// Koala Grove: two koalas who decide every move for themselves.
// Each decision comes from one of two brains. The instinct (grove-instinct.js) runs
// here, costs nothing and lets the grove live 24/7, page open or not. A real model
// call costs tokens, so it only happens while the player has pressed Play and a grove
// page keeps checking in, and never past the daily cap. The brain mode (local, hybrid,
// claude) picks between them. Memory, the relationship and every call's real usage
// are kept in sqlite (data/).

import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  KOALAS, ITEMS, BLUEPRINTS, PLOTS, LANDS, placesOf, landOf, newKoala, friendOf, RENAMED, migrateNames, SIGHTINGS, parseDecision, applyDecision, drift, groveClock, DAY_MS, buildPrompt, systemPrompt, canReadAt, growthOf, carryLimit,
  wisdomOf, relevantLearned, interestsOf, MAX_LEARNED, MAX_CURIOSITIES, MAX_TRAITS,
} from './grove-world.js';
import { koalaArgs, researchArgs, readArgs, think as callClaude } from './grove-brain.js';
import { instinctDecide, instinctRead } from './grove-instinct.js';
import { createLocalLlm } from './grove-local-llm.js';
import { RESOURCES, ISLANDS, COSTS, START_STOCK, held, bridged, stockOf } from './grove-economy.js';
import { BABY_NAMES, babyPersona, bornBaby, graduates } from './grove-family.js';
import { designCost } from './grove-design.js';
import { Tickets, MAX_OPEN_TICKETS } from './grove-tickets.js';
import { problemsOf, habitsOf, hourly, exportTabs, DAY_MS as DAY } from './grove-dashboard.js';

// Which brain decides. local: always the free instinct, 24/7, no page needed. hybrid: the
// instinct, plus a real model call when a page is open and a koala was spoken to (or every
// hybridEvery-th decision). claude: every decision is a model call, only while a page is open.
export const BRAINS = ['local', 'hybrid', 'claude'];

export const GROVE_DEFAULTS = {
  brain: 'claude',
  hybridEvery: 4,
  localReadsPerDay: 48, // books read on instinct cost nothing, but a day has only so many pages
  autoStart: false, // wake a fresh grove on start when the brain needs no tokens
  ollamaUrl: '', // a local model (Ollama) for new library pages and nightly diaries; '' is off
  ollamaModel: '', // '' picks a good installed one
  model: 'claude-haiku-5-5',
  callUsd: 0.05, // --max-budget-usd for one decision
  dayUsd: 0.5, // no new calls once today's real spend reaches this
  bin: 'claude',
  workDir: null,
  timeoutMs: 60000,
  minMs: 20000, // a koala thinks every 20-60 s on its own...
  idleMinMs: 40000, // ...40-90 s when nothing has happened to it since it last decided...
  maxMs: 60000,
  idleMaxMs: 90000,
  replyMinMs: 6000, // ...sooner when spoken to or given something
  replyMaxMs: 12000,
  gapMs: 12000, // never two decisions of one koala closer than this
  failMs: 60000,
  presenceMs: 45000, // the page must check in this often
  tickMs: 1000,
  maxFailures: 3,
  researchPerDay: 16,
  readsPerDay: 16,
  readUsd: 0.03,
  researchUsd: 0.1,
};

const LOG_ROWS = 80;
// Times of day the visitor can jump to, in minutes after midnight.
const TIMES = { morning: 7 * 60, noon: 12 * 60, evening: 18 * 60 + 30, night: 22 * 60 };

export class GroveError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const startOfDay = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export class Grove {
  #listeners = [];
  #timer = null;
  #inflight = new Set();
  #run = {}; // per koala: nextAt, thinking, lastStart, replyDue, stirred, calm, count
  #lastHour = null;
  #heartbeatAt = 0;
  #lastDrift = 0;
  #wasPresent = false;
  #failures = 0;

