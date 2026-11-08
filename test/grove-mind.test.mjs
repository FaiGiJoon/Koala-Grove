import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  mindOf, needsOf, driftMind, satisfy, notice, recall, learn, beliefBoost, consolidate, experience, onBuilt, promise, publicMind, holdsTo,
} from '../hq/grove-mind.js';
import { newKoala, applyDecision, parseDecision, placesOf, drift, groveClock, friendOf } from '../hq/grove-world.js';
import { instinctDecide } from '../hq/grove-instinct.js';
import { Grove } from '../hq/grove.js';
import { createApp } from '../hq/http.js';

const T = Date.UTC(2026, 10, 8, 10);

test('a mind starts from what the koala already remembers', () => {
  const k = { ...newKoala('ruby'), memories: ['The day the bridge was built.'] };
  assert.equal(mindOf(k).long[0].text, 'The day the bridge was built.');
});

test('drives build up over time, at each koala\'s own pace, and actions meet them', () => {
  const c = newKoala('crystal');
  const r = newKoala('ruby');
  driftMind(c, 30);
  driftMind(r, 30);
  assert.ok(needsOf(c).curiosity > needsOf(r).curiosity, 'Crystal gets curious faster');
  assert.ok(needsOf(r).quiet > needsOf(c).quiet, 'Ruby needs quiet sooner');
  const before = needsOf(c).curiosity;
  satisfy(c, { action: 'read' });
  assert.ok(needsOf(c).curiosity < before);
  c.energy = 10;
  assert.equal(needsOf(c).rest, 0.9);
});

test('memory is small on purpose: only strong or recalled moments survive the night', () => {
  const k = newKoala('crystal');
  notice(k, 'Saw a frog once.', 'moment', T);
  notice(k, 'Played at the Lily Pond.', 'moment', T);
  notice(k, 'Played at the Lily Pond.', 'moment', T); // again: stronger, not doubled
  notice(k, 'The big storm.', 'moment', T, 3);
  assert.equal(mindOf(k).short.length, 3);
  consolidate(k, T);
  assert.deepEqual(k.memories.sort(), ['Played at the Lily Pond.', 'The big storm.']);
  for (let i = 0; i < 30; i++) notice(k, `Moment ${i}`, 'moment', T + i, 3);
  consolidate(k, T + 100);
  assert.equal(k.memories.length, 12);
  assert.equal(mindOf(k).short.length, 0);
});

test('recall strengthens memories about where the koala is', () => {
  const k = newKoala('ruby');
  notice(k, 'Read at the Library Isle.', 'moment', T, 2);
  assert.equal(recall(k, ['Library Isle']), 1);
  assert.equal(mindOf(k).short[0].recalled, 0.25);
});

test('beliefs carry evidence, grow with good experiences and fade with bad ones', () => {
  const k = newKoala('crystal');
  for (let i = 0; i < 3; i++) learn(k, 'play@pond', 'Playing at the pond makes me happy.');
  assert.equal(beliefBoost(k, { action: 'play', target: 'pond' }, 'stockpile'), 3);
  for (let i = 0; i < 3; i++) learn(k, 'play@pond', 'x', -1);
  assert.equal(beliefBoost(k, { action: 'play', target: 'pond' }, 'stockpile'), 0);
  assert.equal(mindOf(k).beliefs.length, 0, 'a belief with no evidence left is dropped');
});

test('experience: a promise made by starting a build is kept when it is finished', () => {
  const world = { koalas: { crystal: newKoala('crystal'), ruby: newKoala('ruby') }, builds: [], stock: { wood: 10, stone: 4 } };
  const c = world.koalas.crystal;
  const d = { action: 'build', target: 'bench', mood: 'happy', say: '', thought: '', remember: '', bond: 0 };
  const logs = applyDecision(world, 'crystal', parseDecision(d, c, placesOf(world)));
  experience(c, d, { place: c.place, placeName: 'plot', friend: 'Ruby', logs, now: T });
  assert.equal(mindOf(c).promises.length, 1);
  const kept = onBuilt([c, world.koalas.ruby], `Crystal finished the ${world.builds[0].title}!`, T);
  assert.equal(kept.length, 1);
  assert.ok(mindOf(c).short.some((m) => m.text.startsWith('I kept my promise')));
  assert.ok(mindOf(c).beliefs.some((b) => b.key === 'promises'));
});

