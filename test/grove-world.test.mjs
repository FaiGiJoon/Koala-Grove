import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KOALAS, PLACES, ITEMS, ACTIONS, MOODS, DECISION_SCHEMA,
  newKoala, parseDecision, applyDecision, drift, groveClock, buildPrompt, systemPrompt,
  growthOf, carryLimit, canReadAt, STAGES, START_STRENGTH, unansweredVisitorWords,
} from '../hq/grove-world.js';

const world = () => ({ koalas: Object.fromEntries(KOALAS.map((k) => [k.id, newKoala(k.id)])) });

test('two koalas with their own personas, and a grove of known places', () => {
  assert.deepEqual(KOALAS.map((k) => k.id), ['crystal', 'ruby']);
  for (const k of KOALAS) assert.ok(k.persona.length > 40);
  for (const id of ['big_gum', 'river_gum', 'blue_gum', 'pond', 'swing', 'clearing', 'hollow', 'lookout', 'flowers']) {
    assert.ok(PLACES[id], id);
    assert.equal(typeof PLACES[id].x, 'number');
  }
  assert.equal(Object.values(PLACES).filter((p) => p.tree).length, 3);
  assert.ok(ITEMS.includes('leaf'));
});

test('the decision schema names every action and mood', () => {
  assert.deepEqual(DECISION_SCHEMA.properties.action.enum, ACTIONS);
  assert.deepEqual(DECISION_SCHEMA.properties.mood.enum, MOODS);
  assert.ok(DECISION_SCHEMA.required.includes('action'));
});

test('parseDecision accepts an object and clamps text', () => {
  const k = newKoala('crystal');
  const d = parseDecision({ thought: 'x'.repeat(500), action: 'move', target: 'pond', say: ' hi ', mood: 'playful', remember: '', bond: 9, opinion: 'nice' }, k);
  assert.equal(d.action, 'move');
  assert.equal(d.target, 'pond');
  assert.equal(d.say, 'hi');
  assert.equal(d.thought.length, 200);
  assert.equal(d.mood, 'playful');
  assert.equal(d.bond, 3);
  assert.equal(d.remember, '');
});

test('parseDecision finds JSON inside prose and rejects garbage', () => {
  const k = newKoala('ruby');
  const d = parseDecision('Sure! {"action":"nap","say":"","mood":"sleepy"} done', k);
  assert.equal(d.action, 'nap');
  assert.equal(parseDecision('no json here', k), null);
  assert.equal(parseDecision('{"action":', k), null);
  assert.equal(parseDecision(null, k), null);
  assert.equal(parseDecision([1, 2], k), null);
});

test('parseDecision repairs bad actions, targets and moods', () => {
  const k = newKoala('crystal');
  k.place = 'pond';
  assert.equal(parseDecision({ action: 'fly' }, k).action, 'sit');
  assert.equal(parseDecision({ action: 'move', target: 'mars' }, k).target, 'pond');
  assert.equal(parseDecision({ action: 'eat', target: 'pond' }, k).target, 'big_gum');
  k.place = 'blue_gum';
  assert.equal(parseDecision({ action: 'climb' }, k).target, 'blue_gum');
  assert.equal(parseDecision({ action: 'play', target: 'piano' }, k).target, 'ball');
  assert.equal(parseDecision({ action: 'sit', mood: 'furious' }, k).mood, 'content');
  // Giving needs the item in paw.
  const give = parseDecision({ action: 'give', target: 'pebble' }, k);
  assert.equal(give.action, 'sit');
  k.inventory = ['pebble'];
  assert.equal(parseDecision({ action: 'give', target: 'pebble' }, k).action, 'give');
});

test('applyDecision moves, feeds, and tells the other koala what was said', () => {
  const w = world();
  const m = w.koalas.crystal;
  const b = w.koalas.ruby;
  m.hunger = 80;
  const log = applyDecision(w, 'crystal', parseDecision({ action: 'eat', target: 'river_gum', say: 'Yum!', mood: 'happy', bond: 1, opinion: 'Ruby is sweet', remember: 'River gum leaves taste best' }, m));
  assert.equal(m.place, 'river_gum');
  assert.equal(m.activity, 'eat');
  assert.equal(m.hunger, 35);
  assert.equal(m.mood, 'happy');
  assert.equal(m.bond, 4);
  assert.equal(m.opinion, 'Ruby is sweet');
  assert.deepEqual(m.memories, ['River gum leaves taste best']);
  assert.match(b.recent.at(-1), /Crystal said: "Yum!"/);
  assert.deepEqual(log.map((e) => e.kind), ['act', 'say']);
});

