import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalLlm, pickModel } from '../hq/grove-local-llm.js';
import { createWeb } from '../hq/grove-web.js';
import { Grove } from '../hq/grove.js';

test('pickModel prefers a good installed model, honours an explicit one, and copes with none', () => {
  assert.equal(pickModel(['qwen2.5:1.5b', 'llama3.2:latest', 'gemma4:e4b']), 'gemma4:e4b');
  assert.equal(pickModel(['qwen2.5:1.5b', 'llama3.2:latest']), 'llama3.2:latest');
  assert.equal(pickModel(['tinyllama:latest']), 'tinyllama:latest');
  assert.equal(pickModel(['qwen2.5:1.5b', 'llama3.2:latest'], 'qwen2.5'), 'qwen2.5:1.5b');
  assert.equal(pickModel([]), null);
});

function fakeOllama(reply, { up = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (!up) throw new Error('ECONNREFUSED');
    if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'llama3.2:latest' }] }) };
    return { ok: true, json: async () => ({ response: JSON.stringify(reply(calls.length)) }) };
  };
  return { fetchImpl, calls };
}

test('read asks Ollama for a JSON page with the chosen model', async () => {
  const o = fakeOllama(() => ({ fact: 'Wombats have cube-shaped droppings.', idea: '', curiosity: 'wombats' }));
  const llm = createLocalLlm({ fetchImpl: o.fetchImpl });
  const page = await llm.read('A koala opens a book about wombats');
  assert.equal(page.fact, 'Wombats have cube-shaped droppings.');
  const gen = o.calls.find((c) => c.url.endsWith('/api/generate'));
  assert.equal(gen.body.model, 'llama3.2:latest');
  assert.equal(gen.body.stream, false);
  assert.ok(gen.body.format.properties.fact);
});

test('with Ollama down, read and diary answer null instead of throwing', async () => {
  const llm = createLocalLlm({ fetchImpl: fakeOllama(() => ({}), { up: false }).fetchImpl });
  assert.equal(await llm.available(), null);
  assert.equal(await llm.read('x'), null);
  assert.equal(await llm.diary('x'), null);
});

// A grove on instinct with a fake local model that writes a new page every time.
function setup(localLlm) {
  let t = new Date(2026, 10, 7, 19, 30).getTime(); // evening: diary time
  const grove = new Grove({
    config: { brain: 'local', localReadsPerDay: 1000 },
    think: async () => { throw new Error('no model calls on instinct'); },
    now: () => t,
    rng: Math.random,
    localLlm,
  });
  return { grove, advance: (ms) => (t += ms) };
}
async function run(grove, advance, minutes) {
  for (let i = 0; i < minutes * 6; i++) {
    advance(10000);
    grove.tick();
    await grove.idle();
  }
}

test('on instinct, the local model writes new pages: the koalas keep learning past the bookshelf', async () => {
  let n = 0;
  const llm = {
    model: 'fake',
    read: async () => ({ fact: `Fresh fact number ${++n} from the local model.`, idea: '', curiosity: '' }),
    diary: async () => null,
  };
  const { grove, advance } = setup(llm);
  grove.play();
  await run(grove, advance, 240);
  const learned = grove.state().koalas.flatMap((k) => k.learned ?? []);
  assert.ok(learned.some((f) => f.startsWith('Fresh fact')), 'learned from the local model');
  assert.equal(grove.state().usage.today.calls, 0);
  grove.close();
});

