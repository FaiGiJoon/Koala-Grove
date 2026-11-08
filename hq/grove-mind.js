// A koala's inner life: drives that build up and get met, memories that fade unless they
// matter, beliefs learned from experience, promises kept or not, and the few things each
// koala holds to. Pure (no I/O): the grove calls these after every decision and at night.
//
// The shape follows how a good "living creature" is described from the inside: needs as
// 0 (met) .. 1 (pressing), a short memory that is consolidated into a small long memory,
// and beliefs that carry their own evidence. The koalas use it to choose; the read-only
// API (/api/v1) shows it to anyone curious.

export const DRIVES = ['rest', 'curiosity', 'social', 'expression', 'quiet'];

// How fast each drive builds up per real minute, by koala. Babies grow up with the mix.
const RATES = {
  crystal: { curiosity: 0.014, social: 0.010, expression: 0.010, quiet: 0.004 },
  ruby: { curiosity: 0.009, social: 0.008, expression: 0.006, quiet: 0.010 },
  mixed: { curiosity: 0.012, social: 0.012, expression: 0.008, quiet: 0.006 },
};

// The few things each koala holds to. They nudge what it picks (see HOLDS_BIAS).
export const HOLDS_TO = {
  crystal: ['Be brave, and still be home before dark.', 'Share what you find.', 'Finish what you start.'],
  ruby: ['Rest is never wasted.', 'Be gentle with small things.', 'Keep your promises.'],
  mixed: ['Stay close to the grown-ups.', 'Ask about everything.', 'Be kind.'],
};
export const HOLDS_BIAS = {
  'Be brave, and still be home before dark.': { home_at_night: 12, explore: 4 },
  'Share what you find.': { give: 10 },
  'Finish what you start.': { build: 6 },
  'Rest is never wasted.': { nap: 8 },
  'Be gentle with small things.': { approach: 4 },
  'Keep your promises.': { build: 8 },
  'Stay close to the grown-ups.': { approach: 8 },
  'Ask about everything.': { read: 6 },
  'Be kind.': { give: 6 },
};

const SHORT_MAX = 20; // a day's worth of moments
const LONG_MAX = 12; // small on purpose: only what matters stays
const BELIEFS_MAX = 10;
const PROMISE_DAYS = 3; // a promise not kept in this many real days is let go, with a worry
const DAY = 24 * 60 * 60000;
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const round = (n) => Math.round(n * 100) / 100;
const keyOf = (id) => (RATES[id] ? id : 'mixed');

// The koala's mind, created on first use from what it already remembers.
export function mindOf(k) {
  if (!k.mind) {
    k.mind = {
      drives: { curiosity: 0.3, social: 0.3, expression: 0.2, quiet: 0.2 },
      short: [],
      long: (k.memories ?? []).map((text) => ({ text, kind: 'moment', strength: 3, recalled: 0, since: null })),
      beliefs: [],
      promises: [],
      worries: [],
    };
  }
  return k.mind;
}

export const holdsTo = (k) => HOLDS_TO[keyOf(k.id)] ?? HOLDS_TO.mixed;

// How pressing each drive is now, 0 (met) .. 1 (pressing). Rest comes from energy.
export function needsOf(k) {
  const m = mindOf(k);
  return {
    rest: round(clamp01(1 - (k.energy ?? 50) / 100)),
    curiosity: round(m.drives.curiosity),
    social: round(m.drives.social),
    expression: round(m.drives.expression),
    quiet: round(m.drives.quiet),
  };
}

// The loudest drive, for the koala's own words and the API.
export function loudest(k) {
  const n = needsOf(k);
  return DRIVES.reduce((a, b) => (n[b] > n[a] ? b : a));
}

export function driftMind(k, minutes) {
  const m = mindOf(k);
  const r = RATES[keyOf(k.id)];
  for (const d of Object.keys(r)) m.drives[d] = clamp01((m.drives[d] ?? 0) + r[d] * minutes);
}

// What an action does to the drives. ctx: { together, said, explored }.
export function satisfy(k, d, ctx = {}) {
  const m = mindOf(k);
  const dv = m.drives;
  const ease = (drive, by) => { dv[drive] = clamp01(dv[drive] - by); };
  const press = (drive, by) => { dv[drive] = clamp01(dv[drive] + by); };
  switch (d.action) {
    case 'read': case 'research': ease('curiosity', 0.5); press('quiet', -0.1); break;
    case 'move': if (ctx.explored) ease('curiosity', 0.2); break;
    case 'approach': case 'give': ease('social', 0.4); press('quiet', 0.05); break;
    case 'play': ease('expression', 0.3); if (ctx.together) ease('social', 0.2); break;
    case 'build': ease('expression', 0.25); if (ctx.together) ease('social', 0.15); break;
    case 'nap': ease('quiet', 0.4); break;
    case 'sit': if (ctx.together) ease('social', 0.25); else ease('quiet', 0.3); break;
    case 'climb': ease('expression', 0.1); break;
    default: break;
  }
  if (ctx.said) { ease('expression', 0.15); if (ctx.together) ease('social', 0.1); }
}

