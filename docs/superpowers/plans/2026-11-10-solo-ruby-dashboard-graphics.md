# Solo Ruby: wishes, first person, search log, dashboard overview, graphics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the grove a solo game with Ruby: each new wish files a ticket, the koala speaks in first person, every web lookup is logged (query, article, link) and shown on an overview panel together with Ruby's wish, drives and open tickets, and the scene's graphics are improved.

**Architecture:** Pure helpers (ticket text, wording, search records, overview shaping) live in the modules that already own them (`hq/grove-tickets.js`, `hq/grove-instinct.js`, `hq/grove-dashboard.js`). The Grove class (`hq/grove.js`) only calls them and writes the log. The browser side adds one panel to `public/js/dashboard.js`. Graphics changes stay in `public/js/gfx/` and `public/js/scene.js`.

**Tech Stack:** Node 24 ESM, `node:test`, `node:sqlite`, three.js 0.160 (CDN), plain CSS.

**Spec:** Approved in chat on 2026-11-10 (the five-item design); this plan is that design, decomposed.

## Global Constraints

- The cast is set by `GROVE_KOALAS` (`hq/config.js`, `castOf`). Default `crystal,ruby`; the local grove runs `ruby`. Code must not assume a friend exists in the grove.
- No new npm dependencies (`package.json` has none).
- Model calls stay capped by the existing `config` values; this plan adds no model calls.
- `data/`, `work/`, `logs/` are never committed.
- Ruby's own text uses "I", "me", "my". The words "we", "us", "our" and "let us" never appear in Ruby's own lines.

## Review Focus

1. A wish that repeats the previous wish must not file a second ticket (input: same wish text twice in a row).
2. A ticket filed while Ruby already has three open tickets is skipped, not queued (input: fourth wish).
3. A search with no article still logs a row saying "nothing found", so the overview never looks empty after a lookup (input: Wikipedia returns null).
4. An overview with no searches, no tickets and no wish shows empty-state text, not a blank panel (input: fresh grove).
5. Search queries containing HTML characters render as text, not markup (input: `<img onerror>` in a topic).

---

### Task 0: The cast is a setting, and the solo grove is tested

Keep both koalas in `KOALAS` so the two-koala tests stay meaningful. A solo grove comes from `GROVE_KOALAS=ruby`. Done in this task: `castOf` in `hq/config.js`, `cast` in `GROVE_DEFAULTS` and `this.cast` in `hq/grove.js`, null-safe `friendOf`, and the friend checks in `hq/grove-instinct.js` and `hq/grove-family.js`.

**Files:**
- Modify: `hq/config.js`, `hq/grove.js`, `hq/grove-world.js`, `hq/grove-instinct.js`, `hq/grove-family.js`
- Test: `test/grove-solo.test.mjs` (new)

**Interfaces:**
- Produces: `castOf(raw: string | undefined): string[]`; `Grove.cast: Koala[]`; `friendOf(world, id)` returns `null` when no friend is in the grove.

- [x] **Step 1: Run the suite (both koalas)**

Run: `node --test "test/*.test.mjs"`
Expected: `# fail 0` (248 pass).

- [x] **Step 2: Solo tests**

Run: `node --test test/grove-solo.test.mjs`
Expected: 4 pass.

- [ ] **Step 3: Commit**

```bash
git add hq test
git commit -m "feat: GROVE_KOALAS runs a solo grove; friend lookups handle no friend"
```

---

### Task 1: Each new wish files a ticket

