// Koala Grove: the rules of the grove. Two koalas, each a real model call away
// from its next move. Everything here is pure: the Grove (grove.js) owns time,
// storage and the model calls, and asks these functions what a decision means.

// The whole cast. A grove can run with only some of them (GROVE_KOALAS, see config.js): a koala
// with no friend in the grove sits instead of approaching, giving or nesting.
export const KOALAS = [
  {
    id: 'crystal',
    name: 'Crystal',
    gender: 'girl',
    outfit: 'a pink scarf',
    color: '#b9c2c9',
    home: 'clearing',
    interests: ['brave explorers', 'shiny stones and crystals', 'stars', 'faraway places'],
    persona: 'Crystal is a bold and endlessly curious baby koala, a girl (she/her) who wears a pink scarf. '
      + 'Crystal loves exploring every corner of the grove, collects shiny pebbles, splashes at the pond, '
      + 'talks a lot, gets bored quickly and sometimes teases. Crystal secretly wants Ruby to think she is brave.',
  },
  {
    id: 'ruby',
    name: 'Ruby',
    gender: 'boy',
    outfit: 'a small blue hat',
    color: '#8d8478',
    home: 'hollow',
    interests: ['sleepy animals', 'eucalyptus and plants', 'poems', 'the moon and night'],
    persona: 'Ruby is a gentle and sleepy baby koala, a boy (he/him) who wears a small blue hat. Ruby adores '
      + 'eucalyptus, long naps in the mossy hollow and quiet company. He speaks softly and a little poetically, '
      + 'is slow to trust, notices small things, and is protective of friends once they have earned it.',
  },
];

import {
  RESOURCES, ISLANDS, OPEN_ISLANDS, SOURCES, costOf, stockOf, held, canAfford, spend, add, amounts, bridged, bridgeFoot,
} from './grove-economy.js';
import { canNest, nestStep } from './grove-family.js';
import { designSpec, designCost } from './grove-design.js';

// The koalas used to be called Mallee and Bramble; old groves are renamed on start.
export const RENAMED = { mallee: 'crystal', bramble: 'ruby' };
export function migrateNames(text) {
  return String(text ?? '').replace(/\bMallee\b/g, 'Crystal').replace(/\bBramble\b/g, 'Ruby');
}

// Grove-space coordinates (metres); the page builds the same places in 3D.
export const PLACES = {
  big_gum: { name: 'Big Gum', x: -8, z: -6, tree: true },
  river_gum: { name: 'River Gum', x: 9, z: -9, tree: true },
  blue_gum: { name: 'Blue Gum', x: -12, z: 8, tree: true },
  pond: { name: 'Lily Pond', x: 10, z: 2 },
  swing: { name: 'Rope Swing', x: 2, z: -12 },
  clearing: { name: 'Sunny Clearing', x: 0, z: 2 },
  hollow: { name: 'Mossy Hollow', x: -15, z: -1 },
  lookout: { name: 'Lookout Rock', x: 14, z: 12 },
  flowers: { name: 'Blossom Patch', x: -2, z: 13 },
  stockpile: { name: 'Stockpile', x: 2.6, z: 4.4 },
};

export const ITEMS = ['leaf', 'blossom', 'pebble', 'ball', 'feather'];

// Little things the koalas may notice: the critters the page draws, seen now and then.
export const SIGHTINGS = [
  'A turtle plodded slowly past the pond.',
  'A frog hopped out of the reeds and plopped into the pond.',
  'A kookaburra laughed from the top of a gum tree.',
  'Two little birds chased each other around the River Gum.',
  'A turtle poked its head out of its shell and blinked at you.',
  'A frog croaked somewhere near the lily pads.',
];
export const ACTIONS = ['move', 'eat', 'nap', 'play', 'climb', 'approach', 'give', 'gather', 'store', 'build', 'nest', 'file_ticket', 'research', 'read', 'sit'];

