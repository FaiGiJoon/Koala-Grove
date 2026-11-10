import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { problemsOf, habitsOf, hourly, exportTabs, sheetDate, RULES, HOUR_MS } from '../hq/grove-dashboard.js';
import { Google, loadClient, SCOPE } from '../hq/google.js';
import { Grove } from '../hq/grove.js';
import { createApp } from '../hq/http.js';

const NOW = Date.UTC(2026, 10, 5, 12);
const koala = (id, over = {}) => ({ id, name: id[0].toUpperCase() + id.slice(1), hunger: 30, energy: 80, ...over });
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grove-dash-'));

// --- problems ------------------------------------------------------------------------------

test('problems: hunger and energy thresholds give warnings and problems, and set the light', () => {
  const { problems, lights } = problemsOf({
    koalas: [koala('crystal', { hunger: RULES.hungerWarn }), koala('ruby', { energy: RULES.energyProblem })], now: NOW,
  });
  assert.deepEqual(lights, { crystal: 'warning', ruby: 'problem' });
  assert.equal(problems[0].level, 'problem', 'problems come first');
  assert.match(problems[0].text, /Ruby is exhausted/);
  assert.match(problems[1].text, /Crystal is hungry/);
});

test('problems: a failed call counts only within 15 minutes', () => {
  const failures = [{ ts: NOW - 5 * 60000, koala: 'crystal', text: 'call failed: timeout' }, { ts: NOW - 20 * 60000, koala: 'ruby', text: 'old' }];
  const { problems, lights } = problemsOf({ koalas: [koala('crystal'), koala('ruby')], failures, now: NOW });
  assert.equal(problems.length, 1);
  assert.deepEqual(lights, { crystal: 'problem', ruby: 'ok' });
});

test('problems: open tickets need the owner, and the spend warns at 80% and stops at the cap', () => {
  const k = [koala('crystal'), koala('ruby')];
  const t = problemsOf({ koalas: k, tickets: [{ koala: 'ruby', status: 'open', title: 'We need sand' }, { koala: 'crystal', status: 'answered', title: 'x' }], now: NOW });
  assert.equal(t.problems.length, 1);
  assert.match(t.problems[0].text, /Needs you: ticket "We need sand"/);
  assert.equal(t.lights.ruby, 'warning');
  const warn = problemsOf({ koalas: k, spend: { today: 0.4, cap: 0.5 }, now: NOW });
  assert.match(warn.problems[0].text, /80% of the daily cap/);
  assert.deepEqual(warn.lights, { crystal: 'warning', ruby: 'warning' });
  const cap = problemsOf({ koalas: k, spend: { today: 0.5, cap: 0.5 }, now: NOW });
  assert.equal(cap.problems[0].level, 'problem');
  assert.equal(cap.lights.crystal, 'warning', 'the grove-wide cap marks every koala, but not as their own problem');
  assert.equal(problemsOf({ koalas: k, now: NOW }).problems.length, 0);
});

// --- habits and hourly -------------------------------------------------------------------

test('habits: shares per koala, largest first', () => {
  const h = habitsOf([{ koala: 'crystal', action: 'eat', n: 1 }, { koala: 'crystal', action: 'play', n: 3 }, { koala: 'ruby', action: 'nap', n: 2 }]);
  assert.deepEqual(h.crystal.shares.map((s) => [s.action, s.pct]), [['play', 75], ['eat', 25]]);
  assert.equal(h.ruby.total, 2);
});

test('hourly: 24 buckets, tokens and cost summed, old rows dropped', () => {
  const rows = [
    { ts: NOW - 30 * 60000, tokens_in: 100, tokens_out: 10, cost_usd: 0.01 },
    { ts: NOW - 20 * 60000, tokens_in: 50, tokens_out: 5, cost_usd: 0.02 },
    { ts: NOW - 30 * HOUR_MS, tokens_in: 999, tokens_out: 0, cost_usd: 1 },
  ];
  const b = hourly(rows, NOW);
  assert.equal(b.length, 24);
  assert.equal(b.reduce((a, x) => a + x.tokens, 0), 165);
  assert.equal(b.find((x) => x.ts <= NOW - 20 * 60000 && NOW - 20 * 60000 < x.ts + HOUR_MS).calls, 2);
});

