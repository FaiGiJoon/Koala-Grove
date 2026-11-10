// The owner's dashboard: pure functions over the grove's records. The Grove (grove.js) runs the
// queries; these turn rows into problems, habits, hourly usage and the export's sheet tabs.

export const HOUR_MS = 3600000;
export const DAY_MS = 24 * HOUR_MS;

// All the thresholds in one place, so they are easy to tune.
export const RULES = {
  hungerWarn: 70,
  hungerProblem: 90,
  energyWarn: 25,
  energyProblem: 10,
  failWindowMs: 15 * 60000,
  spendWarn: 0.8,
};

const SEVERITY = { ok: 0, warning: 1, problem: 2 };
const worst = (a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a);

// Active problems, newest first, and each koala's light (its worst problem).
// koalas: state koalas; failures: [{ ts, koala, text }] in the window; spend: { today, cap }; tickets: open tickets.
export function problemsOf({ koalas, failures = [], spend = { today: 0, cap: Infinity }, tickets = [], now = Date.now() }) {
  const list = [];
  const add = (level, koala, text, ts = now) => list.push({ level, koala, text, ts });
  for (const k of koalas) {
    if (k.hunger >= RULES.hungerProblem) add('problem', k.id, `${k.name} is starving (hunger ${Math.round(k.hunger)})`);
    else if (k.hunger >= RULES.hungerWarn) add('warning', k.id, `${k.name} is hungry (hunger ${Math.round(k.hunger)})`);
    if (k.energy <= RULES.energyProblem) add('problem', k.id, `${k.name} is exhausted (energy ${Math.round(k.energy)})`);
    else if (k.energy <= RULES.energyWarn) add('warning', k.id, `${k.name} is tired (energy ${Math.round(k.energy)})`);
  }
  for (const f of failures) if (now - f.ts <= RULES.failWindowMs) add('problem', f.koala, f.text, f.ts);
  for (const t of tickets) if (t.status === 'open') add('warning', t.koala, `Needs you: ticket "${t.title}"`, t.ts ?? t.created ?? now);
  if (spend.cap > 0 && spend.today >= spend.cap) add('problem', null, `Daily cap reached: the koalas stop deciding until tomorrow`);
  else if (spend.cap > 0 && spend.today >= spend.cap * RULES.spendWarn) add('warning', null, `Spend is at ${Math.round((spend.today / spend.cap) * 100)}% of the daily cap`);
  list.sort((a, b) => SEVERITY[b.level] - SEVERITY[a.level] || b.ts - a.ts);
  const lights = Object.fromEntries(koalas.map((k) => [k.id, 'ok']));
  for (const p of list) {
    if (p.koala && p.koala in lights) lights[p.koala] = worst(lights[p.koala], p.level);
    if (!p.koala) for (const id of Object.keys(lights)) lights[id] = worst(lights[id], p.level === 'problem' ? 'warning' : p.level);
  }
  return { problems: list, lights };
}

// Each koala's share of actions: rows are [{ koala, action, n }].
export function habitsOf(rows) {
  const by = {};
  for (const r of rows) {
    if (!r.action) continue;
    const h = (by[r.koala] ??= { total: 0, actions: {} });
    h.actions[r.action] = (h.actions[r.action] ?? 0) + r.n;
    h.total += r.n;
  }
  for (const h of Object.values(by)) {
    h.shares = Object.entries(h.actions)
      .map(([action, n]) => ({ action, n, pct: Math.round((n / h.total) * 100) }))
      .sort((a, b) => b.n - a.n);
  }
  return by;
}

// Tokens and cost per hour over the last 24 hours, oldest first (24 buckets).
export function hourly(usageRows, now) {
  const start = Math.floor((now - DAY_MS) / HOUR_MS) * HOUR_MS + HOUR_MS;
  const buckets = Array.from({ length: 24 }, (_, i) => ({ ts: start + i * HOUR_MS, tokens: 0, cost: 0, calls: 0 }));
  for (const r of usageRows) {
    const i = Math.floor((r.ts - start) / HOUR_MS);
    if (i < 0 || i >= 24) continue;
    buckets[i].tokens += (r.tokens_in ?? 0) + (r.tokens_out ?? 0);
    buckets[i].cost += r.cost_usd ?? 0;
    buckets[i].calls += 1;
  }
  return buckets;
}

// --- the export -------------------------------------------------------------------------

// A sheet date: days since 1899-12-30 in local time, so Sheets shows the owner's clock.
export function sheetDate(ms) {
  const d = new Date(ms);
  const local = ms - d.getTimezoneOffset() * 60000;
  return local / DAY_MS + 25569;
}

const nameOf = (koalas) => (id) => koalas.find((k) => k.id === id)?.name ?? id ?? '';

