import test from 'node:test';
import assert from 'node:assert/strict';
import { Grove } from '../hq/grove.js';
import { castOf } from '../hq/config.js';
import { friendOf, buildPrompt, systemPrompt, applyDecision } from '../hq/grove-world.js';

function solo() {
  let t = Date.UTC(2026, 10, 10, 12);
  const grove = new Grove({ path: ':memory:', config: { cast: ['ruby'], dayUsd: 1 }, think: async () => ({ ok: true, raw: { action: 'sit' }, usage: {} }), now: () => t, rng: () => 0.5 });
  return { grove, advance: (ms) => (t += ms) };
}

test('GROVE_KOALAS: default is both koalas, "ruby" is a solo grove, anything else is refused', () => {
  assert.deepEqual(castOf(undefined), ['crystal', 'ruby']);
  assert.deepEqual(castOf('ruby'), ['ruby']);
  assert.deepEqual(castOf(' Ruby , ruby '), ['ruby']);
  assert.throws(() => castOf('pip'), /GROVE_KOALAS/);
});

test('a solo grove holds only Ruby, and nobody is her friend', () => {
  const { grove } = solo();
  assert.deepEqual(Object.keys(grove.world.koalas), ['ruby']);
  assert.equal(friendOf(grove.world, 'ruby'), null);
});

test('a solo grove builds its prompts without a friend and without Crystal', () => {
  const { grove } = solo();
  const prompt = buildPrompt(grove.world, 'ruby', { label: 'day', phase: 'day' });
  const system = systemPrompt('ruby', grove.world);
  assert.doesNotMatch(prompt + system, /Crystal/);
  assert.match(prompt, /alone/);
  assert.doesNotMatch(prompt, /approach \(go to/);
});

test('a new wish files one ticket in Ruby\'s own words; repeating the wish files none', async () => {
  let t = Date.UTC(2026, 10, 10, 12);
  const usage = { cost_usd: 0.002, tokens_in: 1500, tokens_out: 80, duration_ms: 900 };
  const brain = async () => ({ ok: true, raw: { action: 'sit', say: '', mood: 'content', wish: 'Grow a garden of flowers' }, usage });
  const grove = new Grove({ path: ':memory:', config: { cast: ['ruby'], dayUsd: 1 }, think: brain, now: () => t, rng: () => 0.5 });
  grove.play();
  for (let i = 0; i < 3; i++) {
    t += 70000;
    grove.heartbeat();
    grove.tick();
    await grove.idle();
  }
  assert.deepEqual(grove.tickets.list().map((x) => x.text), ['I wish: Grow a garden of flowers']);
  const o = grove.dashboard().overview;
  assert.equal(o.name, 'Ruby');
  assert.equal(o.wish, 'Grow a garden of flowers');
  assert.equal(o.openTickets.length, 1);
});

test('a solo grove turns approach, give and nest into sitting', () => {
  const { grove } = solo();
  for (const action of ['approach', 'give', 'nest']) {
    const d = { thought: '', action, target: 'pebble', say: '', mood: 'happy', remember: '', bond: 0, opinion: '', build_name: '', build_design: '', wish: '', trait: '' };
    const logs = applyDecision(grove.world, 'ruby', d);
    assert.ok(logs.every((l) => l.action !== action), `${action} should not happen alone`);
    assert.ok(logs.some((l) => l.action === 'sit'), `${action} should become sit`);
  }
});

test('Ruby never says "we", "us" or "our" in her own thoughts or words', async () => {
  const { instinctDecide } = await import('../hq/grove-instinct.js');
  const { grove } = solo();
  // a seeded generator, so the sample is the same every run
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const said = [];
  for (let i = 0; i < 400; i++) {
    const d = instinctDecide(grove.world, 'ruby', { phase: i % 2 ? 'day' : 'night' }, rng);
    said.push(d.thought ?? '', d.say ?? '');
  }
  const bad = said.filter((line) => /\b(we|us|our|let us)\b/i.test(line));
  assert.deepEqual(bad, []);
});

test('a fourth wish while three tickets are open is kept but files no ticket', async () => {
  let t = Date.UTC(2026, 10, 10, 12);
  const usage = { cost_usd: 0.002, tokens_in: 1500, tokens_out: 80, duration_ms: 900 };
  let n = 0;
  const wishes = ['Grow flowers', 'Climb the tallest tree', 'Watch the stars', 'Make a bridge'];
  const brain = async () => ({ ok: true, raw: { action: 'sit', say: '', mood: 'content', wish: wishes[Math.min(n++, wishes.length - 1)] }, usage });
  const grove = new Grove({ path: ':memory:', config: { cast: ['ruby'], dayUsd: 1 }, think: brain, now: () => t, rng: () => 0.5 });
  grove.play();
  for (let i = 0; i < 4; i++) {
    t += 70000;
    grove.heartbeat();
    grove.tick();
    await grove.idle();
  }
  assert.equal(grove.tickets.list().length, 3);
  assert.equal(grove.world.koalas.ruby.wish, 'Make a bridge');
});

test('every model call records why it was made and what it chose', async () => {
  let t = Date.UTC(2026, 10, 10, 12);
  const usage = { cost_usd: 0.002, tokens_in: 1500, tokens_out: 80, duration_ms: 900 };
  const brain = async () => ({ ok: true, raw: { action: 'sit', say: '', mood: 'content' }, usage });
  const grove = new Grove({ path: ':memory:', config: { cast: ['ruby'], dayUsd: 1, brain: 'claude' }, think: brain, now: () => t, rng: () => 0.5 });
  grove.play();
  t += 70000;
  grove.heartbeat();
  grove.tick();
  await grove.idle();
  const [call] = grove.dashboard().calls;
  assert.ok(call, 'a model call was recorded');
  assert.equal(call.kind, 'decide');
  assert.equal(call.action, 'sit');
  assert.match(call.reason, /claude brain/);
  assert.ok(call.prompt_chars > 100);
});

test('a koala invents a creation and it is built in the open field', async () => {
  let t = Date.UTC(2026, 10, 10, 12);
  const usage = { cost_usd: 0.002, tokens_in: 1500, tokens_out: 80, duration_ms: 900 };
  const creation = { name: 'Red Unicorn Town Hall', parts: [{ shape: 'box', size: [3, 2, 3], at: [0, 1, 0], color: '#c23b3b' }, { shape: 'sphere', size: [1, 1, 1], at: [0, 3, 0], color: '#ffffff' }] };
  const brain = async () => ({ ok: true, raw: { action: 'sit', say: '', mood: 'content', creation }, usage });
  const grove = new Grove({ path: ':memory:', config: { cast: ['ruby'], dayUsd: 1, brain: 'claude' }, think: brain, now: () => t, rng: () => 0.5 });
  grove.play();
  t += 70000;
  grove.heartbeat();
  grove.tick();
  await grove.idle();
  const st = grove.state();
  assert.equal(st.creations.length, 1);
  assert.equal(st.creations[0].name, 'Red Unicorn Town Hall');
  assert.equal(st.creations[0].koala, 'ruby');
  assert.equal(st.creations[0].parts.length, 2);
  assert.ok(st.log.some((e) => e.kind === 'creation'), 'the creation is in the log');
});