// --- export rows -------------------------------------------------------------------------

test('export: six tabs with every log and usage row, thinking on its own, and formulas stay text', () => {
  const koalas = [{ ...koala('crystal'), stageLabel: 'Baby', wisdom: 3, wisdomLabel: 'Curious baby', memories: ['held memory'], learned: ['held fact'], traits: ['bold'], strength: 5, mood: 'happy' }];
  const log = [
    { ts: NOW, koala: 'crystal', kind: 'think', text: '=HYPERLINK("x")' },
    { ts: NOW, koala: 'crystal', kind: 'act', action: 'eat', target: 'gum', text: 'Crystal ate' },
    { ts: NOW, koala: 'crystal', kind: 'remember', text: 'logged memory' },
  ];
  const usage = [{ ts: NOW, koala: 'crystal', kind: 'decide', ok: 1, tokens_in: 1000, tokens_out: 50, cost_usd: 0.002, duration_ms: 1500 }];
  const tabs = exportTabs({ koalas, log, usage, now: NOW, model: 'claude-haiku-5-5' });
  assert.deepEqual(tabs.map((t) => t.title), ['Summary', 'Koalas', 'Activity', 'Thinking', 'Usage', 'Memories & learned']);
  const tab = (n) => tabs.find((t) => t.title === n);
  assert.equal(tab('Activity').rows.length, 3);
  assert.deepEqual(tab('Thinking').rows[0].slice(1), ['Crystal', '=HYPERLINK("x")'], 'kept as plain text; the writer sends RAW');
  assert.deepEqual(tab('Usage').rows[0].slice(1), ['Crystal', 'decide', 'yes', 1000, 50, 0.002, 1.5]);
  assert.equal(tab('Koalas').rows[0][9], 'bold');
  const mem = tab('Memories & learned').rows.map((r) => [r[0] === '(held now, date unknown)' ? 'now' : 'logged', r[2], r[3]]);
  assert.deepEqual(mem, [['logged', 'memory', 'logged memory'], ['now', 'memory', 'held memory'], ['now', 'learned', 'held fact']]);
  assert.equal(tab('Summary').rows[2][1], 1, 'one call');
  assert.equal(typeof tab('Activity').rows[0][0], 'number', 'times are sheet dates');
});

test('sheetDate: the Sheets epoch, in local time', () => {
  const ms = new Date(1899, 11, 31, 0, 0).getTime();
  assert.ok(Math.abs(sheetDate(ms) - 1) < 1e-6);
});

// --- the grove's dashboard ---------------------------------------------------------------

test('grove.dashboard: usage rows carry their kind, memories are logged, and the feed includes thoughts', async () => {
  let t = NOW;
  const grove = new Grove({
    config: { dayUsd: 5 },
    think: async () => ({ ok: true, raw: { action: 'eat', target: 'gum_grove', thought: 'Yum.', remember: 'Gum leaves taste best at noon.' }, usage: { cost_usd: 0.001, tokens_in: 900, tokens_out: 40, duration_ms: 1200 } }),
    now: () => t,
    rng: () => 0.5,
  });
  grove.play();
  t += 5000;
  grove.heartbeat();
  grove.tick();
  await grove.idle();
  const d = grove.dashboard();
  assert.equal(d.last24.kinds.decide, 2);
  assert.ok(d.last24.byKoala.crystal.tokens > 0);
  assert.equal(d.hourly.length, 24);
  assert.ok(d.habits.crystal.actions.eat >= 1);
  assert.ok(d.feed.some((e) => e.kind === 'think' && e.text === 'Yum.'));
  assert.ok(d.feed.some((e) => e.kind === 'remember'));
  const tabs = grove.exportData();
  assert.ok(tabs.find((x) => x.title === 'Usage').rows.every((r) => r[2] === 'decide'));
  // a memory already held is not logged twice
  t += 70000;
  grove.heartbeat();
  grove.tick();
  await grove.idle();
  assert.equal(grove.exportData().find((x) => x.title === 'Memories & learned').rows.filter((r) => r[2] === 'memory' && r[0] !== '(held now, date unknown)').length, 2, 'once per koala');
  grove.close();
});

