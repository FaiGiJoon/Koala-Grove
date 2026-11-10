import test from 'node:test';
import assert from 'node:assert/strict';
import { ollamaStatus, systemStatus, hostStatus } from '../hq/grove-system.js';

const json = (body) => ({ ok: true, status: 200, json: async () => body });
const fakeOllama = (url) => {
  if (url.endsWith('/api/version')) return json({ version: '0.9.1' });
  if (url.endsWith('/api/tags')) return json({ models: [{ name: 'qwen2.5:1.5b', size: 2 ** 30, modified_at: '2026-11-04' }] });
  if (url.endsWith('/api/ps')) return json({ models: [{ name: 'qwen2.5:1.5b', size: 2 ** 30, size_vram: 2 ** 29 }] });
  throw new Error('unexpected ' + url);
};

test('ollamaStatus lists installed and loaded models, with GPU memory in GB', async () => {
  const s = await ollamaStatus('http://127.0.0.1:11434/', { fetchImpl: async (u) => fakeOllama(u) });
  assert.equal(s.reachable, true);
  assert.equal(s.version, '0.9.1');
  assert.equal(s.installed[0].name, 'qwen2.5:1.5b');
  assert.equal(s.loaded[0].gpuGb, 0.5);
});

test('an unreachable Ollama is reported, not thrown', async () => {
  const s = await ollamaStatus('http://127.0.0.1:11434', { fetchImpl: async () => { throw new Error('connect ECONNREFUSED'); } });
  assert.equal(s.enabled, true);
  assert.equal(s.reachable, false);
  assert.match(s.error, /ECONNREFUSED/);
});

test('a grove with the local model off reports it as off', async () => {
  const s = await ollamaStatus('', { fetchImpl: async () => { throw new Error('should not call'); } });
  assert.deepEqual(s, { enabled: false, reachable: false, version: null, installed: [], loaded: [] });
});

test('hostStatus reports memory and CPUs', () => {
  const h = hostStatus();
  assert.ok(h.cpuCount >= 1);
  assert.ok(h.memTotalGb > 0);
  assert.ok(h.memUsedPct >= 0 && h.memUsedPct <= 100);
});

test('systemStatus combines the host and the local model server', async () => {
  const s = await systemStatus({ ollamaUrl: 'http://x', fetchImpl: async (u) => fakeOllama(u) });
  assert.ok(s.host.cpuCount >= 1);
  assert.equal(s.ollama.reachable, true);
});
