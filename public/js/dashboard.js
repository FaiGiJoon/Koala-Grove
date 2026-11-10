// The owner's dashboard: a one-page monitor over the grove (status per koala, usage, habits,
// problems, live feed) and the Google Sheets export. Opened from the monitor button in the top
// bar; the grove keeps running behind it. Model text is always inserted as text, never as HTML.

import { fmtUsd, fmtTokens } from './view.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const LIGHT = { ok: 'OK', warning: 'Warning', problem: 'Problem' };
const REFRESH_MS = 10000;

const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const bar = (v, color) => `<span class="dbar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></span>`;

// Tokens per hour as a small SVG bar chart.
function spark(hourly) {
  const max = Math.max(1, ...hourly.map((h) => h.tokens));
  const w = 240;
  const h = 48;
  const bw = w / hourly.length;
  const bars = hourly.map((b, i) => {
    const bh = Math.round((b.tokens / max) * (h - 4));
    return `<rect x="${(i * bw + 1).toFixed(1)}" y="${h - bh}" width="${(bw - 2).toFixed(1)}" height="${bh}" rx="1.5"><title>${time(b.ts)}: ${fmtTokens(b.tokens)} tokens, ${fmtUsd(b.cost)}</title></rect>`;
  }).join('');
  return `<svg class="dspark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Tokens per hour, last 24 hours">${bars}</svg>`;
}