test('old databases get the usage kind column without losing rows', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'g.sqlite');
  const g1 = new Grove({ path: file, think: async () => ({ ok: true, raw: { action: 'sit' } }) });
  g1.db.exec('ALTER TABLE grove_usage DROP COLUMN kind');
  g1.db.prepare('INSERT INTO grove_usage (ts, koala, ok, cost_usd, tokens_in, tokens_out) VALUES (1, ?, 1, 0.1, 1, 1)').run('crystal');
  g1.close();
  const g2 = new Grove({ path: file, think: async () => ({ ok: true, raw: { action: 'sit' } }) });
  const rows = g2.db.prepare('SELECT * FROM grove_usage').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, null);
  g2.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- Google ------------------------------------------------------------------------------

function fakeGoogle({ tokenError = null } = {}) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (url.includes('oauth2.googleapis.com/token')) {
      const p = new URLSearchParams(opts.body);
      if (p.get('grant_type') === 'refresh_token' && tokenError) return json(400, { error: tokenError });
      return json(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: SCOPE });
    }
    if (url.includes('revoke')) return json(200, {});
    if (url.endsWith('/spreadsheets')) return json(200, { spreadsheetId: 'S1', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/S1/edit' });
    return json(200, {});
  };
  return { fetch, calls };
}

function clientDir() {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'google-client.json'), JSON.stringify({ installed: { client_id: 'CID', client_secret: 'CS' } }));
  return dir;
}

test('google: the client comes from Google\'s JSON download or the env', () => {
  const dir = clientDir();
  assert.deepEqual(loadClient(dir, {}), { id: 'CID', secret: 'CS' });
  assert.deepEqual(loadClient(tmpDir(), { GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' }), { id: 'a', secret: 'b' });
  assert.equal(loadClient(tmpDir(), {}), null);
});

test('google: the sign-in link uses PKCE, a state, offline access and only drive.file', () => {
  const g = new Google({ dataDir: clientDir(), fetch: fakeGoogle().fetch, env: {} });
  const u = new URL(g.authUrl('http://127.0.0.1:4318/api/google/callback'));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('scope'), SCOPE);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(u.searchParams.get('state').length >= 30);
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:4318/api/google/callback');
  assert.throws(() => new Google({ dataDir: tmpDir(), env: {} }).authUrl('x'), /not set up/);
});

test('google: the callback checks the state once, sends the verifier, and keeps the token private', async () => {
  const dir = clientDir();
  const f = fakeGoogle();
  const g = new Google({ dataDir: dir, fetch: f.fetch, env: {} });
  const u = new URL(g.authUrl('http://127.0.0.1:1/cb'));
  const state = u.searchParams.get('state');
  await assert.rejects(g.callback({ code: 'C', state: 'wrong' }), /expired or was not started here/);
  await g.callback({ code: 'C', state });
  const sent = new URLSearchParams(f.calls.at(-1).opts.body);
  const challenge = crypto.createHash('sha256').update(sent.get('code_verifier')).digest('base64url');
  assert.equal(challenge, u.searchParams.get('code_challenge'));
  assert.equal(sent.get('client_secret'), 'CS');
  const file = path.join(dir, 'google-token.json');
  // POSIX permission bits do not exist on Windows, so only check them where they mean something
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).refresh_token, 'RT');
  assert.deepEqual(g.status(), { configured: true, connected: true, needsReconnect: false });
  await assert.rejects(g.callback({ code: 'C', state }), /expired/, 'a state works once');
});

test('google: an expired refresh token asks for a reconnect instead of failing silently', async () => {
  const dir = clientDir();
  fs.writeFileSync(path.join(dir, 'google-token.json'), JSON.stringify({ refresh_token: 'OLD' }));
  const g = new Google({ dataDir: dir, fetch: fakeGoogle({ tokenError: 'invalid_grant' }).fetch, env: {} });
  await assert.rejects(g.createSpreadsheet('t', []), (err) => err.code === 'reconnect');
  assert.equal(g.status().needsReconnect, true);
  await assert.rejects(g.createSpreadsheet('t', []), (err) => err.code === 'reconnect');
});

