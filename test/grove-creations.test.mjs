import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCreation, slotFor, MAX_PARTS } from '../hq/grove-creations.js';

test('a valid creation keeps its name and parts', () => {
  const c = parseCreation({ name: 'Red Tower', parts: [{ shape: 'cylinder', size: [1, 4, 1], at: [0, 2, 0], color: '#c23b3b' }] });
  assert.equal(c.name, 'Red Tower');
  assert.deepEqual(c.parts[0], { shape: 'cylinder', size: [1, 4, 1], at: [0, 2, 0], color: '#c23b3b', rotY: 0 });
});

test('JSON text with extra words around it is still read', () => {
  const c = parseCreation('Here it is: {"name":"Moon Cradle","parts":[{"shape":"sphere","size":[2,2,2]}]} enjoy');
  assert.equal(c.name, 'Moon Cradle');
  assert.deepEqual(c.parts[0].at, [0, 0, 0]);
});

test('unknown shapes are dropped, bad colours fall back, sizes and positions are clamped', () => {
  const c = parseCreation({ name: 'X', parts: [
    { shape: 'pyramid', size: [1, 1, 1] },
    { shape: 'box', size: [999, -5, 0.001], at: [50, -50, 3], color: 'pink', rotY: 900 },
  ] });
  assert.equal(c.parts.length, 1);
  assert.deepEqual(c.parts[0].size, [8, 0.05, 0.05]);
  assert.deepEqual(c.parts[0].at, [7, -7, 3]);
  assert.equal(c.parts[0].color, '#8a6a4a');
  assert.equal(c.parts[0].rotY, 360);
});

test('nothing buildable gives null: no name, no parts, or broken text', () => {
  assert.equal(parseCreation(''), null);
  assert.equal(parseCreation({ name: '', parts: [{ shape: 'box' }] }), null);
  assert.equal(parseCreation({ name: 'Empty', parts: [] }), null);
  assert.equal(parseCreation('{not json'), null);
});

test('parts beyond the limit are not kept', () => {
  const parts = Array.from({ length: MAX_PARTS + 10 }, () => ({ shape: 'box' }));
  assert.equal(parseCreation({ name: 'Many', parts }).parts.length, MAX_PARTS);
});

test('creations stand outside the island and never on the same spot', () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const s = slotFor(i);
    assert.ok(Math.hypot(s.x, s.z) >= 24 + 6, `creation ${i} is clear of the island`);
    const key = `${s.x},${s.z}`;
    assert.ok(!seen.has(key), `creation ${i} has its own spot`);
    seen.add(key);
  }
});
