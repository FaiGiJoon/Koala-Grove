// Each koala's own computer: a sealed-off Docker box to write and test the things it makes
// (a game, a calculator, a website, anything that lives as text files in a folder).
//
// The box has no network, no environment from this computer (so no GitHub token, no Claude
// login), a read-only system, no Linux capabilities, a normal user, and caps on memory, CPU,
// processes, output and time. The only thing it can see is the one project folder under
// work/computers/<koala>/<project>/, which is the koala's own work and nothing else.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

export const LIMITS = { files: 24, fileBytes: 60000, totalBytes: 200000, depth: 4, pathLength: 120, commandLength: 300 };

// What a koala may put in a project: relative text files, in plain folders, within the
// limits. Anything else is left out (never an error: the rest of the project still counts).
// Returns { files: { path: text }, dropped: [why...] }.
export function safeFiles(list, limits = LIMITS) {
  const files = {};
  const dropped = [];
  let total = 0;
  for (const f of Array.isArray(list) ? list : []) {
    const raw = typeof f?.path === 'string' ? f.path.trim() : '';
    const content = typeof f?.content === 'string' ? f.content : null;
    const p = path.posix.normalize(raw.replace(/^\.\//, ''));
    const parts = p.split('/');
    const why = !raw || content === null ? 'not a text file'
      : raw.length > limits.pathLength ? 'path too long'
      : !/^[A-Za-z0-9._/-]+$/.test(raw) ? 'odd characters in the path'
      : raw.startsWith('/') || parts.some((s) => s === '..' || s === '' || s === '.') ? 'outside the project'
      : parts.some((s) => s.startsWith('.')) ? 'hidden file'
      : parts.length > limits.depth ? 'folders too deep'
      : p.toLowerCase() === 'readme.md' ? 'the README is written from the description'
      : files[p] !== undefined ? 'twice'
      : Object.keys(files).length >= limits.files ? 'too many files'
      : Buffer.byteLength(content) > limits.fileBytes ? 'file too big'
      : total + Buffer.byteLength(content) > limits.totalBytes ? 'project too big'
      : '';
    if (why) { dropped.push(`${raw.slice(0, 60) || '(no name)'}: ${why}`); continue; }
    files[p] = content;
    total += Buffer.byteLength(content);
  }
  return { files, dropped };
}

// The docker run arguments for one sealed run. Exported so the tests can check every lock.
export function sandboxArgs({ name, dir, image, command, memory = '256m', cpus = '1', pids = 128 }) {
  return [
    'run', '--rm', '--name', name,
    '--network', 'none',
    '--read-only', '--tmpfs', '/tmp:rw,size=64m',
    '--memory', memory, '--memory-swap', memory, '--cpus', cpus, '--pids-limit', String(pids),
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--user', '1000:1000', '-e', 'HOME=/tmp',
    '-v', `${dir}:/project:rw`, '-w', '/project',
    image, 'sh', '-c', command,
  ];
}

function exec(cmd, args, { timeoutMs, onTimeout } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ code: null, out: err.message, timedOut });
    }
    const keep = (d) => { if (out.length < 40000) out += d; };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; onTimeout?.(); child.kill('SIGKILL'); }, timeoutMs) : null;
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: null, out: err.message, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, timedOut }); });
  });
}

export function createComputer({ docker = 'docker', image = 'node:24-alpine', root, timeoutMs = 30000, run = exec, now = () => Date.now() } = {}) {
  if (!root) throw new Error('createComputer needs a root folder');
  let cached = { at: -Infinity, ok: false };
  let pulling = null;

  // Whether Docker runs and the image is here (pulled once if not). Checked at most once a minute.
  async function available() {
    if (now() - cached.at < 60000) return cached.ok;
    let ok = (await run(docker, ['image', 'inspect', image], { timeoutMs: 15000 })).code === 0;
    if (!ok && (await run(docker, ['info'], { timeoutMs: 15000 })).code === 0) {
      pulling ??= run(docker, ['pull', image], { timeoutMs: 600000 }).finally(() => { pulling = null; });
      ok = (await pulling).code === 0;
    }
    cached = { at: now(), ok };
    return ok;
  }

  const folder = (koala, project) => {
    const clean = (s) => String(s).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 48) || 'x';
    return path.join(root, clean(koala), clean(project));
  };

  // Puts the project's files in its folder (replacing what was there) and runs one command
  // in the sealed box. Resolves { ok, code, output, timedOut }.
  async function test(koala, project, files, command) {
    const dir = folder(koala, project);
    fs.rmSync(dir, { recursive: true, force: true });
    for (const [p, text] of Object.entries(files)) {
      const at = path.join(dir, p);
      if (!at.startsWith(dir + path.sep)) continue; // safeFiles already refuses this; belt and braces
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.writeFileSync(at, text);
    }
    fs.mkdirSync(dir, { recursive: true });
    const name = `koala-${String(koala).replace(/[^a-z0-9]/gi, '')}-${crypto.randomBytes(4).toString('hex')}`;
    const r = await run(docker, sandboxArgs({ name, dir, image, command: String(command).slice(0, LIMITS.commandLength) }), {
      timeoutMs,
      onTimeout: () => { run(docker, ['kill', name], { timeoutMs: 10000 }); },
    });
    const output = r.out.length > 4000 ? `${r.out.slice(0, 1500)}\n...\n${r.out.slice(-2500)}` : r.out;
    return { ok: r.code === 0 && !r.timedOut, code: r.code, output: output.trim(), timedOut: Boolean(r.timedOut) };
  }

  return { image, available, test, folder };
}
