import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeFiles, sandboxArgs, createComputer, LIMITS } from '../hq/grove-computer.js';
import { createGithub } from '../hq/grove-github.js';
import { Grove } from '../hq/grove.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'koala-computer-'));

test('safeFiles keeps plain project files and leaves out anything that could escape or hide', () => {
  const { files, dropped } = safeFiles([
    { path: 'index.html', content: '<h1>hi</h1>' },
    { path: './src/game.js', content: 'x' },
    { path: '../../.github/workflows/x.yml', content: 'evil' },
    { path: '/etc/passwd', content: 'no' },
    { path: '.github/workflows/ci.yml', content: 'no' },
    { path: 'a/.env', content: 'no' },
    { path: 'a/b/c/d/e.txt', content: 'too deep' },
    { path: 'README.md', content: 'ours' },
    { path: 'we ird$.js', content: 'no' },
    { path: 'index.html', content: 'twice' },
    { path: 'big.txt', content: 'x'.repeat(LIMITS.fileBytes + 1) },
    { path: 'nope.bin' },
  ]);
  assert.deepEqual(Object.keys(files), ['index.html', 'src/game.js']);
  assert.equal(files['index.html'], '<h1>hi</h1>');
  assert.equal(dropped.length, 10);
  assert.equal(Object.keys(safeFiles(Array.from({ length: 40 }, (_, i) => ({ path: `f${i}.js`, content: '' }))).files).length, LIMITS.files);
  assert.deepEqual(safeFiles('nonsense').files, {});
});

test('sandboxArgs seals the box: no network, read-only, no capabilities, a normal user, only the project folder', () => {
  const a = sandboxArgs({ name: 'koala-ruby-1', dir: '/w/ruby/game', image: 'node:24-alpine', command: 'node test.js' });
  const s = a.join(' ');
  for (const lock of ['--rm', '--network none', '--read-only', '--cap-drop ALL', '--security-opt no-new-privileges', '--user 1000:1000', '--pids-limit', '--memory 256m', '--memory-swap 256m']) {
    assert.ok(s.includes(lock), lock);
  }
  assert.equal(a.filter((x) => x === '-v').length, 1);
  assert.ok(s.includes('-v /w/ruby/game:/project:rw'));
  assert.deepEqual(a.filter((x, i) => a[i - 1] === '-e'), ['HOME=/tmp']); // no token, no login, nothing else
  assert.deepEqual(a.slice(-4), ['node:24-alpine', 'sh', '-c', 'node test.js']);
});

test('the computer writes the project folder, runs one sealed command and kills it when it takes too long', async () => {
  const root = tmp();
  const runs = [];
  let t = 0;
  const run = async (cmd, args, opts) => {
    runs.push(args);
    if (args[0] === 'image') return { code: 0, out: '' };
    if (args[0] === 'kill') return { code: 0, out: '' };
    if (args.includes('sleep 99')) { opts.onTimeout(); return { code: null, out: 'x'.repeat(9000), timedOut: true }; }
    return { code: args.includes('false') ? 1 : 0, out: 'ok 1' };
  };
  const pc = createComputer({ root, run, now: () => t });
  assert.equal(await pc.available(), true);
  assert.equal(await pc.available(), true);
  assert.equal(runs.length, 1, 'checked once a minute');

  const r = await pc.test('ruby', 'star-hop', { 'index.html': '<p>', 'src/t.js': 'ok' }, 'node src/t.js');
  assert.deepEqual(r, { ok: true, code: 0, output: 'ok 1', timedOut: false });
  const dir = path.join(root, 'ruby', 'star-hop');
  assert.equal(fs.readFileSync(path.join(dir, 'src/t.js'), 'utf8'), 'ok');
  assert.ok(runs.at(-1).includes(`${dir}:/project:rw`));

  // a new version replaces the folder: old files do not linger
  await pc.test('ruby', 'star-hop', { 'index.html': '<p>' }, 'false');
  assert.equal(fs.existsSync(path.join(dir, 'src/t.js')), false);
  assert.equal((await pc.test('ruby', 'star-hop', {}, 'false')).ok, false);

  const slow = await pc.test('ruby', 'star-hop', {}, 'sleep 99');
  assert.equal(slow.ok, false);
  assert.equal(slow.timedOut, true);
  assert.ok(slow.output.length < 4100);
  assert.equal(runs.at(-1)[0], 'kill');
});

