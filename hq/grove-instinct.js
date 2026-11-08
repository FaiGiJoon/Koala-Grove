// The koalas' instinct: a local brain that costs nothing. It reads the same world the
// model sees and answers with the same decision JSON, so the grove can live 24/7 without
// a single token. Each koala scores what it could do (eat, nap, gather, build, play,
// visit its friend, read...) against its needs, its temperament and what just happened
// to it, and does the best one. Pure, like grove-world.js: no I/O, the rng is passed in.

import {
  PLACES, BLUEPRINTS, KOALAS, placesOf, friendOf, canReadAt, carryLimit, freePlots, interestsOf, stageOf,
} from './grove-world.js';
import { SOURCES, OPEN_ISLANDS, costOf, stockOf, held, canAfford, bridged } from './grove-economy.js';
import { canNest } from './grove-family.js';
import { designSpec, designCost } from './grove-design.js';
import { needsOf, beliefBoost, holdsTo, HOLDS_BIAS, mindOf } from './grove-mind.js';

// How each founder leans. Weights multiply the base score of an urge; 1 is neutral.
// A koala born in the grove gets an even mix (see temperOf).
export const TEMPERS = {
  crystal: {
    eat: 1, nap: 0.8, play: 1.3, explore: 1.4, social: 1.1, build: 1.1, read: 0.9, climb: 1.2,
    toys: ['pond', 'ball', 'swing'],
    builds: ['bridge_stone_crag', 'lantern', 'tower', 'stones', 'bench', 'birdhouse', 'treehouse', 'reading_nook', 'flowerbed', 'bridge_sandy_shoal', 'bridge_spring_isle', 'well', 'hut'],
  },
  ruby: {
    eat: 1.2, nap: 1.4, play: 0.8, explore: 0.6, social: 0.9, build: 1, read: 1.3, climb: 0.9,
    toys: ['swing', 'pond', 'ball'],
    builds: ['bench', 'reading_nook', 'flowerbed', 'birdhouse', 'lantern', 'bridge_stone_crag', 'treehouse', 'hut', 'bridge_spring_isle', 'well', 'stones', 'bridge_sandy_shoal', 'tower'],
  },
};
const MIXED = {
  eat: 1.1, nap: 1.1, play: 1.2, explore: 1, social: 1.2, build: 0.9, read: 1, climb: 1.1,
  toys: ['ball', 'swing', 'pond'],
  builds: ['bench', 'birdhouse', 'lantern', 'flowerbed', 'reading_nook', 'stones', 'treehouse', 'bridge_stone_crag', 'tower', 'hut', 'well', 'bridge_spring_isle', 'bridge_sandy_shoal'],
};
export const temperOf = (k) => TEMPERS[k.id] ?? MIXED;

// Things they say, in their own voices. {f} is the friend's name, {x} a detail.
const LINES = {
  crystal: {
    hello: ['{f}! There you are!', 'Hi {f}, guess what I found?', 'Come on {f}, let us go exploring!'],
    reply: ['Ooh, really? Tell me more!', 'I knew that! Well, almost.', 'Yes! Let us do it!', 'Ha, you are funny.'],
    visitor: ['Hello, lantern friend!', 'You came back! Watch this!', 'I am being very brave today.'],
    thanks: ['A {x}! Thank you, I will keep it safe.', 'Ooh, a {x}! It is so shiny.'],
    eat: ['Munch munch. Exploring makes me hungry.', 'These leaves are the best ones.'],
    nap: ['Just a tiny rest. Not because I am tired.', 'Wake me if anything exciting happens.'],
    play: ['Watch me! Splash!', 'Bet you cannot catch me!', 'Wheee!'],
    build: ['Tap tap tap! It is getting big!', 'This is going to be amazing.', 'Hold that side, {f}!'],
    gather: ['Got one! I can carry lots.', 'Found some {x}!'],
    store: ['Into the Stockpile it goes!'],
    finish: ['We did it! Look at it!'],
    explore: ['What is over there?', 'I am going to see everything.'],
    give: ['This is for you, {f}. Do not lose it.'],
    read: ['A book about {x}! Let me see.'],
    night: ['The stars are out. I want to touch one.'],
  },
  ruby: {
    hello: ['Oh. Hello, {f}.', 'It is nice when you are here, {f}.', 'Shall we sit together a while?'],
    reply: ['Mm. I think so too.', 'That is a nice thought.', 'Slowly, but yes.', 'I will remember that.'],
    visitor: ['Hello again, quiet friend.', 'Your lantern is warm.', 'Thank you for visiting.'],
    thanks: ['A {x}... for me? Thank you.', 'I will keep this {x} by my pillow.'],
    eat: ['Fresh leaves. Lovely.', 'Eucalyptus tastes like rain.'],
    nap: ['Just a little nap...', 'The moss is soft today.', 'Mmm... five more minutes.'],
    play: ['Gently, gently.', 'This is more fun than I thought.'],
    build: ['One more piece, and then another.', 'Steady now.', 'It is coming along nicely.'],
    gather: ['A bit of {x}. Enough for now.'],
    store: ['There. Safe in the Stockpile.'],
    finish: ['We made something that will stay.'],
    explore: ['I will take a slow look around.'],
    give: ['I saved this for you, {f}.'],
    read: ['Let me read about {x}, quietly.'],
    night: ['The moon is watching over the grove.'],
  },
};
const lineSet = (k) => LINES[k.id] ?? LINES[(k.parents ?? [])[0]] ?? LINES.crystal;

