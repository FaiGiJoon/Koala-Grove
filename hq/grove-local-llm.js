// A model on this computer (Ollama), so the koalas keep learning and growing for free.
// The instinct decides what they do; this only writes new library pages and each koala's
// nightly diary, so it stays light even on a small model. When Ollama is not running,
// everything falls back to the instinct's own bookshelf: nothing breaks, nothing is spent.

// Models tried in this order when GROVE_OLLAMA_MODEL is not set; else the first installed.
export const PREFERRED = ['gemma4:e4b', 'gemma4', 'llama3.2', 'qwen2.5', 'gemma3', 'llama3.1', 'mistral', 'phi'];

export function pickModel(names, wanted = '') {
  if (!names.length) return null;
  if (wanted) return names.find((n) => n === wanted || n.split(':')[0] === wanted) ?? null;
  for (const p of PREFERRED) {
    const hit = names.find((n) => n === p || n.startsWith(`${p}:`) || n.split(':')[0] === p);
    if (hit) return hit;
  }
  return names[0];
}

const PAGE = {
  type: 'object',
  properties: { fact: { type: 'string' }, idea: { type: 'string' }, curiosity: { type: 'string' } },
  required: ['fact', 'idea', 'curiosity'],
};
const DIARY = {
  type: 'object',
  properties: { memory: { type: 'string' }, trait: { type: 'string' } },
  required: ['memory', 'trait'],
};

export function createLocalLlm({ url = 'http://127.0.0.1:11434', model = '', fetchImpl = globalThis.fetch, timeoutMs = 120000, now = () => Date.now() } = {}) {
  let cached = { at: -Infinity, model: null };
  const base = url.replace(/\/$/, '');

  async function call(path, body, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetchImpl(`${base}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  // Which model to use, or null when Ollama is not reachable. Checked at most once a minute.
  async function available() {
    if (!url) return null;
    if (now() - cached.at < 60000) return cached.model;
    const tags = await call('/api/tags', null, 3000);
    const names = (tags?.models ?? []).map((m) => m.name).filter(Boolean);
    cached = { at: now(), model: pickModel(names, model) };
    return cached.model;
  }

  async function ask(system, prompt, schema, ms = timeoutMs) {
    const m = await available();
    if (!m) return null;
    const out = await call('/api/generate', { model: m, system, prompt, format: schema, stream: false, options: { temperature: 0.7 } }, ms);
    if (!out?.response) return null;
    try {
      return { model: m, value: JSON.parse(out.response) };
    } catch {
      return null;
    }
  }

  return {
    available,
    get model() { return cached.model; },
    // A library page: { fact, idea, curiosity } or null.
    async read(prompt) {
      const r = await ask(
        "You are a picture book in a koala grove's library. Tell one short, TRUE, kind fact a child could understand, in one or two sentences. Answer only with the JSON asked for.",
        prompt, PAGE,
      );
      const fact = typeof r?.value?.fact === 'string' ? r.value.fact.trim() : '';
      return fact.length >= 12 ? { ...r.value, fact, model: r.model } : null;
    },
    // A project page in the koala's voice: { title, body, next } or null.
    async project(prompt) {
      const r = await ask(
        "You help a small koala write a page for its own project on GitHub, in its own voice: simple, warm, true, a few short paragraphs in Markdown. Use only facts it gives you. Answer only with the JSON asked for.",
        prompt, { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, next: { type: 'string' } }, required: ['title', 'body', 'next'] },
      );
      const body = typeof r?.value?.body === 'string' ? r.value.body.trim() : '';
      return body.length >= 40 ? { title: String(r.value.title ?? '').trim().slice(0, 80), body: body.slice(0, 4000), next: String(r.value.next ?? '').trim().slice(0, 400) } : null;
    },
    // Something the koala makes at its computer, in the MAKE_SCHEMA shape, or null. Making takes
    // longer than a page, so it gets more time (Ollama may run on another computer).
    async make(system, prompt, schema) {
      const r = await ask(system, prompt, schema, Math.max(timeoutMs, 300000));
      const v = r?.value;
      return v && typeof v.title === 'string' && Array.isArray(v.files) && v.files.length ? { ...v, model: r.model } : null;
    },
    // The koala's diary at the end of a day: { memory, trait } (trait may be empty) or null.
    async diary(prompt) {
      const r = await ask(
        "You help a small koala write its diary at the end of the day. Write in the koala's own voice, simple and warm. Answer only with the JSON asked for.",
        prompt, DIARY,
      );
      const memory = typeof r?.value?.memory === 'string' ? r.value.memory.trim() : '';
      return memory ? { memory, trait: typeof r.value.trait === 'string' ? r.value.trait.trim() : '', model: r.model } : null;
    },
  };
}