test('without Docker the computer is simply not available', async () => {
  const pc = createComputer({ root: tmp(), run: async () => ({ code: 1, out: 'Cannot connect to the Docker daemon' }) });
  assert.equal(await pc.available(), false);
});

// --- the grove: a koala makes something, tests it, fixes it and puts it on its GitHub --------

function fakeGithub() {
  const files = {};
  const commits = [];
  let head = 'c0';
  const json = (status, data) => ({ ok: status < 300, status, json: async () => data });
  const fetchImpl = async (url, init = {}) => {
    const p = url.replace('https://api.github.com/repos/koalas/life', '');
    const body = init.body ? JSON.parse(init.body) : null;
    if (init.method === 'GET' && p === '') return json(200, { default_branch: 'main' });
    if (init.method === 'GET' && p === '/git/ref/heads/main') return json(200, { object: { sha: head } });
    if (init.method === 'GET' && p.startsWith('/git/commits/')) return json(200, { tree: { sha: `t-${head}` } });
    if (init.method === 'POST' && p === '/git/trees') { for (const e of body.tree) files[e.path] = e.content; return json(201, { sha: `t-${commits.length + 1}` }); }
    if (init.method === 'POST' && p === '/git/commits') { commits.push(body); return json(201, { sha: `c${commits.length}` }); }
    if (init.method === 'PATCH') { head = body.sha; return json(200, {}); }
    if (init.method === 'GET' && p.startsWith('/contents/')) {
      const path = decodeURI(p.slice('/contents/'.length).split('?')[0]);
      return path in files ? json(200, { content: Buffer.from(files[path]).toString('base64') }) : json(404, { message: 'Not Found' });
    }
    return json(404, { message: 'Not Found' });
  };
  return { files, commits, gh: createGithub({ token: 'github_pat_x', repo: 'koalas/life', fetchImpl }) };
}

const usage = { cost_usd: 0.02, tokens_in: 100, tokens_out: 900, duration_ms: 5000 };
const game = (extra = {}) => ({
  title: 'Star Hop', kind: 'Game', description: 'A little game where you hop between stars.',
  files: [
    { path: 'index.html', content: '<canvas></canvas><script src="game.js"></script>' },
    { path: 'game.js', content: 'export const hop = (x) => x + 1;' },
    { path: '../../.github/workflows/evil.yml', content: 'on: push' },
  ],
  test: 'node test.js', next: 'Add a moon to land on.', ...extra,
});

function makingGrove({ brain, testResults = [], computerOn = true, mode = 'claude', makesPerDay = 1 }) {
  const f = fakeGithub();
  const tests = [];
  const computer = {
    available: async () => computerOn,
    test: async (koala, project, files, command) => { tests.push({ koala, project, files, command }); return testResults.shift() ?? { ok: true, code: 0, output: 'ok', timedOut: false }; },
  };
  const calls = [];
  const think = async (req) => {
    calls.push(req);
    if (req.kind !== 'make') return { ok: false, raw: null, usage: null, error: 'not in this test' };
    return brain(req, calls.filter((c) => c.kind === 'make').length);
  };
  const grove = new Grove({ config: { brain: mode, makesPerDay }, think, localLlm: null, github: f.gh, computer });
  grove.heartbeat();
  return { grove, f, tests, calls };
}