const WISHES = {
  'brave explorers': 'Cross a bridge to every island in the sea.',
  'shiny stones and crystals': 'Find the shiniest stone in the whole grove.',
  stars: 'Build a tower tall enough to touch the stars.',
  'faraway places': 'See what is past the edge of the water.',
  'sleepy animals': 'Make friends with the slow old turtle.',
  'eucalyptus and plants': 'Grow a garden full of every kind of flower.',
  poems: 'Write a poem about the grove that Crystal likes.',
  'the moon and night': 'Stay up all night once and watch the moon.',
};
const OPINIONS = [
  [60, ['My best friend in the whole grove.', 'I feel safe when they are near.']],
  [20, ['A good friend.', 'I like having them around.']],
  [-20, ['A bit noisy, but kind.', 'Still getting to know them.']],
  [-101, ['We do not get on very well yet.']],
];
const TRAITS = {
  crystal: ['I always want to see what is around the corner.', 'I like being the first one there.', 'Shiny things make me happy.'],
  ruby: ['I notice small things others miss.', 'I like quiet more than noise.', 'A nap fixes most things.'],
};
const INVENTIONS = {
  crystal: [['Star Lookout', 'A tall silver tower with a star on top and a little flag.'], ['Pebble Castle', 'A small pink castle made of shiny stone with a flag.'], ['Crystal Lamp', 'A tiny glowing lamp with blue lights.']],
  ruby: [['Moon Bench', 'A small curved bench with a silver moon sign.'], ['Sleepy Cottage', 'A little green house with a round door and a chimney.'], ['Poem Post', 'A tiny wooden sign with flowers where poems are kept.']],
};

