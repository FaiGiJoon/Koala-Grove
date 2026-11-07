// Pure helpers between the grove's server state and what the page draws.
// No three.js or DOM here, so the tests can run them under Node.

const SIDE = { crystal: -1, ruby: 1 };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Where a koala stands for a place and activity: apart from its friend, beside
// the pond rather than in it, up the trunk when climbing or eating. reach (0 to 1) is how much of
// the tree this koala is strong enough to climb: babies stay low on the trunk.
export function spotFor(places, placeId, koalaId, activity, reach = 1) {
  const p = places[placeId];
  if (!p) return { x: 0, z: 0, y: 0 };
  const side = SIDE[koalaId] ?? 1;
  if (p.tree && (activity === 'climb' || activity === 'eat' || activity === 'nap')) {
    // koalas sleep wedged in a fork, eat a little lower, and climb highest
    const a = Math.atan2(-p.z, -p.x) + side * 0.9;
    const height = activity === 'climb' ? 3.0 : activity === 'nap' ? 2.6 : 2.4;
    return { x: p.x + Math.cos(a) * 0.62, z: p.z + Math.sin(a) * 0.62, y: height * reach };
  }
  if (placeId === 'swing' && activity === 'play') return { x: p.x + side * 1.1, z: p.z, y: 0 };
  const r = placeId === 'pond' ? 5.4 : p.tree ? 1.9 : placeId === 'swing' || p.build ? 2.4 : p.land ? 1.4 : 1.6;
  const a = Math.atan2(-p.z, -p.x) + side * 0.55;
  return { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, y: 0 };
}

export function animFor({ activity, place }) {
  if (activity === 'nap') return 'sleep';
  if (activity === 'eat') return 'eat';
  if (activity === 'climb') return 'cling';
  if (activity === 'play') return place === 'swing' ? 'swing' : place === 'pond' ? 'splash' : 'ball';
  if (activity === 'build') return 'build';
  return 'idle';
}

// What the body does, from what the koala is doing, where, and when (after koala field notes):
// asleep up a tree it wedges into a fork; asleep on the ground in the night or the cold early
// morning it curls into a ball; clinging to a trunk in the midday heat it hugs the cool bark.
export function postureFor({ anim, hour, inTree }) {
  if (anim === 'sleep') return inTree ? 'fork' : hour >= 20 || hour < 7 ? 'curl' : 'sleep';
  if (anim === 'cling' && hour >= 11 && hour < 15) return 'hug';
  return anim;
}

// New land is reached only over its bridge, which runs straight from the island toward the
// land's centre. Returns the waypoints to walk through (none when no bridge is crossed).
export const BRIDGE_IN = 2.5; // the island end of a bridge, this far in from the island's edge
export const bridgeEnds = (land, island = 24) => {
  const d = Math.hypot(land.x, land.z);
  const ux = land.x / d;
  const uz = land.z / d;
  return {
    island: { x: ux * (island - BRIDGE_IN), z: uz * (island - BRIDGE_IN), y: 0 },
    land: { x: land.x - ux * (land.r - 1.2), z: land.z - uz * (land.r - 1.2), y: 0 },
  };
};

export function landRoute(from, to, lands, island = 24) {
  const on = (p) => lands.find((l) => Math.hypot(p.x - l.x, p.z - l.z) < l.r + 0.5) ?? null;
  const a = on(from);
  const b = on(to);
  if (a === b) return [];
  const out = [];
  if (a) {
    const e = bridgeEnds(a, island);
    out.push(e.land, e.island);
  }
  if (b) {
    const e = bridgeEnds(b, island);
    out.push(e.island, e.land);
  }
  return out;
}