test('a koala makes whatever it wants, it is tested in its box and goes on its GitHub under its own folder', async () => {
  const { grove, f, tests, calls } = makingGrove({ brain: () => ({ ok: true, raw: game(), usage }) });
  await grove.publishNow();
  const makes = calls.filter((c) => c.kind === 'make');
  assert.equal(makes.length, 2, 'one thing each');
  assert.ok(makes[0].args.includes('--json-schema'));
  assert.equal(makes[0].args[makes[0].args.indexOf('--tools') + 1], '', 'no tools: the files are the answer');
  assert.match(makes[0].prompt, /never made anything/);
  assert.equal(tests.length, 2);
  assert.deepEqual(Object.keys(tests[0].files), ['index.html', 'game.js']);

  const paths = Object.keys(f.files);
  assert.ok(paths.includes('crystal/makes/star-hop/index.html'));
  assert.ok(paths.includes('ruby/makes/star-hop/game.js'));
  assert.ok(!paths.some((p) => p.includes('.github')), 'nothing outside its folder');
  assert.match(f.files['ruby/makes/star-hop/README.md'], /# Star Hop[\s\S]*index\.html[\s\S]*it works/);
  assert.match(f.files['ruby/README.md'], /Things I made on my computer[\s\S]*makes\/star-hop\/README\.md/);
  assert.match(f.commits.at(-1).message, /made "Star Hop"/);
  assert.ok(grove.state().log.some((l) => /made a game on the computer: "Star Hop", and its test passed/.test(l.text)));
  assert.equal(grove.db.prepare("SELECT COUNT(*) AS n FROM grove_usage WHERE kind = 'make'").get().n, 2);

  // once a day: publishing again does not make more
  await grove.publishNow();
  assert.equal(calls.filter((c) => c.kind === 'make').length, 2);
  grove.close();
});

test('when its test fails, Claude gets one go at fixing it with what the computer said', async () => {
  const { grove, f, tests, calls } = makingGrove({
    brain: (req, n) => ({ ok: true, raw: n === 2 ? game({ files: [{ path: 'game.js', content: 'fixed' }] }) : game(), usage }),
    testResults: [{ ok: false, code: 1, output: 'AssertionError: 1 !== 2', timedOut: false }],
  });
  grove.config.makesPerDay = 1;
  await grove.publishNow();
  const makes = calls.filter((c) => c.kind === 'make');
  assert.match(makes[1].prompt, /AssertionError: 1 !== 2[\s\S]*Fix it/);
  assert.equal(tests[1].files['game.js'], 'fixed');
  const readmes = Object.entries(f.files).filter(([p]) => p.endsWith('makes/star-hop/README.md'));
  assert.ok(readmes.some(([, t]) => /it works/.test(t)));
  grove.close();
});

test('a test that keeps failing is still shared, honestly, with what went wrong', async () => {
  const { grove, f } = makingGrove({
    brain: () => ({ ok: true, raw: game(), usage }),
    testResults: Array.from({ length: 6 }, () => ({ ok: false, code: 1, output: 'TypeError: nope', timedOut: false })),
  });
  await grove.publishNow();
  assert.match(f.files['crystal/makes/star-hop/README.md'], /did not pass yet[\s\S]*TypeError: nope/);
  assert.ok(grove.state().log.some((l) => /but its test failed/.test(l.text)));
  grove.close();
});

test('with the computer off it is shared untested; on the instinct brain without a local model nothing is made', async () => {
  const off = makingGrove({ brain: () => ({ ok: true, raw: game(), usage }), computerOn: false });
  await off.grove.publishNow();
  assert.equal(off.tests.length, 0);
  assert.match(off.f.files['ruby/makes/star-hop/README.md'], /computer was not on/);
  off.grove.close();

  const local = makingGrove({ brain: () => ({ ok: true, raw: game(), usage }), mode: 'local' });
  await local.grove.publishNow();
  assert.equal(local.calls.filter((c) => c.kind === 'make').length, 0);
  assert.ok(!Object.keys(local.f.files).some((p) => p.includes('/makes/')));
  local.grove.close();
});

test('a local model (Ollama) makes things for free when Claude is off', async () => {
  const f = fakeGithub();
  const asked = [];
  const localLlm = { model: 'gemma4', make: async (system, prompt) => { asked.push({ system, prompt }); return game({ title: 'Moon Calculator', kind: 'calculator' }); } };
  const grove = new Grove({ config: { brain: 'local', makesPerDay: 1 }, localLlm, github: f.gh, computer: null });
  await grove.publishNow();
  assert.equal(asked.length, 2);
  assert.match(asked[0].system, /Nobody tells you what to make/);
  assert.ok(f.files['crystal/makes/moon-calculator/index.html']);
  assert.match(f.files['crystal/makes/moon-calculator/README.md'], /A calculator Crystal made/);
  grove.close();
});

test('a koala can keep working on what it made: it sees its files and the same title updates the same folder', async () => {
  let t = Date.parse('2026-11-08T21:00:00');
  const f = fakeGithub();
  const calls = [];
  const think = async (req) => { calls.push(req); return req.kind === 'make' ? { ok: true, raw: game({ next: 'Add a moon.' }), usage } : { ok: false, raw: null, usage: null, error: 'x' }; };
  const grove = new Grove({ config: { brain: 'claude' }, think, now: () => t, localLlm: null, github: f.gh, computer: null });
  grove.heartbeat();
  await grove.publishNow();
  t += 24 * 3600 * 1000;
  grove.heartbeat();
  await grove.publishNow();
  const second = calls.filter((c) => c.kind === 'make' && c.koala === 'ruby')[1];
  assert.match(second.prompt, /The last thing you made is "Star Hop"[\s\S]*--- game\.js[\s\S]*You wanted to: Add a moon\./);
  assert.match(f.files['ruby/makes/star-hop/README.md'], /started 2026-11-08, last worked on 2026-11-09/);
  assert.ok(grove.state().log.some((l) => /worked on a game on the computer/.test(l.text)));
  grove.close();
});

test('every day gets a diary page on GitHub, napping or not, and a day the grove missed is filled in', async () => {
  let t = Date.parse('2026-11-06T21:00:00');
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const f = fakeGithub();
  const grove = new Grove({ config: { brain: 'local', makesPerDay: 1 }, localLlm: null, computer: null, github: f.gh, now: () => t });
  grove.play();
  grove.heartbeat();
  grove.tick();
  await grove.idle();
  const first = day(t);
  assert.match(f.files[`crystal/diary/${first}.md`] ?? '', /\S/, 'the first day has a diary, though no koala napped');

  // The grove is off for a day; the next evening it writes today's page and fills the gap.
  t += 2 * 24 * 3600 * 1000;
  const missedDay = day(t - 24 * 3600 * 1000);
  f.files[`ruby/diary/${missedDay}.md`] = 'A real diary, written earlier.'; // already on GitHub: must not be overwritten
  grove.heartbeat();
  grove.tick();
  await grove.idle();
  const missed = day(t - 24 * 3600 * 1000);
  assert.match(f.files[`crystal/diary/${missed}.md`], /No diary was written for this day/, 'the missed day is on GitHub');
  assert.ok(f.files[`ruby/diary/${day(t)}.md`], 'today is on GitHub for ruby too');
  assert.equal(f.files[`ruby/diary/${missedDay}.md`], 'A real diary, written earlier.', 'an existing diary is kept');
  grove.close();
});

test('a koala can make up to makesPerDay things in a day, each in its own folder', async () => {
  const { grove, f, calls } = makingGrove({ makesPerDay: 3, brain: (req, n) => ({ ok: true, raw: game({ title: `Thing ${n}`, kind: 'Game' }), usage }) });
  await grove.publishNow();
  assert.equal(calls.filter((c) => c.kind === 'make' && c.koala === 'crystal').length, 3);
  for (const n of [1, 2, 3]) assert.ok(f.files[`crystal/makes/thing-${n}/README.md`], `thing ${n} is on GitHub`);
  grove.close();
});