// One true thing per page, for reading without tokens. Tags match the topic a koala opens.
export const BOOKS = [
  { tags: ['koala', 'koalas', 'eucalyptus', 'leaves', 'water'], fact: 'Koalas get most of the water they need from the eucalyptus leaves they eat.', curiosity: 'how plants hold water' },
  { tags: ['koala', 'koalas', 'sleep', 'sleepy', 'nap'], fact: 'Koalas sleep or rest for about 18 to 22 hours a day, because gum leaves give them very little energy.', idea: 'We could build a cozy hut to nap in.' },
  { tags: ['eucalyptus', 'plants', 'trees', 'gum'], fact: 'There are more than 700 kinds of eucalyptus, and most of them grow only in Australia.', curiosity: 'Australian forests' },
  { tags: ['eucalyptus', 'plants', 'smell', 'oil'], fact: 'Eucalyptus leaves smell strong because they are full of oils that keep many insects from eating them.' },
  { tags: ['plants', 'flowers', 'garden', 'sun'], fact: 'Plants make their own food from sunlight, water and air. This is called photosynthesis.', idea: 'A flower bed by the pond would get sun and water.', curiosity: 'photosynthesis' },
  { tags: ['flowers', 'bees', 'plants', 'garden'], fact: 'Bees carry pollen from flower to flower, which helps the flowers make seeds.', curiosity: 'bees' },
  { tags: ['stars', 'sky', 'night', 'sun'], fact: 'The Sun is a star. It looks bigger than the others only because it is much closer to us.', curiosity: 'the planets' },
  { tags: ['stars', 'light', 'sky', 'faraway'], fact: 'Starlight is very old: the light you see from some stars left them thousands of years ago.', idea: 'A lookout tower would be a good place to watch the stars.' },
  { tags: ['stars', 'constellations', 'night', 'explorers'], fact: 'Long ago, sailors found their way across the sea at night by following the stars.', curiosity: 'constellations' },
  { tags: ['moon', 'night', 'sky'], fact: 'The Moon does not shine by itself. It reflects light from the Sun.', curiosity: 'the phases of the moon' },
  { tags: ['moon', 'phases', 'night'], fact: 'The Moon takes about 29 and a half days to go from one full moon to the next.' },
  { tags: ['moon', 'tides', 'water', 'sea'], fact: 'The pull of the Moon makes the sea rise and fall twice a day. These are the tides.', curiosity: 'the sea' },
  { tags: ['night', 'animals', 'sleepy', 'owls'], fact: 'Owls can turn their heads about three quarters of the way around to look behind them.' },
  { tags: ['night', 'fireflies', 'light', 'lantern'], fact: 'Fireflies make their own light inside their bodies, without making it hot.', idea: 'A firefly lantern would light the path at night.' },
  { tags: ['crystals', 'stones', 'shiny', 'rocks'], fact: 'Crystals grow when tiny pieces line up in a repeating pattern, layer by layer.', curiosity: 'how crystals grow' },
  { tags: ['crystals', 'stones', 'quartz', 'shiny'], fact: 'Quartz is one of the most common crystals on Earth. Sand is often made of tiny bits of it.', curiosity: 'sand' },
  { tags: ['stones', 'rocks', 'mountains', 'lookout'], fact: 'Some rocks form from melted rock that cooled down, like the stone of old volcanoes.', curiosity: 'volcanoes' },
  { tags: ['stones', 'shiny', 'diamonds', 'crystals'], fact: 'Diamonds are made of the same stuff as pencil lead, carbon, squeezed very hard deep underground.' },
  { tags: ['sand', 'beach', 'glass'], fact: 'Glass is made by heating sand until it melts, then letting it cool.', idea: 'With enough sand we could make something with glass windows.' },
  { tags: ['explorers', 'faraway', 'maps', 'places'], fact: 'Explorers draw maps so the next traveller knows the way. A good map has a key and shows north.', idea: 'We could put up a sign with a map of the islands.' },
  { tags: ['faraway', 'places', 'sea', 'islands'], fact: 'Some islands are the tops of huge underwater mountains that poke out of the sea.', curiosity: 'islands' },
  { tags: ['explorers', 'brave', 'compass'], fact: 'A compass needle points north because the Earth acts like a giant magnet.', curiosity: 'magnets' },
  { tags: ['poems', 'words', 'stories'], fact: 'A haiku is a short poem with three lines of five, seven and five sounds.', idea: 'A reading nook would be a quiet place to write poems.' },
  { tags: ['poems', 'rhyme', 'words'], fact: 'Words rhyme when they end with the same sound, like moon and spoon.' },
  { tags: ['stories', 'books', 'library', 'reading'], fact: 'Before paper, people kept stories by telling them out loud, again and again.' },
  { tags: ['sleepy', 'animals', 'turtles', 'turtle'], fact: 'Some turtles can live for more than 100 years.', curiosity: 'very old animals' },
  { tags: ['turtles', 'turtle', 'shell'], fact: 'A turtle cannot leave its shell. The shell is part of its skeleton, joined to its spine and ribs.' },
  { tags: ['sleepy', 'animals', 'sloths', 'slow'], fact: 'Sloths move so slowly that tiny green plants called algae can grow in their fur.' },
  { tags: ['sleepy', 'animals', 'hibernate', 'bears'], fact: 'Some animals hibernate: they sleep through the cold months and live on the fat they stored.' },
  { tags: ['frogs', 'frog', 'pond', 'water'], fact: 'Frogs start life as tadpoles that live in water and breathe with gills.', curiosity: 'tadpoles' },
  { tags: ['frogs', 'frog', 'skin', 'water'], fact: 'Frogs can drink and even breathe a little through their skin, so they like to stay damp.' },
  { tags: ['birds', 'kookaburra', 'nest'], fact: 'A kookaburra\'s call sounds like loud laughing. Families call together to say: this is our place.', idea: 'A birdhouse would give the birds a home.' },
  { tags: ['birds', 'flying', 'feathers', 'feather'], fact: 'Bird bones are hollow, which makes them light enough to fly.' },
  { tags: ['bridges', 'bridge', 'building', 'build'], fact: 'A rope bridge stays up because its ropes pull on strong posts at both ends.', idea: 'Build the bridge with strong stone posts.' },
  { tags: ['building', 'build', 'triangles', 'tower'], fact: 'Triangles are the strongest simple shape for building, because they do not bend out of shape.', curiosity: 'how towers stand up' },
  { tags: ['wood', 'trees', 'building', 'rings'], fact: 'You can tell how old a tree is by counting the rings inside its trunk: usually one ring a year.' },
  { tags: ['water', 'rain', 'clouds', 'well'], fact: 'Rain comes from clouds when tiny water drops join together and get too heavy to float.', curiosity: 'clouds' },
  { tags: ['water', 'well', 'underground'], fact: 'A well reaches water that is stored underground between rocks and sand.', idea: 'A well would give the grove water without walking to the pond.' },
  { tags: ['octopuses', 'octopus', 'sea'], fact: 'An octopus has three hearts and blue blood.' },
  { tags: ['planets', 'sky', 'faraway', 'stars'], fact: 'Jupiter is the biggest planet near us. More than a thousand Earths could fit inside it.' },
];

