import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalLlm, pickModel } from '../hq/grove-local-llm.js';
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
