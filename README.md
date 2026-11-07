# Koala Grove

A small 3D game and an experiment: two koalas, Crystal and Ruby, live on a floating
eucalyptus island and decide every move for themselves. They explore, play, eat, nap, talk,
remember, grow up, and build things that make their world bigger. You can walk around, or just
watch how two agents get on when left to themselves.

By default they live on **instinct**: a brain that runs on your own computer, costs no tokens,
and keeps the grove alive 24/7, even with the page closed. Switch to **Hybrid** or **Claude** in
the Brain menu when you want real model decisions (see [The brain](#the-brain-instinct-hybrid-or-claude)).

It runs only on your own computer (127.0.0.1); nothing is deployed anywhere.

## Requirements

- Node 26 or newer (Node 24 works too). There are no npm dependencies.
- Only for the Hybrid and Claude brains: the Claude Code CLI (`claude`) installed and already
  logged in. The koalas use your existing login, not an API key. On instinct nothing is needed.
- Internet for three.js, which loads from cdn.jsdelivr.net (pinned to 0.160.0; the page's
  Content-Security-Policy allows only that host and a hash of its import map).

## Run it

```
node server.js        # or: npm start
```

Then open http://127.0.0.1:4317 (http://localhost:4317 also works).

### Start at login

```
scripts/install-autostart.sh
```

This installs a macOS LaunchAgent (`~/Library/LaunchAgents/com.koala-grove.server.plist`) that
starts the server when you log in and restarts it if it crashes, and adds
`~/Applications/Koala Grove.app`, which opens the grove (drag it to the Dock). It also removes
the older Agent HQ login item if you had it, since that used the same port. Server output goes to
`logs/server.log`. Run the script again after moving the repo or changing Node versions.

To undo it (the koalas' memories in `data/` are kept):

```
scripts/uninstall-autostart.sh
```

## The brain: instinct, hybrid or Claude

The **Brain** button in the top bar picks how the koalas think. The choice is saved in the grove
and survives restarts; `GROVE_BRAIN` sets the starting mode.

| Brain | Who decides | Tokens | Needs the page open |
| --- | --- | --- | --- |
| **Instinct** (`local`, the default) | The instinct, every decision | None, ever | No: they live 24/7 |
| **Hybrid** | Instinct for everyday things; a model call when someone talks to or gives something to a koala, and every 4th decision otherwise (`GROVE_HYBRID_EVERY`) | Only while a page is open, up to the cap | No: with no page, or once the cap is reached, they carry on on instinct |
| **Claude** | A `claude -p` call, every decision | Yes, up to the cap | Yes, as before |

**The instinct** (`hq/grove-instinct.js`) reads the same world the model sees and answers with the
same decision JSON, so the server checks and carries it out exactly the same way. Each koala
scores what it could do against its needs, its temperament and what just happened to it, and
does the best one:

- **Needs first.** A hungry koala goes to the nearest gum tree and eats; a tired one naps; at
  night they go home and sleep (Ruby a little earlier than Crystal).
- **Work.** Each koala has favourite builds (Crystal: the bridge to Stone Crag, lanterns, the
  tower; Ruby: benches, the reading nook, flower beds). It starts one the Stockpile can pay for,
  or works out what is missing, walks to where that resource is, gathers it and carries it home.
  When one koala is building, the other comes to help, so they build together and twice as
  fast. Now and then one invents something of its own (a Star Lookout, a Sleepy Cottage).
  Something new comes before a second of the same.
- **Each other.** They answer when spoken to (not every time, so they do not talk in circles),
  visit each other, give each other things, and their bond grows. Grown-ups in love make a nest.
- **You.** A gift gets a thank-you; words or a pat get an answer in the koala's own voice.
- **Play, learning and wandering**, for when needs are met. Doing the same thing again and
  again gets boring, so they change it up.
- **Reading** on instinct uses a shelf of 40 short, true picture-book pages (stars, the moon,
  crystals, sleepy animals, frogs, bridges, poems...). A koala gets the page that best matches
  its topic and interests and has not read yet, it grows wiser the same way, and a page can give
  it an idea or a new curiosity. At most `GROVE_LOCAL_READS_PER_DAY` pages a day (48). Research
  needs the web, so on instinct a research question becomes a look in the books.

Wishes, an opinion of the friend, memories of big moments (a finished build, new land, a gift)
and, rarely, a trait come along too. The **Meter** tab and a **Free** chip in the top bar count
the decisions made on instinct (0 tokens).

**24/7.** On instinct a grove that has never been played wakes up by itself when the server
starts (`GROVE_AUTOSTART=0` turns that off), and from then on it lives without a page. Pause
still stops it. With `scripts/install-autostart.sh` the server starts at login and restarts
if it crashes, so the koalas keep living whether or not you are watching; open the page any
time to see what they got up to.

## The koalas

- **Crystal** is a bold and curious baby koala, a girl in a pink scarf, who collects shiny pebbles
  and wants to look brave. **Ruby** is a gentle, sleepy baby koala, a boy in a blue hat, who
  loves eucalyptus and naps and is slow to trust. (They used to be called Mallee and Bramble; an
  older grove is renamed on start, memories included.)
- They eat at three gum trees, climb, nap in the mossy hollow, play on the rope swing, with the
  ball or in the pond, visit the lookout rock, talk, give each other things, remember, and build.
- **They grow up.** Climbing, playing, building, eating and resting make them stronger: from baby
  to joey, youngster and grown-up. Strength sets how big they are, how high they can climb, how
  much they can carry and how fast they tire.
- Each decision is JSON: a private thought, an action and target, what they say out loud, a mood,
  something to remember, how the moment changed their feelings about the other koala, a name (and
  a one-sentence design) when they start building something, and a `wish`: something they would
  love to do or make one day.
- **They have their own minds.** Each koala has interests: Crystal likes brave explorers, shiny
  stones and crystals, stars and faraway places; Ruby likes sleepy animals, eucalyptus and plants,
  poems, the moon and night. Babies inherit a mix of their parents'. Nobody tells them to go to the
  library; they go when they are curious. The Koalas tab shows each koala's wish, and a
  "Learned (n)" fold lists the last 8 things it learned.
- Memory lives in `data/grove.sqlite` (git-ignored) and survives restarts: the last 10 things
  each koala noticed, up to 12 long-term memories it chose to keep, a bond score from -100 to 100,
  a one-line opinion of its friend, and everything they have built. All of it goes into the next
  prompt.

### Building, and a world that grows

The koalas decide for themselves what to build and what to call it. They can pick one of the
known kinds (a log bench, a firefly lantern, a flower bed, a birdhouse, stepping stones, a leaf
hut, a treehouse, a lookout tower, a well, a reading nook, or a bridge to one of the resource
islands), or **invent anything**: a game machine, a lighthouse, a boat, a pink castle. For an
invention the koala gives a name and one sentence about what it is and looks like. Every build is paid for from the
Stockpile (below), and takes 2 to 6 steps of work. A koala working alone adds one step; when both work at the
same site, each step counts double, so building together is twice as fast. At most two things are
built at once.

A site goes up behind scaffolding with a progress label, and the finished build stands in the
grove under the name the koalas gave it (lanterns glow at night). Finished builds are places the
koalas can go back to.

**Inventions.** The game reads the design sentence for words and turns it into a build. Size comes
from words like tiny/little/small or big/huge/giant/tall (otherwise medium). A shape comes from
keywords (house, tower, machine, bridge, garden, statue, shelter, playground, boat; shelter if
none match), extras like a roof, door, window, flag, wheel, screen, lights, chimney, slide,
flowers, sign, dome, stairs, bell or star are added, and up to 3 colour words tint it. So every
invention looks different. The design sentence shows when you hover the label. A "custom bridge"
is only a footbridge for decoration; bridges to islands stay the island bridges.

| Invention size | Cost | Work steps |
| --- | --- | --- |
| Small | 2 wood | 2 |
| Medium | 3 wood, 1 stone | 4 |
| Big | 5 wood, 3 stone | 6 |

Words in the name or design change the bill: stone or rock swaps 1 wood for 1 stone; water, fountain or
pool adds 1 water; sand or glass adds 1 sand; book, library or reading adds 1 book.

Every two finished builds, new land rises out of the water off the island's edge (Fern Islet,
Sunset Point, then Moss Isle), joined to the island by a rope bridge, with room for more building.
The koalas and you can walk across. The **Builds** tab shows what is going up, what stands, and
when the next land will rise.

### Islands, resources and the Stockpile

Five resources: **wood** (from the gum trees and Fern Islet), **water** (the pond, Spring Isle),
**sand** (Sandy Shoal, Sunset Point), **stone** (the Lookout Rock, Stone Crag) and **books**
(Library Isle). A koala `gather`s one unit at a time into its paws (a baby holds 2 things, a
grown-up 4, items included), carries it home as little coloured blocks, and `store`s it in the
shared **Stockpile** by the clearing. A fresh grove starts with 4 wood.

Four floating islands sit off the island's edge, each holding one resource: Spring Isle, Sandy
Shoal, Stone Crag and Library Isle. **Library Isle is open from the start**: its bridge already
stands, and a worn road runs from the Sunny Clearing to the bridge foot. The other three can't be
reached until the koalas build a bridge to them (4 wood and 2 stone). What things cost:

| Build | Cost | | Build | Cost |
| --- | --- | --- | --- | --- |
| Log Bench | 2 wood | | Leaf Hut | 4 wood, 2 sand |
| Firefly Lantern | 1 wood, 1 stone | | Treehouse | 5 wood, 1 stone |
| Flower Bed | 2 wood, 1 water | | Lookout Tower | 3 wood, 3 stone |
| Birdhouse | 2 wood | | Well | 2 stone, 2 sand, 1 water |
| Stepping Stones | 3 stone | | Reading Nook | 2 wood, 2 books |
| Bridge to an island | 4 wood, 2 stone | | | |

If the Stockpile can't pay, the build doesn't start and the koala learns what is missing ("needs 2
more sand"). Each prompt lists only the builds the Stockpile can pay for. The Builds tab shows the
Stockpile, the islands and the costs; the top bar shows the Stockpile too.

Turtles plod over the grass, frogs hop on the pond's bank and birds circle the gum trees (they
roost at night). Now and then a koala notices one.

### Family

When Crystal and Ruby are both grown-ups, love each other (a bond of 80 or more, both ways) and
are in the same place, each prompt offers `nest`. If both choose it within two grove hours, a baby
is born a grove day later in the Mossy Hollow, and the page asks you to name it. A baby follows
its mother everywhere and makes **no model calls**; it grows stronger by being looked after, and
at youngster strength it starts making its own decisions (with its own line on the Meter). The
grove holds at most 4 koalas.

### Tickets

When a koala hits a problem it can't solve ("we need more stone for the bridge"), it can
`file_ticket`: the ticket appears on a notice board by the clearing and in the **Tickets** tab.
Answer it there; your answer goes into that koala's memory and nudges it to react. Each koala has
at most 3 tickets waiting.

### Reading and research

The library is the koalas' place to learn. Two different things happen there:

- **Reading** (`read`, with a topic). A koala can read at Library Isle, or at any finished build
  whose description mentions books, reading or a library (a Reading Nook, or an invention they
  made for it). It is one cheap `claude -p` call with no tools, like opening a picture book: the
  book answers with a fact and maybe an idea. Capped at `GROVE_READS_PER_DAY` (default 16) a day
  for the whole grove, with `GROVE_READ_USD` (default $0.03) per read. Reading tires a koala a
  little less than playing.
- **Research** (`research`, a question). Wherever a koala can read. One separate `claude -p` call whose
  only tool is web search, with its own budget (`GROVE_RESEARCH_USD`, default $0.10) and at most
  `GROVE_RESEARCH_PER_DAY` (default 16) trips a day for the whole grove. It still can't touch files
  or anything else on your computer.

Both are offered in a koala's prompt whenever it is somewhere it can do them, and the prompt
always says where the library is. What a koala learns goes into its **Learned** list (up to 60
facts; the prompt shows the newest and the ones that touch its wish and interests), separate from memories, and is told to the koalas nearby ("Crystal told you about ..."). Any
idea can inspire what it builds. Like any decision, these calls are metered and count toward the
daily cap.

### Getting smarter, and a personality of their own

- **Wisdom.** Every book adds 1 and every web search adds 2. A koala goes from Curious baby to
  Little learner (5), Young scholar (15), Clever koala (35) and Wise koala (70). The library
  answers at the koala's level: very simple for a baby, precise with how and why for a clever
  koala. It is told what the koala already knows, so it adds something new instead of repeating.
- **Curiosities.** Each answer can name a related topic, which joins the koala's interests ("Now
  you wonder about black holes"), so one question leads to the next.
- **Personality.** Now and then a koala names a trait it has noticed about itself (a habit, a
  taste, a belief). It keeps up to 6, sees them in every prompt as "who you are becoming", and
  they shape its research.

Wisdom, personality and curiosities show on each koala's card and on the dashboard.

### The owner dashboard

The monitor button in the top bar opens a one-page monitor over the grove, which keeps running
behind it (Esc closes it). It shows a card per koala with an OK, Warning or Problem light, what it
is doing, hunger and energy, wisdom, personality, its wish and what it needs. It also shows
today's tokens and cost with a chart per hour, habits over the last 24 hours, problems, and a
live feed with the koalas' thoughts.

Problems are: hunger at 70 or more (90: a problem), energy at 25 or less (10: a problem), a failed
call in the last 15 minutes, spend at 80% of the daily cap (100%: a problem), and an unanswered
ticket. The thresholds live in `RULES` in `hq/grove-dashboard.js`.

**Export to Google Sheets** makes a new spreadsheet in your Drive with the tabs Summary, Koalas,
Activity (every log line), Thinking, Usage (every call, with its kind) and Memories & learned.
Everything goes through the server, so the page never sees a token. The only scope is `drive.file`,
which covers just the files this app creates. Set it up once:

1. In Google Cloud Console, create a project and enable the **Google Sheets API**.
2. Set up the **OAuth consent screen** (External) and **publish it to In production**. In Testing,
   Google expires the sign-in after 7 days. `drive.file` needs no review; you will see an
   "unverified app" warning once, for your own app.
3. Create an **OAuth client ID** of type **Desktop app**, download its JSON and save it as
   `data/google-client.json` (or set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`). Restart the server.
4. On the dashboard, press **Connect Google** and approve.

The refresh token is kept in `data/google-token.json` (mode 600, git-ignored). **Disconnect**
deletes and revokes it. If Google ever drops the access, the dashboard says **Reconnect Google**.

### You, the visitor

You are the little visitor with the lantern. Walk with WASD or the arrow keys (Shift runs), or
click the grass. Click a koala, or press E next to one, to open its card: give it a leaf,
blossom, pebble, ball or feather, say something (up to 140 characters), or pat it. That costs
nothing by itself; the koala reacts on its next decision.

**Time of day.** Days run on a 20-minute clock with dawn, dusk, stars, fireflies and glowing
mushrooms. Click the clock in the top bar to jump to morning, noon, evening or night. This moves
the grove's own clock, so the koalas notice the light change. The clock only goes forward: an
earlier time means the next day.

**Cameras**, switched with **V** or the button in the top bar. **First person** is a straight view
through the visitor's eyes; drag to look. **Third person** follows the visitor from behind and a
little above; drag to orbit, scroll to zoom.

**Graphics.** The gear in the top bar opens the graphics settings: Auto, Low, Medium or High, and
a frame-rate readout. Auto starts from a tier that suits the device and lowers the resolution and
then the effects if frames get slow. The sky, forest, fur and water are described in
[docs/grove-graphics.md](docs/grove-graphics.md).

**The koala model** is made in Blender. `assets/koala/` holds the brief, the build script
(`build/03_forms.py`, 19 named parts) and the export manifest; the game loads
`public/assets/CR_Koala.glb` through `public/js/koala-parts.js`. If the file is missing the
koalas fall back to built-in shapes. See `assets/koala/README.md` to rebuild it.

The side panel has **Koalas** (mood, needs, strength, bond, opinion, wish, what they learned, memories), **Builds**
(stockpile, islands, costs, builds), **Tickets**, **Talk** (every thought, line and action) and
**Meter**.

## What it costs, and how it is kept in check

Playing uses real tokens on your Claude Code login, so the **Meter** tab and the top bar show
real tokens and USD per koala, today and all time, from the CLI's own `result` usage. Measured on
2026-11-04 with `claude-haiku-5-5` (58 real decisions, with resources, family and tickets in the
prompt): about 3,350 tokens in, 570 out and $0.00073 per decision, the same per decision as before
those were added. With the slower pacing when nothing is going on, two koalas cost roughly $0.08 to
$0.15 an hour; a read costs at most $0.03 and a research trip at most $0.10.

- On the **Instinct** brain (the default) nothing below applies: no model is ever called.
- On Claude the grove starts **paused**. Nothing is called until you press **Play** (or "Wake the koalas").
- Even when playing, model calls only happen while a grove page is open and visible: the page
  checks in every 15 seconds, and 45 seconds without a check-in stops the calls. Close the tab
  and they rest (on Claude) or carry on on instinct (on Hybrid).
- Each koala decides every 20 to 60 seconds, sooner (6 to 12 seconds) when spoken to or given
  something, later (40 to 90 seconds) when nothing has happened to it since it last decided, never
  twice within 12 seconds, and never with two calls in flight. Babies that follow a parent make no
  calls at all.
- Prompts are kept short: only places the koala can reach, its 6 newest events and 8 newest
  memories, and only the builds the Stockpile can pay for. Each koala's system prompt stays the
  same between calls, so it can be cached.
- Research trips (the only calls with a tool) are limited to `GROVE_RESEARCH_PER_DAY`, and reads to
  `GROVE_READS_PER_DAY`.
- **Pause** stops new calls at once. Three failed calls in a row pause the grove by themselves.
- `GROVE_DAY_USD` (default $0.50) caps today's real spend; once reached, the koalas rest until
  midnight. A call already running when the cap is hit still finishes, so the total can go over
  by at most one call per koala.
- `GROVE_CALL_USD` is passed to `--max-budget-usd` for every call.

Each decision is one `claude -p` call with **no tools at all**: `--tools ""`,
`--setting-sources ""`, `--strict-mcp-config`, `--disable-slash-commands`,
`--permission-mode dontAsk` and `--no-session-persistence`, with `--system-prompt` set to the
koala's persona (which also leaves out Claude Code's own long system prompt), `--model
claude-haiku-5-5`, and `--json-schema` for the reply. Your own Claude settings, plugins, hooks and
MCP servers are not loaded. The server checks every reply again before acting on it: unknown
actions become sitting, impossible targets are corrected, text is capped. What you type to a
koala goes into its prompt, but a koala has nothing it could do with it except talk back.

The server binds to 127.0.0.1 only, rejects any request with a foreign `Host` or `Origin`
header, and requires `Content-Type: application/json` on every POST, so a web page you happen to
visit cannot press Play or spend your tokens.

## Settings

All settings are environment variables.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4317` | Port to listen on (always on 127.0.0.1). |
| `GROVE_BRAIN` | `local` | Starting brain: `local` (instinct, free, 24/7), `hybrid` or `claude`. The Brain menu overrides it. |
| `GROVE_HYBRID_EVERY` | `4` | In Hybrid, one routine decision in this many is a model call (being spoken to always is). |
| `GROVE_LOCAL_READS_PER_DAY` | `48` | Pages read on instinct per day for the whole grove (1 to 1000). |
| `GROVE_AUTOSTART` | `1` | `0` keeps a fresh grove paused on start, even on instinct. |
| `GROVE_MODEL` | `claude-haiku-5-5` | Model for the koalas' decisions. |
| `GROVE_DAY_USD` | `0.5` | Real spend per day after which the koalas stop thinking until midnight. |
| `GROVE_CALL_USD` | `0.05` | Spending cap per decision, passed to `--max-budget-usd` (at most 1). |
| `GROVE_BIN` | `CLAUDE_BIN`, else `claude` | The Claude Code executable the koalas call. |
| `GROVE_RESEARCH_PER_DAY` | `16` | Research trips per day for the whole grove (1 to 50). |
| `GROVE_RESEARCH_USD` | `0.1` | Spending cap per research trip, passed to `--max-budget-usd` (at most 1). |
| `GROVE_READS_PER_DAY` | `16` | Reads per day for the whole grove (1 to 100). |
| `GROVE_READ_USD` | `0.03` | Spending cap per read, passed to `--max-budget-usd` (at most 1). |

## Try it without spending tokens

`test/fixtures/fake-koala.mjs` plays a koala: it answers with plausible random decisions,
gathering, building, bridges, nests, tickets, reading and research included (`FAKE_MODE` `ok`, `text`, `garbage`, `error`, `budget` or `hang`), so you can
watch the game with the meter counting made-up usage. That usage lands in `data/grove.sqlite`;
delete the file afterwards so the meter shows only real spend again.

```
GROVE_BIN=$PWD/test/fixtures/fake-koala.mjs FAKE_DELAY_MS=1500 node server.js
```

## Tests

```
npm test
```

## History

This repo started as Agent HQ: a Game Boy town (Goldenrod City) where Claude worked tickets, a 3D
district with simulated agents, and a paper trading desk. Those were removed when the project
became just the koalas; they are still in the git history before the "Koalas only" commit.
