import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../hq/http.js';
import { Grove } from '../hq/grove.js';

const SECRET = 'TOP-SECRET-SENTINEL';
let tmp, dir, server, base, port, grove, canSymlink = true;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'grove-http-'));
  dir = path.join(tmp, 'public');
  await fs.mkdir(dir);
  await fs.writeFile(path.join(tmp, 'secret.txt'), SECRET);
  // Windows only allows symlinks with extra rights; the symlink case is skipped there.
  try { await fs.symlink(path.join(tmp, 'secret.txt'), path.join(dir, 'link.txt')); } catch { canSymlink = false; }
  await fs.writeFile(path.join(dir, 'index.html'), '<h1>grove</h1>');
  await fs.writeFile(path.join(dir, 'app.js'), 'export {}');
  grove = new Grove({ think: async () => ({ ok: true, raw: { action: 'sit' }, usage: null }) });
  server = createApp({ grove, publicDir: dir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  grove.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

const post = (url, body = {}, headers = {}) =>
  fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

function rawGet(rawPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET /api/grove returns both koalas, the places and the real usage meter', async () => {
  const s = await (await fetch(base + '/api/grove')).json();
  assert.deepEqual(s.koalas.map((k) => k.id), ['crystal', 'ruby']);
  assert.ok(s.places.pond);
  assert.equal(s.playing, false);
  assert.equal(s.usage.today.cost, 0);
});

test('play, heartbeat and pause need a JSON POST from this origin', async () => {
  assert.equal((await post('/api/grove/play', {}, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post('/api/grove/play', {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(base + '/api/grove/play', { method: 'POST' })).status, 415, 'body-less POST');
  assert.equal(grove.playing, false);
  assert.equal((await (await post('/api/grove/play')).json()).playing, true);
  assert.equal((await post('/api/grove/heartbeat')).status, 200);
  assert.equal(grove.present, true);
  assert.equal((await (await post('/api/grove/pause', {}, { origin: `http://localhost:${port}` })).json()).playing, false);
});

test('act gives, and bad requests get their status', async () => {
  const res = await post('/api/grove/act', { koala: 'crystal', kind: 'give', item: 'pebble' });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).koalas[0].inventory, ['pebble']);
  assert.equal((await post('/api/grove/act', { koala: 'crystal', kind: 'give', item: 'gold' })).status, 400);
  assert.equal((await post('/api/grove/act', { koala: 'nobody', kind: 'pet' })).status, 404);
  assert.equal((await post('/api/grove/nope')).status, 404);
  assert.equal((await post('/api/tickets', { title: 'x' })).status, 404, 'the ticket board is gone');
});

test('changes stream over /api/events as "grove" frames', { timeout: 5000 }, async () => {
  const ctrl = new AbortController();
  const res = await fetch(base + '/api/events', { signal: ctrl.signal });
  const reader = res.body.getReader();
  await reader.read(); // ": connected"
  await post('/api/grove/act', { koala: 'ruby', kind: 'pet' });
  let text = '';
  while (!text.includes('event: grove')) text += new TextDecoder().decode((await reader.read()).value);
  ctrl.abort();
  assert.match(text, /patted Ruby/);
});

test('foreign Host header is 403 on every route; localhost is allowed', async () => {
  assert.equal((await rawGet('/', { Host: `evil.example:${port}` })).status, 403);
  assert.equal((await rawGet('/api/grove', { Host: `evil.example:${port}` })).status, 403);
  assert.equal((await rawGet('/api/grove', { Host: '127.0.0.1:1' })).status, 403);
  assert.equal((await rawGet('/api/grove', { Host: `localhost:${port}` })).status, 200);
  assert.equal((await rawGet('/', { Host: `127.0.0.1:${port}` })).status, 200);
  assert.equal((await fetch(base + '/api/grove', { headers: { origin: 'https://evil.example' } })).status, 403);
});

test('static files: the grove at /, content types, traversal is 404', async () => {
  const idx = await fetch(base + '/');
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get('content-type'), /text\/html/);
  assert.equal(await idx.text(), '<h1>grove</h1>');
  assert.match((await fetch(base + '/app.js')).headers.get('content-type'), /javascript/);
  assert.equal((await fetch(base + '/missing.png')).status, 404);
  const probes = ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%00', `/${tmp}/secret.txt`, `/${path.join(tmp, 'secret.txt')}`];
  if (canSymlink) probes.push('/link.txt');
  for (const p of probes) {
    const r = await rawGet(p);
    assert.equal(r.status, 404, p);
    assert.ok(!r.body.includes(SECRET), p);
  }
});

test('bodies over 16 KB are 413', async () => {
  const res = await post('/api/grove/act', { koala: 'crystal', kind: 'say', text: 'a'.repeat(20 * 1024) });
  assert.equal(res.status, 413);
});

test('POST /api/grove/time moves the clock; a bad time is 400', async () => {
  const res = await post('/api/grove/time', { to: 'noon' });
  assert.equal(res.status, 200);
  assert.match((await res.json()).clock.label, /12:00/);
  assert.equal((await post('/api/grove/time', { to: 'teatime' })).status, 400);
  assert.equal((await post('/api/grove/time', { to: 'noon' }, { 'content-type': 'text/plain' })).status, 415);
});

test('POST /api/grove/name names a newborn; anyone older is 409; bad names 400', async () => {
  grove.world.baby = { due: 0, parents: ['crystal', 'ruby'] };
  grove.play();
  grove.heartbeat();
  grove.tick();
  const pip = grove.state().koalas.find((k) => k.parents);
  assert.ok(pip);
  assert.equal((await post('/api/grove/name', { koala: pip.id, name: 'Sky' })).status, 200);
  assert.equal((await post('/api/grove/name', { koala: 'ruby', name: 'Bob' })).status, 409);
  assert.equal((await post('/api/grove/name', { koala: pip.id, name: '' })).status, 400);
  assert.equal((await post('/api/grove/name', { koala: pip.id, name: 'x'.repeat(30) })).status, 400);
  assert.equal((await post('/api/grove/name', { koala: pip.id, name: 'Sky' }, { 'content-type': 'text/plain' })).status, 415);
  grove.pause();
});

test('ticket routes: reply and close need JSON from this origin; unknown ids 404; long text 400', async () => {
  const t = grove.tickets.open('crystal', 'We need more water');
  assert.equal((await post(`/api/grove/tickets/${t.id}/reply`, { text: 'The pond has plenty!' })).status, 200);
  assert.equal((await post(`/api/grove/tickets/${t.id}/reply`, { text: 'x'.repeat(301) })).status, 400);
  assert.equal((await post(`/api/grove/tickets/${t.id}/reply`, { text: 'hi' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/api/grove/tickets/999/reply', { text: 'hi' })).status, 404);
  assert.equal((await post(`/api/grove/tickets/${t.id}/close`)).status, 200);
  assert.equal((await post(`/api/grove/tickets/${t.id}/close`, {}, { 'content-type': 'text/plain' })).status, 415);
});

test('POST /api/grove/brain switches the brain; a bad mode is 400; it needs JSON', async () => {
  const res = await post('/api/grove/brain', { mode: 'local' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).brain.mode, 'local');
  assert.equal((await post('/api/grove/brain', { mode: 'psychic' })).status, 400);
  assert.equal((await post('/api/grove/brain', { mode: 'claude' }, { 'content-type': 'text/plain' })).status, 415);
  await post('/api/grove/brain', { mode: 'claude' });
});
