// The grove's panels: top bar with Play/Pause and the real-spend chips, the side
// panel (Koalas, Talk, Meter), the inspector card with the visitor's actions, and
// the event feed. Model text is always inserted as text, never as HTML.

import { fmtUsd, fmtTokens, statusOf, stockText, panelStartsCollapsed } from './view.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ICON = (id) => `<svg class="ico" aria-hidden="true"><use href="#${id}"/></svg>`;
const ITEM_ICON = { leaf: 'i-leaf', blossom: 'i-blossom', pebble: 'i-pebble', ball: 'i-ball', feather: 'i-feather' };
const DOING = {
  move: 'looking around', eat: 'munching eucalyptus', nap: 'napping', play: 'playing', climb: 'up the tree',
  approach: 'keeping company', give: 'sharing', build: 'building', gather: 'gathering', store: 'stocking up', research: 'reading', read: 'reading a book', file_ticket: 'writing a ticket', nest: 'nesting', sit: 'sitting',
};
const LOG_CLASS = { say: 'say', think: 'think', act: 'act', visitor: 'visitor', error: 'error', system: 'system', grow: 'grow', built: 'grow', land: 'grow', ticket: 'ticket', learn: 'grow', wish: 'grow' };

export function createUI({ scene, api }) {
  let state = null;
  let selected = null;
  let tab = 'koalas';
  let clockOffset = 0;
  let introDismissed = false;
  let busy = false;
  const name = (id) => state?.koalas.find((k) => k.id === id)?.name ?? id;

  // --- top bar -------------------------------------------------------------------------
  const intro = $('#intro');
  const playBtn = $('#play');
  playBtn.addEventListener('click', async () => {
    if (!state || busy) return;
    introDismissed = true; // pressing Play is answer enough for the welcome card
    intro.hidden = true;
    busy = true;
    playBtn.disabled = true;
    try {
      await (state.playing ? api.pause() : api.play());
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
      playBtn.disabled = false;
    }
  });
  // two cameras, both at ground level: first person (your own eyes, no body) and third person
  const modeBtn = $('#mode');
  const setMode = (m) => {
    scene.setCamera(m);
    modeBtn.innerHTML = m === 'first' ? `${ICON('i-eye')}<span class="lbl">First person</span>` : `${ICON('i-walk')}<span class="lbl">Third person</span>`;
    modeBtn.title = m === 'first' ? 'Switch to third person (V)' : 'Switch to first person (V)';
    $('#hint').textContent = m === 'first'
      ? 'Drag to look · WASD or tap the grass to walk · E or tap a koala · V for third person'
      : 'WASD or tap the grass to walk · drag to look around · E or tap a koala · V for first person';
  };
  modeBtn.addEventListener('click', () => setMode(scene.cam === 'first' ? 'third' : 'first'));
  setMode('third');

  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, button')) return;
    const k = e.key.toLowerCase();
    if (k === 'v') setMode(scene.cam === 'first' ? 'third' : 'first');
    if (k === 'escape') {
      select(null);
      pop.hidden = true;
      timePop.hidden = true;
    }
    if (k === 'e') {
      const me = scene.visitor.root.position;
      let best = null;
      for (const [id, v] of scene.koalas) {
        const d = Math.hypot(v.pos.x - me.x, v.pos.z - me.z);
        if (d < 4.5 && (!best || d < best.d)) best = { id, d };
      }
      if (best) select(best.id);
      else toast('Walk closer to a koala first.');
    }
  });

  // --- naming a newborn ----------------------------------------------------------------
  const nameForm = $('#name-baby');
  let naming = null;
  const asked = new Set();
  nameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#baby-name');
    try {
      await api.name(naming, input.value.trim());
      toast(`Welcome to the grove, ${input.value.trim()}!`);
      nameForm.hidden = true;
    } catch (err) {
      toast(err.message);
    }
  });
  function offerName() {
    const baby = state.koalas.find((k) => k.parents && !k.named && !asked.has(k.id));
    if (!baby || !nameForm.hidden) return;
    naming = baby.id;
    asked.add(baby.id);
    const [m, d] = baby.parents.map(name);
    nameForm.querySelector('.fine').textContent = `${m} and ${d} have a little ${baby.gender === 'boy' ? 'boy' : 'girl'}. For now ${baby.gender === 'boy' ? 'he' : 'she'} is called ${baby.name}.`;
    $('#baby-name').value = baby.name;
    nameForm.hidden = false;
    $('#baby-name').select();
  }

  // --- time of day ---------------------------------------------------------------------
  const timePop = $('#time-pop');
  const timeBtn = $('#time-btn');
  const timeOf = (c) => (c.phase === 'night' ? 'night' : c.phase === 'dusk' ? 'evening' : c.hour < 11 ? 'morning' : 'noon');
  timeBtn.addEventListener('click', () => {
    timePop.hidden = !timePop.hidden;
    timeBtn.setAttribute('aria-expanded', String(!timePop.hidden));
  });
  for (const b of timePop.querySelectorAll('[data-time]')) {
    b.addEventListener('click', async () => {
      timePop.hidden = true;
      timeBtn.setAttribute('aria-expanded', 'false');
      try {
        const s = await api.time(b.dataset.time);
        toast(`It is ${b.dataset.time} in the grove: ${s.clock.label}`);
      } catch (err) {
        toast(err.message);
      }
    });
  }
  addEventListener('pointerdown', (e) => {
    if (!timePop.hidden && !e.target.closest('#time-pop, #time-btn')) {
      timePop.hidden = true;
      timeBtn.setAttribute('aria-expanded', 'false');
    }
  });

  // --- brain: instinct, hybrid or Claude ----------------------------------------------------
  const brainPop = $('#brain-pop');
  const brainBtn = $('#brain-btn');
  const BRAIN_NAMES = { local: 'Instinct', hybrid: 'Hybrid', claude: 'Claude' };
  const BRAIN_NOTES = {
    local: 'Instinct: the koalas decide on their own, right here on your computer. No tokens at all, and they keep living 24/7 with this page closed.',
    hybrid: 'Hybrid: instinct for everyday things, a real model call when someone talks to a koala (and now and then otherwise), only while a page is open. Closed page or cap reached: instinct, for free.',
    claude: 'Claude: every decision is a real model call, only while a page is open, up to the daily cap.',
  };
  function markBrain() {
    const mode = state?.brain?.mode ?? 'claude';
    for (const b of brainPop.querySelectorAll('[data-brain]')) b.setAttribute('aria-pressed', String(b.dataset.brain === mode));
    $('#brain-note').textContent = BRAIN_NOTES[mode];
    brainBtn.textContent = `Brain: ${BRAIN_NAMES[mode]}`;
  }
  brainBtn.addEventListener('click', () => {
    brainPop.hidden = !brainPop.hidden;
    brainBtn.setAttribute('aria-expanded', String(!brainPop.hidden));
    markBrain();
  });
  for (const b of brainPop.querySelectorAll('[data-brain]')) {
    b.addEventListener('click', async () => {
      try {
        await api.brain(b.dataset.brain);
        const short = { local: 'free, 24/7', hybrid: 'free, plus model calls while you watch', claude: 'real model calls' };
        toast(`Brain: ${BRAIN_NAMES[b.dataset.brain]} (${short[b.dataset.brain]}).`);
      } catch (err) {
        toast(err.message);
      }
    });
  }
  addEventListener('pointerdown', (e) => {
    if (!brainPop.hidden && !e.target.closest('#brain-pop, #brain-btn')) {
      brainPop.hidden = true;
      brainBtn.setAttribute('aria-expanded', 'false');
    }
  });

  // --- graphics settings ---------------------------------------------------------------
  const pop = $('#settings-pop');
  const gear = $('#settings');
  const fpsEl = $('#fps');
  const describe = () => `Drawing at ${scene.tier} quality${scene.scale < 1 ? `, ${Math.round(scene.scale * 100)}% resolution` : ''}.`;
  function markQuality() {
    for (const b of pop.querySelectorAll('[data-q]')) b.setAttribute('aria-pressed', String(b.dataset.q === scene.pref));
    $('#q-now').textContent = scene.pref === 'auto' ? `Auto: ${describe()}` : describe();
  }
  gear.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    gear.setAttribute('aria-expanded', String(!pop.hidden));
    markQuality();
  });
  for (const b of pop.querySelectorAll('[data-q]')) {
    b.addEventListener('click', () => {
      scene.setQuality(b.dataset.q);
      markQuality();
    });
  }
  $('#fps-toggle').addEventListener('change', (e) => (fpsEl.hidden = !e.target.checked));
  addEventListener('pointerdown', (e) => {
    if (!pop.hidden && !e.target.closest('#settings-pop, #settings')) {
      pop.hidden = true;
      gear.setAttribute('aria-expanded', 'false');
    }
  });
  scene.onTierChange = ({ tier, scale, from }) => {
    markQuality();
    toast(`Smoothing the picture: ${tier} quality${scale < 1 ? `, ${Math.round(scale * 100)}% resolution` : ''}`);
  };

  // --- side panel ----------------------------------------------------------------------
  for (const b of document.querySelectorAll('#tabs button')) {
    b.addEventListener('click', () => {
      tab = b.dataset.tab;
      for (const x of document.querySelectorAll('#tabs button')) x.classList.toggle('on', x === b);
      for (const s of document.querySelectorAll('.tab-body')) s.hidden = s.id !== `tab-${tab}`;
      draw();
    });
  }
  // on mid-width screens the grove comes first: the panel starts tucked away
  if (panelStartsCollapsed(innerWidth)) {
    $('#panel').classList.add('collapsed');
    scene.resize();
  }
  $('#panel-toggle').addEventListener('click', () => {
    $('#panel').classList.toggle('collapsed');
    scene.resize();
  });

  // --- inspector -----------------------------------------------------------------------
  const insp = $('#inspector');
  insp.innerHTML = `
    <div class="head">
      <div class="avatar"></div>
      <div><div class="iname"></div><div class="state"></div></div>
      <button class="close" type="button" title="Close (Esc)">×</button>
    </div>
    <div class="thought"></div>
    <div class="said"></div>
    <div class="needs"></div>
    <details class="inner"><summary>Inside</summary><div class="needs drives"></div><ul class="inner-notes"></ul></details>
    <div class="give" role="group" aria-label="Give an item"></div>
    <form class="talk">
      <input maxlength="140" placeholder="Say something to the koala" aria-label="Say something">
      <button class="btn" type="submit">Say</button>
      <button class="btn ghost pat" type="button">Pat</button>
    </form>
    <div class="cost-note">Giving, saying and patting are free. The koala reacts on its next decision (a real model call only on the Hybrid or Claude brain).</div>`;
  insp.querySelector('.close').addEventListener('click', () => select(null));
  const give = insp.querySelector('.give');
  for (const item of Object.keys(ITEM_ICON)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'item';
    b.title = `Give a ${item}`;
    b.innerHTML = `${ICON(ITEM_ICON[item])}<span>${item}</span>`;
    b.addEventListener('click', () => act({ kind: 'give', item }, `Gave ${name(selected)} a ${item}.`));
    give.append(b);
  }
  const form = insp.querySelector('.talk');
  const input = form.querySelector('input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return input.focus();
    act({ kind: 'say', text }, null).then((ok) => { if (ok) input.value = ''; });
  });
  insp.querySelector('.pat').addEventListener('click', () => act({ kind: 'pet' }, `You patted ${name(selected)}.`));

  async function act(body, done) {
    if (!selected) return false;
    scene.visit(selected);
    try {
      await api.act({ koala: selected, ...body });
      if (done) toast(done);
      return true;
    } catch (err) {
      toast(err.message);
      return false;
    }
  }

  function select(id) {
    selected = id;
    scene.select(id);
    insp.hidden = !id;
    drawInspector();
  }
  scene.onPick = (id) => select(id);

  // --- intro ---------------------------------------------------------------------------
  $('#intro-play').addEventListener('click', async () => {
    introDismissed = true;
    intro.hidden = true;
    try { await api.play(); } catch (err) { toast(err.message); }
  });
  $('#intro-look').addEventListener('click', () => {
    introDismissed = true;
    intro.hidden = true;
  });

  // --- feed and toast ------------------------------------------------------------------
  const feed = $('#feed');
  function onLog(e) {
    if (e.kind === 'think' || e.kind === 'remember') return;
    const el = document.createElement('div');
    el.className = `ev ${LOG_CLASS[e.kind] ?? ''}`;
    const who = e.koala ? state?.koalas.find((k) => k.id === e.koala) : null;
    el.style.setProperty('--c', e.kind === 'error' ? 'var(--red)' : e.kind === 'visitor' ? 'var(--mint)' : who?.color ?? 'var(--muted)');
    el.textContent = e.kind === 'say' ? `${who?.name ?? ''}: “${e.text}”` : e.text;
    feed.prepend(el);
    while (feed.children.length > 5) feed.lastChild.remove();
    setTimeout(() => el.remove(), 14000);
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  // --- drawing -------------------------------------------------------------------------
  function bar(v, color) {
    return `<div class="bar"><i style="width:${Math.round(v)}%;background:${color}"></i></div>`;
  }
  function bondBar(v) {
    const left = v < 0 ? 50 + v / 2 : 50;
    const w = Math.abs(v) / 2;
    return `<div class="bond"><i style="left:${left}%;width:${w}%;background:${v < 0 ? 'var(--red)' : 'var(--mint)'}"></i><b></b></div>`;
  }
  const where = (k) => state.places[k.place]?.name ?? k.place;
  // "Baby, strength 5 of 100. Next: joey at 20. Climbs a third of a tree, holds 2." in a few words.
  const growthLine = (k) => `${esc(k.stageLabel)}, strength ${Math.round(k.strength)}/100${k.nextStage ? `, ${esc(k.nextStage.label.toLowerCase())} at ${k.nextStage.at}` : ', fully grown'}. `
    + `Climbs ${Math.round(k.reach * 100)}% of a tree, holds ${k.carry}.`;
  function nextIn(k) {
    if (k.thinking) return 'thinking now';
    if (!state.playing || (state.capped && state.brain?.mode === 'claude') || k.nextAt == null) return 'resting';
    const s = Math.max(0, Math.round((k.nextAt - (Date.now() + clockOffset)) / 1000));
    return s ? `decides in ${s} s` : 'deciding soon';
  }

  function drawKoalas() {
    const friend = (k) => state.koalas.find((o) => o.id !== k.id);
    $('#tab-koalas').innerHTML = state.koalas.map((k) => `
      <article class="kcard" style="--c:${k.color}" data-id="${esc(k.id)}">
        <div class="khead">
          <span class="dot"></span><b>${esc(k.name)}</b><span class="stage">${esc(k.stageLabel)}</span><span class="mood">${esc(k.mood)}</span>
          <span class="next" data-next="${esc(k.id)}">${esc(nextIn(k))}</span>
        </div>
        <div class="doing">${esc(DOING[k.activity] ?? k.activity)} at the ${esc(where(k))}</div>
        ${k.thought ? `<div class="thought">${esc(k.thought)}</div>` : ''}
        <div class="needs2">
          <label>Hunger</label>${bar(k.hunger, 'var(--orange)')}
          <label>Energy</label>${bar(k.energy, 'var(--mint)')}
          <label>Strength</label>${bar(k.strength, 'var(--gold)')}
          <label>Bond</label>${bondBar(k.bond)}
        </div>
        <div class="holds">${growthLine(k)}</div>
        <div class="opinion">${k.opinion ? `On ${esc(friend(k).name)}: “${esc(k.opinion)}”` : `No opinion of ${esc(friend(k).name)} yet.`}</div>
        <div class="holds">Holding: ${k.inventory.length ? k.inventory.map(esc).join(', ') : 'nothing'}</div>
        <div class="holds">${k.wish ? `Wish: “${esc(k.wish)}”` : 'No wish yet.'}</div>
        <div class="holds mind">${esc(k.wisdomLabel ?? 'Curious baby')} · wisdom ${Math.round(k.wisdom ?? 0)}${k.nextWisdom ? ` (${esc(k.nextWisdom.label)} at ${k.nextWisdom.at})` : ''}</div>
        ${(k.traits ?? []).length ? `<div class="holds">Personality: ${k.traits.map(esc).join(' · ')}</div>` : ''}
        ${(k.curiosities ?? []).length ? `<div class="holds">Wonders about: ${k.curiosities.map(esc).join(', ')}</div>` : ''}
        <details><summary>Learned (${(k.learned ?? []).length})</summary>
          <ul>${(k.learned ?? []).map((m) => `<li>${esc(m)}</li>`).join('') || '<li class="muted">Nothing yet. Koalas learn at the library.</li>'}</ul>
        </details>
        <details ${k.memories.length ? 'open' : ''}><summary>Remembers (${k.memories.length})</summary>
          <ul>${k.memories.map((m) => `<li>${esc(m)}</li>`).join('') || '<li class="muted">Nothing yet. Memories form as the koalas live.</li>'}</ul>
        </details>
        <details><summary>Noticed lately</summary><ul>${k.recent.map((m) => `<li>${esc(m)}</li>`).join('') || '<li class="muted">Nothing yet.</li>'}</ul></details>
      </article>`).join('');
    for (const card of document.querySelectorAll('.kcard')) card.addEventListener('click', (e) => {
      if (!e.target.closest('details')) select(card.dataset.id);
    });
  }

  // What the koalas are building, what stands, and when the next land rises.
  function drawBuilds() {
    const builds = state.builds ?? [];
    const open = builds.filter((b) => !b.done);
    const done = builds.filter((b) => b.done);
    const risen = (state.lands ?? []).filter((l) => l.risen);
    const next = (state.lands ?? []).find((l) => !l.risen);
    const who = (b) => b.helpers.map(name).join(' and ');
    const card = (b) => `
      <div class="bcard${b.done ? ' done' : ''}">
        <div class="bhead"><b>${esc(b.title)}</b><span>${esc(b.kind === 'custom' ? 'Own invention' : state.blueprints?.[b.kind]?.name ?? b.kind)}</span></div>
        ${b.kind === 'custom' && b.spec?.design ? `<div class="bmeta">${esc(b.spec.design)}</div>` : ''}
        ${b.done ? '' : `<div class="bar"><i style="width:${Math.round((b.progress / b.effort) * 100)}%;background:var(--warm)"></i></div>`}
        <div class="bmeta">${b.done ? 'Built' : `${b.progress} of ${b.effort} steps`} by ${esc(who(b))}, at the ${esc(state.places[b.plot]?.name ?? b.plot)}</div>
      </div>`;
    const toNext = next ? 2 - (done.length % 2) : 0;
    const stock = state.stock ?? {};
    const cost = (c) => Object.entries(c ?? {}).map(([r, n]) => `${n} ${r}`).join(', ');
    $('#tab-builds').innerHTML = `
      <p class="empty">The koalas decide for themselves what to build and what to call it. Each build is paid for from the Stockpile, and building together goes twice as fast.</p>
      <h3>Stockpile</h3>
      <div class="stock">${['wood', 'water', 'sand', 'stone', 'book'].map((r) => `<span class="res res-${r}"><i></i>${stock[r] ?? 0} ${r === 'book' ? 'books' : r}</span>`).join('')}</div>
      <h3>Islands</h3>
      <div class="rows">${(state.islands ?? []).map((i) => `<div class="row islandrow"><div class="name"><span class="res res-${i.resource}"><i></i></span>${esc(i.name)}</div>
        <div class="meta">${i.bridged ? 'bridged' : 'needs a bridge: 4 wood, 2 stone'}</div></div>`).join('')}</div>
      <h3>Going up</h3>
      ${open.length ? open.map(card).join('') : '<p class="empty">Nothing is being built right now.</p>'}
      <h3>Built (${done.length})</h3>
      ${done.length ? done.map(card).join('') : '<p class="empty">Nothing yet. Their first build will appear here and in the grove.</p>'}
      <h3>The grove</h3>
      <p class="lastcall">${risen.length ? `New land so far: ${risen.map((l) => esc(l.name)).join(', ')}.` : 'Just the island for now.'}
        ${next ? `${esc(next.name)} rises from the water after ${toNext} more finished build${toNext === 1 ? '' : 's'}.` : 'All the new land has risen.'}</p>
      <h3>What things cost</h3>
      <div class="costs">${Object.entries(state.blueprints ?? {}).filter(([id]) => !id.startsWith('bridge_')).map(([id, bp]) => `<div><b>${esc(bp.name)}</b><span>${esc(cost(state.costs?.[id]))}</span></div>`).join('')}${['small', 'medium', 'big'].map((size) => `<div><b>Your own invention — ${size}</b><span>${esc(cost(state.customCosts?.[size]?.cost))}</span></div>`).join('')}</div>`;
  }

  // Tickets the koalas wrote for you, with a reply box and a close button each.
  function drawTickets() {
    const body = $('#tab-tickets');
    if (body.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return; // don't wipe a reply being typed
    const list = state.tickets ?? [];
    body.innerHTML = `<p class="empty">When the koalas hit a problem they can't solve, they write it down for you. Your answer reaches them on their next decision.</p>`
      + (list.length ? list.map((t) => `
      <article class="tcard ${t.status}" data-id="${t.id}">
        <div class="thead"><b>${esc(name(t.koala))}</b><span>${t.status === 'open' ? 'waiting for you' : 'answered'}</span></div>
        <p class="ttext">${esc(t.text)}</p>
        ${t.reply ? `<p class="treply">You: ${esc(t.reply)}</p>` : ''}
        <form class="treplyform"><textarea maxlength="300" rows="2" placeholder="Write an answer" aria-label="Answer ${esc(name(t.koala))}"></textarea>
        <div class="tbtns"><button class="btn" type="submit">${t.reply ? 'Answer again' : 'Answer'}</button><button class="btn ghost tclose" type="button">Close ticket</button></div></form>
      </article>`).join('') : '<p class="empty">No tickets right now.</p>');
    for (const card of body.querySelectorAll('.tcard')) {
      const id = Number(card.dataset.id);
      card.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = card.querySelector('textarea').value.trim();
        if (!text) return;
        try { await api.reply(id, text); toast('Answer sent.'); } catch (err) { toast(err.message); }
      });
      card.querySelector('.tclose').addEventListener('click', async () => {
        try { await api.close(id); } catch (err) { toast(err.message); }
      });
    }
  }

  function drawTalk() {
    const body = $('#tab-talk');
    const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 30;
    body.innerHTML = state.log.length ? state.log.map((e) => {
      const k = state.koalas.find((x) => x.id === e.koala);
      const time = new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const head = e.kind === 'visitor' ? 'You' : k?.name ?? 'Grove';
      return `<div class="line ${LOG_CLASS[e.kind] ?? ''}" style="--c:${k?.color ?? 'var(--muted)'}">
        <span class="t">${time}</span><b>${esc(head)}</b><span class="x">${esc(e.kind === 'say' ? `“${e.text}”` : e.text)}</span></div>`;
    }).join('') : '<p class="empty">Nothing has happened yet. Press Play and the koalas start deciding for themselves.</p>';
    if (atEnd) body.scrollTop = body.scrollHeight;
  }

  function drawMeter() {
    const u = state.usage;
    const pct = Math.min(100, (u.today.cost / u.dayUsd) * 100);
    const avg = u.total.calls ? u.total.cost / u.total.calls : 0;
    const row = (k) => {
      const b = u.byKoala[k.id];
      return `<div class="row real" style="--c:${k.color}">
        <div class="name"><span class="dot" style="background:${k.color}"></span>${esc(k.name)}</div>
        <div class="meta">${fmtUsd(b.today.cost)} today</div>
        <div class="sub">${b.today.calls} calls, ${fmtTokens(b.today.tokens_in)} in, ${fmtTokens(b.today.tokens_out)} out</div>
        <div class="meta">${fmtUsd(b.total.cost)} all time</div>
      </div>`;
    };
    const last = u.last;
    const free = state.brain?.free ?? { today: 0, total: 0 };
    const mode = state.brain?.mode ?? 'claude';
    $('#tab-meter').innerHTML = `
      <div class="disclaimer real-note">${mode === 'local'
        ? 'The koalas are on instinct: every decision is made here, on your computer, and costs nothing. The real usage below is only from earlier model calls.'
        : `Real usage. Each model decision is one <code>claude -p</code> call on your Claude Code login,
        model <code>${esc(u.model)}</code>, at most ${fmtUsd(u.callUsd)} per call. The numbers come from the CLI's own result.${mode === 'hybrid' ? ' Everyday decisions are on instinct and free.' : ''}`}</div>
      ${mode !== 'claude' ? `<div class="disclaimer">${state.brain?.localModel
        ? `New library pages and the nightly diaries are written by <code>${esc(state.brain.localModel)}</code> on your computer, for free.`
        : 'Start Ollama on this computer and the koalas learn something new every day for free: new library pages and a nightly diary. Until then they read their own bookshelf.'}</div>` : ''}
      <h3>On instinct (free)</h3>
      <div class="big">
        <div class="stat"><div class="k">Free today</div><div class="v">${free.today}</div></div>
        <div class="stat"><div class="k">Free all time</div><div class="v">${free.total}</div></div>
        <div class="stat"><div class="k">Tokens</div><div class="v">0</div></div>
      </div>
      <h3>Today</h3>
      <div class="spend"><b>${fmtUsd(u.today.cost)}</b> of ${fmtUsd(u.dayUsd)} daily cap</div>
      <div class="bar cap"><i style="width:${pct}%;background:${pct >= 100 ? 'var(--red)' : 'var(--real)'}"></i></div>
      <div class="big real">
        <div class="stat"><div class="k">Model calls</div><div class="v">${u.today.calls}</div></div>
        <div class="stat"><div class="k">Tokens in</div><div class="v">${fmtTokens(u.today.tokens_in)}</div></div>
        <div class="stat"><div class="k">Tokens out</div><div class="v">${fmtTokens(u.today.tokens_out)}</div></div>
      </div>
      <h3>Per koala</h3>
      <div class="rows">${state.koalas.map(row).join('')}</div>
      <h3>Last call</h3>
      <p class="lastcall">${last ? `${esc(name(last.koala))}: ${fmtTokens(last.tokens_in)} in, ${fmtTokens(last.tokens_out)} out,
        ${last.ms != null ? `${(last.ms / 1000).toFixed(1)} s, ` : ''}${fmtUsd(last.cost)}${last.ok ? '' : ', failed'}` : 'No calls yet.'}</p>
      <h3>Pace</h3>
      <p class="lastcall">${u.total.calls ? `${fmtUsd(avg)} per decision on average. Two koalas deciding every 40 s or so comes to about ${fmtUsd(avg * 180)} an hour.` : 'The pace shows after the first decisions.'}
        All time: ${fmtUsd(u.total.cost)} over ${u.total.calls} calls.</p>`;
  }

  function drawInspector() {
    if (!selected || !state) return;
    const k = state.koalas.find((x) => x.id === selected);
    if (!k) return;
    insp.style.setProperty('--c', k.color);
    insp.querySelector('.avatar').textContent = k.name[0];
    insp.querySelector('.iname').textContent = k.name;
    insp.querySelector('.state').textContent = `${k.mood}, ${DOING[k.activity] ?? k.activity} at the ${where(k)}`;
    const th = insp.querySelector('.thought');
    th.textContent = k.thinking ? 'Thinking…' : k.thought || 'No thoughts yet.';
    const said = insp.querySelector('.said');
    said.textContent = k.say ? `Last said: “${k.say}”` : '';
    said.hidden = !k.say;
    insp.querySelector('.needs').innerHTML = `<label>Hunger</label>${bar(k.hunger, 'var(--orange)')}<label>Energy</label>${bar(k.energy, 'var(--mint)')}<label>Strength</label>${bar(k.strength, 'var(--gold)')}`;
    // the inner life: drives (0 met .. 1 pressing), what it holds to, lessons, promises
    const inner = k.inner;
    if (inner) {
      const n = inner.needs;
      insp.querySelector('.drives').innerHTML = ['curiosity', 'social', 'expression', 'quiet']
        .map((d) => `<label>${d[0].toUpperCase()}${d.slice(1)}</label>${bar(Math.round(n[d] * 100), 'var(--blue, #7aa7ff)')}`).join('');
      insp.querySelector('.inner-notes').innerHTML = [
        `<li><b>Holds to</b> ${esc(inner.holdsTo.join(' '))}</li>`,
        ...inner.beliefs.slice(0, 3).map((b) => `<li><b>Learned</b> ${esc(b.text)} <span class="ev">x${b.evidence}</span></li>`),
        ...inner.promises.map((p) => `<li><b>Promised</b> to ${esc(p.subject)}</li>`),
        ...inner.worries.map((w) => `<li><b>Worried</b> ${esc(w)}</li>`),
      ].join('');
    }
    const full = k.inventory.length >= (k.carry ?? 4);
    for (const b of give.children) b.disabled = full;
    give.title = full ? `${k.name}'s paws are full` : '';
  }

  function drawChips() {
    const st = statusOf(state);
    const u = state.usage;
    $('#chips').innerHTML = `
      <div class="chip status ${st.key}" title="${esc(st.text)}"><i></i>${esc({ live: 'Live', thinking: 'Thinking', paused: 'Paused', capped: 'Cap reached', away: 'Waiting', offline: 'Offline' }[st.key])}</div>
      <div class="chip stockchip" title="What is in the Stockpile">Stockpile <b>${esc(stockText(state.stock))}</b></div>
      ${state.brain?.mode !== 'claude' ? `<div class="chip" title="Decisions made on instinct today: no tokens">Free <b>${state.brain?.free?.today ?? 0}</b></div>` : ''}
      <div class="chip real" title="Real spend today, against GROVE_DAY_USD">Today <b>${fmtUsd(u.today.cost)}</b> / ${fmtUsd(u.dayUsd)}</div>
      <div class="chip real" title="Real tokens today, in and out">Tokens <b>${fmtTokens(u.today.tokens_in + u.today.tokens_out)}</b></div>`;
    playBtn.innerHTML = state.playing ? `${ICON('i-pause')}Pause` : `${ICON('i-playbtn')}Play`;
    playBtn.classList.toggle('on', !state.playing);
    playBtn.title = state.brain?.mode === 'local'
      ? (state.playing ? 'Pause: the koalas stop and wait' : 'Play: the koalas live on instinct, 24/7, for free')
      : state.playing ? 'Pause: no more decisions or model calls' : 'Play: the koalas start deciding';
    markBrain();
    $('#status-line').textContent = st.text;
    $('#clock').textContent = state.clock.label;
    const night = state.clock.phase === 'night';
    $('#clock-ico use').setAttribute('href', night ? '#i-moon' : '#i-sun');
    $('#clock-ico').parentElement.classList.toggle('night', night);
    for (const b of timePop.querySelectorAll('[data-time]')) b.setAttribute('aria-pressed', String(b.dataset.time === timeOf(state.clock)));
  }

  function draw() {
    if (!state) return;
    drawChips();
    offerName();
    if (tab === 'koalas') drawKoalas();
    if (tab === 'talk') drawTalk();
    if (tab === 'builds') drawBuilds();
    if (tab === 'tickets') drawTickets();
    if (tab === 'meter') drawMeter();
    drawInspector();
  }

  let second = 0;
  return {
    onLog,
    render(s) {
      state = s;
      clockOffset = s.now - Date.now();
      $('#boot').hidden = true;
      if (s.playing) introDismissed = true; // the intro is for a grove that has not woken yet
      if (!introDismissed) {
        intro.hidden = s.playing;
        $('#intro-cap').textContent = s.brain?.mode === 'local'
          ? 'They are on instinct: free, and they keep living with this page closed. Pick Hybrid or Claude in the Brain menu for model calls.'
          : `Today's cap is ${fmtUsd(s.usage.dayUsd)}, on ${s.usage.model}. Spent so far: ${fmtUsd(s.usage.today.cost)}.`;
      }
      draw();
    },
    offline(msg) {
      $('#chips').innerHTML = `<div class="chip status offline"><i></i>Offline</div>`;
      $('#status-line').textContent = msg || 'Lost the connection to the grove server. Reconnecting…';
    },
    tick(dt) {
      second += dt;
      if (second < 1) return;
      second = 0;
      if (!fpsEl.hidden) fpsEl.textContent = `${Math.round(scene.fps)} fps · ${scene.tier}${scene.scale < 1 ? ` · ${Math.round(scene.scale * 100)}%` : ''}`;
      if (!state) return;
      for (const el of document.querySelectorAll('[data-next]')) {
        const k = state.koalas.find((x) => x.id === el.dataset.next);
        if (k) el.textContent = nextIn(k);
      }
    },
  };
}