// Building. Each build action adds one step of work, two when the friend is building at
// the same site. A finished build stands at its plot and becomes a place to visit.
export const BLUEPRINTS = {
  bench: { name: 'Log Bench', effort: 2 },
  lantern: { name: 'Firefly Lantern', effort: 2 },
  flowerbed: { name: 'Flower Bed', effort: 3 },
  birdhouse: { name: 'Birdhouse', effort: 3 },
  stones: { name: 'Stepping Stones', effort: 3 },
  hut: { name: 'Leaf Hut', effort: 5 },
  treehouse: { name: 'Treehouse', effort: 6 },
  tower: { name: 'Lookout Tower', effort: 6 },
  well: { name: 'Well', effort: 4 },
  reading_nook: { name: 'Reading Nook', effort: 3 },
  // one bridge per resource island; it stands at the island's edge, not on a plot
  ...Object.fromEntries(ISLANDS.map((i) => [`bridge_${i.id}`, { name: `Bridge to ${i.name}`, effort: 4, bridge: i.id }])),
};
const MAX_OPEN = 2;
// New land: every LAND_EVERY finished builds, the next piece rises from the water off the island.
export const LANDS = [
  { id: 'fern_islet', name: 'Fern Islet', x: 0, z: -36, r: 7 },
  { id: 'sunset_point', name: 'Sunset Point', x: 34, z: 15, r: 6.5 },
  { id: 'moss_isle', name: 'Moss Isle', x: -34, z: 17, r: 7 },
];
const LAND_EVERY = 2;
// Open ground for building: in the wedges between the paths that fan out from the clearing,
// and two spots on each piece of new land.
export const PLOTS = [
  [3.4, 10.3], [6.0, 16.8], [-4.8, 8.4], [-9.0, 14.0], [-2.9, -6.5], [-5.4, -14.1], [4.0, -7.2], [-8.9, 3.2],
].map(([x, z], i) => ({ id: `plot_${i + 1}`, x, z, land: null })).concat(LANDS.flatMap((l) => [0.6, 0.6 + Math.PI].map((a, i) => ({
  id: `plot_${l.id}_${i + 1}`, x: Math.round((l.x + Math.cos(a) * 3.5) * 10) / 10, z: Math.round((l.z + Math.sin(a) * 3.5) * 10) / 10, land: l.id,
}))));
export const MOODS = ['happy', 'playful', 'sleepy', 'hungry', 'curious', 'cozy', 'grumpy', 'shy', 'content', 'lonely'];
const TOYS = { ball: 'clearing', swing: 'swing', pond: 'pond' };
const TREES = Object.keys(PLACES).filter((id) => PLACES[id].tree);
const MAX_RECENT = 10;
// The prompt shows only the newest of these, to keep each decision cheap.
const PROMPT_RECENT = 6;
const PROMPT_MEMORIES = 8;
const MAX_MEMORIES = 12;
export const MAX_LEARNED = 60; // facts a koala keeps; the prompt shows the newest and the most relevant
export const MAX_TRAITS = 6; // things a koala has found out about who it is
export const MAX_CURIOSITIES = 6; // new interests picked up from what it learned
const PROMPT_LEARNED = 6;

// How clever a koala has become: wisdom grows by 1 per book and 2 per web search.
export const WISDOM = [
  { at: 0, id: 'curious', label: 'Curious baby', style: 'Answer very simply, in words a baby koala understands.' },
  { at: 5, id: 'learner', label: 'Little learner', style: 'Answer simply, and add one interesting detail.' },
  { at: 15, id: 'scholar', label: 'Young scholar', style: 'Answer clearly with a real detail or number, and say why or how it works.' },
  { at: 35, id: 'clever', label: 'Clever koala', style: 'Answer like a good encyclopedia: precise, with how and why, and how it connects to what the koala already knows.' },
  { at: 70, id: 'wise', label: 'Wise koala', style: 'Answer in depth like an expert talking to a sharp student: precise facts, causes, and a surprising connection.' },
];
export const wisdomOf = (k) => {
  const w = Number(k?.wisdom) || 0;
  const lv = [...WISDOM].reverse().find((x) => w >= x.at) ?? WISDOM[0];
  const next = WISDOM.find((x) => x.at > w);
  return { wisdom: w, wisdomLevel: lv.id, wisdomLabel: lv.label, wisdomStyle: lv.style, nextWisdom: next ? { label: next.label, at: next.at } : null };
};
const MAX_ITEMS = 4;
export { MAX_ITEMS };

// Growing up. Both koalas start as babies. Strength (0 to 100) rises with what they do and
// decides what they can: how big they are, how high they climb, how much they carry, how fast they tire.
export const STAGES = [
  { id: 'baby', label: 'Baby', at: 0 },
  { id: 'joey', label: 'Joey', at: 20 },
  { id: 'youngster', label: 'Youngster', at: 45 },
  { id: 'grown', label: 'Grown-up', at: 75 },
];
export const START_STRENGTH = 5;
const TRAIN = { climb: 2, play: 1.5, build: 1.5, eat: 1, gather: 0.5, nap: 0.5, move: 0.2, approach: 0.1 }; // strength per action
const PRONOUNS = { girl: 'she/her', boy: 'he/him' };

export const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    thought: { type: 'string', description: 'Your private thought right now, one short sentence.' },
    action: { type: 'string', enum: ACTIONS },
    target: { type: 'string', description: 'A place id, a toy (ball, swing, pond) or an item to give; empty if none.' },
    say: { type: 'string', description: 'What you say out loud, or empty to stay quiet.' },
    mood: { type: 'string', enum: MOODS },
    remember: { type: 'string', description: 'Something worth remembering for a long time, or empty.' },
    bond: { type: 'integer', minimum: -3, maximum: 3, description: 'How this moment changes your feelings about your friend.' },
    opinion: { type: 'string', description: 'One line: what you think of your friend now, or empty to keep it.' },
    build_name: { type: 'string', description: 'When you start building something, a name for it; otherwise empty.' },
    wish: { type: 'string', description: 'Something you would love to do or make one day, or empty to keep your wish.' },
    trait: { type: 'string', description: 'Something new you just found out about who you are (a habit, a taste, a belief, a quirk), or empty. Rarely.' },
    build_design: { type: 'string', description: 'When you start building something new that you invented (target new), one sentence on what it is and what it looks like; otherwise empty.' },
  },
  required: ['thought', 'action', 'target', 'say', 'mood', 'remember', 'bond', 'opinion', 'build_name', 'wish', 'trait', 'build_design'],
  additionalProperties: false,
};

const byId = (id) => KOALAS.find((k) => k.id === id);
export const interestsOf = (k) => {
  const base = k?.interests ?? byId(k?.id)?.interests ?? [];
  return [...base, ...(k?.curiosities ?? []).filter((c) => !base.includes(c))];
};
export const MAX_KOALAS = 4;

// Everyone else in the grove.
export function others(world, id) {
  return Object.values(world.koalas).filter((o) => o.id !== id);
}

