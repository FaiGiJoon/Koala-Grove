import test from 'node:test';
import assert from 'node:assert/strict';
import { customPlan, panelStartsCollapsed, postureFor, critterPath, stockText, carried, RESOURCE_COLORS, landRoute, spotFor, animFor, fmtUsd, fmtTokens, freshLog, statusOf, skyAt, walkable } from '../public/js/view.js';
import { PLACES } from '../hq/grove-world.js';

test('koalas at the same place stand apart, and stand beside the pond, not in it', () => {
  const a = spotFor(PLACES, 'clearing', 'crystal', 'sit');
  const b = spotFor(PLACES, 'clearing', 'ruby', 'sit');
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 1.2);
  const p = spotFor(PLACES, 'pond', 'crystal', 'sit');
  assert.ok(Math.hypot(p.x - PLACES.pond.x, p.z - PLACES.pond.z) > 4.5);
  assert.equal(p.y, 0);
});

test('climbing and eating put the koala up in the tree', () => {
  assert.ok(spotFor(PLACES, 'big_gum', 'crystal', 'climb').y > 2);
  assert.ok(spotFor(PLACES, 'big_gum', 'crystal', 'eat').y > 2);
  assert.equal(spotFor(PLACES, 'big_gum', 'crystal', 'sit').y, 0);
  // a baby only gets part of the way up the trunk
  const low = spotFor(PLACES, 'big_gum', 'crystal', 'climb', 0.35).y;
  assert.ok(low > 0.5 && low < spotFor(PLACES, 'big_gum', 'crystal', 'climb').y / 2, `y ${low}`);
  assert.deepEqual(spotFor(PLACES, 'nowhere', 'crystal', 'sit'), { x: 0, z: 0, y: 0 });
});

test('animFor picks the animation from the activity and the place', () => {
  assert.equal(animFor({ activity: 'nap', place: 'hollow' }), 'sleep');
  assert.equal(animFor({ activity: 'eat', place: 'big_gum' }), 'eat');
  assert.equal(animFor({ activity: 'climb', place: 'big_gum' }), 'cling');
  assert.equal(animFor({ activity: 'play', place: 'swing' }), 'swing');
  assert.equal(animFor({ activity: 'play', place: 'pond' }), 'splash');
  assert.equal(animFor({ activity: 'play', place: 'clearing' }), 'ball');
  assert.equal(animFor({ activity: 'move', place: 'lookout' }), 'idle');
});

test('money and tokens read well at koala scale', () => {
  assert.equal(fmtUsd(0), '$0.00');
  assert.equal(fmtUsd(0.0042), '$0.0042');
  assert.equal(fmtUsd(0.1234), '$0.12');
  assert.equal(fmtTokens(950), '950');
  assert.equal(fmtTokens(12345), '12.3k');
  assert.equal(fmtTokens(2_500_000), '2.5M');
});

test('freshLog returns only entries newer than the last one seen', () => {
  const log = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(freshLog(log, 1).map((e) => e.id), [2, 3]);
  assert.deepEqual(freshLog(log, 3), []);
  assert.deepEqual(freshLog(undefined, 0), []);
});

test('statusOf explains why the koalas are or are not thinking', () => {
  const base = { playing: true, present: true, capped: false, koalas: [{ thinking: false }, { thinking: false }] };
  assert.equal(statusOf(base).key, 'live');
  assert.equal(statusOf({ ...base, koalas: [{ thinking: true }, {}] }).key, 'thinking');
  assert.equal(statusOf({ ...base, playing: false }).key, 'paused');
  assert.match(statusOf({ ...base, playing: false, pausedReason: 'Calls failed 3 times' }).text, /failed/);
  assert.equal(statusOf({ ...base, capped: true }).key, 'capped');
  assert.equal(statusOf(null).key, 'offline');
});

test('skyAt: bright at noon, dark at midnight, fireflies only at night', () => {
  const noon = skyAt(0.5);
  const midnight = skyAt(0);
  assert.ok(noon.sun > 0.8);
  assert.ok(midnight.sun < 0.2);
  assert.ok(midnight.night > 0.8);
  assert.equal(noon.night, 0);
  assert.equal(noon.top.length, 3);
});

test('building plays the hammering animation', () => {
  assert.equal(animFor({ activity: 'build', place: 'plot_1' }), 'build');
});

test('walking to new land goes over its bridge, and back again', () => {
  const fern = { id: 'fern_islet', x: 0, z: -36, r: 7 };
  const moss = { id: 'moss_isle', x: -34, z: 17, r: 7 };
  const lands = [fern, moss];
  const out = landRoute({ x: 0, z: 2 }, { x: 0, z: -36 }, lands);
  assert.equal(out.length, 2);
  assert.ok(Math.hypot(out[0].x, out[0].z) < 24, 'starts on the island');
  assert.ok(Math.hypot(out[1].x - fern.x, out[1].z - fern.z) < fern.r, 'ends on the islet');
  assert.deepEqual(landRoute({ x: 0, z: -36 }, { x: 0, z: 2 }, lands), [...out].reverse());
  assert.equal(landRoute({ x: 0, z: 2 }, { x: 5, z: 5 }, lands).length, 0, 'island to island: no bridge');
  assert.equal(landRoute({ x: 1, z: -35 }, { x: -1, z: -37 }, lands).length, 0, 'within one islet');
  assert.equal(landRoute({ x: 0, z: -36 }, { x: -34, z: 17 }, lands).length, 4, 'islet to islet: over both bridges');
});