export function createDashboard({ api }) {
  const root = $('#dash');
  const btn = $('#dash-btn');
  let state = null;
  let data = null;
  let timer = null;
  let exporting = false;
  let showSetup = false;

  const isOpen = () => !root.hidden;
  function open() {
    root.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    refresh();
    timer = setInterval(refresh, REFRESH_MS);
    $('#dash-close').focus();
  }
  function close() {
    root.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    clearInterval(timer);
    timer = null;
    btn.focus();
  }
  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  $('#dash-close').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });

  async function refresh() {
    try {
      data = await api.dashboard();
      draw();
    } catch (err) {
      $('#dash-sub').textContent = `Could not load: ${err.message}`;
    }
  }

  // --- export ---------------------------------------------------------------------------
  $('#dash-export').addEventListener('click', async () => {
    const g = data?.google;
    if (!g?.configured) { showSetup = true; return draw(); }
    if (!g.connected || g.needsReconnect) return window.open('/api/google/connect', '_blank', 'noopener');
    if (exporting) return;
    exporting = true;
    const b = $('#dash-export');
    b.disabled = true;
    b.textContent = 'Exporting…';
    // open the tab now, while the click still counts, so the popup blocker lets it through
    const tab = window.open('', '_blank');
    try {
      const { url } = await api.exportSheets();
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.open(url, '_blank', 'noopener');
      b.textContent = 'Exported';
    } catch (err) {
      if (tab) tab.close();
      b.textContent = 'Export failed';
      $('#dash-sub').textContent = err.message;
      refresh();
    } finally {
      exporting = false;
      setTimeout(() => { b.disabled = false; b.textContent = 'Export to Google Sheets'; }, 2500);
    }
  });

  function setupHelp() {
    return `<h3>Set up Google Sheets once</h3>
      <ol class="dsetup">
        <li>In <b>Google Cloud Console</b>, create a project and enable the <b>Google Sheets API</b>.</li>
        <li>Set up the <b>OAuth consent screen</b> (External) and <b>publish it to In production</b>, so the sign-in does not expire after 7 days.</li>
        <li>Create an <b>OAuth client ID</b> of type <b>Desktop app</b> and download its JSON.</li>
        <li>Save it as <code>data/google-client.json</code> in the grove folder, then restart the server.</li>
        <li>Press <b>Connect Google</b> here and approve. Google shows an "unverified app" warning once: that is your own app.</li>
      </ol>`;
  }

  function googleLine() {
    const g = data?.google;
    const el = $('#dash-google');
    if (!g?.configured) { el.textContent = 'Google: not set up'; return; }
    if (g.needsReconnect) { el.innerHTML = '<a href="/api/google/connect" target="_blank" rel="noopener">Reconnect Google</a>'; return; }
    if (!g.connected) { el.innerHTML = '<a href="/api/google/connect" target="_blank" rel="noopener">Connect Google</a>'; return; }
    el.innerHTML = 'Google connected · <button type="button" class="linkbtn" id="dash-disconnect">Disconnect</button>';
    $('#dash-disconnect').addEventListener('click', async () => {
      await api.disconnectGoogle().catch(() => {});
      refresh();
    });
  }

  // --- drawing ----------------------------------------------------------------------------
  function cards() {
    const lights = data?.lights ?? {};
    const needs = (k) => {
      const out = [];
      if (k.hunger >= 70) out.push('food');
      if (k.energy <= 25) out.push('rest');
      const t = (state.tickets ?? []).filter((x) => x.koala === k.id && x.status === 'open');
      if (t.length) out.push(`your answer (${t.length} ticket${t.length === 1 ? '' : 's'})`);
      return out;
    };
    $('#dash-cards').innerHTML = state.koalas.map((k) => {
      const light = lights[k.id] ?? 'ok';
      const n = needs(k);
      return `<article class="dcard ${light}" style="--c:${k.color}">
        <div class="dtop"><b>${esc(k.name)}</b><span class="dlight ${light}">${LIGHT[light]}</span></div>
        <div class="dnow">${k.thinking ? 'Thinking… ' : ''}${esc(k.activity)} at ${esc(state.places?.[k.place]?.name ?? k.place)} · ${esc(k.mood)}</div>
        <div class="dmeters">
          <label>Hunger</label>${bar(k.hunger, 'var(--orange)')}
          <label>Energy</label>${bar(k.energy, 'var(--mint)')}
        </div>
        <div class="dline">${esc(k.stageLabel)} · ${esc(k.wisdomLabel ?? '')} (wisdom ${Math.round(k.wisdom ?? 0)}) · knows ${(k.learned ?? []).length}</div>
        ${(k.traits ?? []).length ? `<div class="dline">Personality: ${k.traits.map(esc).join(' · ')}</div>` : ''}
        <div class="dline">${k.wish ? `Wants: “${esc(k.wish)}”` : 'No wish yet.'}</div>
        <div class="dline ${n.length ? 'dneed' : ''}">Needs: ${n.length ? n.map(esc).join(', ') : 'nothing right now'}</div>
        ${(k.curiosities ?? []).length ? `<div class="dline">Wonders about: ${k.curiosities.map(esc).join(', ')}</div>` : ''}
        ${k.opinion ? `<div class="dline">On ${esc(state.koalas.find((o) => o.id !== k.id)?.name ?? 'friend')}: “${esc(k.opinion)}” (bond ${k.bond})</div>` : ''}
      </article>`;
    }).join('');
  }

  // The overview: what the koala wants, how pressing each drive is, what it searched for, and its open tickets.
  const DRIVE_LABEL = { rest: 'Rest', curiosity: 'Curiosity', social: 'Company', expression: 'Speaking up', quiet: 'Quiet time' };
  function overviewBox() {
    const o = data?.overview;
    if (!o?.name) {
      $('#dash-overview').innerHTML = '<h3>Overview</h3><div class="dline">No koala in the grove yet.</div>';
      return;
    }
    const drives = o.drives.map((d) => `<div class="ddrive"><label>${esc(DRIVE_LABEL[d.name] ?? d.name)}</label>${bar(Math.round(d.value * 100), 'var(--mint)')}</div>`).join('');
    const searches = o.searches.length
      ? `<ul class="dlist">${o.searches.map((s) => {
          const what = s.title
            ? (s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>` : esc(s.title))
            : '<i>nothing found</i>';
          return `<li><span class="t">${time(s.ts)}</span> “${esc(s.query)}” <span class="k">${esc(s.via)}</span> ${what}</li>`;
        }).join('')}</ul>`
      : '<div class="dline">No searches yet.</div>';
    const tickets = o.openTickets.length
      ? `<ul class="dlist">${o.openTickets.map((t) => `<li class="warning">${esc(t.text)} <span class="k">waiting for your answer</span></li>`).join('')}</ul>`
      : '<div class="dline">No open tickets.</div>';
    $('#dash-overview').innerHTML = `<h3>Overview: ${esc(o.name)}</h3>
      <div class="dwish">${o.wish ? `Wants: “${esc(o.wish)}”` : 'No wish yet.'}</div>
      <div class="dgrid">
        <div><h4>Drives</h4>${drives || '<div class="dline">None.</div>'}</div>
        <div><h4>Searched online</h4>${searches}</div>
        <div><h4>Open tickets</h4>${tickets}</div>
      </div>`;
  }

  function usageBox() {
    const u = state.usage;
    const l = data?.last24;
    const per = state.koalas.map((k) => {
      const b = u.byKoala[k.id]?.today ?? { calls: 0, tokens_in: 0, tokens_out: 0, cost: 0 };
      return `<li><span class="dot" style="background:${k.color}"></span>${esc(k.name)}: ${fmtTokens(b.tokens_in + b.tokens_out)} tokens, ${b.calls} calls, ${fmtUsd(b.cost)}</li>`;
    }).join('');
    const kinds = l ? Object.entries(l.kinds).map(([k, n]) => `${n} ${esc(k)}`).join(' · ') : '';
    $('#dash-usage').innerHTML = `<h3>Usage today</h3>
      <div class="dbig"><b>${fmtTokens(u.today.tokens_in + u.today.tokens_out)}</b> tokens · <b>${fmtUsd(u.today.cost)}</b> of ${fmtUsd(u.dayUsd)} cap</div>
      ${data ? spark(data.hourly) : ''}
      <ul class="dlist">${per}</ul>
      <div class="dline">${l ? `Last 24 h: ${kinds || 'no calls'}${l.avgSeconds != null ? ` · ${l.avgSeconds.toFixed(1)} s per call` : ''}` : ''} · model ${esc(u.model)}</div>`;
  }

  function habitsBox() {
    const h = data?.habits ?? {};
    $('#dash-habits').innerHTML = `<h3>Habits (24 h)</h3>${state.koalas.map((k) => {
      const x = h[k.id];
      if (!x) return `<div class="dline"><b>${esc(k.name)}</b>: nothing yet</div>`;
      return `<div class="dhabit"><b>${esc(k.name)}</b><div class="dstack">${x.shares.map((s) => `<i style="flex:${s.n}" title="${esc(s.action)} ${s.pct}%"></i>`).join('')}</div>
        <div class="dline">${x.shares.slice(0, 6).map((s) => `${esc(s.action)} ${s.pct}%`).join(' · ')}</div></div>`;
    }).join('')}`;
  }

  function problemsBox() {
    const p = data?.problems ?? [];
    $('#dash-problems').innerHTML = `<h3>Problems</h3>${p.length
      ? `<ul class="dlist">${p.map((x) => `<li class="${x.level}"><span class="dlight ${x.level}">${LIGHT[x.level]}</span> ${time(x.ts)} ${esc(x.text)}</li>`).join('')}</ul>`
      : '<div class="dline">All quiet. No problems.</div>'}${showSetup && !data?.google?.configured ? setupHelp() : ''}`;
  }

  function feedBox() {
    const name = (id) => state.koalas.find((k) => k.id === id)?.name ?? '';
    const rows = data?.feed ?? [...state.log].reverse();
    $('#dash-feed').innerHTML = `<h3>Live feed</h3><ul class="dfeed">${rows.slice(0, 40).map((e) => `<li class="${esc(e.kind)}"><span class="t">${time(e.ts)}</span><b>${esc(name(e.koala))}</b><span class="k">${esc(e.kind)}</span><span class="x">${esc(e.kind === 'say' ? `“${e.text}”` : e.text)}</span></li>`).join('')}</ul>`;
  }

  function draw() {
    if (!state || !isOpen()) return;
    $('#dash-sub').textContent = `${state.playing ? 'Running' : 'Paused'} · ${state.clock?.label ?? ''} · updated ${time(Date.now())}`;
    overviewBox();
    cards();
    usageBox();
    habitsBox();
    problemsBox();
    feedBox();
    googleLine();
  }

  return {
    render(s) {
      state = s;
      draw();
    },
  };
}