  constructor({ path = ':memory:', config = {}, think = null, now = () => Date.now(), rng = Math.random, localLlm = undefined } = {}) {
    this.config = { ...GROVE_DEFAULTS, ...config };
    this.now = now;
    this.rng = rng;
    this.brain = think ?? ((req) => this.#callClaude(req));
    // free learning on this computer: new pages and diaries (null when not configured)
    this.localLlm = localLlm !== undefined ? localLlm
      : this.config.ollamaUrl ? createLocalLlm({ url: this.config.ollamaUrl, model: this.config.ollamaModel, now }) : null;

    const db = (this.db = new DatabaseSync(path));
    db.exec(`
      CREATE TABLE IF NOT EXISTS grove_koalas (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS grove_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, koala TEXT, kind TEXT NOT NULL,
        text TEXT NOT NULL, action TEXT, target TEXT);
      CREATE TABLE IF NOT EXISTS grove_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, koala TEXT NOT NULL, ok INTEGER NOT NULL,
        cost_usd REAL NOT NULL, tokens_in INTEGER NOT NULL, tokens_out INTEGER NOT NULL, duration_ms INTEGER);
      CREATE INDEX IF NOT EXISTS grove_usage_ts ON grove_usage(ts);
      CREATE TABLE IF NOT EXISTS grove_meta (key TEXT PRIMARY KEY, value TEXT);
    `);
    // Which kind of call a usage row was (decide, read, research): added later, empty on old rows.
    if (!db.prepare('PRAGMA table_info(grove_usage)').all().some((c) => c.name === 'kind')) db.exec('ALTER TABLE grove_usage ADD COLUMN kind TEXT');
    const p = (sql) => db.prepare(sql);
    this.q = {
      koala: p('SELECT data FROM grove_koalas WHERE id = ?'),
      allKoalas: p('SELECT id, data FROM grove_koalas ORDER BY rowid'),
      saveKoala: p('INSERT INTO grove_koalas (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data'),
      log: p('INSERT INTO grove_log (ts, koala, kind, text, action, target) VALUES (?, ?, ?, ?, ?, ?)'),
      recentLog: p('SELECT * FROM grove_log ORDER BY id DESC LIMIT ?'),
      usage: p('INSERT INTO grove_usage (ts, koala, ok, cost_usd, tokens_in, tokens_out, duration_ms, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
      habits: p("SELECT koala, action, COUNT(*) AS n FROM grove_log WHERE kind = 'act' AND ts >= ? GROUP BY koala, action"),
      usageSince: p('SELECT * FROM grove_usage WHERE ts >= ? ORDER BY id'),
      allUsage: p('SELECT * FROM grove_usage ORDER BY id'),
      allLog: p('SELECT * FROM grove_log ORDER BY id'),
      failures: p("SELECT ts, koala, text FROM grove_log WHERE kind = 'error' AND ts >= ? ORDER BY id DESC"),
      feed: p("SELECT * FROM grove_log WHERE kind IN ('think', 'act', 'say', 'learn', 'grow', 'error', 'ticket', 'remember') ORDER BY id DESC LIMIT ?"),
      sums: p(`SELECT koala, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(tokens_in), 0) AS tokens_in,
        COALESCE(SUM(tokens_out), 0) AS tokens_out FROM grove_usage WHERE ts >= ? GROUP BY koala`),
      lastUsage: p('SELECT * FROM grove_usage ORDER BY id DESC LIMIT 1'),
      meta: p('SELECT value FROM grove_meta WHERE key = ?'),
      setMeta: p('INSERT INTO grove_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    };

    this.#rename();
    this.tickets = new Tickets(db);
    // The koalas' world: themselves, and what they have built together.
    this.world = { koalas: {}, builds: [] };
    for (const k of KOALAS) {
      const row = this.q.koala.get(k.id);
      this.world.koalas[k.id] = row ? { ...newKoala(k.id), ...JSON.parse(row.data) } : newKoala(k.id);
    }
    // the family born in the grove
    for (const row of this.q.allKoalas.all()) if (!this.world.koalas[row.id]) this.world.koalas[row.id] = JSON.parse(row.data);
    for (const id of Object.keys(this.world.koalas)) this.#run[id] = { nextAt: Infinity, thinking: false, lastStart: 0, replyDue: false };
    this.world.builds = this.#meta('builds', []);
    this.world.stock = this.#meta('stock', { ...START_STOCK });
    this.world.baby = this.#meta('baby', null);
    this.world.nest = this.#meta('nest', null);
    this.world.tickets = this.tickets.list();
    if (this.#meta('epoch') == null) this.#setMeta('epoch', this.now());
    if (this.playing) this.#schedule();
  }

  // A grove from before the rename: move Mallee and Bramble's rows, words and spend to Crystal and Ruby.
  #rename() {
    const db = this.db;
    for (const [from, to] of Object.entries(RENAMED)) {
      const row = this.q.koala.get(from);
      if (!row) continue;
      db.exec('BEGIN');
      try {
        if (!this.q.koala.get(to)) {
          const k = JSON.parse(row.data);
          for (const key of ['name', 'opinion', 'thought', 'say']) if (typeof k[key] === 'string') k[key] = migrateNames(k[key]);
          for (const key of ['memories', 'recent']) if (Array.isArray(k[key])) k[key] = k[key].map(migrateNames);
          k.id = to;
          this.q.saveKoala.run(to, JSON.stringify(k));
        }
        db.prepare('DELETE FROM grove_koalas WHERE id = ?').run(from);
        db.prepare('UPDATE grove_log SET koala = ? WHERE koala = ?').run(to, from);
        db.prepare('UPDATE grove_usage SET koala = ? WHERE koala = ?').run(to, from);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
    const fix = db.prepare('UPDATE grove_log SET text = ? WHERE id = ?');
    for (const r of db.prepare("SELECT id, text FROM grove_log WHERE text LIKE '%Mallee%' OR text LIKE '%Bramble%'").all()) fix.run(migrateNames(r.text), r.id);
  }

  // Every koala, founders first; and the ones that make their own decisions (not following a parent).
  #all() {
    return Object.values(this.world.koalas);
  }
  #thinkers() {
    return this.#all().filter((k) => !k.follows);
  }

  // A new koala joins the grove (a baby, born in grove.js's birth step).
  addKoala(k) {
    this.world.koalas[k.id] = { ...newKoala(KOALAS[0].id), ...k };
    this.#run[k.id] = { nextAt: Infinity, thinking: false, lastStart: 0, replyDue: false };
    this.#save(k.id);
    this.#emit();
    return this.world.koalas[k.id];
  }

  // --- persistence helpers -----------------------------------------------------------
  #meta(key, fallback = null) {
    const row = this.q.meta.get(key);
    return row ? JSON.parse(row.value) : fallback;
  }
  #setMeta(key, value) {
    this.q.setMeta.run(key, JSON.stringify(value));
  }
  #save(id) {
    this.q.saveKoala.run(id, JSON.stringify(this.world.koalas[id]));
  }
  #log(entry) {
    this.q.log.run(this.now(), entry.koala ?? null, entry.kind, entry.text, entry.action ?? null, entry.target ?? null);
  }

  get playing() {
    return this.#meta('playing', false);
  }
  get present() {
    return this.now() - this.#heartbeatAt < this.config.presenceMs;
  }

