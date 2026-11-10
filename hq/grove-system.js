// What this computer is doing, for the owner's trace: the host (CPU, memory, load) and the local
// model server (Ollama): its version, the models installed, and the models loaded right now with
// how much of each sits in GPU memory. Nothing here changes anything; every read has a short timeout.

import os from 'node:os';

const TIMEOUT_MS = 2000;

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

export function hostStatus(now = Date.now()) {
  const total = os.totalmem();
  const free = os.freemem();
  const cpus = os.cpus() ?? [];
  const load = os.loadavg();
  return {
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() ?? 'unknown',
    cpuCount: cpus.length,
    loadAvg: load.map((x) => Math.round(x * 100) / 100),
    memTotalGb: Math.round((total / 2 ** 30) * 10) / 10,
    memUsedPct: total ? Math.round(((total - free) / total) * 100) : 0,
    uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
    at: now,
  };
}

// ollamaUrl: e.g. http://127.0.0.1:11434, or '' when the local model is off.
export async function ollamaStatus(ollamaUrl, { fetchImpl = globalThis.fetch } = {}) {
  if (!ollamaUrl) return { enabled: false, reachable: false, version: null, installed: [], loaded: [] };
  const base = ollamaUrl.replace(/\/$/, '');
  try {
    const [version, tags, ps] = await Promise.all([
      getJson(fetchImpl, `${base}/api/version`).catch(() => ({ version: null })),
      getJson(fetchImpl, `${base}/api/tags`),
      getJson(fetchImpl, `${base}/api/ps`).catch(() => ({ models: [] })),
    ]);
    const gb = (n) => Math.round((Number(n ?? 0) / 2 ** 30) * 100) / 100;
    return {
      enabled: true,
      reachable: true,
      version: version.version ?? null,
      installed: (tags.models ?? []).map((m) => ({ name: m.name, sizeGb: gb(m.size), modified: m.modified_at ?? null })),
      loaded: (ps.models ?? []).map((m) => ({ name: m.name, sizeGb: gb(m.size), gpuGb: gb(m.size_vram), until: m.expires_at ?? null })),
    };
  } catch (err) {
    return { enabled: true, reachable: false, error: err.message.slice(0, 160), version: null, installed: [], loaded: [] };
  }
}

export async function systemStatus({ ollamaUrl = '', fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  return { host: hostStatus(now), ollama: await ollamaStatus(ollamaUrl, { fetchImpl }) };
}
