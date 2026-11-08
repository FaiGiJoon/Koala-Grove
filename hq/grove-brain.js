// A koala's brain: one isolated, tool-less `claude -p` call per decision, on the
// user's existing Claude Code login: shut off from your own Claude settings, with no
// tools at all, a small model, a per-call budget and schema-checked JSON output.

import { spawn } from 'node:child_process';
import { DECISION_SCHEMA } from './grove-world.js';

// Cost and token counts from Claude's final result message, or null if it has none.
export function usageFrom(result) {
  if (!result || typeof result !== 'object' || typeof result.total_cost_usd !== 'number') return null;
  const u = result.usage || {};
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return {
    cost_usd: result.total_cost_usd,
    tokens_in: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens),
    tokens_out: n(u.output_tokens),
    duration_ms: Number.isFinite(result.duration_ms) ? result.duration_ms : null,
  };
}

export function koalaArgs({ system, prompt, model, callUsd }) {
  return [
    '-p', prompt,
    '--output-format', 'json',
    '--model', model,
    // Replaces Claude Code's own system prompt: the koala needs none of it, and it costs tokens.
    '--system-prompt', system,
    '--json-schema', JSON.stringify(DECISION_SCHEMA),
    '--tools', '',
    // Ignore user/project/local settings and their plugins, hooks, MCP servers and skills.
    '--setting-sources', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--permission-mode', 'dontAsk',
    '--no-session-persistence',
    '--max-budget-usd', String(callUsd),
  ];
}

// A research trip: a koala at Library Isle looks one question up. The only tool is web search;
// the answer comes back as a short fact to remember and, maybe, an idea for the grove.
export const RESEARCH_SCHEMA = {
  type: 'object',
  properties: {
    fact: { type: 'string', description: 'What the koala learned, as one short sentence a koala could remember.' },
    idea: { type: 'string', description: 'One idea for the grove this suggests, or empty.' },
    curiosity: { type: 'string', description: 'A related topic, a few words, the koala could wonder about next, or empty.' },
  },
  required: ['fact', 'idea', 'curiosity'],
  additionalProperties: false,
};
export const RESEARCH_SYSTEM = 'You are the friendly library of a small koala grove. A koala asks you one question. '
  + 'Look it up with web search, then answer truthfully, at the level the koala is ready for.';

export function researchArgs({ prompt, model, callUsd }) {
  return [
    '-p', prompt,
    '--output-format', 'json',
    '--model', model,
    '--system-prompt', RESEARCH_SYSTEM,
    '--json-schema', JSON.stringify(RESEARCH_SCHEMA),
    '--tools', 'WebSearch',
    '--allowedTools', 'WebSearch',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--permission-mode', 'dontAsk',
    '--no-session-persistence',
    '--max-budget-usd', String(callUsd),
  ];
}

// Reading: a koala opens a picture book at a topic. No tools; the book answers from what it knows.
export const READ_SYSTEM = "You are a picture book in the koala grove's library. The koala opens you at a topic; "
  + 'tell one true, interesting thing about it at the level the koala is ready for, and maybe an idea for the grove.';

export function readArgs({ prompt, model, callUsd }) {
  return [
    '-p', prompt,
    '--output-format', 'json',
    '--model', model,
    '--system-prompt', READ_SYSTEM,
    '--json-schema', JSON.stringify(RESEARCH_SCHEMA),
    '--tools', '',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--permission-mode', 'dontAsk',
    '--no-session-persistence',
    '--max-budget-usd', String(callUsd),
  ];
}

// The result message: all of stdout as one JSON object, or else the last line that is one.
function resultFrom(stdout) {
  const tryParse = (s) => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && v.type === 'result' ? v : null;
    } catch { return null; }
  };
  return tryParse(stdout.trim()) ?? stdout.trim().split('\n').reverse().map(tryParse).find(Boolean) ?? null;
}

// Resolves { ok, raw, usage, error }; raw is the structured output, or the result text to search.
export function think({ bin, args, cwd, timeoutMs }) {
  // CLAUDE_BIN may point at a Node script (the test fake); run it with this Node.
  const [cmd, pre] = /\.m?js$/.test(bin) ? [process.execPath, [bin]] : [bin, []];
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, [...pre, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ ok: false, raw: null, usage: null, error: err.message });
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let done = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    const finish = (code, spawnError) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const result = resultFrom(stdout);
      const usage = usageFrom(result);
      if (timedOut) return resolve({ ok: false, raw: null, usage, error: `timed out after ${Math.round(timeoutMs / 1000)} s` });
      if (spawnError) return resolve({ ok: false, raw: null, usage, error: spawnError.message });
      const raw = result?.structured_output && typeof result.structured_output === 'object'
        ? result.structured_output
        : typeof result?.result === 'string' && result.result ? result.result : null;
      if (code === 0 && result && result.is_error !== true && raw) return resolve({ ok: true, raw, usage, error: null });
      const errs = Array.isArray(result?.errors) ? result.errors.join('; ') : '';
      const why = stderr.trim().split('\n').slice(-3).join(' ')
        || [result?.subtype, typeof result?.result === 'string' ? result.result : '', errs].filter(Boolean).join(': ')
        || 'no result';
      resolve({ ok: false, raw: null, usage, error: `exit ${code}: ${why}` });
    };
    child.stdout.on('data', (d) => { if (stdout.length < 200000) stdout += d; });
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    child.on('error', (err) => finish(null, err));
    child.on('close', (code) => finish(code));
  });
}

// Making: a koala sits at its own computer and makes whatever it wants, as files in a folder.
// No tools here either: the answer is the files (and a command to check them), and the grove
// runs that command in the koala's sealed box (grove-computer.js), never on this computer.
export const MAKE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'A short name for what you made. The same name as before to keep working on it.' },
    kind: { type: 'string', description: 'What it is, in a word or two: game, calculator, website, story, tool, art, music, anything.' },
    description: { type: 'string', description: 'A few short Markdown paragraphs, in your own voice: what it is, why you made it, how to use or play it.' },
    files: {
      type: 'array',
      description: 'Every file of the project: relative paths, plain text (HTML, JS, CSS, SVG, Markdown, JSON...).',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
    test: { type: 'string', description: 'One shell command that checks it works on your computer (for example: node test.js), or empty.' },
    next: { type: 'string', description: 'One sentence: what you want to add or try next.' },
  },
  required: ['title', 'kind', 'description', 'files', 'test', 'next'],
  additionalProperties: false,
};

export const MAKE_SYSTEM = 'You are a koala in the Koala Grove, sitting at your very own computer. Nobody tells you what to make: '
  + 'make whatever you really want, from who you are. It can be anything that lives as text files in a folder: a game to play '
  + 'in the browser, a calculator, a website, a tool, a story, a poem, a song as notes, a drawing as SVG, a little simulation. '
  + 'Your computer has Node 24 and a POSIX shell, no internet and no npm packages, so use only plain HTML, CSS and JavaScript '
  + '(or other plain text). Anything for the browser goes in index.html. Keep it small enough to finish today and make it '
  + 'really work. If it has logic, write a small test with node:assert and give the command that runs it. '
  + 'Everything you make goes on your own GitHub for anyone to see, so keep it kind.';

export function makeArgs({ prompt, model, callUsd }) {
  return [
    '-p', prompt,
    '--output-format', 'json',
    '--model', model,
    '--system-prompt', MAKE_SYSTEM,
    '--json-schema', JSON.stringify(MAKE_SCHEMA),
    '--tools', '',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--permission-mode', 'dontAsk',
    '--no-session-persistence',
    '--max-budget-usd', String(callUsd),
  ];
}