  // The brain mode the owner picked on the page, else the configured one.
  get brainMode() {
    const m = this.#meta('brain', null);
    return BRAINS.includes(m) ? m : BRAINS.includes(this.config.brain) ? this.config.brain : 'claude';
  }
  // Whether the grove can go on without a page and without tokens.
  get autonomous() {
    return this.brainMode !== 'claude';
  }
  // Whether a model call is allowed right now; if not, the instinct decides and reads.
  #online() {
    const mode = this.brainMode;
    if (mode === 'local') return false;
    return this.present && !this.capped;
  }

  setBrain(mode) {
    if (!BRAINS.includes(mode)) throw new GroveError(400, `brain must be one of: ${BRAINS.join(', ')}`);
    if (mode === this.brainMode) return this.state();
    this.#setMeta('brain', mode);
    const words = { local: 'instinct only (free, 24/7)', hybrid: 'instinct, with real model calls while you watch', claude: 'real model calls only' };
    this.#log({ kind: 'system', text: `Brain set to ${words[mode]}.` });
    if (this.playing) this.#schedule();
    this.#emit();
    return this.state();
  }

  onChange(fn) {
    this.#listeners.push(fn);
  }
  #emit() {
    if (!this.#listeners.length) return;
    const state = this.state();
    for (const fn of this.#listeners) {
      try { fn(state); } catch (err) { console.error('grove listener failed:', err); }
    }
  }

  // --- spend ---------------------------------------------------------------------------
  #sums(since) {
    const out = { total: { calls: 0, cost: 0, tokens_in: 0, tokens_out: 0 } };
    for (const k of this.#all()) out[k.id] = { calls: 0, cost: 0, tokens_in: 0, tokens_out: 0 };
    for (const r of this.q.sums.all(since)) {
      const row = { calls: r.calls, cost: r.cost, tokens_in: r.tokens_in, tokens_out: r.tokens_out };
      out[r.koala] = row;
      for (const key of Object.keys(row)) out.total[key] += row[key];
    }
    return out;
  }
  spentToday() {
    return this.#sums(startOfDay(this.now())).total.cost;
  }
  get capped() {
    return this.spentToday() >= this.config.dayUsd;
  }

  // --- scheduling ----------------------------------------------------------------------
  #between(lo, hi) {
    return lo + (hi - lo) * this.rng();
  }
  #schedule() {
    this.#thinkers().forEach((k, i) => {
      if (!this.#run[k.id].thinking) this.#run[k.id].nextAt = this.now() + 1000 + i * 2500;
    });
  }
  // Something happened to this koala: let it react soon, but not sooner than the gap allows.
  #nudge(id) {
    const r = this.#run[id];
    r.stirred = true;
    if (r.thinking) {
      r.replyDue = true;
      return;
    }
    const soon = Math.max(this.now() + this.#between(this.config.replyMinMs, this.config.replyMaxMs), r.lastStart + this.config.gapMs);
    r.nextAt = Math.min(r.nextAt, soon);
  }

  tick() {
    const now = this.now();
    const present = this.present;
    // On instinct the grove lives without a page; on model calls only while one is open.
    const active = this.playing && (present || this.autonomous);
    if (active && this.#lastDrift) {
      const minutes = Math.min(2, (now - this.#lastDrift) / 60000);
      for (const k of this.#all()) {
        drift(this.world.koalas[k.id], minutes);
        if (k.follows) k.strength = Math.min(100, k.strength + minutes); // babies grow by being looked after
        this.#save(k.id);
      }
    }
    this.#lastDrift = now;
    if (active) {
      this.#sightings();
      this.#family();
      this.#diaries();
    }
    if (present !== this.#wasPresent) {
      this.#wasPresent = present;
      this.#emit();
    }
    if (!active || (this.capped && !this.autonomous)) return;
    for (const k of this.#thinkers()) {
      const r = this.#run[k.id];
      if (!r.thinking && now >= r.nextAt) this.#decide(k.id);
    }
  }

  // Grove minutes since the first morning: the clock nesting and births run on.
  #minute() {
    const c = this.clock();
    return (c.day - 1) * 1440 + c.hour * 60 + c.minute;
  }

  // Once a day, when a koala settles down to sleep, it writes its diary: one memory of the
  // day worth keeping, and sometimes something new about who it is becoming. The computer's
  // own model writes it when there is one; else the instinct keeps the day's biggest moment.
  #diaries() {
    const day = startOfDay(this.now());
    const done = this.#meta('diary', {});
    for (const k of this.#thinkers()) {
      if (k.activity !== 'nap' || done[k.id] === day) continue;
      done[k.id] = day;
      this.#setMeta('diary', done);
      const job = this.#diary(k.id)
        .catch((err) => console.error('grove diary failed:', err))
        .finally(() => this.#inflight.delete(job));
      this.#inflight.add(job);
    }
  }

  async #diary(id) {
    const k = this.world.koalas[id];
    const f = this.#all().find((o) => o.id !== id);
    let entry = null;
    if (this.localLlm) {
      const prompt = [
        `You are ${k.name}, a ${wisdomOf(k).wisdomLabel.toLowerCase()} koala, curious about ${interestsOf(k).join(', ') || 'everything'}.`,
        (k.traits ?? []).length ? `Who you are: ${k.traits.join('; ')}.` : 'You are still finding out who you are.',
        `What you already remember: ${(k.memories ?? []).slice(-6).join(' | ') || 'nothing yet'}.`,
        `What happened today: ${(k.recent ?? []).join(' | ') || 'a quiet day'}.`,
        (k.learned ?? []).length ? `Things you learned lately: ${k.learned.slice(-3).join(' | ')}.` : '',
        f ? `Your friend is ${f.name}; how you feel about them: ${k.opinion || 'still deciding'}.` : '',
        'Write memory: one sentence (under 140 characters) about today worth remembering for a long time, different from what you already remember.',
        'Write trait: something new you found out about who you are, in one short sentence, or empty if nothing new.',
      ].filter(Boolean).join('\n');
      try { entry = await this.localLlm.diary(prompt); } catch { entry = null; }
    }
    if (!entry) {
      const big = [...(k.recent ?? [])].reverse().find((e) => /finished the|rose from the water|was born|gave you|you read|found out|grew wiser/i.test(e));
      if (!big) return;
      entry = { memory: big.replace(/^You /, 'I ').slice(0, 140), trait: '' };
    }
    const memory = entry.memory.replace(/\s+/g, ' ').slice(0, 140);
    if (!(k.memories ?? []).includes(memory)) k.memories = [...(k.memories ?? []), memory].slice(-12);
    const trait = entry.trait.replace(/\s+/g, ' ').slice(0, 120);
    if (trait && !(k.traits ?? []).some((t) => t.toLowerCase() === trait.toLowerCase())) {
      k.traits = [...(k.traits ?? []), trait].slice(-MAX_TRAITS);
      this.#log({ koala: id, kind: 'grow', text: `${k.name} found out something new about who they are: ${trait}` });
    }
    this.#save(id);
    this.#log({ koala: id, kind: 'learn', text: `${k.name} wrote in the diary: ${memory}` });
  }

  // Births when a baby is due, and babies old enough to start deciding for themselves.
  #family() {
    const w = this.world;
    const now = this.#minute();
    if (w.baby && now >= w.baby.due) {
      const taken = new Set(this.#all().map((k) => k.name));
      const name = BABY_NAMES.find((n) => !taken.has(n)) ?? `Joey ${this.#all().length}`;
      let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      while (w.koalas[id]) id += '_';
      const parents = w.baby.parents.map((p) => w.koalas[p]);
      bornBaby(w, now, name, id, this.rng() < 0.5 ? 'girl' : 'boy');
      this.#run[id] = { nextAt: Infinity, thinking: false, lastStart: 0, replyDue: false };
      for (const p of parents) p.recent.push(`Your baby ${name} was born in the Mossy Hollow!`);
      this.#log({ koala: id, kind: 'grow', text: `A baby koala was born: ${name}, the child of ${parents.map((p) => p.name).join(' and ')}!` });
      this.#setMeta('baby', null);
      for (const x of this.#all()) this.#save(x.id);
      this.#emit();
    }
    for (const k of this.#all().filter(graduates)) {
      k.follows = null;
      k.recent.push('You feel big enough to go your own way now.');
      this.#run[k.id].nextAt = this.now() + 1000;
      this.#log({ koala: k.id, kind: 'grow', text: `${k.name} is old enough to decide for ${k.gender === 'boy' ? 'himself' : 'herself'} now.` });
      this.#save(k.id);
      this.#emit();
    }
  }

  // Research happens only at Library Isle, a few times a day for the whole grove.
  #mayResearch(id) {
    const k = this.world.koalas[id];
    if (this.capped) {
      k.recent.push('You wanted to look something up, but the library is closed: the grove has used its tokens for today.');
      return false;
    }
    if (!canReadAt(this.world, k.place)) {
      k.recent.push('You wanted to look something up, but you can research only at the library or somewhere with books.');
      return false;
    }
    const day = startOfDay(this.now());
    const used = this.#meta('research', { day, count: 0 });
    if (used.day === day && used.count >= this.config.researchPerDay) {
      k.recent.push('You wanted to look something up, but the library is closed for today. Come back tomorrow.');
      return false;
    }
    this.#setMeta('research', { day, count: (used.day === day ? used.count : 0) + 1 });
    return true;
  }

  // Reading happens at Library Isle or at a finished build about books, a few times a day.
  #mayRead(id, offline = false) {
    const k = this.world.koalas[id];
    if (offline) return this.#mayReadFree(id);
    if (this.capped) {
      k.recent.push('You wanted to read, but the grove has used its tokens for today.');
      return false;
    }
    if (!canReadAt(this.world, k.place)) {
      k.recent.push('You wanted to read, but you can read only at the library or somewhere with books.');
      return false;
    }
    const day = startOfDay(this.now());
    const used = this.#meta('reads', { day, count: 0 });
    if (used.day === day && used.count >= this.config.readsPerDay) {
      k.recent.push('You wanted to read, but you have read enough for today. Come back tomorrow.');
      return false;
    }
    this.#setMeta('reads', { day, count: (used.day === day ? used.count : 0) + 1 });
    return true;
  }

  // Reading on instinct: no tokens, but no more than localReadsPerDay pages a day.
  #freeReadsLeft() {
    const day = startOfDay(this.now());
    const used = this.#meta('localReads', { day, count: 0 });
    return this.config.localReadsPerDay - (used.day === day ? used.count : 0);
  }
  #mayReadFree(id) {
    const k = this.world.koalas[id];
    if (!canReadAt(this.world, k.place)) {
      k.recent.push('You wanted to read, but you can read only at the library or somewhere with books.');
      return false;
    }
    if (this.#freeReadsLeft() <= 0) {
      k.recent.push('You wanted to read, but you have read enough for today. Come back tomorrow.');
      return false;
    }
    const day = startOfDay(this.now());
    const used = this.#meta('localReads', { day, count: 0 });
    this.#setMeta('localReads', { day, count: (used.day === day ? used.count : 0) + 1 });
    return true;
  }

  // A learning call: a book (no tools) or the web (search only), each with its own budget.
  // Offline, the instinct's own shelf of books answers instead, for free.
  // What comes back is kept in `learned` and told to koalas at the same place.
  async #learn(id, topic, { web, offline = false }) {
    const k = this.world.koalas[id];
    const w = wisdomOf(k);
    const known = relevantLearned({ ...k, wish: `${k.wish ?? ''} ${topic}` }, 4);
    const about = [
      `${k.name} is a ${w.wisdomLabel.toLowerCase()} koala, curious about ${interestsOf(k).join(', ') || 'everything'}.`,
      ...((k.traits ?? []).length ? [`${k.name}'s personality: ${k.traits.join('; ')}.`] : []),
      ...(known.length ? [`${k.name} already knows:`, ...known.map((f) => `- ${f}`), 'Tell something new, that builds on this rather than repeating it.'] : []),
      w.wisdomStyle,
    ].join('\n');
    const prompt = web
      ? `${k.name} the koala asks: ${topic}\n${about}\nAnswer as one fact the koala can remember, one idea for the grove (or empty), and one related topic the koala could wonder about next (or empty).`
      : `${k.name} the koala opens a book about: ${topic}\n${about}\nTell one true thing about it as a fact the koala can remember, one idea for the grove (or empty), and one related topic the koala could wonder about next (or empty).`;
    if (offline) {
      // the computer's own model writes a new page if it can; else the instinct's bookshelf
      let page = null;
      if (this.localLlm) {
        try { page = await this.localLlm.read(prompt); } catch { page = null; }
        if (page && (k.learned ?? []).includes(page.fact.replace(/\s+/g, ' ').slice(0, 280))) page = null;
      }
      page ??= instinctRead(k, topic, this.rng);
      if (!page) {
        k.recent.push(`You looked through every book about ${topic}, but you know all of it already.`);
        this.#save(id);
        return;
      }
      return this.#learned(id, topic, page, { web: false });
    }
    const args = web
      ? researchArgs({ prompt, model: this.config.model, callUsd: this.config.researchUsd })
      : readArgs({ prompt, model: this.config.model, callUsd: this.config.readUsd });
    let out;
    try {
      out = await this.brain({ koala: id, kind: web ? 'research' : 'read', prompt, args });
    } catch (err) {
      out = { ok: false, raw: null, usage: null, error: err.message };
    }
    const u = out.usage;
    let raw = out.raw;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { raw = null; }
    }
    const fact = typeof raw?.fact === 'string' ? raw.fact.trim().replace(/\s+/g, ' ').slice(0, 280) : '';
    if (u) this.q.usage.run(this.now(), id, fact ? 1 : 0, u.cost_usd, u.tokens_in, u.tokens_out, u.duration_ms, web ? 'research' : 'read');
    if (!out.ok || !fact) {
      this.#log({ koala: id, kind: 'error', text: `${k.name}'s ${web ? 'research' : 'reading'} found nothing: ${out.error ?? 'no answer'}` });
      return;
    }
    return this.#learned(id, topic, raw, { web });
  }

  // What a koala learned (a fact, maybe an idea and a new curiosity) goes into its mind.
  #learned(id, topic, raw, { web }) {
    const k = this.world.koalas[id];
    const w = wisdomOf(k);
    const fact = raw.fact.trim().replace(/\s+/g, ' ').slice(0, 280);
    const idea = typeof raw.idea === 'string' ? raw.idea.trim().replace(/\s+/g, ' ').slice(0, 160) : '';
    k.learned = [...(k.learned ?? []), fact].slice(-MAX_LEARNED);
    const trim = (x) => { if (x.recent.length > 10) x.recent.splice(0, x.recent.length - 10); };
    k.recent.push(`${web ? 'On the web you found out' : 'At the library you read'}: ${fact}${idea ? ` It gave you an idea: ${idea}` : ''}`);
    const before = w.wisdomLabel;
    k.wisdom = (Number(k.wisdom) || 0) + (web ? 2 : 1);
    const after = wisdomOf(k).wisdomLabel;
    if (after !== before) {
      k.recent.push(`You feel wiser. You are a ${after.toLowerCase()} now!`);
      this.#log({ koala: id, kind: 'grow', text: `${k.name} grew wiser: a ${after.toLowerCase()} now.` });
    }
    const next = typeof raw.curiosity === 'string' ? raw.curiosity.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
    if (next && !interestsOf(k).some((c) => c.toLowerCase() === next.toLowerCase())) {
      k.curiosities = [...(k.curiosities ?? []), next].slice(-MAX_CURIOSITIES);
      k.recent.push(`Now you wonder about ${next}.`);
    }
    trim(k);
    for (const o of this.#all()) {
      if (o.id === id || o.place !== k.place) continue;
      o.recent.push(`${k.name} told you: ${fact}`);
      trim(o);
      this.#save(o.id);
    }
    this.#save(id);
    this.#log({ koala: id, kind: 'learn', text: web ? `${k.name} looked up "${topic}" on the web: ${fact}` : `${k.name} read about ${topic}: ${fact}` });
  }

  // A koala writes a ticket (its say is the text); at most three wait at once.
  #fileTicket(id, decision) {
    const k = this.world.koalas[id];
    if (!decision.say) {
      decision.action = 'sit';
    } else if (this.tickets.openCount(id) >= MAX_OPEN_TICKETS) {
      k.recent.push('You wanted to write another ticket, but three of yours are already waiting for answers from the visitor.');
      decision.action = 'sit';
    } else {
      const t = this.tickets.open(id, decision.say);
      this.#log({ koala: id, kind: 'ticket', text: `${k.name} filed a ticket: ${t.title}` });
    }
    this.world.tickets = this.tickets.list();
  }

  replyTicket(ticketId, text) {
    const t = this.tickets.get(ticketId);
    if (!t) throw new GroveError(404, 'no such ticket');
    const reply = typeof text === 'string' ? text.trim() : '';
    if (!reply || reply.length > 300) throw new GroveError(400, 'a reply is 1 to 300 characters');
    this.tickets.reply(ticketId, reply);
    const k = this.world.koalas[t.koala];
    if (k) {
      k.recent.push(`The visitor answered your ticket: "${reply}"`);
      if (k.recent.length > 10) k.recent.splice(0, k.recent.length - 10);
      this.#save(k.id);
      if (!k.follows) this.#nudge(k.id);
    }
    this.#log({ koala: t.koala, kind: 'visitor', text: `You answered ${k?.name ?? 'a koala'}'s ticket: "${reply}"`, action: 'reply' });
    this.world.tickets = this.tickets.list();
    this.#emit();
    return this.state();
  }

  closeTicket(ticketId) {
    if (!this.tickets.get(ticketId)) throw new GroveError(404, 'no such ticket');
    this.tickets.close(ticketId);
    this.world.tickets = this.tickets.list();
    this.#emit();
    return this.state();
  }

  // The visitor names a newborn (within its first grove day).
  nameKoala(id, name) {
    const k = this.world.koalas[id];
    if (!k || !Object.hasOwn(this.world.koalas, id)) throw new GroveError(404, 'no such koala');
    const t = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
    if (!t || t.length > 24) throw new GroveError(400, 'a name is 1 to 24 characters');
    if (!k.parents || k.named || this.#minute() - (k.bornAt ?? 0) > 1440) throw new GroveError(409, 'only a newborn can be named, once');
    k.persona = babyPersona(this.world, k.parents, t, k.gender);
    k.name = t;
    k.named = true;
    for (const x of this.#all()) x.recent.push(`The visitor named the baby ${t}.`);
    this.#log({ koala: id, kind: 'visitor', text: `You named the baby ${t}`, action: 'name' });
    for (const x of this.#all()) this.#save(x.id);
    this.#emit();
    return this.state();
  }

  // Once a grove hour, each koala may notice one of the critters.
  #sightings() {
    const c = this.clock();
    const hour = c.day * 24 + c.hour;
    if (this.#lastHour === null) this.#lastHour = hour;
    if (hour === this.#lastHour) return;
    this.#lastHour = hour;
    for (const k of this.#all()) {
      if (this.rng() >= 0.15) continue;
      const koala = this.world.koalas[k.id];
      koala.recent.push(SIGHTINGS[Math.floor(this.rng() * SIGHTINGS.length)]);
      if (koala.recent.length > 10) koala.recent.splice(0, koala.recent.length - 10);
      this.#save(k.id);
    }
  }

  // Model call or instinct for this decision. Hybrid spends tokens where they matter most:
  // when someone just spoke to or gave something to the koala, and now and then otherwise.
  #usesModel(id) {
    const mode = this.brainMode;
    if (mode === 'claude') return true;
    if (!this.#online()) return false;
    const r = this.#run[id];
    r.count = (r.count ?? 0) + 1;
    return r.stirred || r.count % Math.max(1, this.config.hybridEvery) === 0;
  }

  #decide(id) {
    const r = this.#run[id];
    const model = this.#usesModel(id);
    r.calm = !r.stirred;
    r.stirred = false;
    r.thinking = true;
    r.replyDue = false;
    r.lastStart = this.now();
    let call;
    if (model) {
      const req = {
        koala: id,
        system: systemPrompt(id, this.world),
        prompt: buildPrompt(this.world, id, this.clock()),
      };
      try { call = Promise.resolve(this.brain(req)); } catch (err) { call = Promise.reject(err); }
    } else {
      // instinct: no tokens, no usage row, never fails
      const canRead = this.#freeReadsLeft() > 0;
      try {
        call = Promise.resolve({ ok: true, raw: instinctDecide(this.world, id, this.clock(), this.rng, { canRead }), usage: null, local: true });
      } catch (err) { call = Promise.reject(err); }
      this.#countFree();
    }
    const job = call
      .catch((err) => ({ ok: false, raw: null, usage: null, error: err.message }))
      .then((out) => this.#finish(id, out))
      .catch((err) => console.error('grove decision failed:', err))
      .finally(() => {
        this.#inflight.delete(job);
        r.thinking = false;
        this.#emit();
      });
    this.#inflight.add(job);
    this.#emit();
  }

  // Decisions made on instinct today, for the meter.
  #countFree() {
    const day = startOfDay(this.now());
    const used = this.#meta('instinct', { day, count: 0, total: 0 });
    this.#setMeta('instinct', { day, count: (used.day === day ? used.count : 0) + 1, total: (used.total ?? 0) + 1 });
  }
  #freeStats() {
    const day = startOfDay(this.now());
    const used = this.#meta('instinct', { day, count: 0, total: 0 });
    return { today: used.day === day ? used.count : 0, total: used.total ?? 0 };
  }

  #finish(id, out) {
    const r = this.#run[id];
    const u = out.usage;
    const decision = out.ok ? parseDecision(out.raw, this.world.koalas[id], placesOf(this.world)) : null;
    if (u) this.q.usage.run(this.now(), id, decision ? 1 : 0, u.cost_usd, u.tokens_in, u.tokens_out, u.duration_ms, 'decide');
    if (!decision) {
      const why = out.ok ? 'Reply was not a decision' : out.error;
      this.#log({ koala: id, kind: 'error', text: `${this.world.koalas[id].name}'s call failed: ${why}` });
      r.nextAt = this.now() + this.config.failMs;
      if (++this.#failures >= this.config.maxFailures && this.playing) {
        this.pause(`Calls failed ${this.#failures} times in a row: ${why}`);
      }
      return;
    }
    this.#failures = 0;
    if (decision.thought) this.#log({ koala: id, kind: 'think', text: decision.thought });
    // memories roll off the koala's own list, so the log keeps the full history for the export
    if (decision.remember && !this.world.koalas[id].memories.includes(decision.remember)) this.#log({ koala: id, kind: 'remember', text: decision.remember });
    if (decision.action === 'file_ticket') this.#fileTicket(id, decision);
    let question = null;
    let topic = null;
    // Without tokens there is no web: a research question becomes a look in the books.
    const offline = !!out.local || !this.#online();
    if (decision.action === 'research' && offline) decision.action = 'read';
    if (decision.action === 'research') {
      question = this.#mayResearch(id) ? decision.target : null;
      if (!question) decision.action = 'sit';
    } else if (decision.action === 'read') {
      topic = this.#mayRead(id, offline) ? decision.target : null;
      if (!topic) decision.action = 'sit';
    }
    this.world.minute = this.#minute();
    for (const entry of applyDecision(this.world, id, decision)) this.#log(entry);
    this.#setMeta('baby', this.world.baby ?? null);
    this.#setMeta('nest', this.world.nest ?? null);
    // babies go wherever the parent they follow goes
    for (const baby of this.#all().filter((x) => x.follows === id)) {
      baby.place = this.world.koalas[id].place;
      baby.hunger = this.world.koalas[id].hunger; // fed and rested with its mother
      baby.energy = Math.max(baby.energy, this.world.koalas[id].energy);
      baby.activity = this.world.koalas[id].activity === 'nap' ? 'nap' : 'sit';
    }
    for (const other of this.#all()) this.#save(other.id);
    this.#setMeta('builds', this.world.builds);
    this.#setMeta('stock', this.world.stock);
    const friend = friendOf(this.world, id).id;
    if (decision.say) {
      const here = this.world.koalas[id].place;
      for (const o of this.#thinkers()) if (o.id !== id && (o.id === friend || o.place === here)) this.#nudge(o.id);
    } else if (decision.action === 'give' || decision.action === 'approach') {
      this.#nudge(friend);
    }
    const quiet = r.calm && !decision.say && !r.replyDue;
    let next = this.now() + (quiet ? this.#between(this.config.idleMinMs, this.config.idleMaxMs) : this.#between(this.config.minMs, this.config.maxMs));
    if (r.replyDue) next = Math.min(next, Math.max(this.now() + this.#between(this.config.replyMinMs, this.config.replyMaxMs), r.lastStart + this.config.gapMs));
    r.nextAt = next;
    r.replyDue = false;
    if (question) return this.#learn(id, question, { web: true });
    if (topic) return this.#learn(id, topic, { web: false, offline });
  }

  async idle() {
    while (this.#inflight.size) await Promise.all([...this.#inflight]);
  }

  // --- controls ------------------------------------------------------------------------
  play() {
    this.#setMeta('playing', true);
    this.#setMeta('pausedReason', null);
    this.#failures = 0;
    this.#lastHour = null;
    this.#schedule();
    this.#sightings(); // starts the hour count
    this.#emit();
    return this.state();
  }

  pause(reason = null) {
    this.#setMeta('playing', false);
    this.#setMeta('pausedReason', reason);
    for (const k of this.#all()) if (!this.#run[k.id].thinking) this.#run[k.id].nextAt = Infinity;
    if (reason) this.#log({ kind: 'system', text: `Paused: ${reason}` });
    this.#emit();
    return this.state();
  }

  // The visitor moves the grove's clock to a time of day. It only ever goes forward, so an
  // earlier time means the next day; both koalas notice the change in the light.
  setTime(to) {
    const at = TIMES[to];
    if (at == null) throw new GroveError(400, `time must be one of: ${Object.keys(TIMES).join(', ')}`);
    const c = this.clock();
    const now = (c.day - 1) * 1440 + c.hour * 60 + c.minute;
    let want = (c.day - 1) * 1440 + at;
    if (want <= now) want += 1440;
    // groveClock starts its first day at 08:00 (480 minutes in).
    this.#setMeta('epoch', this.now() - ((want - 480) / 1440) * DAY_MS);
    for (const k of this.#all()) {
      const koala = this.world.koalas[k.id];
      koala.recent.push(`The light changed all at once: it is ${to} now.`);
      if (koala.recent.length > 10) koala.recent.splice(0, koala.recent.length - 10);
      this.#save(k.id);
    }
    this.#log({ kind: 'system', text: `You turned the grove's clock to ${to}: ${this.clock().label}` });
    this.#emit();
    return this.state();
  }

  heartbeat() {
    this.#heartbeatAt = this.now();
    if (!this.#wasPresent) {
      this.#wasPresent = true;
      this.#emit();
    }
    return { ok: true };
  }

  // The visitor gives an item, says something or gives a pat. Costs no tokens itself.
  act({ koala, kind, item, text } = {}) {
    const k = this.world.koalas[koala];
    if (!k || !Object.hasOwn(this.world.koalas, koala)) throw new GroveError(404, 'no such koala');
    if (kind === 'give') {
      if (!ITEMS.includes(item)) throw new GroveError(400, `item must be one of: ${ITEMS.join(', ')}`);
      if (held(k) >= carryLimit(k.strength)) throw new GroveError(409, `${k.name}'s paws are full`);
      k.inventory.push(item);
      k.recent.push(`The visitor gave you a ${item}.`);
      this.#log({ koala, kind: 'visitor', text: `You gave ${k.name} a ${item}`, action: 'give', target: item });
    } else if (kind === 'say') {
      const t = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
      if (!t || t.length > 140) throw new GroveError(400, 'say 1 to 140 characters');
      k.recent.push(`The visitor said: "${t}"`);
      this.#log({ koala, kind: 'visitor', text: `You to ${k.name}: "${t}"`, action: 'say' });
    } else if (kind === 'pet') {
      k.recent.push('The visitor gave you a gentle pat on the head.');
      this.#log({ koala, kind: 'visitor', text: `You patted ${k.name}`, action: 'pet' });
    } else {
      throw new GroveError(400, 'kind must be give, say or pet');
    }
    if (k.recent.length > 10) k.recent.splice(0, k.recent.length - 10);
    this.#save(koala);
    this.#nudge(koala);
    this.#emit();
    return this.state();
  }

  start() {
    if (this.#timer) return;
    // A grove that has never been played wakes by itself when its brain costs nothing.
    if (this.config.autoStart && this.autonomous && this.#meta('playing', null) === null) this.play();
    this.#timer = setInterval(() => this.tick(), this.config.tickMs);
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
  }

  close() {
    this.stop();
    this.db.close();
  }

  // The real model call, with the user's Claude Code login.
  async #callClaude({ system, prompt, args = null }) {
    const c = this.config;
    if (c.workDir) fs.mkdirSync(c.workDir, { recursive: true });
    return callClaude({ bin: c.bin, args: args ?? koalaArgs({ system, prompt, model: c.model, callUsd: c.callUsd }), cwd: c.workDir ?? process.cwd(), timeoutMs: c.timeoutMs });
  }

  // --- reporting -----------------------------------------------------------------------
  clock() {
    return groveClock(this.now() - this.#meta('epoch', this.now()));
  }

  // The owner's dashboard: problems, habits and usage over the last day, and the latest feed.
  dashboard() {
    const now = this.now();
    const st = this.state();
    const usage = this.q.usageSince.all(now - DAY);
    const durations = usage.filter((u) => u.duration_ms != null);
    const { problems, lights } = problemsOf({
      koalas: st.koalas,
      failures: this.q.failures.all(now - 15 * 60000),
      spend: { today: st.usage.today.cost, cap: this.config.dayUsd },
      tickets: st.tickets.map((t) => ({ ...t, ts: t.created })),
      now,
    });
    const byKoala = {};
    for (const u of usage) {
      const b = (byKoala[u.koala] ??= { calls: 0, tokens: 0, cost: 0, failed: 0 });
      b.calls += 1;
      b.tokens += u.tokens_in + u.tokens_out;
      b.cost += u.cost_usd;
      if (!u.ok) b.failed += 1;
    }
    const kinds = {};
    for (const u of usage) kinds[u.kind ?? 'decide'] = (kinds[u.kind ?? 'decide'] ?? 0) + 1;
    return {
      now,
      problems,
      lights,
      habits: habitsOf(this.q.habits.all(now - DAY)),
      hourly: hourly(usage, now),
      last24: { byKoala, kinds, avgSeconds: durations.length ? durations.reduce((a, u) => a + u.duration_ms, 0) / durations.length / 1000 : null },
      feed: this.q.feed.all(60),
    };
  }

  // Everything recorded, for the Google Sheets export.
  exportData() {
    const st = this.state();
    return exportTabs({ koalas: st.koalas, log: this.q.allLog.all(), usage: this.q.allUsage.all(), now: this.now(), model: this.config.model });
  }

  state() {
    const now = this.now();
    const today = this.#sums(startOfDay(now));
    const total = this.#sums(0);
    const last = this.q.lastUsage.get();
    return {
      playing: this.playing,
      pausedReason: this.#meta('pausedReason', null),
      present: this.present,
      capped: today.total.cost >= this.config.dayUsd,
      brain: { mode: this.brainMode, modes: BRAINS, autonomous: this.autonomous, free: this.#freeStats(), hybridEvery: this.config.hybridEvery, localModel: this.localLlm?.model ?? null },
      clock: this.clock(),
      places: placesOf(this.world),
      items: ITEMS,
      builds: this.world.builds,
      blueprints: BLUEPRINTS,
      plots: PLOTS,
      lands: LANDS.map((l) => ({ ...l, risen: landOf(this.world).includes(l) })),
      stock: stockOf(this.world),
      family: { baby: this.world.baby ?? null, nest: this.world.nest ?? null },
      tickets: this.tickets.list(),
      resources: RESOURCES,
      costs: COSTS,
      customCosts: Object.fromEntries(['small', 'medium', 'big'].map((size) => [size, designCost({ size, design: '' })])),
      islands: ISLANDS.map((i) => ({ ...i, bridged: bridged(this.world).has(i.id) })),
      koalas: this.#all().map((k) => ({
        ...k,
        ...growthOf(k),
        ...wisdomOf(k),
        color: KOALAS.find((f) => f.id === k.id)?.color ?? k.color ?? '#a8a29a',
        thinking: this.#run[k.id].thinking,
        nextAt: this.#run[k.id].nextAt === Infinity ? null : this.#run[k.id].nextAt,
      })),
      log: this.q.recentLog.all(LOG_ROWS).reverse(),
      usage: {
        model: this.config.model,
        dayUsd: this.config.dayUsd,
        callUsd: this.config.callUsd,
        today: today.total,
        total: total.total,
        byKoala: Object.fromEntries(this.#all().map((k) => [k.id, { today: today[k.id], total: total[k.id] }])),
        last: last ? { koala: last.koala, ok: !!last.ok, cost: last.cost_usd, tokens_in: last.tokens_in, tokens_out: last.tokens_out, ms: last.duration_ms, ts: last.ts } : null,
      },
      now,
    };
  }
}
