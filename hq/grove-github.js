// The koalas' own GitHub: once a day each koala commits its life to a repository, as
// itself (the commit author is the koala). Its diary, its mind, its profile and its
// projects: notes it puts together about what it has been learning, and its own
// inventions. The history becomes a record of how each one grows, to study over time.
//
// Uses only the GitHub REST API with a fine-grained token limited to that one repository
// (Contents: read and write). The token stays on the server; nothing else is touched.

const API = 'https://api.github.com';

export function createGithub({ token, repo, branch = '', fetchImpl = globalThis.fetch, api = API } = {}) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) return null;
  let head = branch;

  async function gh(method, path, body) {
    const res = await fetchImpl(`${api}/repos/${repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'koala-grove',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${data?.message ?? ''}`.trim());
    return data;
  }

  async function read(path) {
    try {
      const f = await gh('GET', `/contents/${encodeURI(path)}${head ? `?ref=${head}` : ''}`);
      return Buffer.from(f.content ?? '', 'base64').toString('utf8');
    } catch (err) {
      if (/: 404/.test(err.message)) return null;
      throw err;
    }
  }

  // One commit with several files, authored by the koala. files: { path: text }.
  async function commit(files, message, author) {
    if (!head) head = (await gh('GET', '')).default_branch;
    const ref = await gh('GET', `/git/ref/heads/${head}`);
    const parent = await gh('GET', `/git/commits/${ref.object.sha}`);
    const tree = await gh('POST', '/git/trees', {
      base_tree: parent.tree.sha,
      tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
    });
    if (tree.sha === parent.tree.sha) return null; // nothing changed
    const c = await gh('POST', '/git/commits', { message, tree: tree.sha, parents: [ref.object.sha], author });
    await gh('PATCH', `/git/refs/heads/${head}`, { sha: c.sha });
    return c.sha;
  }

  return { repo, read, commit, url: `https://github.com/${repo}` };
}

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'project';
const list = (xs, empty = '- nothing yet') => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : empty);

// A koala's profile page.
export function profileMd(k, mind, who, projects) {
  return `# ${k.name}

Stage: ${who.stage}. Mind: ${who.wisdom}. Lives in the Koala Grove. Friend: ${who.friend ?? 'nobody yet'}${k.opinion ? ` ("${k.opinion}")` : ''}.

## Who I am becoming
${list(k.traits ?? [], '- still finding out')}

## What I hold to
${list(mind.holdsTo)}

## What experience taught me
${list(mind.beliefs.slice(0, 8).map((b) => `${b.text} (x${b.evidence})`))}

## I wonder about
${list([...(k.curiosities ?? []), ...who.interests].slice(0, 8))}

## My wish
${k.wish || 'I have not found one yet.'}

## My projects
${list(projects.map((p) => `[${p.title}](projects/${p.slug}/README.md)`))}

## Things I remember
${list(mind.long.map((m) => m.text))}

_Written by ${k.name} on day ${who.day} of the grove. The [diary](diary/) has one page a day; [mind.json](mind.json) is how I am inside right now._
`;
}

// One diary page for a day.
export function diaryMd(k, date, entry, today, mind) {
  const did = Object.entries(today.actions).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a} x${n}`).join(', ');
  return `# ${k.name}, ${date}

${entry || 'A quiet day.'}

- Feeling: ${k.mood}. Most of all I needed: ${mind.loudest}.
- What I did: ${did || 'not much'}.
${today.said.length ? `- Things I said: ${today.said.slice(-5).map((s) => `"${s}"`).join(' ')}\n` : ''}${today.learned.length ? `- What I learned:\n${today.learned.map((l) => `  - ${l}`).join('\n')}\n` : ''}${mind.promises.length ? `- Promises I am keeping: ${mind.promises.map((p) => p.subject).join('; ')}.\n` : ''}${mind.worries.length ? `- On my mind: ${mind.worries.join(' ')}\n` : ''}`;
}

// A project page from what the koala put together (or a local model wrote in its voice).
export function projectMd(k, p) {
  return `# ${p.title}

_A project by ${k.name}, started ${p.started}._

${p.body}

${p.notes?.length ? `## My notes\n${list(p.notes)}\n` : ''}${p.next ? `## What I want to try next\n${p.next}\n` : ''}`;
}

export function rootMd(koalas, day) {
  return `# The Koala Grove, in the koalas' own words

The koalas of the [Koala Grove](https://github.com/FaiGiJoon/Koala-Grove) live on their own and
write their lives here, once a day, each as the author of its own commits. Nobody tells them
what to write. Read the history to see how each one grows.

${koalas.map((k) => `- [${k.name}](${k.id}/README.md)`).join('\n')}

_Last updated on day ${day} of the grove._
`;
}
