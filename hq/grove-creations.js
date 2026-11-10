// Free creations: anything a koala invents, as real geometry. The model writes a creation as JSON:
// a name and a list of primitive parts (box, cylinder, sphere, cone, torus), each with a size,
// a position from the creation's centre, a colour and a turn. This module checks it, and gives
// each creation a place in the open field around the island. Pure: no I/O.

export const SHAPES = ['box', 'cylinder', 'sphere', 'cone', 'torus'];
export const MAX_PARTS = 40;
export const MAX_CREATIONS = 300;
const SIZE = [0.05, 8];
const REACH = 7; // a part's centre lies within this many metres of the creation's centre
const HEX = /^#[0-9a-fA-F]{6}$/;
const FALLBACK_COLOR = '#8a6a4a';

const num = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const triple = (v, lo, hi, dflt) => {
  const a = Array.isArray(v) ? v.slice(0, 3) : [];
  while (a.length < 3) a.push(dflt);
  return a.map((x) => num(x, lo, hi, dflt));
};

function normPart(p) {
  if (!p || typeof p !== 'object') return null;
  if (!SHAPES.includes(p.shape)) return null;
  return {
    shape: p.shape,
    size: triple(p.size, SIZE[0], SIZE[1], 1),
    at: triple(p.at, -REACH, REACH, 0),
    color: HEX.test(p.color) ? p.color : FALLBACK_COLOR,
    rotY: num(p.rotY, -360, 360, 0),
  };
}

// raw: a JSON object, or text that contains one. Returns { name, parts } or null when there is
// nothing buildable in it.
export function parseCreation(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return null;
    try { obj = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const name = typeof obj.name === 'string' ? obj.name.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
  const parts = (Array.isArray(obj.parts) ? obj.parts : []).slice(0, MAX_PARTS).map(normPart).filter(Boolean);
  if (!name || !parts.length) return null;
  return { name, parts };
}

// Creation i stands on a spiral outside the island (radius 24), so nothing overlaps and the field grows outward.
export function slotFor(i) {
  const a = i * 2.39996323; // the golden angle
  const r = 36 + 7 * Math.sqrt(i);
  return { x: Math.round(Math.cos(a) * r * 10) / 10, z: Math.round(Math.sin(a) * r * 10) / 10 };
}
