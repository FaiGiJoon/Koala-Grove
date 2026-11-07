import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A numeric env value: unset or empty gives the default; anything else must be a
// finite number above 0 (and an integer up to max when asked), or startup stops.
export function positiveNumber(name, raw, fallback, { integer = false, max = Infinity } = {}) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  const ok = Number.isFinite(n) && n > 0 && n <= max && (!integer || Number.isInteger(n));
  if (!ok) {
    const want = integer ? `a whole number from 1 to ${max}` : 'a number above 0';
    throw new Error(`${name} must be ${want}, got: ${raw}`);
  }
  return n;
}

const env = process.env;

// Which brain the koalas use: local (free instinct, 24/7), hybrid or claude.
export function brainMode(raw) {
  if (raw === undefined || raw === '') return 'local';
  const v = String(raw).trim().toLowerCase();
  if (!['local', 'hybrid', 'claude'].includes(v)) throw new Error(`GROVE_BRAIN must be local, hybrid or claude, got: ${raw}`);
  return v;
}

export default {
  port: positiveNumber('PORT', env.PORT, 4317, { integer: true, max: 65535 }),
  // Two koalas on real model calls; GROVE_DAY_USD caps today's real spend.
  grove: {
    brain: brainMode(env.GROVE_BRAIN),
    // in hybrid, a routine decision is a model call once in this many (being spoken to always is)
    hybridEvery: positiveNumber('GROVE_HYBRID_EVERY', env.GROVE_HYBRID_EVERY, 4, { integer: true, max: 100 }),
    localReadsPerDay: positiveNumber('GROVE_LOCAL_READS_PER_DAY', env.GROVE_LOCAL_READS_PER_DAY, 48, { integer: true, max: 1000 }),
    // a never-played grove wakes by itself when the brain needs no tokens
    autoStart: env.GROVE_AUTOSTART !== '0',
    // a model on this computer (Ollama) writes new library pages and nightly diaries for free;
    // 'off' turns it off, and when Ollama is not running the koalas use their own bookshelf
    ollamaUrl: env.GROVE_OLLAMA_URL === 'off' ? '' : env.GROVE_OLLAMA_URL || 'http://127.0.0.1:11434',
    ollamaModel: env.GROVE_OLLAMA_MODEL || '',
    model: env.GROVE_MODEL || 'claude-haiku-5-5',
    bin: env.GROVE_BIN || env.CLAUDE_BIN || 'claude',
    callUsd: positiveNumber('GROVE_CALL_USD', env.GROVE_CALL_USD, 0.05, { max: 1 }),
    dayUsd: positiveNumber('GROVE_DAY_USD', env.GROVE_DAY_USD, 0.5),
    // research trips use web search: rarer, and with their own budget
    researchPerDay: positiveNumber('GROVE_RESEARCH_PER_DAY', env.GROVE_RESEARCH_PER_DAY, 16, { integer: true, max: 50 }),
    // reading a book from the library: its own daily count and price
    readsPerDay: positiveNumber('GROVE_READS_PER_DAY', env.GROVE_READS_PER_DAY, 16, { integer: true, max: 100 }),
    readUsd: positiveNumber('GROVE_READ_USD', env.GROVE_READ_USD, 0.03, { max: 1 }),
    researchUsd: positiveNumber('GROVE_RESEARCH_USD', env.GROVE_RESEARCH_USD, 0.1, { max: 1 }),
  },
  root,
  dataDir: path.join(root, 'data'),
  workDir: path.join(root, 'work'),
};