test('applyDecision: approach goes to the friend, give hands over the item, nap restores energy', () => {
  const w = world();
  const m = w.koalas.crystal;
  const b = w.koalas.ruby;
  b.place = 'lookout';
  m.inventory = ['blossom'];
  applyDecision(w, 'crystal', parseDecision({ action: 'approach' }, m));
  assert.equal(m.place, 'lookout');
  applyDecision(w, 'crystal', parseDecision({ action: 'give', target: 'blossom' }, m));
  assert.deepEqual(m.inventory, []);
  assert.deepEqual(b.inventory, ['blossom']);
  assert.match(b.recent.at(-1), /gave you a blossom/);
  b.energy = 20;
  applyDecision(w, 'ruby', parseDecision({ action: 'nap' }, b));
  assert.equal(b.energy, 60);
  assert.equal(b.activity, 'nap');
});

test('memories are bounded: 10 recent events, 12 long-term notes, bond within ±100', () => {
  const w = world();
  const m = w.koalas.crystal;
  for (let i = 0; i < 40; i++) applyDecision(w, 'crystal', parseDecision({ action: 'sit', remember: `note ${i}`, bond: 3 }, m));
  assert.equal(m.recent.length, 10);
  assert.equal(m.memories.length, 12);
  assert.equal(m.memories.at(-1), 'note 39');
  assert.equal(m.bond, 100);
});

test('drift makes koalas hungrier and sleepier; napping recovers', () => {
  const k = newKoala('crystal');
  k.hunger = 10;
  k.energy = 50;
  drift(k, 10);
  assert.equal(k.hunger, 22);
  assert.equal(k.energy, 42);
  k.activity = 'nap';
  drift(k, 10);
  assert.equal(k.energy, 62);
  k.hunger = 99;
  drift(k, 100);
  assert.equal(k.hunger, 100);
});

test('groveClock runs a 20-minute day that starts in the morning', () => {
  const c0 = groveClock(0);
  assert.equal(c0.day, 1);
  assert.equal(c0.hour, 8);
  assert.equal(c0.phase, 'day');
  const night = groveClock((14 / 24) * 20 * 60000); // 8 + 14 = 22:00
  assert.equal(night.hour, 22);
  assert.equal(night.phase, 'night');
  assert.equal(groveClock(20 * 60000).day, 2);
  assert.equal(groveClock(0).label, 'Day 1 · 08:00');
});

test('the prompt carries needs, the friend, memories and the place ids', () => {
  const w = world();
  w.koalas.crystal.recent = ['Ruby said: "hello"'];
  w.koalas.crystal.memories = ['The pond has frogs'];
  w.koalas.ruby.place = 'pond';
  const p = buildPrompt(w, 'crystal', groveClock(0));
  assert.match(p, /Ruby/);
  assert.match(p, /Ruby said: "hello"/);
  assert.match(p, /The pond has frogs/);
  assert.match(p, /big_gum/);
  assert.match(p, /Day 1 · 08:00/);
  assert.match(systemPrompt('ruby'), /Ruby/);
  assert.match(systemPrompt('ruby'), /JSON/);
  // Memories are for what is new; otherwise every turn re-saves the same moment.
  assert.match(systemPrompt('ruby'), /Leave remember empty unless/);
  assert.match(buildPrompt(w, 'crystal', groveClock(0)), /Things you remember/);
});

