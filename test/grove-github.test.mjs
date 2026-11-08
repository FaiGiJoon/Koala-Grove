import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithub, slug, profileMd } from '../hq/grove-github.js';
import { Grove } from '../hq/grove.js';

// A tiny fake of the GitHub REST API: one branch, trees and commits in memory.
function fakeGithub() {
  const files = { 'README.md': 'hi' };
  const commits = [];
  let head = 'c0';
  const calls = [];
  const json = (status, data) => ({ ok: status < 300, status, json: async () => data });
  const fetchImpl = async (url, init = {}) => {
    const path = url.replace('https://api.github.com/repos/koalas/life', '');
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path, auth: init.headers.authorization });
    if (init.method === 'GET' && path === '') return json(200, { default_branch: 'main' });
    if (init.method === 'GET' && path === '/git/ref/heads/main') return json(200, { object: { sha: head } });
    if (init.method === 'GET' && path.startsWith('/git/commits/')) return json(200, { tree: { sha: `t-${head}` } });
    if (init.method === 'POST' && path === '/git/trees') {
      for (const e of body.tree) files[e.path] = e.content;
      return json(201, { sha: `t-${commits.length + 1}` });
    }
    if (init.method === 'POST' && path === '/git/commits') {
      commits.push(body);
      return json(201, { sha: `c${commits.length}` });
    }
    if (init.method === 'PATCH' && path === '/git/refs/heads/main') { head = body.sha; return json(200, {}); }
    return json(404, { message: 'Not Found' });
  };
  return { files, commits, calls, fetchImpl };
}

test('createGithub is off without a token or a proper owner/name', () => {
  assert.equal(createGithub({ token: '', repo: 'a/b' }), null);
  assert.equal(createGithub({ token: 'x', repo: 'nope' }), null);
});

test('commit makes one commit with all files, authored by the koala', async () => {
  const f = fakeGithub();
  const gh = createGithub({ token: 'tok', repo: 'koalas/life', fetchImpl: f.fetchImpl });
  const sha = await gh.commit({ 'ruby/README.md': '# Ruby', 'ruby/diary/2026-11-08.md': 'A day.' }, 'Ruby: day 1', { name: 'Ruby the koala', email: 'ruby@koala-grove.invalid' });
  assert.equal(sha, 'c1');
  assert.equal(f.commits[0].author.name, 'Ruby the koala');
  assert.deepEqual(f.commits[0].parents, ['c0']);
  assert.equal(f.files['ruby/README.md'], '# Ruby');
  assert.ok(f.calls.every((c) => c.auth === 'Bearer tok'));
});

test('slug and profile pages', () => {
  assert.equal(slug('My notes on The Moon & stars!'), 'my-notes-on-the-moon-stars');
  const md = profileMd({ name: 'Ruby', traits: ['I like quiet.'], curiosities: [], wish: '' },
    { holdsTo: ['Rest is never wasted.'], beliefs: [{ text: 'Books make me wiser.', evidence: 3 }], long: [] },
    { stage: 'Grown-up', wisdom: 'Thinker', friend: 'Crystal', interests: ['poems'], day: 4 }, []);
  assert.match(md, /# Ruby/);
  assert.match(md, /Books make me wiser\. \(x3\)/);
});

test('each koala commits its life once a day: profile, diary, mind and a project', async () => {
  let t = new Date(2026, 10, 8, 16).getTime(); // the diary waits for the evening
  const f = fakeGithub();
  let n = 0;
  const grove = new Grove({
    config: { brain: 'local', localReadsPerDay: 1000 },
    think: async () => { throw new Error('no model calls'); },
    now: () => t,
    localLlm: {
      model: 'fake',
      read: async () => ({ fact: `True fact ${++n} about this topic.`, idea: '', curiosity: '' }),
      diary: async () => ({ memory: `A good day, number ${n}.`, trait: '' }),
      project: async () => ({ title: 'My big notes', body: 'I wrote these notes myself, from what I read in the library today.', next: 'Read more.' }),
    },
    github: createGithub({ token: 'github_pat_SECRET123', repo: 'koalas/life', fetchImpl: f.fetchImpl }),
  });
  grove.play();
  for (let i = 0; i < 6 * 300; i++) { t += 10000; grove.tick(); await grove.idle(); }
  const ids = f.commits.map((c) => c.author.email.split('@')[0]);
  assert.ok(ids.length >= 2, 'both founders committed');
  assert.equal(new Set(ids).size, ids.length, 'one commit per koala per day (babies born on the way count too)');
  assert.ok(ids.length <= grove.state().koalas.length);
  for (const id of ids) {
    assert.ok(f.files[`${id}/README.md`].startsWith('# '), 'a profile');
    assert.ok(f.files[`${id}/mind.json`].includes('"beliefs"'), 'its mind');
    assert.ok(Object.keys(f.files).some((p) => p.startsWith(`${id}/diary/`)), 'a diary page');
  }
  assert.match(f.files['README.md'], /in the koalas' own words/);
  assert.ok(Object.keys(f.files).some((p) => /\/projects\/.+\/README\.md$/.test(p)), 'at least one project');
  assert.equal(grove.state().usage.today.calls, 0, 'still no tokens');
  assert.ok(!JSON.stringify(grove.state()).includes('SECRET123'), 'the token never reaches the page');
  grove.close();
});