test('at a build site the koalas stand clear of the build, apart from each other', () => {
  const places = { ...PLACES, plot_1: { name: 'Leaf Hut', x: 3.4, z: 10.3, build: 'hut', done: true } };
  const a = spotFor(places, 'plot_1', 'crystal', 'build');
  const b = spotFor(places, 'plot_1', 'ruby', 'build');
  for (const s of [a, b]) assert.ok(Math.hypot(s.x - 3.4, s.z - 10.3) >= 2.2);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 1.2);
});

test('stockText reads well, skipping empty piles', () => {
  assert.equal(stockText({ wood: 6, sand: 1 }), '6 wood · 1 sand');
  assert.equal(stockText({ sand: 0, stone: 2 }), '2 stone');
  assert.equal(stockText({}), 'empty');
  assert.equal(stockText(undefined), 'empty');
});

test('carried lists each resource unit a koala holds, in resource order', () => {
  assert.deepEqual(carried({ res: { stone: 1, wood: 2 } }), ['wood', 'wood', 'stone']);
  assert.deepEqual(carried({}), []);
  for (const r of ['wood', 'water', 'sand', 'stone', 'book']) assert.match(RESOURCE_COLORS[r], /^#[0-9a-f]{6}$/);
});

test('walking to a bridged resource island crosses its bridge', () => {
  const sandy = { id: 'sandy_shoal', x: 38, z: -6, r: 6.5 };
  const out = landRoute({ x: 0, z: 2 }, { x: 38, z: -6 }, [sandy]);
  assert.equal(out.length, 2);
  assert.ok(Math.hypot(out[1].x - sandy.x, out[1].z - sandy.z) < sandy.r);
});

test('critters keep to their homes: turtles crawl, frogs hop by the pond, birds circle up high', () => {
  const home = { x: 10, z: 2 };
  for (let t = 0; t <= 60; t += 0.25) {
    const turtle = critterPath('turtle', t, home);
    assert.ok(Math.hypot(turtle.x - home.x, turtle.z - home.z) <= 6, `turtle at ${t}`);
    assert.equal(turtle.y, 0);
    const frog = critterPath('frog', t, home, 1);
    assert.ok(Math.hypot(frog.x - home.x, frog.z - home.z) <= 6, `frog at ${t}`);
    assert.ok(frog.y >= 0, `frog under ground at ${t}`);
    const bird = critterPath('bird', t, home, 2);
    assert.ok(bird.y >= 8 && bird.y <= 13, `bird at ${bird.y}`);
    for (const c of [turtle, frog, bird]) assert.ok(Number.isFinite(c.yaw));
  }
  // they move
  assert.notDeepEqual(critterPath('turtle', 0, home), critterPath('turtle', 20, home));
  assert.ok(Array.from({ length: 40 }, (_, i) => critterPath('frog', i * 0.25, home).y).some((y) => y > 0.1), 'frogs hop');
});

test('koala postures follow koala life: fork wedge up a tree, ball curl in the night cold, tree hug in the midday heat', () => {
  assert.equal(postureFor({ anim: 'sleep', place: 'big_gum', hour: 14, inTree: true }), 'fork');
  assert.equal(postureFor({ anim: 'sleep', place: 'hollow', hour: 23, inTree: false }), 'curl');
  assert.equal(postureFor({ anim: 'sleep', place: 'hollow', hour: 6, inTree: false }), 'curl', 'the cold early morning');
  assert.equal(postureFor({ anim: 'sleep', place: 'hollow', hour: 13, inTree: false }), 'sleep');
  assert.equal(postureFor({ anim: 'cling', place: 'river_gum', hour: 13, inTree: true }), 'hug');
  assert.equal(postureFor({ anim: 'cling', place: 'river_gum', hour: 9, inTree: true }), 'cling');
  assert.equal(postureFor({ anim: 'eat', place: 'big_gum', hour: 13, inTree: true }), 'eat');
  assert.equal(postureFor({ anim: 'walk', place: 'pond', hour: 2, inTree: false }), 'walk');
});

test('a koala napping at a gum tree wedges into a fork up the trunk, as high as it can climb', () => {
  const low = spotFor(PLACES, 'big_gum', 'crystal', 'nap', 0.35);
  assert.ok(low.y > 0.5 && low.y < 2.5, `fork at ${low.y}`);
  assert.ok(spotFor(PLACES, 'big_gum', 'crystal', 'nap', 1).y > low.y);
  assert.equal(spotFor(PLACES, 'hollow', 'crystal', 'nap').y, 0, 'no tree: on the ground');
});

test('the side panel starts tucked away when it would cover too much of the grove', () => {
  assert.equal(panelStartsCollapsed(1400), false, 'wide desktop: room for both');
  assert.equal(panelStartsCollapsed(2560), false);
  assert.equal(panelStartsCollapsed(1000), true, 'narrow desktop or tablet: the grove comes first');
  assert.equal(panelStartsCollapsed(375), false, 'phones use the bottom sheet instead');
});

// --- custom builds ---
const SHAPES = ['house', 'tower', 'machine', 'bridge', 'garden', 'statue', 'shelter', 'playground', 'boat'];
const PARTS = ['roof', 'door', 'window', 'flag', 'wheel', 'screen', 'buttons', 'lights', 'chimney', 'slide', 'flowers', 'sign', 'dome', 'stairs', 'bell', 'star'];

test('customPlan: every shape yields a drawable plan with a finite height', () => {
  for (const shape of SHAPES) for (const size of ['small', 'medium', 'big']) {
    const p = customPlan({ shape, size, parts: [], colors: ['blue'] });
    assert.ok(p.parts.length >= 3, shape);
    assert.ok(Number.isFinite(p.height) && p.height > 0, shape);
    for (const q of p.parts) assert.ok(['box', 'cyl', 'cone', 'sphere'].includes(q.type) && q.size.every(Number.isFinite) && q.pos.every(Number.isFinite) && /^#/.test(q.color));
  }
});

test('customPlan: parts add primitives, glowing parts glow, and each part works on every shape', () => {
  for (const shape of SHAPES) {
    const base = customPlan({ shape, size: 'medium', parts: [], colors: [] }).parts.length;
    for (const part of PARTS) assert.ok(customPlan({ shape, size: 'medium', parts: [part], colors: [] }).parts.length > base, `${shape}+${part}`);
  }
  for (const part of ['screen', 'lights', 'star']) assert.ok(customPlan({ shape: 'house', size: 'medium', parts: [part], colors: [] }).parts.some((q) => q.glow), part);
  assert.ok(!customPlan({ shape: 'house', size: 'medium', parts: [], colors: [] }).parts.some((q) => q.glow));
});

test('customPlan: unknown shape falls back to shelter, size scales, colours are used, footprint stays small', () => {
  const a = customPlan({ shape: 'spaceship', size: 'medium', parts: [], colors: [] });
  const b = customPlan({ shape: 'shelter', size: 'medium', parts: [], colors: [] });
  assert.deepEqual(a, b);
  const small = customPlan({ shape: 'tower', size: 'small', parts: [], colors: [] }).height;
  const big = customPlan({ shape: 'tower', size: 'big', parts: [], colors: [] }).height;
  assert.ok(big > small * 1.5);
  const pink = customPlan({ shape: 'house', size: 'medium', parts: ['door'], colors: ['pink'] });
  const blue = customPlan({ shape: 'house', size: 'medium', parts: ['door'], colors: ['blue'] });
  assert.notDeepEqual(pink.parts.map((q) => q.color), blue.parts.map((q) => q.color));
  for (const shape of SHAPES) for (const q of customPlan({ shape, size: 'big', parts: PARTS.slice(0, 8), colors: ['red', 'gold'] }).parts) assert.ok(Math.abs(q.pos[0]) <= 1.6 && Math.abs(q.pos[2]) <= 1.6, `${shape} ${q.type} ${q.pos}`);
  assert.ok(customPlan(undefined).parts.length >= 3);
});

test('statusOf: on instinct the grove is live with no page and past the cap', () => {
  const base = { playing: true, present: false, capped: true, koalas: [{ thinking: false }] };
  assert.equal(statusOf({ ...base, brain: { mode: 'local' } }).key, 'live');
  assert.match(statusOf({ ...base, brain: { mode: 'local' } }).text, /No tokens/);
  assert.equal(statusOf({ ...base, brain: { mode: 'hybrid' } }).key, 'live');
  assert.equal(statusOf({ ...base, capped: false, brain: { mode: 'hybrid' } }).key, 'live');
  assert.equal(statusOf({ ...base, brain: { mode: 'claude' } }).key, 'capped');
  assert.equal(statusOf({ ...base, playing: false, brain: { mode: 'local' } }).key, 'paused');
});

test('a visitor can step from a bridge back onto the main island (and not off the edge)', () => {
  // A fake bridge running out from the island's edge along +x, from radius 21.5 to 30.
  const bridge = (x, z) => (x >= 21.5 && x <= 30 && Math.abs(z) < 0.9 ? 1 : null);
  assert.ok(walkable({ x: 21.5, z: 0 }, bridge), 'the bridge foot is ground');
  assert.ok(walkable({ x: 20, z: 0 }, bridge), 'the main island is ground, so stepping off the bridge onto it is allowed');
  assert.ok(walkable({ x: 0, z: 0 }, bridge));
  assert.ok(!walkable({ x: 25, z: 3 }, bridge), 'beside the bridge, over the sea, is not ground');
  assert.ok(!walkable({ x: 0, z: 25 }, () => null), 'out past the island edge is not ground');
});