// A moment goes into short memory; seen again, it gets stronger instead of doubled.
export function notice(k, text, kind = 'moment', now = Date.now(), strength = 1) {
  const m = mindOf(k);
  const t = String(text).replace(/\s+/g, ' ').trim().slice(0, 140);
  if (!t) return;
  const hit = m.short.find((x) => x.text === t) ?? m.long.find((x) => x.text === t);
  if (hit) {
    hit.strength = Math.min(10, hit.strength + 1);
    hit.recalled += 1;
    return;
  }
  m.short.push({ text: t, kind, strength, recalled: 0, since: now });
  if (m.short.length > SHORT_MAX) m.short.splice(0, m.short.length - SHORT_MAX);
}

// Being somewhere, with someone or doing something brings back memories about it.
export function recall(k, words) {
  const m = mindOf(k);
  const ws = words.filter(Boolean).map((w) => String(w).toLowerCase()).filter((w) => w.length > 2);
  if (!ws.length) return 0;
  let n = 0;
  for (const x of [...m.long, ...m.short]) {
    const t = x.text.toLowerCase();
    if (ws.some((w) => t.includes(w))) { x.recalled += 0.25; n++; }
  }
  return n;
}

// A belief from experience: the same lesson again adds evidence; going against it takes some.
export function learn(k, key, text, delta = 1) {
  const m = mindOf(k);
  const b = m.beliefs.find((x) => x.key === key);
  if (b) b.evidence = Math.min(20, b.evidence + delta);
  else if (delta > 0) m.beliefs.push({ key, text, evidence: delta });
  m.beliefs = m.beliefs.filter((x) => x.evidence > 0).sort((a, b) => b.evidence - a.evidence).slice(0, BELIEFS_MAX);
}

export const beliefKey = (action, place) => `${action}@${place}`;
// What a lesson is about: the place for reading, napping and sitting (their target is a
// topic or nothing), else the target (the tree, the toy, the resource).
export const beliefPlace = (d, place) => (['read', 'nap', 'sit', 'research'].includes(d.action) ? place : d.target || place);

// How much experience says this is a good thing to do here (0 when it does not know).
export function beliefBoost(k, d, place) {
  const b = mindOf(k).beliefs.find((x) => x.key === beliefKey(d.action, beliefPlace(d, place)));
  return b ? Math.min(b.evidence, 8) : 0;
}

export function promise(k, subject, kind, now = Date.now()) {
  const m = mindOf(k);
  if (m.promises.some((p) => p.subject === subject)) return;
  m.promises.push({ subject, kind, since: now });
  if (m.promises.length > 5) m.promises.shift();
}

// A promise is kept when the thing it was about happens. Returns the kept ones.
export function keep(k, match, now = Date.now()) {
  const m = mindOf(k);
  const kept = m.promises.filter((p) => match(p));
  if (!kept.length) return [];
  m.promises = m.promises.filter((p) => !kept.includes(p));
  for (const p of kept) {
    notice(k, `I kept my promise: ${p.subject}.`, 'promise', now, 3);
    learn(k, 'promises', 'Keeping a promise feels good.');
  }
  return kept;
}

// Night: short memory is sorted out. What was strong or came back stays; the rest fades.
// The long memory keeps only the strongest few. Old promises turn into worries.
export function consolidate(k, now = Date.now()) {
  const m = mindOf(k);
  const keepers = m.short.filter((x) => x.strength + x.recalled >= 2);
  m.short = [];
  for (const x of keepers) if (!m.long.some((l) => l.text === x.text)) m.long.push(x);
  for (const x of m.long) x.strength = Math.max(0.5, x.strength * 0.95); // all fade a little
  const worth = (x) => x.strength + Math.log2(1 + x.recalled);
  m.long = m.long.sort((a, b) => worth(b) - worth(a)).slice(0, LONG_MAX)
    .sort((a, b) => (a.since ?? 0) - (b.since ?? 0));
  const old = m.promises.filter((p) => now - p.since > PROMISE_DAYS * DAY);
  m.promises = m.promises.filter((p) => !old.includes(p));
  for (const p of old) m.worries = [...m.worries, `I never finished: ${p.subject}.`].slice(-3);
  k.memories = m.long.map((x) => x.text); // what the prompt and the page show
  return { kept: keepers.length, long: m.long.length };
}

