// The page's line to the grove server: the grove API, the event stream,
// and the heartbeat that tells the server this page is open (no heartbeat, no model calls;
// on the instinct brain the koalas live on without it).

async function request(url, opts) {
  const res = await fetch(url, opts);
  let body = {};
  try { body = await res.json(); } catch { /* no JSON body */ }
  if (!res.ok) {
    const err = new Error(body.error || `request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// The server rejects POSTs without a JSON content type, even body-less ones.
const post = (url, data = {}) => request(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

export const groveApi = {
  state: () => request('/api/grove'),
  play: () => post('/api/grove/play'),
  pause: () => post('/api/grove/pause'),
  heartbeat: () => post('/api/grove/heartbeat'),
  act: (body) => post('/api/grove/act', body),
  time: (to) => post('/api/grove/time', { to }),
  brain: (mode) => post('/api/grove/brain', { mode }),
  name: (koala, name) => post('/api/grove/name', { koala, name }),
  reply: (id, text) => post(`/api/grove/tickets/${id}/reply`, { text }),
  close: (id) => post(`/api/grove/tickets/${id}/close`),
  dashboard: () => request('/api/dashboard'),
  exportSheets: () => post('/api/google/export'),
  disconnectGoogle: () => post('/api/google/disconnect'),
};

// EventSource reconnects by itself; every (re)connect reloads the full grove state.
export function connectGrove({ onState, onOffline }) {
  const es = new EventSource('/api/events');
  const load = () => groveApi.state().then(onState, (err) => onOffline(err));
  es.addEventListener('open', load);
  es.addEventListener('error', () => onOffline(null));
  es.addEventListener('grove', (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    onState(data);
  });
  return { reload: load };
}

// Check in every 15 s while the page is visible; a hidden tab lets the koalas rest.
export function keepAlive() {
  const beat = () => {
    if (document.visibilityState === 'visible') groveApi.heartbeat().catch(() => {});
  };
  beat();
  setInterval(beat, 15000);
  document.addEventListener('visibilitychange', beat);
}