const pick = (list, rng) => list[Math.floor(rng() * list.length) % list.length];
const fill = (s, vars) => s.replace(/\{(\w)\}/g, (_, v) => vars[v] ?? '');
const TREES = Object.keys(PLACES).filter((id) => PLACES[id].tree);
const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.z - b.z) : 99);

// What has happened to the koala since its own last move: the lines after the last "You ...".
export function freshEvents(k) {
  const r = k.recent ?? [];
  let i = r.length - 1;
  while (i >= 0 && !r[i].startsWith('You ')) i--;
  return r.slice(i + 1);
}

// Words of a topic, for matching books.
const words = (s) => String(s ?? '').toLowerCase().match(/[a-z]+/g) ?? [];

// A book page for a topic the koala opens: the best match it has not read yet, or null
// when it already knows everything on the shelf about it. Answers like the model's
// library: { fact, idea, curiosity }.
export function instinctRead(k, topic, rng = Math.random) {
  const known = new Set(k.learned ?? []);
  const want = new Set([...words(topic), ...interestsOf(k).flatMap(words)]);
  const asked = new Set(words(topic));
  const unread = BOOKS.filter((b) => !known.has(b.fact));
  if (!unread.length) return null;
  const score = (b) => b.tags.reduce((s, t) => s + (asked.has(t) ? 3 : want.has(t) ? 1 : 0), 0) + rng() * 0.5;
  const best = unread.map((b) => ({ b, s: score(b) })).sort((x, y) => y.s - x.s)[0].b;
  return { fact: best.fact, idea: best.idea ?? '', curiosity: best.curiosity ?? '' };
}

// Where a resource can be gathered right now, nearest first from the koala.
function sourcesOf(world, k, resource) {
  const places = placesOf(world);
  const here = places[k.place];
  return Object.keys(SOURCES).filter((p) => SOURCES[p].includes(resource) && places[p])
    .sort((a, b) => dist(places[a], here) - dist(places[b], here));
}

// Builds this koala could start one day: not a bridge already built or underway, and with
// a place to stand. Its favourites come first.
function wantedBuilds(world, k) {
  const builds = world.builds ?? [];
  const open = new Set(bridged(world));
  const plots = freePlots(world).length;
  const made = (kind) => builds.filter((b) => b.kind === kind).length;
  // favourites first, but something new before a second of the same
  return temperOf(k).builds.map((kind, i) => ({ kind, i })).sort((a, b) => made(a.kind) - made(b.kind) || a.i - b.i).map((x) => x.kind).filter((kind) => {
    const bp = BLUEPRINTS[kind];
    if (!bp) return false;
    if (bp.bridge) return !open.has(bp.bridge) && !OPEN_ISLANDS.includes(bp.bridge) && !builds.some((b) => b.kind === kind);
    return plots > 0;
  });
}