test('google: a spreadsheet gets a tab each, RAW values in chunks, bold headers and date columns', async () => {
  const dir = clientDir();
  fs.writeFileSync(path.join(dir, 'google-token.json'), JSON.stringify({ refresh_token: 'RT' }));
  const f = fakeGoogle();
  const g = new Google({ dataDir: dir, fetch: f.fetch, env: {} });
  const big = Array.from({ length: 12000 }, (_, i) => [i, 'x']);
  const out = await g.createSpreadsheet('Koala Grove export', [
    { title: "Ruby's", header: ['Time', 'Text'], rows: big, dateCols: [0] },
    { title: 'Small', header: ['A'], rows: [['=1+1']], dateCols: [] },
  ]);
  assert.equal(out.url, 'https://docs.google.com/spreadsheets/d/S1/edit');
  const create = JSON.parse(f.calls.find((c) => c.url.endsWith('/spreadsheets')).opts.body);
  assert.deepEqual(create.sheets.map((s) => s.properties.title), ["Ruby's", 'Small']);
  const values = f.calls.filter((c) => c.url.includes('values:batchUpdate')).map((c) => JSON.parse(c.opts.body));
  assert.equal(values.length, 4, '12001 rows in three chunks, plus one');
  assert.ok(values.every((v) => v.valueInputOption === 'RAW'));
  assert.equal(values[0].data[0].range, "'Ruby''s'!A1");
  assert.equal(values[1].data[0].range, "'Ruby''s'!A5001");
  const fmt = JSON.parse(f.calls.find((c) => c.url.endsWith('/S1:batchUpdate')).opts.body);
  assert.ok(fmt.requests.some((r) => r.repeatCell?.cell.userEnteredFormat.numberFormat?.type === 'DATE_TIME'));
  assert.ok(f.calls.filter((c) => c.url.includes('sheets.googleapis.com')).every((c) => c.opts.headers.Authorization === 'Bearer AT'));
});

test('google: disconnect removes the token and revokes it', async () => {
  const dir = clientDir();
  fs.writeFileSync(path.join(dir, 'google-token.json'), JSON.stringify({ refresh_token: 'RT' }));
  const f = fakeGoogle();
  const g = new Google({ dataDir: dir, fetch: f.fetch, env: {} });
  await g.disconnect();
  assert.equal(fs.existsSync(path.join(dir, 'google-token.json')), false);
  assert.ok(f.calls.some((c) => c.url.includes('revoke')));
});

// --- http ----------------------------------------------------------------------------------

test('http: dashboard, setup page, bad callback, and export through a mocked Google', async () => {
  const dir = clientDir();
  const pub = tmpDir();
  fs.writeFileSync(path.join(pub, 'index.html'), 'x');
  const grove = new Grove({ think: async () => ({ ok: true, raw: { action: 'sit' } }) });
  const noClient = new Google({ dataDir: tmpDir(), fetch: fakeGoogle().fetch, env: {} });
  for (const [google, configured] of [[noClient, false], [new Google({ dataDir: dir, fetch: fakeGoogle().fetch, env: {} }), true]]) {
    const server = createApp({ grove, publicDir: pub, google });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const d = await (await fetch(`${base}/api/dashboard`)).json();
    assert.equal(d.google.configured, configured);
    assert.equal(d.google.connected, false);
    assert.ok(Array.isArray(d.problems));
    const c = await fetch(`${base}/api/google/connect`, { redirect: 'manual' });
    if (configured) {
      assert.equal(c.status, 302);
      assert.match(c.headers.get('location'), /^https:\/\/accounts\.google\.com\//);
      assert.match(c.headers.get('location'), new RegExp(encodeURIComponent(`${base}/api/google/callback`).replace(/[.]/g, '\\.')));
    } else {
      assert.equal(c.status, 409);
      assert.match(await c.text(), /not set up/);
    }
    const bad = await fetch(`${base}/api/google/callback?code=x&state=nope`);
    assert.equal(bad.status, 400);
    assert.match(bad.headers.get('content-security-policy') ?? (await bad.text()), /default-src 'none'|expired/);
    const ex = await fetch(`${base}/api/google/export`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(ex.status, 409, 'not connected yet');
    const evil = await fetch(`${base}/api/google/export`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
    assert.equal(evil.status, 403, 'other sites cannot trigger an export');
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
  grove.close();
});