test('system prompt tells a koala what it really can do, so it answers a visitor honestly', () => {
  const none = systemPrompt('ruby');
  assert.match(none, /answer it out loud/);
  assert.match(none, /not on GitHub/);
  assert.match(none, /only when the grove has tokens to spend/);
  assert.doesNotMatch(none, /written down on the grove's GitHub/);
  const full = systemPrompt('ruby', null, { github: true, web: true });
  assert.match(full, /written down on the grove's GitHub, once a day/);
  assert.doesNotMatch(full, /not on GitHub/);
  assert.doesNotMatch(full, /only when the grove has tokens/);
});

test('Crystal is a girl and Ruby a boy, both told so in their prompts', () => {
  assert.deepEqual(KOALAS.map((k) => [k.id, k.gender]), [['crystal', 'girl'], ['ruby', 'boy']]);
  assert.match(systemPrompt('crystal'), /Ruby, a boy \(he\/him\)/);
  assert.match(systemPrompt('ruby'), /Crystal, a girl \(she\/her\)/);
  assert.match(KOALAS[0].persona, /pink scarf/);
  assert.match(KOALAS[1].persona, /small blue hat/);
});

test('both koalas start as small, weak babies', () => {
  for (const k of KOALAS) {
    const n = newKoala(k.id);
    const g = growthOf(n);
    assert.equal(n.strength, START_STRENGTH);
    assert.equal(g.stage, 'baby');
    assert.ok(g.size < 0.6, `size ${g.size}`);
    assert.equal(g.carry, 2);
    assert.ok(g.reach < 0.4, `reach ${g.reach}`);
    assert.match(buildPrompt(world(), k.id, groveClock(0)), /You are a baby, strength 5 of 100 \(a joey at 20\)/);
  }
});

test('growth: size, carrying and climbing reach rise with strength and top out at fully grown', () => {
  let last = { size: 0, carry: 0, reach: 0 };
  for (const s of [0, 20, 45, 75, 100]) {
    const k = { ...newKoala('crystal'), strength: s };
    const g = growthOf(k);
    assert.ok(g.size > last.size || s === 0, `size at ${s}`);
    assert.ok(g.carry >= last.carry && g.reach >= last.reach);
    last = g;
  }
  assert.equal(last.size, 1);
  assert.equal(last.carry, 4);
  assert.equal(last.reach, 1);
  assert.equal(last.nextStage, null);
  assert.equal(last.stage, 'grown');
  assert.deepEqual(STAGES.map((s) => s.id), ['baby', 'joey', 'youngster', 'grown']);
});

test('climbing, playing, eating and napping make a koala stronger; sitting does not', () => {
  const w = world();
  const m = w.koalas.crystal;
  const run = (d) => applyDecision(w, 'crystal', parseDecision(d, m));
  const gained = (d) => {
    const before = m.strength;
    run(d);
    return m.strength - before;
  };
  assert.equal(gained({ action: 'sit' }), 0);
  const climb = gained({ action: 'climb', target: 'big_gum' });
  const play = gained({ action: 'play', target: 'ball' });
  const eat = gained({ action: 'eat', target: 'big_gum' });
  const nap = gained({ action: 'nap' });
  assert.ok(climb > play && play > eat && eat > nap && nap > 0, [climb, play, eat, nap].join(' '));
  m.strength = 100;
  assert.equal(gained({ action: 'climb', target: 'big_gum' }), 0, 'capped at 100');
});

test('a stage change is logged and remembered, once', () => {
  const w = world();
  const m = w.koalas.crystal;
  m.strength = 19.5;
  const log = applyDecision(w, 'crystal', parseDecision({ action: 'climb', target: 'big_gum' }, m));
  assert.equal(growthOf(m).stage, 'joey');
  const grew = log.filter((e) => e.kind === 'grow');
  assert.equal(grew.length, 1);
  assert.equal(grew[0].text, 'Crystal grew into a joey!');
  assert.match(m.recent.at(-1), /You feel stronger. You are a joey now!/);
  assert.match(w.koalas.ruby.recent.at(-1), /Crystal has grown into a joey/);
  const again = applyDecision(w, 'crystal', parseDecision({ action: 'climb', target: 'big_gum' }, m));
  assert.equal(again.filter((e) => e.kind === 'grow').length, 0);
});

test('babies tire faster than grown koalas and scramble instead of climbing', () => {
  const w = world();
  const baby = w.koalas.crystal;
  const grown = w.koalas.ruby;
  grown.strength = 100;
  baby.energy = grown.energy = 80;
  applyDecision(w, 'crystal', parseDecision({ action: 'play', target: 'ball' }, baby));
  applyDecision(w, 'ruby', parseDecision({ action: 'play', target: 'ball' }, grown));
  assert.ok(80 - baby.energy > 80 - grown.energy, `${baby.energy} vs ${grown.energy}`);
  const log = applyDecision(w, 'crystal', parseDecision({ action: 'climb', target: 'river_gum' }, baby));
  assert.match(log[0].text, /scrambled a little way up the River Gum/);
  const big = applyDecision(w, 'ruby', parseDecision({ action: 'climb', target: 'river_gum' }, grown));
  assert.match(big[0].text, /climbed the River Gum/);
});

test('a baby cannot be handed more than it can carry', () => {
  const w = world();
  const m = w.koalas.crystal;
  const b = w.koalas.ruby;
  m.inventory = ['leaf'];
  b.inventory = ['pebble', 'ball'];
  applyDecision(w, 'crystal', parseDecision({ action: 'give', target: 'leaf' }, m));
  assert.deepEqual(b.inventory, ['pebble', 'ball'], 'paws full: the leaf stays out');
  assert.equal(carryLimit(70), 4);
});

test('prompts stay short: recent memories and events are trimmed', () => {
  const w = world();
  const k = w.koalas.crystal;
  k.recent = Array.from({ length: 10 }, (_, i) => `event ${i}`);
  k.memories = Array.from({ length: 12 }, (_, i) => `memory ${i}`);
  const p = buildPrompt(w, 'crystal', groveClock(0));
  assert.doesNotMatch(p, /- event 3\n/);
  assert.match(p, /- event 4\n/);
  assert.doesNotMatch(p, /- memory 3\n/);
  assert.match(p, /- memory 4\n/);
  assert.ok(p.length < 3200, `prompt is ${p.length} characters`);
});

test('a third koala hears what is said and shows up in the others\' prompts', async () => {
  const { MAX_KOALAS, others } = await import('../hq/grove-world.js');
  assert.equal(MAX_KOALAS, 4);
  const w = world();
  w.koalas.pip = { ...newKoala('crystal'), id: 'pip', name: 'Pip', follows: 'crystal', parents: ['crystal', 'ruby'] };
  assert.deepEqual(others(w, 'ruby').map((k) => k.id).sort(), ['crystal', 'pip']);
  applyDecision(w, 'ruby', parseDecision({ action: 'sit', say: 'Good morning!' }, w.koalas.ruby));
  assert.match(w.koalas.crystal.recent.at(-1), /Ruby said: "Good morning!"/);
  assert.match(w.koalas.pip.recent.at(-1), /Ruby said: "Good morning!"/);
  const p = buildPrompt(w, 'ruby', groveClock(0));
  assert.match(p, /Crystal is at/);
  assert.match(p, /Pip/);
});

test('review: a grown child is never offered a nest with its parent', async () => {
  const { canNest } = await import('../hq/grove-family.js');
  const w = world();
  w.koalas.pip = { ...newKoala('crystal'), id: 'pip', name: 'Pip', parents: ['crystal', 'ruby'], follows: null };
  for (const id of ['crystal', 'pip']) Object.assign(w.koalas[id], { strength: 80, bond: 90, place: 'hollow' });
  assert.equal(canNest(w, 'pip', 'crystal').ok, false);
  assert.doesNotMatch(buildPrompt(w, 'pip', groveClock(0)), /nest \(with/);
});

test('review: a gift to a friend with full paws stays with the giver', () => {
  const w = world();
  w.koalas.crystal.inventory = ['pebble'];
  w.koalas.ruby.inventory = ['leaf', 'ball']; // a baby holds 2
  applyDecision(w, 'crystal', parseDecision({ action: 'give', target: 'pebble' }, w.koalas.crystal));
  assert.deepEqual(w.koalas.crystal.inventory, ['pebble']);
  assert.deepEqual(w.koalas.ruby.inventory, ['leaf', 'ball']);
  assert.equal(w.koalas.crystal.activity, 'sit');
  assert.match(w.koalas.crystal.recent.join(' '), /paws are full/);
  assert.doesNotMatch(w.koalas.ruby.recent.join(' '), /gave you/);
});

test('read: a topic, capped at 80 characters; empty sits', () => {
  assert.ok(ACTIONS.includes('read'));
  const k = newKoala('crystal');
  assert.equal(parseDecision({ action: 'read', target: 'x'.repeat(200) }, k).target.length, 80);
  assert.equal(parseDecision({ action: 'read', target: '  ' }, k).action, 'sit');
});

test('canReadAt: Library Isle and finished book-ish builds only', () => {
  const w = world();
  w.builds = [
    { id: 1, kind: 'reading_nook', title: 'Nook', plot: 'plot_a', done: true },
    { id: 2, kind: 'custom', title: 'Story Hut', plot: 'plot_b', done: true },
    { id: 3, kind: 'custom', title: 'x', spec: { design: 'a shelf of books' }, plot: 'plot_c', done: true },
    { id: 4, kind: 'reading_nook', title: 'Unfinished', plot: 'plot_d', done: false },
    { id: 5, kind: 'bench', title: 'Bench', plot: 'plot_e', done: true },
  ];
  assert.ok(canReadAt(w, 'library_isle'));
  for (const p of ['plot_a', 'plot_b', 'plot_c']) assert.ok(canReadAt(w, p), p);
  for (const p of ['plot_d', 'plot_e', 'pond']) assert.ok(!canReadAt(w, p), p);
});

test('read: costs energy like play, is described, and the prompt offers it and lists what was learned', () => {
  const w = world();
  const k = w.koalas.crystal;
  k.place = 'library_isle';
  k.learned = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const before = k.energy;
  const log = applyDecision(w, 'crystal', parseDecision({ action: 'read', target: 'frogs' }, k));
  assert.ok(k.energy < before);
  assert.match(log[0].text, /opened a book about "frogs"/);
  const p = buildPrompt(w, 'crystal', { label: 'Mon 10:00', phase: 'morning' });
  assert.match(p, /The library is on Library Isle \(library_isle\), across the bridge from the grove/);
  assert.match(p, /read \(target: a topic/);
  assert.match(p, /research \(target/);
  assert.match(p, /Things you learned:\n- b\n- c\n- d\n- e\n- f\n- g/);
  w.koalas.ruby.place = 'pond';
  assert.doesNotMatch(buildPrompt(w, 'ruby', { label: 'x', phase: 'y' }), /read \(target/);
});

test('founders have their own interests; the system prompt names them and the wish field', () => {
  const crystal = KOALAS.find((k) => k.id === 'crystal');
  const ruby = KOALAS.find((k) => k.id === 'ruby');
  assert.deepEqual(crystal.interests, ['brave explorers', 'shiny stones and crystals', 'stars', 'faraway places']);
  assert.deepEqual(ruby.interests, ['sleepy animals', 'eucalyptus and plants', 'poems', 'the moon and night']);
  const sys = systemPrompt('crystal', world());
  assert.match(sys, /You have your own mind and your own life\. You are curious about: brave explorers, shiny stones and crystals, stars, faraway places\./);
  assert.match(sys, /Follow your curiosity: visit the library to read or look things up, then talk about what you learned and let it inspire what you build\./);
  assert.match(sys, /wish/);
  const w = world();
  w.koalas.pip = { ...newKoala('crystal'), id: 'pip', name: 'Pip', gender: 'girl', persona: 'Pip is small.', interests: ['frogs', 'mud'], parents: ['crystal', 'ruby'] };
  assert.match(systemPrompt('pip', w), /curious about: frogs, mud\./);
});

test('wish is a required schema field, stored when non-empty, kept when empty, and shown in the prompt', () => {
  assert.ok(DECISION_SCHEMA.required.includes('wish'));
  assert.equal(DECISION_SCHEMA.properties.wish.type, 'string');
  const w = world();
  const m = w.koalas.crystal;
  assert.match(buildPrompt(w, 'crystal', groveClock(0)), /You have no wish yet\./);
  const log = applyDecision(w, 'crystal', parseDecision({ action: 'sit', wish: 'Build a tower to touch the stars' }, m));
  assert.equal(m.wish, 'Build a tower to touch the stars');
  assert.ok(log.some((e) => e.kind === 'wish' && e.text === 'Crystal wishes: Build a tower to touch the stars'));
  assert.equal(log[0].kind, 'act');
  assert.match(buildPrompt(w, 'crystal', groveClock(0)), /Your wish: "Build a tower to touch the stars"/);
  const same = applyDecision(w, 'crystal', parseDecision({ action: 'sit', wish: 'Build a tower to touch the stars' }, m));
  assert.ok(!same.some((e) => e.kind === 'wish'));
  applyDecision(w, 'crystal', parseDecision({ action: 'sit', wish: '' }, m));
  assert.equal(m.wish, 'Build a tower to touch the stars');
  assert.equal(parseDecision({ action: 'sit', wish: 'x'.repeat(300) }, m).wish.length, 120);
});

test('a visitor question is put in front of the koala until it answers', () => {
  const w = world();
  const k = w.koalas.ruby;
  k.recent = ['You sat and looked around.'];
  assert.equal(unansweredVisitorWords(k), null);
  assert.doesNotMatch(buildPrompt(w, 'ruby', groveClock(0)), /IS WAITING/);
  k.recent.push('The visitor said: "Ruby, have you used your GitHub yet?"');
  assert.equal(unansweredVisitorWords(k), 'Ruby, have you used your GitHub yet?');
  assert.match(buildPrompt(w, 'ruby', groveClock(0)), /IS WAITING\. They just said to you: "Ruby, have you used your GitHub yet\?"/);
  k.recent.push('You said: "Not yet, Crystal. I do not know what GitHub is."');
  assert.equal(unansweredVisitorWords(k), null);
  assert.doesNotMatch(buildPrompt(w, 'ruby', groveClock(0)), /IS WAITING/);
});