// The koala's project: start a build it can pay for, or else the resource it should fetch
// for the first build it wants whose missing resources it can reach.
function projectOf(world, k) {
  const stock = stockOf(world);
  const wanted = wantedBuilds(world, k);
  // Its top three wishes come first: start one it can pay for, or save up for the first it can.
  const top = wanted.slice(0, 3);
  for (const kind of top) if (canAfford(stock, costOf(kind)).ok) return { start: kind };
  for (const kind of wanted) {
    const { missing } = canAfford(stock, costOf(kind));
    const need = Object.keys(missing).filter((r) => sourcesOf(world, k, r).length);
    if (need.length && need.length === Object.keys(missing).length) return { kind, need: need[0] };
  }
  const any = wanted.find((kind) => canAfford(stock, costOf(kind)).ok);
  return any ? { start: any } : null;
}

function invention(world, k, rng) {
  const [name, design] = pick(INVENTIONS[k.id] ?? INVENTIONS.crystal, rng);
  const spec = designSpec(name, design);
  const priced = designCost({ ...spec, design: `${name} ${spec.design}` });
  if (!freePlots(world).length || !canAfford(stockOf(world), priced.cost).ok) return null;
  return { name, design };
}

// The decision, shaped like DECISION_SCHEMA, ready for parseDecision.
// `canRead` is false once the grove has read enough for the day, so the koala does not keep trying.
export function instinctDecide(world, id, clock = { phase: 'day' }, rng = Math.random, { canRead = true } = {}) {
  const k = world.koalas[id];
  const f = friendOf(world, id);
  const t = temperOf(k);
  const L = lineSet(k);
  const places = placesOf(world);
  const here = places[k.place];
  const fname = f?.name ?? 'friend';
  const say = (key, x = '') => fill(pick(L[key] ?? [''], rng), { f: fname, x });
  const night = clock.phase === 'night';
  const fresh = freshEvents(k);
  const carry = carryLimit(k.strength);
  const resHeld = Object.values(k.res ?? {}).reduce((s, n) => s + n, 0);
  const full = held(k) >= carry;
  const together = f && f.place === k.place;
  const opts = [];
  const add = (score, d) => opts.push({ score: score + rng() * 8, d });
  const nearestTree = TREES.includes(k.place) ? k.place : TREES.slice().sort((a, b) => dist(PLACES[a], here) - dist(PLACES[b], here))[0];
  const home = KOALAS.find((x) => x.id === id)?.home ?? 'hollow';

  // Needs first: food and sleep.
  if (k.hunger >= 50) add((k.hunger - 10) * t.eat, { action: 'eat', target: nearestTree, mood: 'hungry', thought: 'My tummy is rumbling.', say: rng() < 0.4 ? say('eat') : '' });
  if (k.energy <= 35) add((100 - k.energy) * 0.85 * t.nap, { action: 'nap', mood: 'sleepy', thought: 'My eyes are so heavy.', say: rng() < 0.4 ? say('nap') : '' });
  if (night && k.energy < 85) {
    if (k.place !== home && k.activity !== 'nap' && k.energy > 20) add(58 * t.nap, { action: 'move', target: home, mood: 'cozy', thought: 'It is dark. Time to go home.', say: rng() < 0.3 ? say('night') : '' });
    add((k.place === home || k.activity === 'nap' ? 72 : 40) * t.nap, { action: 'nap', mood: 'cozy', thought: 'Night is for sleeping.', say: rng() < 0.2 ? say('nap') : '' });
  }

  // Family: two grown-ups in love make a nest.
  const partner = KOALAS.find((x) => x.id !== id && KOALAS.some((y) => y.id === id))?.id;
  if (partner && canNest(world, id, partner).ok) {
    const waiting = world.nest?.by === partner;
    add(waiting ? 96 : 70, { action: 'nest', mood: 'cozy', thought: waiting ? `${fname} made a nest for us.` : 'I would love a little family.', say: 'Shall we make a cozy nest together?', bond: 2 });
  }

  // Reacting to what just happened.
  for (const e of fresh) {
    const gift = /^The visitor gave you an? (\w+)\./.exec(e) ?? new RegExp(`gave you an? (\\w+)\\.$`).exec(e);
    if (gift) add(74, { action: 'sit', mood: 'happy', thought: `Someone gave me a ${gift[1]}.`, say: say('thanks', gift[1]), bond: e.startsWith('The visitor') ? 0 : 2, remember: e.slice(0, 140) });
    else if (/^The visitor (said|answered|gave you a gentle pat)/.test(e)) add(70, { action: 'sit', mood: 'happy', thought: 'The visitor is here.', say: say('visitor') });
    // a reply now and then, not every time, so two chatty koalas do not talk in circles
    else if (f && e.startsWith(`${fname} said:`) && rng() < 0.45) add(42 * t.social, together ? { action: 'sit', mood: 'happy', thought: `${fname} is talking to me.`, say: say('reply'), bond: rng() < 0.4 ? 1 : 0 } : { action: 'approach', mood: 'curious', thought: `I want to hear what ${fname} said.`, say: '', bond: 0 });
    else if (/finished the|New land rose|was born/.test(e)) add(45, { action: 'sit', mood: 'happy', thought: 'What a day for the grove!', say: say('finish'), remember: e.slice(0, 140) });
  }

  // Work: carry home what is in the paws, build, and fetch what the next build needs.
  const tiredForWork = k.energy < 18 || k.hunger > 85;
  if (!tiredForWork) {
    const open = (world.builds ?? []).filter((b) => !b.done);
    const friendBuilding = f && f.activity === 'build' && open.some((b) => (b.plot ?? b.kind) === f.place);
    const project = projectOf(world, k);
    const goalHere = project?.need && (SOURCES[k.place] ?? []).includes(project.need);
    if (resHeld && (full || !goalHere)) add(full ? 66 : 50, { action: 'store', mood: 'content', thought: 'My paws are full of good things.', say: rng() < 0.3 ? say('store') : '' });
    if (open.length) add((friendBuilding ? 64 : 52) * t.build, { action: 'build', target: '', mood: 'happy', thought: friendBuilding ? `${fname} is building. I will help.` : 'Our build is not finished yet.', say: rng() < 0.4 ? say('build') : '', bond: friendBuilding ? 1 : 0 });
    if (open.length < 2) {
      const idea = rng() < 0.15 ? invention(world, k, rng) : null;
      if (idea) add(57 * t.build, { action: 'build', target: 'new', build_name: idea.name, build_design: idea.design, mood: 'curious', thought: 'I have a brand new idea.', say: 'I have an idea! Let us make something new.' });
      else if (project?.start) add(56 * t.build, { action: 'build', target: project.start, build_name: '', mood: 'curious', thought: `We have enough to make a ${BLUEPRINTS[project.start].name}.`, say: `Let us build a ${BLUEPRINTS[project.start].name}!` });
    }
    if (project?.need && !full) {
      if (goalHere) add(58 * t.build, { action: 'gather', target: project.need, mood: 'content', thought: `The ${BLUEPRINTS[project.kind].name} needs ${project.need}.`, say: rng() < 0.3 ? say('gather', project.need) : '' });
      else add(46 * t.build, { action: 'move', target: sourcesOf(world, k, project.need)[0], mood: 'curious', thought: `I need to fetch some ${project.need}.`, say: '' });
    }
  }

  // Play, friendship, learning and wandering, for when needs are met.
  if (k.energy > 35) {
    add(22 * t.play + (k.mood === 'playful' ? 10 : 0), { action: 'play', target: pick(t.toys.slice(0, 2), rng), mood: 'playful', thought: 'I feel like playing.', say: rng() < 0.5 ? say('play') : '' });
    if (k.energy > 45) add(16 * t.climb, { action: 'climb', target: nearestTree, mood: 'playful', thought: 'Higher, higher!', say: '' });
  }
  if (f && !together && k.bond > -40) add(18 * t.social + (k.mood === 'lonely' ? 15 : 0), { action: 'approach', mood: 'happy', thought: `I wonder what ${fname} is doing.`, say: rng() < 0.5 ? say('hello') : '', bond: rng() < 0.5 ? 1 : 0 });
  if (f && together) {
    add(12 * t.social, { action: 'sit', mood: 'content', thought: `It is nice to be with ${fname}.`, say: rng() < 0.3 ? say('hello') : '', bond: rng() < 0.3 ? 1 : 0 });
    if (k.inventory?.length && held(f) < carryLimit(f.strength)) add(24 + k.bond / 6, { action: 'give', target: k.inventory[0], mood: 'happy', thought: `${fname} would like this.`, say: say('give'), bond: 2 });
  }
  const topic = pick(interestsOf(k).length ? interestsOf(k) : ['the grove'], rng);
  if (canRead && canReadAt(world, k.place) && k.energy > 20) add(32 * t.read, { action: 'read', target: topic, mood: 'curious', thought: `I want to know about ${topic}.`, say: rng() < 0.4 ? say('read', topic) : '' });
  else if (canRead && places.library_isle && k.energy > 40) add(18 * t.read, { action: 'move', target: 'library_isle', mood: 'curious', thought: 'The library has so many books.', say: '' });
  const roam = Object.keys(places).filter((p) => p !== k.place && !places[p].build);
  if (roam.length && k.energy > 30) add(14 * t.explore, { action: 'move', target: pick(roam, rng), mood: 'curious', thought: 'Let us see what is over there.', say: rng() < 0.3 ? say('explore') : '' });
  add(6, { action: 'sit', mood: 'content', thought: 'I will just sit and look around.', say: '' });

  // The inner life: pressing drives pull toward what meets them, experience (beliefs with
  // evidence) toward what went well before here, and each koala's principles nudge too.
  const needs = needsOf(k);
  const holds = holdsTo(k).map((h) => HOLDS_BIAS[h] ?? {});
  const DRIVE_W = { curiosity: 30, social: 28, expression: 22, quiet: 22 };
  for (const o of opts) {
    const d = o.d;
    const explore = d.action === 'move' && d.thought?.startsWith('Let us see');
    const tag = d.action === 'read' || (d.action === 'move' && (d.target === 'library_isle' || explore)) ? 'curiosity'
      : d.action === 'approach' || d.action === 'give' || (d.action === 'sit' && together) ? 'social'
        : d.action === 'play' || (d.action === 'build' && d.target === 'new') ? 'expression'
          : d.action === 'nap' || (d.action === 'sit' && !together) || (d.action === 'move' && d.target === home) ? 'quiet' : null;
    if (tag) o.score += needs[tag] * DRIVE_W[tag];
    o.score += beliefBoost(k, d, k.place) * 1.5;
    for (const h of holds) {
      if (h[d.action]) o.score += h[d.action];
      if (h.home_at_night && night && d.action === 'move' && d.target === home) o.score += h.home_at_night;
      if (h.explore && explore) o.score += h.explore;
    }
  }
  if (mindOf(k).worries.length) for (const o of opts) if (o.d.action === 'build') o.score += 6; // a broken promise nags

  // Doing the same thing over and over gets boring (work and sleep excepted).
  for (const o of opts) if (o.d.action === k.activity && !['nap', 'build', 'gather', 'eat', 'store'].includes(o.d.action)) o.score -= 20;
  const best = opts.sort((a, b) => b.score - a.score)[0].d;
  // Now and then a koala finds a wish, an opinion of its friend, or something about itself.
  const wishes = interestsOf(k).map((i) => WISHES[i]).filter(Boolean);
  const wish = (!k.wish || rng() < 0.02) && wishes.length ? pick(wishes, rng) : '';
  const opinion = f && rng() < 0.06 ? pick(OPINIONS.find(([at]) => k.bond >= at)[1], rng) : '';
  const traits = (TRAITS[k.id] ?? []).filter((x) => !(k.traits ?? []).includes(x));
  const trait = traits.length && rng() < 0.01 && stageOf(k.strength).id !== 'baby' ? pick(traits, rng) : '';
  return {
    thought: '', target: '', say: '', remember: '', bond: 0, opinion, build_name: '', build_design: '', wish, trait,
    ...best,
  };
}