test('promises left too long turn into a worry', () => {
  const k = newKoala('ruby');
  promise(k, 'finish the Moon Bench', 'build', T);
  consolidate(k, T + 4 * 24 * 3600000);
  assert.equal(mindOf(k).promises.length, 0);
  assert.match(mindOf(k).worries[0], /Moon Bench/);
});

test('over a long life, the two koalas grow different: their own beliefs and habits', () => {
  const world = { koalas: { crystal: newKoala('crystal'), ruby: newKoala('ruby') }, builds: [], stock: { wood: 4 } };
  let s = 5;
  const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const counts = { crystal: {}, ruby: {} };
  for (let i = 0; i < 600; i++) {
    for (const id of ['crystal', 'ruby']) {
      const k = world.koalas[id];
      const d = parseDecision(instinctDecide(world, id, groveClock(i * 30000), rng), k, placesOf(world));
      const logs = applyDecision(world, id, d);
      const f = friendOf(world, id);
      experience(k, d, { place: k.place, placeName: placesOf(world)[k.place]?.name, friend: f.name, together: f.place === k.place, logs, now: T + i * 30000 });
      for (const e of logs) if (e.kind === 'built') onBuilt(Object.values(world.koalas), e.text, T);
      counts[id][d.action] = (counts[id][d.action] ?? 0) + 1;
      for (const x of Object.values(world.koalas)) { drift(x, 0.5); driftMind(x, 0.5); }
    }
    if (i % 120 === 119) for (const x of Object.values(world.koalas)) consolidate(x, T + i * 30000);
  }
  const c = mindOf(world.koalas.crystal);
  const r = mindOf(world.koalas.ruby);
  assert.ok(c.beliefs.length >= 3 && r.beliefs.length >= 3, 'both learned lessons');
  assert.notDeepEqual(c.beliefs.map((b) => b.key), r.beliefs.map((b) => b.key), 'different lessons');
  assert.ok((counts.ruby.read ?? 0) > (counts.crystal.read ?? 0), 'Ruby reads more');
  assert.ok((counts.crystal.play ?? 0) > (counts.ruby.play ?? 0), 'Crystal plays more');
  assert.ok(world.koalas.crystal.memories.length > 0, 'memories were kept');
  assert.deepEqual(holdsTo(world.koalas.ruby).length, 3);
});

test('the public API: now, mind, memories, who and feed, read-only, open to any origin', async () => {
  let t = T;
  const grove = new Grove({ config: { brain: 'local' }, now: () => t, think: async () => { throw new Error('no'); } });
  grove.play();
  for (let i = 0; i < 60; i++) { t += 10000; grove.tick(); await grove.idle(); }
  const server = createApp({ grove, publicDir: new URL('../public', import.meta.url).pathname });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address();
  const get = (p, headers = {}) => new Promise((ok, no) => {
    http.get({ host: '127.0.0.1', port, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c)).on('end', () => ok({ status: res.statusCode, headers: res.headers, body: b ? JSON.parse(b) : null }));
    }).on('error', no);
  });
  try {
    const now = await get('/api/v1/now', { origin: 'https://faigijoon.github.io' });
    assert.equal(now.status, 200);
    assert.equal(now.headers['access-control-allow-origin'], '*');
    assert.equal(now.body.v, 1);
    assert.equal(now.body.koalas.length, 2);
    assert.ok('curiosity' in now.body.koalas[0].needs);
    const mind = await get('/api/v1/mind?koala=ruby');
    assert.equal(mind.body.koalas[0].name, 'Ruby');
    assert.ok(mind.body.koalas[0].holdsTo.includes('Rest is never wasted.'));
    const mem = await get('/api/v1/memories?koala=crystal');
    assert.ok(Array.isArray(mem.body.koalas[0].long));
    const who = await get('/api/v1/who');
    assert.ok(who.body.koalas.every((k) => k.holdsTo.length));
    const feed = await get('/api/v1/feed?limit=5');
    assert.ok(feed.body.feed.length <= 5 && feed.body.feed.length > 0);
    assert.equal((await get('/api/v1/mind?koala=nobody')).status, 404);
    assert.equal((await get('/api/v1/nope')).status, 404);
    assert.equal((await get('/api/grove', { origin: 'https://evil.example' })).status, 403, 'the private API stays private');
    assert.equal((await get('/api/v1/now', { host: 'grove.example.ts.net' })).status, 403, 'unknown hosts are refused');
  } finally {
    server.close();
    grove.close();
  }
});
