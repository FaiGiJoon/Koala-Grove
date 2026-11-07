import test from 'node:test';
import assert from 'node:assert/strict';
import { instinctDecide, instinctRead, freshEvents, BOOKS } from '../hq/grove-instinct.js';
import { newKoala, parseDecision, applyDecision, placesOf, drift, groveClock, ACTIONS, DECISION_SCHEMA } from '../hq/grove-world.js';
import { Grove } from '../hq/grove.js';
import { brainMode } from '../hq/config.js';

// A seeded rng, so a failing run can be replayed.
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const freshWorld = () => ({ koalas: { crystal: newKoala('crystal'), ruby: newKoala('ruby') }, builds: [], stock: { wood: 4 } });

test('instinct answers with every field the model schema asks for', () => {
  const raw = instinctDecide(freshWorld(), 'crystal', groveClock(0), seeded(3));
  for (const key of DECISION_SCHEMA.required) assert.ok(key in raw, `missing ${key}`);
  assert.ok(ACTIONS.includes(raw.action));
});

test('left alone on instinct for a long while, the koalas eat, sleep, gather, build and grow', () => {
  const world = freshWorld();
  const rng = seeded(7);
  const seen = new Set();
  for (let i = 0; i < 600; i++) {
    for (const id of Object.keys(world.koalas)) {
      const raw = instinctDecide(world, id, groveClock(i * 30000), rng);
      const d = parseDecision(raw, world.koalas[id], placesOf(world));
      assert.ok(d, 'always a decision');
      applyDecision(world, id, d);
      seen.add(d.action);
      for (const k of Object.values(world.koalas)) drift(k, 0.5);
    }
  }
  for (const a of ['eat', 'nap', 'gather', 'store', 'build', 'play', 'move']) assert.ok(seen.has(a), `never did ${a}`);
  const done = world.builds.filter((b) => b.done);
  assert.ok(done.length >= 4, `only ${done.length} builds finished`);
  assert.ok(new Set(done.map((b) => b.kind)).size >= 3, 'builds are varied, not the same bench again and again');
  for (const k of Object.values(world.koalas)) {
    assert.ok(k.strength > 20, `${k.name} grew stronger`);
    assert.ok(k.hunger < 95, `${k.name} is not starving`);
  }
});

test('needs come first: a hungry koala eats, an exhausted one naps, full paws are carried home', () => {
  const rng = () => 0.5;
  const hungry = freshWorld();
  hungry.koalas.ruby.hunger = 95;
  assert.equal(instinctDecide(hungry, 'ruby', groveClock(0), rng).action, 'eat');
  const tired = freshWorld();
  tired.koalas.crystal.energy = 5;
  assert.equal(instinctDecide(tired, 'crystal', groveClock(0), rng).action, 'nap');
  const full = freshWorld();
  Object.assign(full.koalas.crystal, { res: { wood: 2 }, place: 'big_gum' });
  assert.equal(instinctDecide(full, 'crystal', groveClock(0), rng).action, 'store');
});

test('a gift from the visitor gets a thank-you', () => {
  const world = freshWorld();
  world.koalas.crystal.recent.push('You sat and looked around.', 'The visitor gave you a feather.');
  assert.deepEqual(freshEvents(world.koalas.crystal), ['The visitor gave you a feather.']);
  const d = instinctDecide(world, 'crystal', groveClock(0), () => 0.5);
  assert.match(d.say, /feather/);
});

test('the bookshelf answers the topic asked, never twice the same page, then runs out', () => {
  const k = { ...newKoala('ruby'), learned: [] };
  const page = instinctRead(k, 'the moon', () => 0);
  assert.match(page.fact, /Moon/);
  k.learned = BOOKS.map((b) => b.fact).filter((f) => f !== BOOKS[0].fact);
  assert.equal(instinctRead(k, 'anything', () => 0).fact, BOOKS[0].fact);
  k.learned = BOOKS.map((b) => b.fact);
  assert.equal(instinctRead(k, 'anything', () => 0), null);
});

// A grove whose model brain must never be called unless the test says so.
function setup(config = {}) {
  let t = Date.UTC(2026, 10, 7, 12);
  const calls = [];
  const grove = new Grove({
    config: { dayUsd: 1, ...config },
    think: async (req) => {
      calls.push(req);
      return { ok: true, raw: { action: 'sit', say: 'model', mood: 'content' }, usage: { cost_usd: 0.002, tokens_in: 1000, tokens_out: 50, duration_ms: 500 } };
    },
    now: () => t,
    rng: seeded(11),
  });
  return { grove, calls, advance: (ms) => (t += ms) };
}
async function run(grove, advance, minutes, beat = false) {
  for (let i = 0; i < minutes * 6; i++) {
    advance(10000);
    if (beat) grove.heartbeat();
    grove.tick();
    await grove.idle();
  }
}

test('local brain: the koalas live with no page open, spend nothing and count their free decisions', async () => {
  const { grove, calls, advance } = setup({ brain: 'local' });
  grove.play();
  await run(grove, advance, 30);
  const st = grove.state();
  assert.equal(calls.length, 0, 'no model calls');
  assert.equal(st.usage.today.calls, 0);
  assert.equal(st.usage.today.cost, 0);
  assert.equal(st.brain.mode, 'local');
  assert.ok(st.brain.free.today >= 40, `only ${st.brain.free.today} free decisions in 30 minutes`);
  assert.ok(st.log.some((e) => e.kind === 'act'), 'they did things');
  grove.close();
});

test('local brain keeps going past the spend cap, and Pause still stops it', async () => {
  const { grove, calls, advance } = setup({ brain: 'local', dayUsd: 0.000001 });
  grove.play();
  await run(grove, advance, 5);
  const before = grove.state().brain.free.today;
  assert.ok(before > 0);
  grove.pause();
  await run(grove, advance, 5);
  assert.equal(grove.state().brain.free.today, before);
  assert.equal(calls.length, 0);
  grove.close();
});

test('hybrid: instinct while nobody watches, a model call when a koala is spoken to', async () => {
  const { grove, calls, advance } = setup({ brain: 'hybrid', hybridEvery: 1000 });
  grove.play();
  await run(grove, advance, 5);
  assert.equal(calls.length, 0, 'no page, no model calls');
  assert.ok(grove.state().brain.free.today > 0);
  grove.heartbeat();
  grove.act({ koala: 'ruby', kind: 'say', text: 'Hello Ruby!' });
  await run(grove, advance, 1, true);
  assert.ok(calls.some((c) => c.koala === 'ruby'), 'Ruby answered with a real model call');
  grove.close();
});

test('setBrain switches the mode, persists it and refuses nonsense', () => {
  const { grove } = setup();
  assert.equal(grove.state().brain.mode, 'claude');
  grove.setBrain('local');
  assert.equal(grove.state().brain.mode, 'local');
  assert.throws(() => grove.setBrain('psychic'), /brain must be one of/);
  grove.close();
});

test('autoStart wakes a never-played grove on instinct, but not a paused one', () => {
  const a = setup({ brain: 'local', autoStart: true });
  a.grove.start();
  assert.equal(a.grove.state().playing, true);
  a.grove.close();
  const b = setup({ brain: 'local', autoStart: true });
  b.grove.pause();
  b.grove.start();
  assert.equal(b.grove.state().playing, false);
  b.grove.close();
});

test('GROVE_BRAIN defaults to local and accepts only the three modes', () => {
  assert.equal(brainMode(undefined), 'local');
  assert.equal(brainMode('Hybrid'), 'hybrid');
  assert.throws(() => brainMode('gpt'), /GROVE_BRAIN/);
});
