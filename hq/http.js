import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_BODY = 16 * 1024;
const PING_MS = 25000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        failed = true;
        chunks.length = 0;
        reject(new HttpError(413, 'request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      if (size === 0) return resolve({});
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('not an object');
        }
        resolve(value);
      } catch {
        reject(new HttpError(400, 'body must be a JSON object'));
      }
    });
    req.on('error', reject);
  });
}

// The grove server: its API, the live event stream and the page. Localhost only.
export function createApp({ grove, publicDir, google = null }) {
  const root = path.resolve(publicDir);
  const clients = new Set();

  function broadcast(name, data) {
    const frame = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(frame);
  }
  grove.onChange((state) => broadcast('grove', state));

  function sse(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    const timer = setInterval(() => res.write(': ping\n\n'), PING_MS);
    req.on('close', () => {
      clearInterval(timer);
      clients.delete(res);
    });
  }

  // A grove refusal (bad item, full paws, unknown time) keeps its status.
  function refuse(fn) {
    try {
      return fn();
    } catch (err) {
      if (err.status) throw new HttpError(err.status, err.message);
      throw err;
    }
  }

  // A small page for the browser tab Google sends back to.
  function page(res, status, title, text) {
    const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const body = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(title)}</title>`
      + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"></head>`
      + `<body style="font:16px system-ui;background:#0f1520;color:#e8eef5;display:grid;place-items:center;min-height:90vh;text-align:center">`
      + `<div><h1 style="font-size:20px">${esc(title)}</h1><p>${esc(text)}</p></div></body></html>`;
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body);
  }

  // The owner's dashboard and the Google Sheets export. Tokens stay on the server.
  async function owner(req, res, pathname, query, port) {
    const method = req.method;
    if (pathname === '/api/dashboard' && method === 'GET') {
      return sendJson(res, 200, { ...grove.dashboard(), google: google ? google.status() : { configured: false, connected: false } });
    }
    if (!pathname.startsWith('/api/google/')) return false;
    if (!google) throw new HttpError(404, 'not found');
    const redirect = `http://127.0.0.1:${port}/api/google/callback`;
    if (pathname === '/api/google/connect' && method === 'GET') {
      let url;
      try { url = google.authUrl(redirect); } catch (err) { return page(res, 409, 'Google is not set up yet', err.message); }
      res.writeHead(302, { Location: url, 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (pathname === '/api/google/callback' && method === 'GET') {
      try {
        await google.callback({ code: query.get('code'), state: query.get('state'), error: query.get('error') });
      } catch (err) {
        return page(res, err.status ?? 500, 'Google was not connected', err.message);
      }
      return page(res, 200, 'Google connected', 'You can close this tab and press Export to Google Sheets on the dashboard.');
    }
    if (pathname === '/api/google/export' && method === 'POST') {
      const d = new Date(grove.now());
      const two = (n) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
      try {
        const sheet = await google.createSpreadsheet(`Koala Grove export ${stamp}`, grove.exportData());
        return sendJson(res, 200, sheet);
      } catch (err) {
        if (err.status) return sendJson(res, err.status, { error: err.message, code: err.code ?? null });
        throw err;
      }
    }
    if (pathname === '/api/google/disconnect' && method === 'POST') {
      await google.disconnect();
      return sendJson(res, 200, google.status());
    }
    throw new HttpError(404, 'not found');
  }

  // State, Play/Pause, the clock, the page's heartbeat, and the visitor's actions.
  async function api(req, res, pathname, query = new URLSearchParams(), port = 0) {
    const method = req.method;
    if (method !== 'GET' && method !== 'HEAD') {
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') throw new HttpError(415, 'content-type must be application/json');
    }
    if (pathname === '/api/events' && method === 'GET') return sse(req, res);
    if (pathname === '/api/dashboard' || pathname.startsWith('/api/google/')) return owner(req, res, pathname, query, port);
    if (pathname === '/api/grove' && method === 'GET') return sendJson(res, 200, grove.state());
    if (method === 'POST') {
      if (pathname === '/api/grove/play') return sendJson(res, 200, grove.play());
      if (pathname === '/api/grove/pause') return sendJson(res, 200, grove.pause());
      if (pathname === '/api/grove/heartbeat') return sendJson(res, 200, grove.heartbeat());
      if (pathname === '/api/grove/act') {
        const body = await readJson(req);
        return sendJson(res, 200, refuse(() => grove.act(body)));
      }
      const ticket = /^\/api\/grove\/tickets\/(\d+)\/(reply|close)$/.exec(pathname);
      if (ticket) {
        const tid = Number(ticket[1]);
        if (ticket[2] === 'close') return sendJson(res, 200, refuse(() => grove.closeTicket(tid)));
        const { text } = await readJson(req);
        return sendJson(res, 200, refuse(() => grove.replyTicket(tid, text)));
      }
      if (pathname === '/api/grove/name') {
        const { koala, name } = await readJson(req);
        return sendJson(res, 200, refuse(() => grove.nameKoala(koala, name)));
      }
      if (pathname === '/api/grove/brain') {
        const { mode } = await readJson(req);
        return sendJson(res, 200, refuse(() => grove.setBrain(mode)));
      }
      if (pathname === '/api/grove/time') {
        const { to } = await readJson(req);
        return sendJson(res, 200, refuse(() => grove.setTime(to)));
      }
    }
    throw new HttpError(404, 'not found');
  }

  async function serveStatic(req, res, rawPath) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
    let rel;
    try { rel = decodeURIComponent(rawPath); } catch { throw new HttpError(404, 'not found'); }
    if (rel.includes('\0')) throw new HttpError(404, 'not found');
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, '.' + path.sep + rel);
    if (file !== root && !file.startsWith(root + path.sep)) throw new HttpError(404, 'not found');
    let data;
    try {
      const [real, realRoot] = await Promise.all([fs.realpath(file), fs.realpath(root)]);
      if (!real.startsWith(realRoot + path.sep)) throw new Error('outside');
      data = await fs.readFile(real);
    } catch {
      throw new HttpError(404, 'not found');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const { port } = server.address();
      if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
        throw new HttpError(403, 'forbidden host');
      }
      const { origin } = req.headers;
      if (origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
        throw new HttpError(403, 'forbidden origin');
      }
      const rawUrl = (req.url || '/').split('#')[0];
      const rawPath = rawUrl.split('?')[0];
      const query = new URLSearchParams(rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : '');
      if (rawPath === '/api' || rawPath.startsWith('/api/')) await api(req, res, rawPath, query, port);
      else await serveStatic(req, res, rawPath);
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) {
        if (err.status === 413) res.setHeader('Connection', 'close');
        return sendJson(res, err.status, { error: err.message });
      }
      console.error('request failed:', err);
      sendJson(res, 500, { error: 'internal error' });
    }
  });
  return server;
}