**Files:**
- Modify: `hq/grove.js` (near `#fileTicket`, around line 866; and where a decision's logs are handled, around line 1040)
- Modify: `hq/grove-tickets.js` (add a pure helper)
- Test: `test/grove-tickets.test.mjs`

**Interfaces:**
- Consumes: `Tickets.open(koala, text)`, `Tickets.openCount(koala)`, `MAX_OPEN_TICKETS` (existing).
- Produces: `wishTicketText(wish: string): string` in `hq/grove-tickets.js`, returns `I wish: <wish>` trimmed to `MAX_TEXT`. Grove gains `#wishTicket(id: string, wish: string): void`.

- [ ] **Step 1: Write the failing tests**

```js
test('a new wish files one ticket with the wish text', () => {
  // grove with Ruby; applyDecision a decision with wish 'Grow a garden of flowers'
  // assert tickets.list() has one ticket, koala 'ruby', text 'I wish: Grow a garden of flowers'
});
test('the same wish twice files no second ticket', () => { /* same wish in two decisions -> still one */ });
test('a fourth wish while three tickets are open is skipped', () => { /* openCount = 3 -> no new ticket */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/grove-tickets.test.mjs`
Expected: FAIL (`wishTicketText` / `#wishTicket` not defined).

- [ ] **Step 3: Implement `wishTicketText` and `#wishTicket`**

`#wishTicket` is called only when the decision produced a `wish` log entry (the existing `newWish` path in `applyDecision` in `hq/grove-world.js`, around line 510). It skips when `openCount >= MAX_OPEN_TICKETS`. Log a `ticket` entry as `#fileTicket` does, and refresh `this.world.tickets`.

- [ ] **Step 4: Run tests until they pass**

Run: `node --test test/grove-tickets.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hq/grove.js hq/grove-tickets.js hq/grove-world.js test/grove-tickets.test.mjs
git commit -m "feat: a koala's new wish files a ticket"
```

---

### Task 2: First-person wording

**Files:**
- Modify: `hq/grove-instinct.js` (lines around 257, 281-282: "made a nest for us", "Shall we make", "We have enough to make", "Let us build")
- Modify: `hq/grove-world.js` (prompt text in `systemPrompt` and `buildPrompt` that says "we"/"us"/"our")
- Modify: `hq/grove.js` (around line 470: "we built it in the grove")
- Test: `test/grove-instinct.test.mjs`

**Interfaces:**
- Consumes: the instinct's `say` / `thought` strings (unchanged shape).
- Produces: no new functions.

- [ ] **Step 1: Write the failing test**

```js
test('Ruby never speaks of "we", "us" or "our" in its own lines', () => {
  // run instinctDecide many times with a seeded rng on the solo grove; collect thought and say
  // assert none match /\b(we|us|our|let us)\b/i
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/grove-instinct.test.mjs`
Expected: FAIL, listing the lines that contain "we".

- [ ] **Step 3: Rewrite each self-directed line in first person**

Example: `Let us build a ${name}!` becomes `Let me build a ${name}!`; `We have enough to make a ${name}.` becomes `I have enough to make a ${name}.`. Lines addressed to a friend (`{f}`) are left alone; the solo cast never reaches them.

- [ ] **Step 4: Run tests until they pass**

Run: `node --test test/grove-instinct.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hq/grove-instinct.js hq/grove-world.js hq/grove.js test/grove-instinct.test.mjs
git commit -m "fix: Ruby speaks in the first person"
```

---

### Task 3: Log every web search

**Files:**
- Modify: `hq/grove.js` (`#learn`, the offline branch that calls `this.web.lookup(topic)`, around line 790; and the Claude research branch)
- Modify: `hq/grove-web.js` (`lookup` already returns `{ title, extract, url }` or `null`; no change expected)
- Modify: `hq/grove-dashboard.js` (add `searchesOf`)
- Test: `test/grove-web.test.mjs` (new), `test/grove.test.mjs`

**Interfaces:**
- Consumes: `Grove.web.lookup(topic): Promise<{title, extract, url} | null>`.
- Produces: `#logSearch(id: string, query: string, source: {title, url} | null, via: 'wikipedia' | 'book' | 'research'): void`, which writes a log row with `kind: 'search'`, `target: query`, `text: "Searched "<query>": <title or 'nothing found'>"`, and `url` in `target`'s companion field. Store the link in the `text` as `(url)` when present so no schema change is needed. Also `searchesOf(rows, limit = 10)` in `hq/grove-dashboard.js` returns `[{ ts, query, title, url, via }]` newest first, parsed from those rows.

- [ ] **Step 1: Write the failing tests**

```js
test('a web lookup logs the query, the article title and link', async () => {
  // fake web.lookup returns { title: 'Koala', url: 'https://en.wikipedia.org/wiki/Koala', extract: '...' }
  // after a learn tick, grove_log has kind 'search' with target 'koala facts' and text containing the title and url
});
test('a lookup with no article logs "nothing found"', async () => { /* web.lookup -> null */ });
test('searchesOf returns newest first, capped at 10', () => { /* 12 rows -> 10 items, first is newest */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/grove-web.test.mjs test/grove.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `#logSearch` and call it at every lookup**

Call it after each `this.web.lookup(topic)` (offline branch) and after each Claude research call (the `via: 'research'` branch, query = topic, title/url from the model's cited source if any, else `null`). Implement `searchesOf` as a pure function.

- [ ] **Step 4: Run tests until they pass**

Run: `node --test test/grove-web.test.mjs test/grove.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hq/grove.js hq/grove-dashboard.js test/grove-web.test.mjs test/grove.test.mjs
git commit -m "feat: log every web search with its article and link"
```

---

### Task 4: Dashboard overview panel for Ruby

**Files:**
- Modify: `hq/grove-dashboard.js` (add `overviewOf`)
- Modify: `hq/http.js` (add the overview to the existing dashboard payload; find the route that serves `grove-dashboard` data)
- Modify: `public/js/dashboard.js` (render the panel at the top)
- Modify: `public/grove.css` or `public/base.css` (panel styles; reuse existing tokens)
- Test: `test/grove-dashboard.test.mjs`

**Interfaces:**
- Consumes: `searchesOf(rows)` (Task 3), the open tickets list (`world.tickets`), Ruby's state (`world.koalas.ruby`, its `wish` and `mind` drives).
- Produces: `overviewOf({ koala, tickets, searches }): { wish: string | null, drives: [{ name: string, value: number }], searches: [...], openTickets: [...] }` in `hq/grove-dashboard.js`. The payload gains `overview`.

- [ ] **Step 1: Write the failing tests**

```js
test('overviewOf shows the wish, the drives, the searches and the open tickets', () => { /* assert shape */ });
test('an empty grove gives an overview with empty lists and wish null', () => { /* Review Focus 4 */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/grove-dashboard.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `overviewOf`, wire it into the payload, render it**

Render the panel above the existing tables. Escape every string with the same escaper the dashboard already uses (Review Focus 5); if none exists, add `esc(s)` that replaces `& < > " '`.

- [ ] **Step 4: Run tests, then check the page**

Run: `node --test test/grove-dashboard.test.mjs`
Expected: PASS
Then open `http://127.0.0.1:4317/dashboard` (or the dashboard route) and confirm the panel renders with no console errors.

- [ ] **Step 5: Commit**

```bash
git add hq/grove-dashboard.js hq/http.js public/js/dashboard.js public/grove.css test/grove-dashboard.test.mjs
git commit -m "feat: dashboard overview of Ruby's wants, searches and tickets"
```

---

### Task 5: Graphics improvements

**Files:**
- Modify: `public/js/gfx/sky.js`, `public/js/gfx/post.js`, `public/js/gfx/grade.js` (atmosphere, light, shadows, colour)
- Modify: `public/js/gfx/terrain.js`, `public/js/gfx/flora.js`, `public/js/gfx/props.js` (island, trees, flowers)
- Modify: `public/js/gfx/materials.js`, `public/js/koala.js` (fur and koala material)
- Modify: `public/js/scene.js` (only to wire the above)
- Test: `test/grove-gfx.test.mjs`, `test/grove-visual.test.mjs` (existing; keep green)

**Interfaces:**
- Consumes: the existing exports of each `gfx` module (keep their signatures).
- Produces: no changed exports; if a signature must change, the caller in `scene.js` changes in the same commit.

- [ ] **Step 1: Capture a baseline screenshot**

Open the page, wait for the scene to settle, take a screenshot. Save it to the scratchpad as `before.png`.

- [ ] **Step 2: Run the existing graphics tests**

Run: `node --test test/grove-gfx.test.mjs test/grove-visual.test.mjs`
Expected: PASS (baseline).

- [ ] **Step 3: Make one visible improvement per commit**

Order: lighting and shadows, sky and water, flora, koala fur. After each change, keep the graphics tests green and take a screenshot to confirm the change is visible and nothing is broken.

- [ ] **Step 4: Compare and commit each improvement**

Take `after.png` for the final pass. Each commit message names what changed, e.g. `feat(gfx): soft shadows and warmer light`.

---

### Task 6: Pull requests

**Files:** none (git only)

- [ ] **Step 1: Koala-Grove PR**

The local folder is the source. Clone `FaiGiJoon/Koala-Grove` to the scratchpad, create branch `feat/solo-ruby-dashboard-graphics`, copy the local tree over (excluding `data/`, `work/`, `logs/`, `node_modules/`, and anything matching a secret pattern), commit, push, and open a PR against `main`. The PR body must say it includes earlier local work that is not yet on `main`.

- [ ] **Step 2: Koala-repo PR**

The koala repo (`FaiGiJoon/Repo-for-the-Koala-s`) received the removal of the old folders directly on `main` (commit `dae2d6f`) before this plan. This plan adds no koala-repo file changes, so there is nothing new for a PR. Say so in the final message.

- [ ] **Step 3: Verify**

Run: `gh pr view --json url,state` (with `GH_TOKEN` from `data/grove.env`) for each PR.
Expected: both PRs open with URLs.