// The spreadsheet's tabs: { title, header, rows, dateCols }. All values are plain strings and
// numbers; the writer sends them RAW, so text that looks like a formula stays text.
export function exportTabs({ koalas, log, usage, now, model }) {
  const name = nameOf(koalas);
  const per = {};
  for (const u of usage) {
    const p = (per[u.koala] ??= { calls: 0, tokens_in: 0, tokens_out: 0, cost: 0 });
    p.calls += 1;
    p.tokens_in += u.tokens_in;
    p.tokens_out += u.tokens_out;
    p.cost += u.cost_usd;
  }
  const days = {};
  for (const u of usage) {
    const d = new Date(u.ts);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const x = (days[key] ??= { calls: 0, tokens: 0, cost: 0 });
    x.calls += 1;
    x.tokens += u.tokens_in + u.tokens_out;
    x.cost += u.cost_usd;
  }
  const sum = Object.values(per).reduce((a, p) => ({
    calls: a.calls + p.calls, tokens_in: a.tokens_in + p.tokens_in, tokens_out: a.tokens_out + p.tokens_out, cost: a.cost + p.cost,
  }), { calls: 0, tokens_in: 0, tokens_out: 0, cost: 0 });
  const summary = [
    ['Exported', sheetDate(now)],
    ['Model', model ?? ''],
    ['Calls', sum.calls],
    ['Tokens in', sum.tokens_in],
    ['Tokens out', sum.tokens_out],
    ['Cost (USD)', round(sum.cost)],
    [],
    ['Koala', 'Calls', 'Tokens in', 'Tokens out', 'Cost (USD)'],
    ...Object.entries(per).map(([id, p]) => [name(id), p.calls, p.tokens_in, p.tokens_out, round(p.cost)]),
    [],
    ['Day', 'Calls', 'Tokens', 'Cost (USD)'],
    ...Object.entries(days).sort().map(([d, x]) => [d, x.calls, x.tokens, round(x.cost)]),
  ];
  const memoryRows = [];
  for (const e of log) {
    if (e.kind === 'learn') memoryRows.push([sheetDate(e.ts), name(e.koala), 'learned', e.text]);
    if (e.kind === 'remember') memoryRows.push([sheetDate(e.ts), name(e.koala), 'memory', e.text]);
  }
  const logged = new Set(memoryRows.map((r) => `${r[1]}|${r[3]}`));
  for (const k of koalas) {
    for (const m of k.memories ?? []) if (!logged.has(`${k.name}|${m}`)) memoryRows.push(['(held now, date unknown)', k.name, 'memory', m]);
    for (const f of k.learned ?? []) if (![...logged].some((x) => x.startsWith(`${k.name}|`) && x.includes(f))) memoryRows.push(['(held now, date unknown)', k.name, 'learned', f]);
  }
  return [
    { title: 'Summary', header: ['Item', 'Value'], rows: summary, dateCols: [], dateCells: [[0, 1]] },
    {
      title: 'Koalas',
      header: ['Koala', 'Stage', 'Wisdom', 'Level', 'Hunger', 'Energy', 'Strength', 'Mood', 'Wish', 'Personality', 'Wonders about', 'Bond', 'Opinion', 'Memories', 'Learned'],
      rows: koalas.map((k) => [k.name, k.stageLabel ?? '', Math.round(k.wisdom ?? 0), k.wisdomLabel ?? '', Math.round(k.hunger), Math.round(k.energy), Math.round(k.strength),
        k.mood ?? '', k.wish ?? '', (k.traits ?? []).join('; '), (k.curiosities ?? []).join(', '), k.bond ?? 0, k.opinion ?? '', (k.memories ?? []).length, (k.learned ?? []).length]),
      dateCols: [],
    },
    {
      title: 'Activity',
      header: ['Time', 'Koala', 'Kind', 'Action', 'Target', 'Text'],
      rows: log.map((e) => [sheetDate(e.ts), name(e.koala), e.kind, e.action ?? '', e.target ?? '', e.text]),
      dateCols: [0],
    },
    {
      title: 'Thinking',
      header: ['Time', 'Koala', 'Thought'],
      rows: log.filter((e) => e.kind === 'think').map((e) => [sheetDate(e.ts), name(e.koala), e.text]),
      dateCols: [0],
    },
    {
      title: 'Usage',
      header: ['Time', 'Koala', 'Call', 'OK', 'Tokens in', 'Tokens out', 'Cost (USD)', 'Seconds'],
      rows: usage.map((u) => [sheetDate(u.ts), name(u.koala), u.kind ?? '', u.ok ? 'yes' : 'no', u.tokens_in, u.tokens_out, u.cost_usd,
        u.duration_ms == null ? '' : Math.round(u.duration_ms / 100) / 10]),
      dateCols: [0],
    },
    {
      title: 'Memories & learned',
      header: ['Time', 'Koala', 'Type', 'Text'],
      rows: memoryRows,
      dateCols: [0],
    },
  ];
}

const round = (x) => Math.round(x * 10000) / 10000;

// The searches a koala made, newest first. Rows are grove_log rows of kind 'search', whose text is
// `Searched "<query>" (<via>): <title or "nothing found">` with ` (<url>)` after the title when there is a link.
export function searchesOf(rows, limit = 10) {
  const out = [];
  for (const r of rows) {
    if (out.length >= limit) break;
    if (r.kind !== 'search') continue;
    const text = String(r.text ?? '');
    const via = r.action ?? '';
    const head = `Searched "${r.target ?? ''}" (${via}): `;
    const rest = text.startsWith(head) ? text.slice(head.length) : text;
    const link = rest.match(/ \((https?:\/\/\S+)\)$/);
    const title = link ? rest.slice(0, link.index) : rest;
    out.push({ ts: r.ts, query: r.target ?? '', via, title: title === 'nothing found' ? null : title, url: link ? link[1] : '' });
  }
  return out;
}

// What the owner sees about one koala: its wish, how pressing each drive is (0..1), its latest searches
// and its open tickets. With no koala, every list is empty and the wish is null.
export function overviewOf({ koala = null, needs = {}, tickets = [], searches = [] } = {}) {
  if (!koala) return { name: null, wish: null, drives: [], searches: [], openTickets: [] };
  return {
    name: koala.name,
    wish: koala.wish || null,
    drives: Object.entries(needs).map(([name, value]) => ({ name, value })),
    searches,
    openTickets: tickets.filter((t) => t.status === 'open' && t.koala === koala.id).map((t) => ({ id: t.id, text: t.text, created: t.created ?? null })),
  };
}