test('web lookup: finds the Wikipedia article for a topic, and answers null when it cannot', async () => {
  const urls = [];
  const web = createWeb({
    fetchImpl: async (url) => {
      urls.push(url);
      return { ok: true, json: async () => ({ query: { pages: [{ title: 'Cepheid variable', extract: 'A Cepheid is a star that pulsates.', fullurl: 'https://en.wikipedia.org/wiki/Cepheid_variable' }] } }) };
    },
  });
  const hit = await web.lookup('Cepheid');
  assert.equal(hit.title, 'Cepheid variable');
  assert.equal(hit.extract, 'A Cepheid is a star that pulsates.');
  assert.match(urls[0], /^https:\/\/en\.wikipedia\.org\/w\/api\.php\?/);
  assert.match(urls[0], /gsrsearch=Cepheid/);

  // an article that only happens to match, like "Headless Horseman" for sleepy animals, is no answer
  const article = (title) => createWeb({ fetchImpl: async () => ({ ok: true, json: async () => ({ query: { pages: [{ title, extract: 'Some text.' }] } }) }) });
  assert.equal(await article('Headless Horseman').lookup('sleepy animals'), null);
  assert.equal((await article('Koala').lookup('How do koalas find water?')).title, 'Koala');
  assert.equal(await article('What Women Want').lookup('What is water?'), null);

  assert.equal(await createWeb({ fetchImpl: async () => { throw new Error('offline'); } }).lookup('x'), null);
  assert.equal(await createWeb({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }).lookup('x'), null);
  assert.equal(await createWeb({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }) }).lookup('x'), null);
});

function groveWithWeb(llm, lookup, researchPerDay) {
  let t = new Date(2026, 10, 7, 8, 0).getTime();
  const grove = new Grove({
    config: { brain: 'local', localReadsPerDay: 1000, researchPerDay },
    think: async () => { throw new Error('no Claude on instinct'); },
    now: () => t,
    rng: Math.random,
    localLlm: llm,
    web: { lookup },
    github: null,
  });
  return { grove, advance: (ms) => (t += ms) };
}

test('on instinct, a koala looks things up on the real web and the local model writes it down, without Claude', async () => {
  const prompts = [];
  let n = 0;
  const llm = {
    model: 'fake',
    read: async (p) => { prompts.push(p); return { fact: `Web fact number ${++n} from the article.`, idea: '', curiosity: '' }; },
    diary: async () => null,
  };
  let lookups = 0;
  const { grove, advance } = groveWithWeb(llm, async () => { lookups++; return { title: 'Koala', extract: 'Koalas sleep most of the day.', url: 'u' }; }, 2);
  grove.play();
  const seen = []; // the state only carries the latest log rows, so collect them along the way
  for (let m = 0; m < 240; m++) {
    await run(grove, advance, 1);
    seen.push(...grove.state().log);
  }
  assert.ok(prompts.some((p) => p.includes('Koalas sleep most of the day.')), 'the article reaches the local model');
  assert.ok(seen.some((l) => l.kind === 'learn' && /on the web/.test(l.text)), 'remembered as found on the web');
  assert.equal(lookups, 2, 'no more than the day\'s research limit');
  assert.ok(prompts.length > 2, 'after the limit the koalas go on reading books');
  assert.equal(grove.state().usage.today.calls, 0, 'nothing spent');
  grove.close();
});

test('on instinct, a failed web lookup falls back to an ordinary book', async () => {
  const llm = {
    model: 'fake',
    read: async () => ({ fact: 'A fact from an ordinary book page.', idea: '', curiosity: '' }),
    diary: async () => null,
  };
  const { grove, advance } = groveWithWeb(llm, async () => null, 16);
  grove.play();
  const learns = []; // the state only carries the latest log rows, so collect them along the way
  for (let m = 0; m < 240; m++) {
    await run(grove, advance, 1);
    learns.push(...grove.state().log.filter((l) => l.kind === 'learn'));
  }
  assert.ok(learns.length > 0, 'still learning');
  assert.ok(!learns.some((l) => /on the web/.test(l.text)), 'not claimed as the web');
  grove.close();
});

test('each koala writes one diary entry a day when it goes to sleep: a memory and a new trait', async () => {
  let diaries = 0;
  const llm = {
    model: 'fake',
    read: async () => null,
    diary: async () => ({ memory: `Today was a lovely day number ${++diaries}.`, trait: 'I like the quiet before sleep.' }),
  };
  const { grove, advance } = setup(llm);
  grove.play();
  await run(grove, advance, 120);
  const ks = grove.state().koalas;
  assert.ok(diaries >= 1 && diaries <= ks.length, `wrote ${diaries} diaries, at most one per koala per day`);
  const writer = ks.find((k) => (k.memories ?? []).some((m) => m.startsWith('Today was a lovely day')));
  assert.ok(writer, 'a memory was kept');
  assert.ok(writer.traits.includes('I like the quiet before sleep.'), 'a trait was added');
  grove.close();
});
