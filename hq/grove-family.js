// Love and babies. Two grown-up koalas who love each other may make a nest; a baby is born a
// grove day later, follows its mother everywhere for free, and once it is strong enough it
// starts making its own (real model) decisions. Pure, like grove-world.js.

import { KOALAS, MAX_KOALAS, START_STRENGTH, stageOf, interestsOf } from './grove-world.js';

export const NEST_WINDOW = 120; // grove minutes: both must choose to nest within this
export const GESTATION = 1440; // grove minutes: one grove day
export const GRADUATE_AT = 45; // strength at which a baby starts deciding for itself
export const BABY_NAMES = ['Pip', 'Wattle', 'Gumnut', 'Sky'];
export const CAKE_DAY = 100; // the grove day the koalas get a big cake
export const CAKE_FROM = 'Casper and Simon';
export const cakeMemory = () => `${CAKE_FROM} gave you a big cake to celebrate day ${CAKE_DAY} of the grove!`;
const LOVE = 80;

const TRAITS = {
  crystal: "curiosity and love of shiny pebbles",
  ruby: "gentle, sleepy calm and love of eucalyptus",
};
const PRONOUNS = { girl: 'she/her', boy: 'he/him' };

// Whether a and b could make a nest now, and if not, why (in words a koala can be told).
export function canNest(world, a, b) {
  const ka = world.koalas[a];
  const kb = world.koalas[b];
  if (!ka || !kb) return { ok: false, why: 'there is nobody to nest with' };
  if (ka.parents || kb.parents || a === b) return { ok: false, why: 'only Crystal and Ruby can start a family' };
  if (stageOf(ka.strength).id !== 'grown' || stageOf(kb.strength).id !== 'grown') return { ok: false, why: 'you both need to be grown-ups first' };
  if (ka.bond < LOVE || kb.bond < LOVE) return { ok: false, why: 'you need to love each other more first' };
  if (ka.place !== kb.place) return { ok: false, why: 'you need to be together in the same place' };
  if (world.baby) return { ok: false, why: 'a baby is already on the way' };
  if (Object.keys(world.koalas).length >= MAX_KOALAS) return { ok: false, why: 'there is no room in the grove for another koala' };
  return { ok: true, why: '' };
}

const partnerOf = (world, id) => (world.koalas[id]?.parents ? null : KOALAS.find((k) => k.id !== id && world.koalas[k.id])?.id);

// A koala chooses to nest at grove minute `now`. Returns { refused: why } | { pending: true } | { conceived: true }.
export function nestStep(world, id, now) {
  const partner = partnerOf(world, id);
  const check = canNest(world, id, partner);
  if (!check.ok) return { refused: check.why };
  if (world.nest && world.nest.by === partner && now - world.nest.at <= NEST_WINDOW) {
    const mother = [id, partner].find((k) => KOALAS.find((x) => x.id === k)?.gender === 'girl') ?? id;
    world.baby = { due: now + GESTATION, parents: [mother, mother === id ? partner : id] };
    world.nest = null;
    return { conceived: true };
  }
  world.nest = { by: id, at: now };
  return { pending: true };
}

export function babyPersona(world, parents, name, gender) {
  const [a, b] = parents.map((p) => world.koalas[p]);
  return `${name} is a baby koala, a ${gender} (${PRONOUNS[gender]}), the child of ${a.name} and ${b.name}. `
    + `${name} has ${a.name}'s ${TRAITS[a.id] ?? 'warm heart'} and ${b.name}'s ${TRAITS[b.id] ?? 'kind eyes'}, `
    + `looks up to both parents, and is still learning how everything in the grove works.`;
}

// Two interests from each parent, no repeats.
export const babyInterests = (world, parents) => [...new Set(parents.flatMap((p) => interestsOf(world.koalas[p]).slice(0, 2)))];

// The baby, if it is due at grove minute `now`: it joins world.koalas and is returned.
export function bornBaby(world, now, name, id, gender = 'girl') {
  if (!world.baby || now < world.baby.due) return null;
  const parents = world.baby.parents;
  const k = {
    id,
    name,
    gender,
    persona: babyPersona(world, parents, name, gender),
    interests: babyInterests(world, parents),
    color: '#b3aca3',
    place: 'hollow',
    activity: 'sit',
    mood: 'cozy',
    hunger: 20,
    energy: 90,
    strength: START_STRENGTH,
    inventory: [],
    res: {},
    bond: 40,
    opinion: '',
    memories: [],
    recent: [`You were born in the Mossy Hollow. Your mother is ${world.koalas[parents[0]].name}.`],
    thought: '',
    say: '',
    follows: parents[0],
    parents,
    bornAt: now,
    named: false,
  };
  world.koalas[id] = k;
  world.baby = null;
  return k;
}

export const graduates = (k) => !!k.follows && k.strength >= GRADUATE_AT;