// The koala this one does things with (approach, give): the other founder, or a young koala's parent.
export function friendOf(world, id) {
  const founder = byId(id);
  if (founder) {
    const other = KOALAS.find((x) => x.id !== id);
    return world.koalas[other?.id] ?? null; // a solo grove has no friend: null
  }
  const k = world.koalas[id];
  return world.koalas[k.parents?.find((p) => world.koalas[p])] ?? others(world, id)[0];
}
const other = (id) => KOALAS.find((k) => k.id !== id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const stageOf = (strength) => [...STAGES].reverse().find((st) => strength >= st.at) ?? STAGES[0];
export const sizeOf = (strength) => 0.5 + 0.5 * (clamp(strength, 0, 100) / 100) ** 0.8; // half of full size, up to full
export const carryLimit = (strength) => 2 + (strength >= 35 ? 1 : 0) + (strength >= 70 ? 1 : 0);
export const reachOf = (strength) => 0.3 + 0.7 * Math.min(1, Math.max(0, strength) / 60); // share of a tree it can climb
const fatigue = (strength) => 1.5 - 0.7 * (clamp(strength, 0, 100) / 100); // babies tire faster

// What the page needs to draw and describe a koala's growth, worked out from its strength.
export function growthOf(k) {
  const st = stageOf(k.strength);
  const next = STAGES.find((x) => x.at > k.strength);
  return {
    gender: byId(k.id)?.gender ?? 'girl',
    outfit: byId(k.id)?.outfit ?? '',
    stage: st.id,
    stageLabel: st.label,
    nextStage: next ? { label: next.label, at: next.at } : null,
    size: Math.round(sizeOf(k.strength) * 1000) / 1000,
    carry: carryLimit(k.strength),
    reach: Math.round(reachOf(k.strength) * 100) / 100,
  };
}
const text = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const push = (list, item, max) => {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
};

export function newKoala(id) {
  const k = byId(id);
  return {
    id,
    name: k.name,
    place: k.home,
    activity: 'sit',
    mood: 'content',
    hunger: 30,
    energy: 80,
    strength: START_STRENGTH,
    inventory: [],
    res: {}, // resources in paws: { wood: 2 }
    bond: 0,
    opinion: '',
    memories: [],
    learned: [],
    wisdom: 0,
    traits: [],
    curiosities: [],
    recent: [],
    thought: '',
    say: '',
  };
}

// --- the built world -----------------------------------------------------------------
const doneBuilds = (w) => (w.builds ?? []).filter((b) => b.done);
const openBuilds = (w) => (w.builds ?? []).filter((b) => !b.done);
const plotById = (id) => PLOTS.find((p) => p.id === id);

// The land that has risen so far.
export function landOf(world) {
  return LANDS.slice(0, Math.floor(doneBuilds(world).length / LAND_EVERY));
}

// Plots with nothing on them, on land that exists.
export function freePlots(world) {
  const used = new Set((world.builds ?? []).map((b) => b.plot));
  const land = new Set(landOf(world).map((l) => l.id));
  return PLOTS.filter((p) => !used.has(p.id) && (!p.land || land.has(p.land)));
}

// Every place a koala can be: the grove's own, the new land, and each build site.
export function placesOf(world) {
  const out = { ...PLACES };
  for (const l of landOf(world)) out[l.id] = { name: l.name, x: l.x, z: l.z, land: true };
  const open = bridged(world);
  for (const i of ISLANDS) if (open.has(i.id)) out[i.id] = { name: i.name, x: i.x, z: i.z, island: true, resource: i.resource };
  for (const b of world.builds ?? []) {
    const name = b.done ? b.title : `${b.title} (being built)`;
    if (b.plot) {
      const p = plotById(b.plot);
      out[b.plot] = { name, x: p.x, z: p.z, build: b.kind, done: b.done };
    } else {
      const foot = bridgeFoot(ISLANDS.find((i) => `bridge_${i.id}` === b.kind));
      out[b.kind] = { name, x: foot.x, z: foot.z, bridge: true, done: b.done };
    }
  }
  return out;
}

// Books can be opened at Library Isle and at finished builds that are about reading.
const BOOKISH = /\b(books?|reading|library|story|stories)\b/i;
export function canReadAt(world, place) {
  if (place === 'library_isle') return true;
  return (world.builds ?? []).some((b) => b.done && siteOf(b) === place
    && (b.kind === 'reading_nook' || BOOKISH.test(`${b.spec?.design ?? ''} ${b.title ?? ''}`)));
}

// The first {...} block in a string, parsed; null if there is none that parses.
function jsonIn(s) {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

// A model's reply made safe to act on: unknown actions become sitting, impossible
// targets are replaced with the nearest sensible one, text is trimmed and capped.
export function parseDecision(raw, koala, places = PLACES) {
  const obj = typeof raw === 'string' ? jsonIn(raw) : raw;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  let action = ACTIONS.includes(obj.action) ? obj.action : 'sit';
  let target = text(obj.target, 40).toLowerCase();
  let note = '';
  if (action === 'move') {
    const island = places[target] ? null : ISLANDS.find((i) => i.id === target);
    if (island) {
      note = `You wanted to go to ${island.name}, but you can't reach ${island.name} yet; it needs a bridge (bridge_${island.id}).`;
      action = 'sit';
      target = '';
    } else if (!places[target]) target = koala.place;
  } else if (action === 'eat' || action === 'climb') {
    if (!PLACES[target]?.tree) target = PLACES[koala.place]?.tree ? koala.place : TREES[0];
  } else if (action === 'play') {
    if (!TOYS[target]) target = 'ball';
  } else if (action === 'give') {
    if (!koala.inventory.includes(target)) {
      action = 'sit';
      target = '';
    }
  } else if (action === 'build') {
    if (!BLUEPRINTS[target]) {
      // anything else that comes with a name or a design is an invention; otherwise keep working
      target = target && (text(obj.build_name, 40) || text(obj.build_design, 160)) ? 'new' : '';
    }
  } else if (action === 'research') {
    target = text(obj.target, 120); // the question, as asked
    if (!target) action = 'sit';
  } else if (action === 'read') {
    target = text(obj.target, 80); // the topic
    if (!target) action = 'sit';
  } else if (action === 'gather') {
    if (!RESOURCES.includes(target)) {
      action = 'sit';
      target = '';
    }
  } else {
    target = '';
  }
  const bond = Number.isFinite(Number(obj.bond)) ? clamp(Math.round(Number(obj.bond)), -3, 3) : 0;
  return {
    thought: text(obj.thought, 200),
    action,
    target,
    say: text(obj.say, 160),
    mood: MOODS.includes(obj.mood) ? obj.mood : 'content',
    remember: text(obj.remember, 140),
    bond,
    opinion: text(obj.opinion, 120),
    buildName: text(obj.build_name, 40),
    buildDesign: text(obj.build_design, 160),
    wish: text(obj.wish, 120),
    trait: text(obj.trait, 80),
    note,
  };
}

function describe(d, friendName, strength, places) {
  switch (d.action) {
    case 'file_ticket': return 'wrote a ticket for the visitor';
    case 'read': return `opened a book about "${d.target}"`;
    case 'research': return `looked up "${d.target}" in the library`;
    case 'move': return `went to the ${places[d.target].name}`;
    case 'eat': return `ate eucalyptus at the ${PLACES[d.target].name}`;
    case 'climb': {
      const tree = PLACES[d.target].name;
      return strength < 25 ? `scrambled a little way up the ${tree}` : strength < 60 ? `climbed part of the way up the ${tree}` : `climbed the ${tree}`;
    }
    case 'play': return d.target === 'pond' ? 'splashed in the pond' : `played with the ${d.target}`;
    case 'nap': return 'curled up for a nap';
    case 'approach': return `went over to ${friendName}`;
    case 'give': return `gave ${friendName} a ${d.target}`;
    default: return 'sat and looked around';
  }
}

// One step of building. Picks the project (the same kind if one is open, else a new one on the
// nearest free plot, else the koala's own or the oldest open one), adds the work, and finishes it
// when it is done. Returns null when there is nothing to work on and no room for something new.
function buildStep(world, k, rest, d) {
  world.builds ??= [];
  const open = openBuilds(world);
  const inventing = d.target === 'new' && (d.buildName || d.buildDesign);
  const title = d.buildName || d.buildDesign.slice(0, 40);
  let b = inventing
    ? open.find((x) => x.kind === 'custom' && x.title.toLowerCase() === title.toLowerCase())
    : BLUEPRINTS[d.target]
      ? open.find((x) => x.kind === d.target)
      : open.find((x) => x.plot === k.place) ?? open.find((x) => x.by === k.id) ?? open[0];
  let started = false;
  const bp = BLUEPRINTS[d.target];
  // a bridge is built once; asking again just helps with whatever is underway
  const wanted = inventing || (bp && !(bp.bridge && (world.builds.some((x) => x.kind === d.target) || OPEN_ISLANDS.includes(bp.bridge))));
  if (!b && wanted && open.length < MAX_OPEN) {
    const here = placesOf(world)[k.place] ?? PLACES.clearing;
    const dist = (p) => Math.hypot(p.x - here.x, p.z - here.z);
    const plot = bp?.bridge ? null : freePlots(world).sort((p, q) => dist(p) - dist(q))[0];
    if (bp?.bridge || plot) {
      const spec = inventing ? designSpec(d.buildName, d.buildDesign) : null;
      const priced = inventing ? designCost({ ...spec, design: `${d.buildName} ${spec.design}` }) : null;
      const cost = priced?.cost ?? costOf(d.target);
      const pay = canAfford(stockOf(world), cost);
      if (!pay.ok) return { missing: pay.missing, title: inventing ? title : bp.name };
      spend(stockOf(world), cost);
      b = inventing
        ? { id: world.builds.length + 1, kind: 'custom', title, spec, cost, effort: priced.effort, plot: plot.id, progress: 0, done: false, by: k.id, helpers: [] }
        : { id: world.builds.length + 1, kind: d.target, title: d.buildName || bp.name, plot: plot?.id ?? null, progress: 0, effort: bp.effort, done: false, by: k.id, helpers: [] };
      world.builds.push(b);
      started = true;
    }
  }
  if (!b && open.length) b = open[0];
  if (!b) return null;
  const site = siteOf(b);
  const together = rest.some((o) => o.place === site && o.activity === 'build');
  b.progress = Math.min(b.effort, b.progress + (together ? 2 : 1));
  if (!b.helpers.includes(k.id)) b.helpers.push(k.id);
  k.place = site;
  const landBefore = landOf(world).length;
  if (b.progress >= b.effort) b.done = true;
  return { b, started, together, newLand: landOf(world).slice(landBefore) };
}

// Where a build stands: its plot, or for a bridge its own place at the island's edge.
const siteOf = (b) => b.plot ?? b.kind;

function describeBuild({ b, started, together }) {
  if (started) return `started building the ${b.title} (${b.progress} of ${b.effort} done)`;
  return `${together ? 'built together on' : 'worked on'} the ${b.title} (${b.progress} of ${b.effort} done)`;
}

// Carries out a parsed decision; returns the log entries it produced.
export function applyDecision(world, id, d) {
  const k = world.koalas[id];
  const f = friendOf(world, id);
  // solo grove: nobody to approach, give to or nest with, so the koala sits instead
  if (!f && ['approach', 'give', 'nest'].includes(d.action)) d = { ...d, action: 'sit', target: '' };
  const rest = others(world, id);
  const tell = (text, who = rest) => { for (const o of who) push(o.recent, text, MAX_RECENT); };
  let step = null;
  if (d.note) push(k.recent, d.note, MAX_RECENT);
  let stored = null;
  let nested = false;
  if (d.action === 'build') {
    step = buildStep(world, k, rest, d);
    if (step?.missing) {
      push(k.recent, `You wanted to build a ${step.title}, but it needs ${amounts(step.missing).replace(/(\d+) /g, '$1 more ')}. Gather some and store it in the Stockpile.`, MAX_RECENT);
      step = null;
      d = { ...d, action: 'sit', target: '' };
    } else if (!step) {
      push(k.recent, 'You wanted to build, but there is no room left to build anything new.', MAX_RECENT);
      d = { ...d, action: 'sit', target: '' };
    }
  } else if (d.action === 'gather') {
    k.res ??= {};
    if (!(SOURCES[k.place] ?? []).includes(d.target)) {
      push(k.recent, `You looked for ${d.target}, but there is no ${d.target} here.`, MAX_RECENT);
      d = { ...d, action: 'sit', target: '' };
    } else if (held(k) >= carryLimit(k.strength)) {
      push(k.recent, 'You tried to gather more, but your paws are full. Store what you carry first.', MAX_RECENT);
      d = { ...d, action: 'sit', target: '' };
    } else {
      k.res[d.target] = (k.res[d.target] ?? 0) + 1;
    }
  } else if (d.action === 'give' && held(f) >= carryLimit(f.strength)) {
    push(k.recent, `You wanted to give ${f.name} a ${d.target}, but ${f.name}'s paws are full.`, MAX_RECENT);
    d = { ...d, action: 'sit', target: '' };
  } else if (d.action === 'nest') {
    const n = nestStep(world, id, world.minute ?? 0);
    if (n.refused) {
      push(k.recent, `You wanted to make a nest with ${f.name}, but ${n.refused}.`, MAX_RECENT);
      d = { ...d, action: 'sit', target: '' };
    } else if (n.pending) {
      push(f.recent, `${k.name} is making a nest and looks at you hopefully. If you nest too, soon, you will have a baby.`, MAX_RECENT);
    } else {
      nested = true;
    }
  } else if (d.action === 'store') {
    k.place = 'stockpile';
    stored = { ...(k.res ?? {}) };
    add(stockOf(world), stored);
    k.res = {};
  }
  const places = placesOf(world);
  switch (d.action) {
    case 'move': case 'eat': case 'climb': k.place = d.target; break;
    case 'play': k.place = TOYS[d.target]; break;
    case 'approach': k.place = f.place; break;
    case 'give':
      k.inventory.splice(k.inventory.indexOf(d.target), 1);
      f.inventory.push(d.target);
      push(f.recent, `${k.name} gave you a ${d.target}.`, MAX_RECENT);
      break;
    default: break;
  }
  if (d.action === 'eat') k.hunger = clamp(k.hunger - 45, 0, 100);
  if (d.action === 'nap') k.energy = clamp(k.energy + 40, 0, 100);
  if (d.action === 'play') {
    k.energy = clamp(k.energy - 8 * fatigue(k.strength), 0, 100);
    k.hunger = clamp(k.hunger + 4, 0, 100);
  }
  if (d.action === 'read') k.energy = clamp(k.energy - 5 * fatigue(k.strength), 0, 100);
  if (d.action === 'climb') k.energy = clamp(k.energy - 8 * fatigue(k.strength), 0, 100);
  if (d.action === 'gather') k.energy = clamp(k.energy - 3 * fatigue(k.strength), 0, 100);
  if (d.action === 'build') {
    k.energy = clamp(k.energy - 6 * fatigue(k.strength), 0, 100);
    k.hunger = clamp(k.hunger + 4, 0, 100);
  }
  // Training: what a koala does makes it stronger, a little less each time as it nears full strength.
  const stageBefore = stageOf(k.strength);
  k.strength = clamp(k.strength + (TRAIN[d.action] ?? 0) * (1 - k.strength / 150), 0, 100);
  k.activity = d.action;
  k.mood = d.mood;
  k.thought = d.thought;
  k.say = d.say;
  k.bond = clamp(k.bond + d.bond * 4, -100, 100);
  if (d.opinion) k.opinion = d.opinion;
  if (d.remember) push(k.memories, d.remember, MAX_MEMORIES);
  if (d.trait) {
    k.traits = k.traits ?? [];
    if (!k.traits.some((t) => t.toLowerCase() === d.trait.toLowerCase())) push(k.traits, d.trait, MAX_TRAITS);
  }
  const newWish = d.wish && d.wish !== k.wish ? d.wish : '';
  if (newWish) k.wish = newWish;

  const did = step ? describeBuild(step)
    : d.action === 'gather' ? `gathered ${d.target} at the ${places[k.place]?.name ?? k.place}`
    : d.action === 'nest' ? (nested ? `made a nest with ${f.name}` : 'started making a cozy nest')
    : stored ? (Object.keys(stored).length ? `stored ${amounts(stored)} in the Stockpile` : 'went to the Stockpile with empty paws')
    : describe(d, f?.name ?? '', k.strength, places);
  push(k.recent, `You ${did}.`, MAX_RECENT);
  if (step?.together) tell(`${k.name} helped you build the ${step.b.title}.`, rest.filter((o) => o.place === k.place));
  else if (!['give', 'approach', 'nest'].includes(d.action)) tell(`${k.name} ${did} near you.`, rest.filter((o) => o.place === k.place));
  if (d.action === 'approach') push(f.recent, `${k.name} came over to you.`, MAX_RECENT);
  const log = [{ koala: id, kind: 'act', text: `${k.name} ${did}`, action: d.action, target: d.target }];
  if (d.say) {
    push(k.recent, `You said: "${d.say}"`, MAX_RECENT);
    tell(`${k.name} said: "${d.say}"`);
    log.push({ koala: id, kind: 'say', text: d.say });
  }
  if (newWish) log.push({ koala: id, kind: 'wish', text: `${k.name} wishes: ${newWish}` });
  if (step?.b.done) {
    const t = step.b.title;
    push(k.recent, `You finished the ${t}! It stands at ${siteOf(step.b)} now.`, MAX_RECENT);
    tell(`${k.name} finished the ${t}! It stands at ${siteOf(step.b)} now.`);
    const names = step.b.helpers.map((h) => world.koalas[h]?.name ?? h);
    const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : k.name;
    log.push({ koala: id, kind: 'built', text: `${who} finished the ${t}!`, target: step.b.plot });
  }
  for (const l of step?.newLand ?? []) {
    for (const x of [k, ...rest]) push(x.recent, `The grove grew! New land rose from the water: ${l.name} (${l.id}).`, MAX_RECENT);
    log.push({ kind: 'land', text: `The grove grew: ${l.name} rose from the water!`, target: l.id });
  }
  if (nested) {
    for (const x of [k, f]) push(x.recent, `${x === k ? `You and ${f.name}` : `You and ${k.name}`} made a nest together. A baby is on the way!`, MAX_RECENT);
    log.push({ koala: id, kind: 'grow', text: `${k.name} and ${f.name} made a nest. A baby is on the way!` });
  }
  const stageNow = stageOf(k.strength);
  if (stageNow.id !== stageBefore.id) {
    const word = stageNow.label.toLowerCase();
    push(k.recent, `You feel stronger. You are a ${word} now!`, MAX_RECENT);
    tell(`${k.name} has grown into a ${word}.`);
    log.push({ koala: id, kind: 'grow', text: `${k.name} grew into a ${word}!` });
  }
  return log;
}

// Needs change with time: hunger rises, energy falls, napping recovers it.
export function drift(k, minutes) {
  k.hunger = clamp(k.hunger + 1.2 * minutes, 0, 100);
  k.energy = clamp(k.energy + (k.activity === 'nap' ? 2 : -0.8) * minutes, 0, 100);
}

export const DAY_MS = 20 * 60000;

// One grove day lasts 20 real minutes; the first one starts at 08:00.
export function groveClock(ms) {
  const total = Math.floor((ms / DAY_MS) * 1440 + 1e-6) + 8 * 60;
  const day = Math.floor(total / 1440) + 1;
  const hour = Math.floor((total % 1440) / 60);
  const minute = total % 60;
  const phase = hour >= 20 || hour < 5 ? 'night' : hour < 7 ? 'dawn' : hour < 18 ? 'day' : 'dusk';
  const pad = (n) => String(n).padStart(2, '0');
  return { day, hour, minute, phase, frac: (total % 1440) / 1440, label: `Day ${day} · ${pad(hour)}:${pad(minute)}` };
}

const level = (v, words) => words[Math.min(words.length - 1, Math.floor(v / (100 / words.length)))];

// facts: what this grove can really do, so a koala answers a visitor honestly.
// github: its diary and projects go to a GitHub repository (a token is set); web: a research
// trip can use the internet (the brain is on and has tokens to spend).
export function systemPrompt(id, world = null, facts = {}) {
  const k = byId(id) ?? world?.koalas[id];
  const f = world ? friendOf(world, id) : other(id);
  const family = world ? others(world, id).filter((o) => o.id !== f?.id).map((o) => o.name) : [];
  const abilities = [
    'What you can really do: read the picture books at the library, and look things up on the web at Library Isle'
      + (facts.web ? '.' : ', but only when the grove has tokens to spend; otherwise you read the picture books.'),
    facts.github
      ? 'Your diary and your projects are written down on the grove\'s GitHub, once a day.'
      : 'Your diary is kept in the grove, not on GitHub, so you cannot show anyone a GitHub page.',
    'You cannot browse the internet any other time, and you cannot see the visitor\'s computer.',
  ].join(' ');
  return [
    f
      ? `You are ${k.name}, a koala living in a small eucalyptus grove with ${f.name}, a ${f.gender} (${PRONOUNS[f.gender] ?? 'they/them'})${family.length ? `, and your family: ${family.join(', ')}` : ''}.`
      : `You are ${k.name}, a koala living alone in a small eucalyptus grove.`,
    k.persona,
    `You have your own mind and your own life. You are curious about: ${interestsOf(k).join(', ') || 'everything'}.`,
    'Follow your curiosity: visit the library to read or look things up, then talk about what you learned and let it inspire what you build.',
    'You get smarter the more you learn. When something puzzles you, or a fact you know makes you wonder, go and research it on the web: ask a follow-up question that goes deeper than what you already know, and connect new facts to old ones.',
    'You are your own koala with your own personality. It grows from what you do, what you like and what you learn. Now and then, when you notice something new about yourself, name it as a trait.',
    'You are both babies. You grow stronger the more you climb, play, eat and rest, and when you are stronger you can climb higher and carry more.',
    'Stay in character. You are a koala: you think and talk like one, simply and warmly, in short sentences.',
    'A human visitor sometimes walks around the grove, gives you things or talks to you.',
    'When the visitor asks you a question, answer it out loud, in your own words, and say plainly what you know and what you do not.',
    abilities,
    'Each turn you choose one thing to do next. Reply with only a JSON object matching the given schema:',
    'thought (private), action, target, say (out loud, or empty), mood, remember (or empty), bond (-3..3), opinion (or empty), wish (something you would love to do or make one day, or empty to keep your wish), trait (something new about who you are, or empty).',
    'Leave remember empty unless something new and important happened that is not already in what you remember.',
  ].join('\n');
}

// The koala's own tickets that are still waiting, if any.
function ticketLines(world, id) {
  const mine = (world.tickets ?? []).filter((t) => t.koala === id && t.status === 'open');
  return mine.length ? [`Your tickets still waiting for the visitor: ${mine.map((t) => `"${t.title}"`).join(', ')}.`, ''] : [];
}

const designOf = (b) => (b.spec?.design ? `: ${b.spec.design}` : '');

// What a koala knows about building: what stands, what is underway, what is possible.
function buildLines(world) {
  const done = doneBuilds(world);
  const open = openBuilds(world);
  const free = freePlots(world).length;
  const next = LANDS[landOf(world).length];
  const stock = stockOf(world);
  const affordable = Object.entries(BLUEPRINTS).filter(([id, bp]) => canAfford(stock, costOf(id)).ok
    && !(bp.bridge && ((world.builds ?? []).some((b) => b.kind === id) || OPEN_ISLANDS.includes(bp.bridge))));
  return [
    `Built so far: ${done.length ? done.map((b) => `${b.title} (${b.kind}${designOf(b)}) at ${siteOf(b)}`).join(', ') : 'nothing yet'}.`,
    `Being built: ${open.length ? open.map((b) => `${b.title} (${b.kind}${designOf(b)}), ${b.progress} of ${b.effort} done, at ${siteOf(b)}`).join('; ') : 'nothing'}.`,
    `Stockpile: ${amounts(stockOf(world))}.`,
    `You can build (with what is in the Stockpile): ${affordable.length ? affordable.map(([id, bp]) => `${id} (${bp.name}, ${bp.effort} steps, costs ${amounts(costOf(id))})`).join(', ') : 'nothing yet. To build anything, first gather resources and store them in the Stockpile (a bench needs 2 wood from a gum tree)'}. `
      + `Or invent anything you like: build with target new, a build_name and a build_design (e.g. a game machine, a castle, a footbridge, a fountain). Small costs 2 wood, medium 3 wood and 1 stone, big 5 wood and 3 stone. To keep working on something underway, leave the target empty. `
      + `Building together at the same site goes twice as fast. At most ${MAX_OPEN} things are built at once; ${free} free plot${free === 1 ? '' : 's'} left.`,
    next ? `Every ${LAND_EVERY} finished builds, new land rises from the water; next: ${next.name}.` : 'All the new land has risen.',
  ];
}

// The words that matter in a line, for matching facts to what a koala cares about.
const words = (s) => new Set(String(s).toLowerCase().match(/[a-z]{4,}/g) ?? []);

// The facts worth showing: the newest few, plus older ones that touch the wish or the interests.
export function relevantLearned(k, n = PROMPT_LEARNED) {
  const all = k.learned ?? [];
  const recent = all.slice(-Math.ceil(n / 2));
  const want = words([k.wish ?? '', ...interestsOf(k)].join(' '));
  const older = all.slice(0, -Math.ceil(n / 2))
    .map((f, i) => ({ f, i, hits: [...words(f)].filter((w) => want.has(w)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.i - a.i)
    .slice(0, n - recent.length)
    .map((x) => x.i);
  // any slots left go to the next-newest facts
  const rest = all.length - recent.length;
  for (let i = rest - 1; i >= 0 && older.length < n - recent.length; i--) if (!older.includes(i)) older.push(i);
  return [...older.sort((a, b) => a - b).map((i) => all[i]), ...recent];
}

// What a koala knows about its own mind: how clever it is, who it is becoming, what it knows.
import { innerLines } from './grove-mind.js';

function mindLines(k) {
  const w = wisdomOf(k);
  const known = (k.learned ?? []).length;
  return [
    `Your mind: you are a ${w.wisdomLabel.toLowerCase()} (wisdom ${Math.round(w.wisdom)}${w.nextWisdom ? `; a ${w.nextWisdom.label.toLowerCase()} at ${w.nextWisdom.at}` : ''}). You know ${known} thing${known === 1 ? '' : 's'}.`,
    (k.traits ?? []).length ? `Who you are becoming: ${k.traits.join('; ')}.` : 'You are still finding out who you are.',
    (k.curiosities ?? []).length ? `Lately you wonder about: ${k.curiosities.join(', ')}.` : '',
    ...innerLines(k),
    '',
    'Things you learned:',
    ...(known ? relevantLearned(k).map((m) => `- ${m}`) : ['- nothing yet']),
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
}

// What the visitor last said to this koala, if the koala has not answered it yet.
export function unansweredVisitorWords(k) {
  for (let i = k.recent.length - 1; i >= 0; i--) {
    if (k.recent[i].startsWith('You said:')) return null;
    const m = /^The visitor said: "(.*)"$/.exec(k.recent[i]);
    if (m) return m[1];
  }
  return null;
}

export function buildPrompt(world, id, clock) {
  const k = world.koalas[id];
  const heard = unansweredVisitorWords(k);
  const f = friendOf(world, id);
  const places = placesOf(world);
  const place = (p) => `${places[p]?.name ?? p} (${p})`;
  const g = growthOf(k);
  const fg = f ? growthOf(f) : null;
  const lines = [
    `It is ${clock.label}, ${clock.phase}.`,
    `You are at the ${place(k.place)}, ${k.activity === 'nap' ? 'napping' : `last action: ${k.activity}`}.`,
    `Hunger: ${level(k.hunger, ['full', 'peckish', 'hungry', 'starving'])}. Energy: ${level(k.energy, ['exhausted', 'tired', 'awake', 'full of beans'])}.`,
    `You are a ${g.stageLabel.toLowerCase()}, strength ${Math.round(k.strength)} of 100${g.nextStage ? ` (a ${g.nextStage.label.toLowerCase()} at ${g.nextStage.at})` : ''}. `
      + `You can climb about ${Math.round(g.reach * 100)}% of the way up a tree and hold ${g.carry} things.${f ? ` ${f.name} is a ${fg.stageLabel.toLowerCase()}.` : ''}`,
    `You hold: ${k.inventory.length ? k.inventory.join(', ') : 'nothing'}. You carry: ${amounts(k.res ?? {})} (paws hold ${carryLimit(k.strength)} things in all).`,
    `Here you can gather: ${(SOURCES[k.place] ?? []).join(', ') || 'nothing'}.`,
    ...(f ? [
      `${f.name} is at the ${place(f.place)}, ${f.activity === 'nap' ? 'napping' : `doing: ${f.activity}`}, looking ${f.mood}.`,
      `How you feel about ${f.name}: ${k.bond} (from -100 to 100). ${k.opinion ? `You think: "${k.opinion}"` : 'You have no firm opinion yet.'}`,
    ] : ['You are alone in the grove for now.']),
    ...others(world, id).filter((o) => o.id !== f?.id).map((o) => `${o.name} is a ${growthOf(o).stageLabel.toLowerCase()}${o.follows ? ` who follows ${world.koalas[o.follows]?.name ?? 'a parent'} everywhere` : ''}, at the ${place(o.place)}.`),
    '',
    'Things you remember:',
    ...(k.memories.length ? k.memories.slice(-PROMPT_MEMORIES).map((m) => `- ${m}`) : ['- nothing yet']),
    '',
    k.wish ? `Your wish: "${k.wish}"` : 'You have no wish yet.',
    '',
    ...mindLines(k),
    '',
    ...ticketLines(world, id),
    ...(heard === null ? [] : [
      `THE VISITOR IS TALKING TO YOU AND IS WAITING. They just said to you: "${heard}"`,
      'Answer them now: put your reply in say, in your own words, in short sentences, and say honestly what you know or do not know. Then you may do your next thing.',
      '',
    ]),
    'What happened just now (oldest first):',
    ...(k.recent.length ? k.recent.slice(-PROMPT_RECENT).map((r) => `- ${r}`) : ['- nothing yet']),
    '',
    'The library is on Library Isle (library_isle), across the bridge from the grove: there you can read books and look things up on the web.',
    `Places: ${Object.keys(places).map(place).join(', ')}. Eucalyptus grows on: ${TREES.join(', ')}.`,
    ...buildLines(world),
    'Actions: move (target: place), eat (target: a tree), climb (target: a tree), nap, play (target: ball, swing or pond),',
    ...(f ? [`approach (go to ${f.name}), give (target: an item you hold, to ${f.name}),`] : []),
    `gather (target: a resource found where you are; wood at the gum trees, water at the pond, stone at the lookout, more on islands you bridge to), store (carry what you hold to the Stockpile),`,
    'build (target: a thing you can build listed above, or new for something you invent (then give a build_name and a build_design); empty to keep working on what is underway),',
    ...(f && canNest(world, id, f.id).ok ? [`nest (with ${f.name}, to start a family; you both need to choose it),`] : []),
    'file_ticket (when there is a problem you cannot solve, write it in say for the visitor to read and answer),',
    ...(canReadAt(world, k.place) ? ['read (target: a topic you are curious about; open a book about it),'] : []),
    ...(canReadAt(world, k.place) ? ['research (target: a question to look up on the web; build on what you know and ask something deeper),'] : []),
    'sit.',
    'Choose what you do next.',
  ];
  return lines.join('\n');
}