// Words for the koala's prompt (model brain) and the page.
export function innerLines(k) {
  const m = mindOf(k);
  const n = needsOf(k);
  const press = DRIVES.filter((d) => n[d] >= 0.6);
  return [
    press.length ? `Inside, you most need: ${press.join(', ')}.` : 'Inside, you feel settled.',
    `You hold to: ${holdsTo(k).join(' ')}`,
    m.beliefs.length ? `What experience taught you: ${m.beliefs.slice(0, 4).map((b) => b.text).join(' ')}` : '',
    m.promises.length ? `Promises you made: ${m.promises.map((p) => p.subject).join('; ')}.` : '',
    m.worries.length ? `On your mind: ${m.worries.join(' ')}` : '',
  ].filter(Boolean);
}

const GOOD = new Set(['happy', 'playful', 'content', 'cozy', 'curious', 'proud', 'excited', 'calm']);
const BAD = new Set(['lonely', 'grumpy', 'hungry', 'sleepy', 'sad', 'bored', 'tired', 'scared']);
const LESSON = {
  play: (p) => `Playing at the ${p} makes me happy.`,
  eat: (p) => `The ${p} has good leaves.`,
  read: (p) => `Reading at the ${p} makes me wiser.`,
  nap: (p) => `I sleep well at the ${p}.`,
  climb: (p) => `Climbing the ${p} makes me stronger.`,
  gather: (p, x) => `There is always ${x} at the ${p}.`,
};
const MOMENT = {
  play: (p, f) => `Played at the ${p}${f ? ` with ${f}` : ''}.`,
  build: (p, f) => `Built something${f ? ` with ${f}` : ''}.`,
  approach: (p, f) => `Went to find ${f}.`,
  give: (p, f, x) => `Gave ${f} a ${x}.`,
  read: (p) => `Read at the ${p}.`,
};

// After each decision: drives move, the moment is noticed, memories come back, a lesson
// is learned or unlearned, and promises are made or kept.
// ctx: { place (where it happened), placeName, friend (name), together, said, explored, logs, now }
export function experience(k, d, ctx) {
  const now = ctx.now ?? Date.now();
  satisfy(k, d, ctx);
  const p = ctx.placeName ?? ctx.place;
  const key = beliefKey(d.action, beliefPlace(d, ctx.place));
  const mood = d.mood ?? k.mood;
  const lesson = LESSON[d.action]?.(p, d.target);
  if (lesson && GOOD.has(mood)) learn(k, key, lesson, 1);
  else if (lesson && BAD.has(mood)) learn(k, key, lesson, -1);
  if (ctx.together && ctx.friend && GOOD.has(mood) && ['sit', 'play', 'build', 'approach', 'give'].includes(d.action)) {
    learn(k, beliefKey('approach', ctx.friend), `Being with ${ctx.friend} makes the day better.`, 1);
  }
  const moment = MOMENT[d.action]?.(p, ctx.together || d.action !== 'play' ? ctx.friend : '', d.target);
  if (moment) notice(k, moment, 'moment', now);
  if (d.remember) notice(k, d.remember, 'moment', now, 2);
  for (const e of ctx.logs ?? []) {
    if (e.kind === 'built' || e.kind === 'grow' || e.kind === 'land') notice(k, e.text, 'moment', now, 2);
    const started = /started building the (.+?) \(/.exec(e.text ?? '');
    if (started && e.koala === k.id) promise(k, `finish the ${started[1]}`, 'build', now);
  }
  recall(k, [p, d.target]);
}

// A build was finished: every koala that promised it keeps its promise.
export function onBuilt(koalas, text, now = Date.now()) {
  const kept = [];
  for (const k of koalas) kept.push(...keep(k, (pr) => text.includes(pr.subject.replace(/^finish the /, '')), now));
  return kept;
}

// The read-only view of a koala's inner life, for /api/v1.
export function publicMind(k, now = Date.now()) {
  const m = mindOf(k);
  const iso = (t) => (t ? new Date(t).toISOString() : null);
  return {
    needs: needsOf(k),
    loudest: loudest(k),
    holdsTo: holdsTo(k),
    promises: m.promises.map((x) => ({ kind: x.kind, subject: x.subject, since: iso(x.since) })),
    worries: [...m.worries],
    beliefs: m.beliefs.map((b) => ({ text: b.text, evidence: b.evidence })),
    long: m.long.map((x) => ({ text: x.text, kind: x.kind, strength: round(x.strength), recalled: x.recalled, since: iso(x.since) })),
    short: m.short.map((x) => ({ text: x.text, kind: x.kind, strength: round(x.strength), recalled: x.recalled, since: iso(x.since) })),
    at: iso(now),
  };
}