export function fmtUsd(v) {
  const n = Number(v) || 0;
  if (n > 0 && n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

export function freshLog(log, lastId) {
  return (log || []).filter((e) => e.id > lastId);
}

// Why the koalas are, or are not, thinking right now.
export function statusOf(s) {
  if (!s) return { key: 'offline', text: 'The grove server is not answering. Is it running?' };
  if (!s.playing) return { key: 'paused', text: s.pausedReason ? `Paused: ${s.pausedReason}` : 'Paused. Press Play to wake the koalas.' };
  const mode = s.brain?.mode ?? 'claude';
  if (mode === 'local') return { key: 'live', text: 'Living on instinct, 24/7. No tokens are spent, even with this page closed.' };
  if (s.capped) {
    if (mode === 'hybrid') return { key: 'live', text: "Today's spend cap is reached, so the koalas live on instinct until tomorrow. No tokens." };
    return { key: 'capped', text: "Today's spend cap is reached. The koalas rest until tomorrow." };
  }
  if (!s.present) {
    if (mode === 'hybrid') return { key: 'live', text: 'Living on instinct while no page is open. No tokens.' };
    return { key: 'away', text: 'Waiting for this page to check in.' };
  }
  if (s.koalas.some((k) => k.thinking)) return { key: 'thinking', text: 'A koala is thinking. This is a real model call.' };
  if (mode === 'hybrid') return { key: 'live', text: 'Live. Instinct for everyday things, a real model call when a koala is spoken to.' };
  return { key: 'live', text: 'Live. Each koala decides every 20 to 60 seconds.' };
}

// Sky colours through the grove day; frac 0 is midnight, 0.5 is noon.
const SKY = [
  [0.0, [0.06, 0.08, 0.18], [0.12, 0.13, 0.26], 0.05],
  [0.21, [0.08, 0.1, 0.22], [0.2, 0.17, 0.3], 0.08],
  [0.26, [0.36, 0.32, 0.52], [0.98, 0.7, 0.55], 0.4],
  [0.33, [0.45, 0.72, 0.86], [0.86, 0.93, 0.9], 1],
  [0.72, [0.45, 0.72, 0.86], [0.86, 0.93, 0.9], 1],
  [0.79, [0.42, 0.33, 0.55], [0.98, 0.62, 0.45], 0.45],
  [0.86, [0.08, 0.1, 0.22], [0.2, 0.17, 0.3], 0.08],
  [1.0, [0.06, 0.08, 0.18], [0.12, 0.13, 0.26], 0.05],
];

export function skyAt(frac) {
  const f = ((frac % 1) + 1) % 1;
  let i = 0;
  while (i < SKY.length - 2 && f > SKY[i + 1][0]) i++;
  const [f0, top0, bot0, sun0] = SKY[i];
  const [f1, top1, bot1, sun1] = SKY[i + 1];
  const t = clamp01((f - f0) / (f1 - f0));
  const sun = lerp(sun0, sun1, t);
  return {
    top: top0.map((v, k) => lerp(v, top1[k], t)),
    bottom: bot0.map((v, k) => lerp(v, bot1[k], t)),
    sun,
    night: clamp01((0.45 - sun) / 0.35),
  };
}

// --- resources -------------------------------------------------------------------------
const RESOURCE_ORDER = ['wood', 'water', 'sand', 'stone', 'book'];
export const RESOURCE_COLORS = { wood: '#8a6a4a', water: '#4e8fa3', sand: '#e6d29a', stone: '#a9a196', book: '#b05a3c' };

// "6 wood · 1 sand", or "empty".
export function stockText(stock) {
  const parts = RESOURCE_ORDER.filter((r) => stock?.[r] > 0).map((r) => `${stock[r]} ${r}`);
  return parts.length ? parts.join(' · ') : 'empty';
}

// One entry per resource unit in a koala's paws, in resource order (drawn as little blocks).
export function carried(k) {
  return RESOURCE_ORDER.flatMap((r) => Array(Math.max(0, k.res?.[r] ?? 0)).fill(r));
}

// --- critters --------------------------------------------------------------------------
// Where a critter is at time t (seconds), around its home. Deterministic, so every page agrees.
// Turtles crawl a slow loop, frogs hop between three spots by the water, birds circle up high.
export function critterPath(kind, t, home, phase = 0) {
  if (kind === 'turtle') {
    const a = phase + t * 0.06;
    return { x: home.x + Math.cos(a) * 3, z: home.z + Math.sin(a) * 3, y: 0, yaw: -a };
  }
  if (kind === 'frog') {
    const spot = (i) => {
      const a = phase + (i % 3) * 2.1;
      return { x: home.x + Math.cos(a) * 5.3, z: home.z + Math.sin(a) * 5.3 };
    };
    const per = 3.2;
    const n = Math.floor(t / per);
    const u = Math.min(1, (t - n * per) / 0.55); // a hop takes 0.55 s, then it sits
    const a = spot(n);
    const b = spot(n + 1);
    return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, y: u < 1 ? Math.sin(u * Math.PI) * 0.5 : 0, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
  }
  const a = phase + t * 0.45;
  return { x: home.x + Math.cos(a) * 6, z: home.z + Math.sin(a) * 6, y: 10 + Math.sin(t * 0.7 + phase) * 1.5, yaw: -a };
}

// --- motion ----------------------------------------------------------------------------
// One frame of easing toward a target `distance` away: speed builds up at `accel`, cruises at
// `max`, and follows a braking curve so it arrives gently, never past the target.
export function glide(speed, distance, dt, { max, accel }) {
  if (!(distance > 0)) return { speed: 0, step: 0 };
  const brake = Math.sqrt(2 * accel * distance); // the fastest speed that can still stop in time
  const want = Math.min(max, brake);
  let v = speed < want ? Math.min(want, speed + accel * dt) : Math.max(want, speed - accel * 2 * dt);
  if (brake < max) v = Math.max(v, Math.min(0.15, want)); // braking: never crawl forever at the very end
  const step = Math.min(distance, v * dt);
  return { speed: step === distance ? 0 : v, step };
}

// --- layout ------------------------------------------------------------------------------
// Between phone and wide desktop the 400 px panel would cover a third of the view: start with
// it tucked away (one click opens it). Phones get the bottom sheet instead.
export function panelStartsCollapsed(width) {
  return width > 820 && width < 1100;
}

// --- koala inventions ----------------------------------------------------------------------
// A custom build is a few primitives picked from its spec: pure data, so Node can test it and
// builds.js turns it into meshes. Authored at medium size; width grows less than height so the
// footprint stays inside a plot.
export const BUILD_COLORS = {
  pink: '#f08aa0', blue: '#5b9bd5', red: '#d9534f', green: '#6f9a62', yellow: '#f2c14e', purple: '#a98bd8',
  orange: '#ef8f3c', white: '#f4efe4', gold: '#d9a93a', silver: '#b8c0c8', black: '#3a3a40',
};
const WOOD_TONES = ['#8a6a4a', '#c9a77c', '#b05a3c'];
const SIZE_H = { small: 0.7, medium: 1, big: 1.4 };
const SIZE_W = { small: 0.8, medium: 1, big: 1.15 };

export function customPlan(spec) {
  const shape = SHAPES[spec?.shape] ? spec.shape : 'shelter';
  const h = SIZE_H[spec?.size] ?? 1;
  const w = SIZE_W[spec?.size] ?? 1;
  const named = (spec?.colors ?? []).filter((c) => BUILD_COLORS[c]).map((c) => BUILD_COLORS[c]);
  const palette = named.length ? named : WOOD_TONES;
  const col = (i) => palette[i % palette.length];
  const out = [];
  // Unit-scale authoring: size/pos given in medium metres, scaled here.
  const add = (type, size, pos, color, extra = {}) => {
    const s = type === 'box' ? [size[0] * w, size[1] * h, size[2] * w] : type === 'cyl' ? [size[0] * w, size[1] * w, size[2] * h] : type === 'cone' ? [size[0] * w, size[1] * h, size[2] ?? 8] : [size[0] * (w + h) / 2];
    const q = { type, size: s, pos: [pos[0] * w, pos[1] * h, pos[2] * w], color, ...extra };
    // soft: a modelled piece (models/kit.glb) that stands in for this primitive when it is
    // loaded; fit is its bounding box, pos/rot override the primitive's, skip drops the primitive.
    if (extra.soft) {
      const f = extra.soft.fit;
      q.soft = { ...extra.soft, fit: f && [f[0] * w, f[1] * h, f[2] * w], pos: extra.soft.pos && [extra.soft.pos[0] * w, extra.soft.pos[1] * h, extra.soft.pos[2] * w] };
    }
    out.push(q);
  };
  const ctx = SHAPES[shape]({ add, col });
  const set = new Set(spec?.parts ?? []);
  for (const p of PART_ORDER) if (set.has(p)) PARTS[p]({ add, col }, ctx);
  let height = 0.3;
  for (const q of out) height = Math.max(height, q.pos[1] + (q.type === 'sphere' ? q.size[0] : q.type === 'cyl' ? q.size[2] / 2 : q.size[1] / 2));
  return { parts: out, height };
}

const DARKWOOD = '#4a3626';
const GLASSY = '#bfe3f2';
const SHAPES = {
  house: ({ add, col }) => {
    add('box', [1.8, 1.2, 1.6], [0, 0.6, 0], col(0));
    add('cone', [1.45, 0.9, 4], [0, 1.65, 0], col(1), { rot: [0, Math.PI / 4, 0], soft: { model: 'gable', fit: [2.3, 0.95, 2.0], rot: [0, 0, 0] } });
    add('box', [0.5, 0.85, 0.06], [0, 0.43, 0.82], DARKWOOD, { soft: { model: 'door', fit: [0.55, 0.85, 0.14] } });
    return { hw: 0.9, hd: 0.8, top: 2.1, wallH: 1.2 };
  },
  tower: ({ add, col }) => {
    add('cyl', [0.75, 0.95, 3.2], [0, 1.6, 0], col(0));
    add('cyl', [1.05, 1.05, 0.2], [0, 3.3, 0], col(1));
    add('cone', [1.1, 1.0], [0, 3.9, 0], col(2));
    return { hw: 0.8, hd: 0.9, top: 4.4, wallH: 3.2 };
  },
  machine: ({ add, col }) => {
    add('box', [1.6, 1.5, 1.0], [0, 0.85, 0], col(0));
    add('box', [0.3, 0.2, 0.3], [-0.6, 0.1, 0.3], DARKWOOD);
    add('box', [0.3, 0.2, 0.3], [0.6, 0.1, 0.3], DARKWOOD);
    add('cyl', [0.12, 0.12, 0.5], [0.5, 1.85, 0], col(1));
    return { hw: 0.8, hd: 0.5, top: 1.6, wallH: 1.5 };
  },
  bridge: ({ add, col }) => {
    add('box', [1.2, 0.16, 1.0], [0, 0.55, 0], col(0));
    for (const s of [-1, 1]) {
      add('box', [0.8, 0.16, 1.0], [s * 0.95, 0.35, 0], col(0), { rot: [0, 0, -s * 0.3] });
      add('box', [2.7, 0.07, 0.07], [0, 1.05, s * 0.5], col(1));
      add('cyl', [0.06, 0.06, 0.8], [s * 1.1, 0.65, s * 0.5], col(1));
      add('cyl', [0.06, 0.06, 0.8], [-s * 1.1, 0.65, s * 0.5], col(1));
    }
    return { hw: 1.1, hd: 0.5, top: 1.1, wallH: 0.6 };
  },
  garden: ({ add, col }) => {
    add('box', [2.2, 0.3, 1.6], [0, 0.15, 0], col(0));
    add('box', [2.0, 0.12, 1.4], [0, 0.32, 0], DARKWOOD);
    add('sphere', [0.35], [-0.5, 0.55, -0.2], '#6f9a62');
    for (let i = 0; i < 4; i++) add('sphere', [0.13], [-0.8 + i * 0.5, 0.5, 0.35], col(i + 1), { soft: { model: 'flower', fit: [0.36, 0.17, 0.36] } });
    return { hw: 1.0, hd: 0.7, top: 0.7, wallH: 0.35 };
  },
  statue: ({ add, col }) => {
    add('box', [1.0, 0.6, 1.0], [0, 0.3, 0], '#a9a196');
    add('cyl', [0.3, 0.42, 1.1], [0, 1.15, 0], col(0));
    add('sphere', [0.3], [0, 1.95, 0], col(0));
    add('sphere', [0.12], [-0.38, 1.75, 0], col(1));
    add('sphere', [0.12], [0.38, 1.75, 0], col(1));
    return { hw: 0.5, hd: 0.5, top: 2.3, wallH: 1.7 };
  },
  shelter: ({ add, col }) => {
    for (const [x, z] of [[-0.9, -0.7], [0.9, -0.7], [-0.9, 0.7], [0.9, 0.7]]) add('cyl', [0.09, 0.11, 1.8], [x, 0.9, z], col(0));
    add('cone', [1.7, 0.8, 4], [0, 2.2, 0], col(1), { rot: [0, Math.PI / 4, 0], soft: { model: 'pyramid', fit: [2.5, 0.8, 2.5], rot: [0, 0, 0] } });
    add('box', [1.5, 0.12, 0.4], [0, 0.4, -0.5], col(2));
    return { hw: 0.9, hd: 0.7, top: 2.6, wallH: 1.8 };
  },
  playground: ({ add, col }) => {
    for (const x of [-0.9, 0.9]) {
      add('cyl', [0.07, 0.07, 1.8], [x, 0.9, -0.2], col(0), { rot: [0, 0, x * 0.18] });
      add('cyl', [0.07, 0.07, 1.8], [x, 0.9, 0.5], col(0), { rot: [0, 0, x * 0.18] });
    }
    add('cyl', [0.06, 0.06, 2.1], [0, 1.78, 0.15], col(1), { rot: [0, 0, Math.PI / 2] });
    for (const x of [-0.4, 0.4]) add('box', [0.4, 0.06, 0.25], [x, 0.4, 0.15], col(2));
    return { hw: 1.0, hd: 0.5, top: 1.85, wallH: 1.8 };
  },
  boat: ({ add, col }) => {
    add('box', [2.0, 0.5, 1.0], [0, 0.4, 0], col(0), { soft: { model: 'hull', fit: [2.4, 0.75, 1.05], pos: [0.1, 0.3, 0] } });
    add('cone', [0.5, 0.5, 4], [1.2, 0.4, 0], col(0), { rot: [0, Math.PI / 4, -Math.PI / 2], soft: { skip: true } });
    add('cyl', [0.05, 0.06, 2.2], [0, 1.6, 0], DARKWOOD);
    add('box', [0.04, 1.4, 0.9], [0, 1.65, 0.05], col(1), { soft: { model: 'sail', fit: [1.0, 1.4, 0.12], pos: [0.5, 1.65, 0.04], rot: [0, 0, 0] } });
    return { hw: 1.0, hd: 0.5, top: 2.7, wallH: 0.7 };
  },
};

const PART_ORDER = ['roof', 'dome', 'chimney', 'door', 'window', 'screen', 'buttons', 'lights', 'wheel', 'slide', 'stairs', 'sign', 'flowers', 'bell', 'flag', 'star'];
const PARTS = {
  roof: ({ add, col }, c) => add('cone', [c.hw * 1.15, 0.5, 6], [0, c.top + 0.15, 0], col(2), { soft: { model: 'pyramid', fit: [c.hw * 2.3, 0.5, c.hw * 2.3] } }),
  dome: ({ add, col }, c) => add('sphere', [c.hw * 0.7], [0, c.top + 0.1, 0], col(1), { soft: { model: 'dome', fit: [c.hw * 1.4, c.hw * 0.7, c.hw * 1.4], pos: [0, c.top - 0.05 + c.hw * 0.35, 0] } }),
  chimney: ({ add, col }, c) => add('box', [0.3, 0.6, 0.3], [c.hw * 0.5, c.top, -c.hd * 0.3], col(2), { soft: { model: 'chimney', fit: [0.34, 0.6, 0.34] } }),
  door: ({ add }, c) => add('box', [0.45, 0.75, 0.08], [0, 0.38, c.hd + 0.05], DARKWOOD, { soft: { model: 'door', fit: [0.5, 0.78, 0.14] } }),
  window: ({ add }, c) => { for (const s of [-1, 1]) add('box', [0.06, 0.35, 0.35], [s * (c.hw + 0.03), Math.max(0.5, c.wallH * 0.6), 0], GLASSY, { soft: { model: 'window', fit: [0.36, 0.36, 0.1], rot: [0, s * Math.PI / 2, 0] } }); },
  screen: ({ add }, c) => add('box', [0.7, 0.5, 0.06], [0, Math.max(0.6, c.wallH * 0.65), c.hd + 0.04], '#8fe3c0', { glow: true }),
  buttons: ({ add, col }, c) => { for (let i = 0; i < 3; i++) add('sphere', [0.07], [-0.25 + i * 0.25, Math.max(0.35, c.wallH * 0.3), c.hd + 0.06], col(i + 1)); },
  lights: ({ add }, c) => { for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add('sphere', [0.1], [x * c.hw * 0.9, c.top * 0.55, z * c.hd * 0.9], '#ffe08a', { glow: true }); },
  wheel: ({ add, col }, c) => { for (const s of [-1, 1]) add('cyl', [0.3, 0.3, 0.12], [s * (c.hw + 0.05), 0.3, 0], col(1), { rot: [0, 0, Math.PI / 2], soft: { model: 'wheel', fit: [0.14, 0.64, 0.64], rot: [0, 0, 0] } }); },
  slide: ({ add, col }, c) => add('box', [0.5, 0.08, 1.4], [c.hw + 0.3, 0.55, 0.2], col(1), { rot: [0.6, 0, 0], soft: { model: 'slide', fit: [0.5, 0.2, 1.4] } }),
  stairs: ({ add, col }, c) => { for (let i = 0; i < 3; i++) add('box', [0.8, 0.14, 0.25], [0, 0.07 + i * 0.14, c.hd + 0.5 - i * 0.2], col(1)); },
  sign: ({ add, col }, c) => { add('cyl', [0.04, 0.04, 0.8], [-c.hw * 0.7, 0.4, c.hd + 0.4], DARKWOOD); add('box', [0.6, 0.3, 0.05], [-c.hw * 0.7, 0.85, c.hd + 0.4], col(2)); },
  flowers: ({ add, col }, c) => { for (let i = 0; i < 4; i++) add('sphere', [0.1], [-0.6 + i * 0.4, 0.14, c.hd + 0.25], col(i + 1), { soft: { model: 'flower', fit: [0.3, 0.14, 0.3] } }); },
  bell: ({ add }, c) => add('cone', [0.2, 0.28, 8], [0.3, c.top + 0.1, 0], '#d9a93a', { soft: { model: 'bell', fit: [0.38, 0.4, 0.38] } }),
  flag: ({ add, col }, c) => { add('cyl', [0.03, 0.03, 1.0], [-c.hw * 0.6, c.top + 0.4, 0], DARKWOOD); add('box', [0.5, 0.3, 0.03], [-c.hw * 0.6 + 0.27, c.top + 0.75, 0], col(1), { soft: { model: 'pennant', fit: [0.5, 0.3, 0.05] } }); },
  star: ({ add }, c) => add('sphere', [0.18], [0, c.top + 0.9, 0], '#ffe27a', { glow: true, soft: { model: 'star', fit: [0.5, 0.5, 0.14] } }),
};
