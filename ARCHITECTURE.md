# Nines architecture

Nines is a static browser game that later ships as an Android app. The player walks a career
trail in a top-down pixel world and fixes simulated machines in an in-game terminal. This
document is the Architect's part of the brief: the modules, the terminal simulator, the
condition language, the content schemas, saves, i18n, offline loading and the Android build.

Principles, in priority order:

1. **Content drives a small engine.** Quests, NPCs, dialogue, machines and win conditions are
   YAML in `/content`. The engine knows a fixed set of commands and facts; content combines
   them. Contributors never write JavaScript.
2. **Nothing leaves the device.** No network calls at runtime, no tracking, no analytics, no
   ads. Saves live in `localStorage`. Content is bundled at build time.
3. **Pure core, thin shell.** The simulator, the condition language, saves and i18n are pure
   TypeScript with no DOM or Phaser imports, so they are unit-tested in Node. Phaser and the
   DOM only render and collect input.
4. **Boring and auditable.** Few dependencies, exact pins, short files, no code generation at
   runtime (`eval`, `new Function`), and checks in CI for the rules that matter.

## Modules

```
src/
  rules/          the condition language (pure)
    expr.ts         lexer, parser, type checker, evaluator
    registries.ts   which facts content may ask about, with their types
  sim/            the terminal simulator (pure)
    state.ts        SimState and createState(scenario)
    vfs.ts          filesystem queries and changes, globbing, disk usage
    path.ts, size.ts  path and size helpers
    ci.ts           the "nines-ci" pipeline validator
    facts.ts        SCENARIO_FACTS implemented over SimState
    shell/parse.ts  command line and flag parser
    shell/commands.ts  the commands
    session.ts      run a line, save a file, evaluate events, hints, objectives
  core/           game rules without rendering (pure)
    i18n.ts         t(key, params), locale choice
    save.ts         save format, versioning, migrations
    progress.ts     PROGRESS_FACTS implemented over the saved game
    (MVP) game.ts   money, XP, quest completion, shop purchases
  content/
    types.ts        TypeScript mirror of the schemas; the bundle's shape
  game/           Phaser and DOM (thin)
    BootScene.ts    placeholder in phase 1
    (MVP) WorldScene, HudScene, RoadmapScene, ShopScene, TerminalOverlay (DOM + xterm.js)
tools/
  content/load.ts         load + validate + bundle /content (Node, build time only)
  vite-plugin-content.ts  exposes the bundle as `virtual:nines-content`
schemas/          JSON Schemas for every content file
content/          the game's data
tests/            Vitest: rules, sim, quests played end to end, content, guards
```

Dependencies point one way: `game → core, sim, rules, content/types`; `sim → rules`;
`tools → sim, rules` (to validate content with the same code the game runs). Nothing in
`rules`, `sim` or `core` imports Phaser or touches `window`, `document` or `localStorage`
directly (`save.ts` takes a storage object).

## The terminal simulator

The terminal is not a shell. It is a small simulator of one machine per quest, driven by a
`scenario.yaml`, with a command parser in front of it and the condition language behind it.

### State model

`SimState` (`src/sim/state.ts`) is plain JSON so a session can be cloned with
`structuredClone`, reset to its starting snapshot and, if ever needed, saved.

| Part | Shape | Notes |
| ---- | ----- | ----- |
| Filesystem | `fs: Record<absPath, {type:'dir'} \| {type:'file', size, content?}>` | A flat map. Children of a dir are the keys whose dirname is that dir. Scenarios hold at most a few hundred entries, so linear scans stay simple and obviously correct. A file has a `size` in bytes and optional visible `content`; a 2.4 GB log is `size: 2.4G` plus a few lines of content (its tail). Editing a file sets `size` to the content's byte length. |
| Mounts | `mounts: {path, device, size, baseUsed}[]` | A path belongs to the longest mount path that contains it. Used = `baseUsed` (space the scenario does not list) + the sizes of the files on that mount. `df` and `disk_usage()` read this, so `rm` and `mv` free space naturally, including moving a file to another mount. |
| Services | `services: Record<name, {description, state, enabled, logs[]}>` | `state` is `active`, `inactive` or `failed`. `logs` is the journal. A restart evaluates the scenario's `restart.succeeds_if` condition: true makes it `active` and appends success lines, false makes it `failed` and appends failure lines. |
| Pods | `pods: {name, namespace, deployment, status, restarts, age, logs[]}[]` | Derived from `deployments` in the scenario. `kubectl rollout restart` replaces a deployment's pods with new, deterministically named ones whose status follows `restart.succeeds_if`. |
| Git | `git: {root, branch, head, index, commits}` | `head` and `index` map repo-relative paths to a content signature. The working tree is the filesystem. `status` diffs the three; `add` copies working tree to index; `commit` copies index to head. |
| Pipeline | `pipeline: {status: none\|passed\|failed, runs}` | When the scenario names a pipeline file, every commit "runs CI": the committed file goes through the `nines-ci` validator and the result is printed and stored. |
| Bookkeeping | `cwd`, `oldpwd`, `counters {commands, fails}`, `ran[]`, `restarted[]`, `flags`, `firedEvents[]`, `shownHints[]`, `generation` | What the player did, for hints and conditions. `ran` holds command names and, for systemctl, kubectl and git, "name subcommand" (`git commit`). |

No clocks and no randomness: log timestamps come from a fake clock that moves 7 seconds per
command, and pod names come from a hash of the deployment and a counter. The same inputs give
the same outputs, so quests are testable end to end.

### Command parser

`src/sim/shell/parse.ts`:

- **Words**: split on spaces and tabs; single quotes are literal; double quotes allow `\"` and
  `\\`; a backslash escapes one character. `~` and `~/x` resolve to the home directory.
- **Pipes**: `a | b` passes `a`'s output lines to `b` as stdin. `cat`, `less`, `tail` and
  `grep` read stdin; the others ignore it.
- **Globs**: an unquoted `*` or `?` expands against the filesystem (dotfiles only with an
  explicit dot), like bash; no match leaves the word as typed.
- **Refused with a friendly message**: `>`, `>>`, `<`, `;`, `&`, `&&`, `||`, `$VAR`, `$( )` and
  backticks. The player learns this terminal's limits instead of seeing nothing happen.
- **Flags**: a getopt-style helper per command: clusters (`-rf`), values (`-n 20`, `-n20`),
  long options (`--no-pager`, `--tail=5`), `--` to end options. An unknown flag prints the
  real tool's style of error plus the usage line.
- `sudo` in front of a command is accepted and ignored: the player is root in every scenario.

### Commands

Each command is a pure function `(ctx, args, stdin) → {out, exit, fail?, ui?, outage?}` that
may change the working copy of the state.

| Command | Supported |
| ------- | --------- |
| `help [cmd]` | the list with one line each; usage for one command |
| `ls` | `-l -a -A -h -1`, several operands; dirs shown with a trailing `/` |
| `cd`, `pwd` | `cd`, `cd ~`, `cd -`, `cd ..` |
| `cat`, `less` | files or stdin; `less` asks the UI for a pager |
| `tail` | `-n N`, `-N`, several files with headers, stdin; `-f` explains it does not follow |
| `grep` | `-i -v -n -c -r -l -F`, regex or fixed string, files, folders (`-r`) or stdin; exit 1 on no match is not a "failed attempt" |
| `df` | `-h`, per mount, rounded up like coreutils |
| `du` | `-s -h -c`, several operands and globs, recursive listing without `-s` |
| `rm` | `-r -f -v`; see Consequences |
| `mv` | rename, move into a dir, several sources into a dir |
| `systemctl` | `status`, `restart` (and `start`) |
| `journalctl` | `-u unit`, `-n N`, `-xe` accepted, `--no-pager` |
| `kubectl` | `get pods [-n ns \| -A]`, `logs pod\|deployment/x [--tail N]`, `rollout restart deployment/x` |
| `git` | `status`, `add <paths> \| . \| -A`, `commit -m msg [-a]` |
| `edit` (`nano`, `vi`, `vim`) | opens the built-in editor (a UI action); saving calls `saveFile` |
| `clear`, `exit` | UI actions |

Output imitates the real tools closely enough that what the player learns transfers.

### Consequences, not blocks

Destructive commands are allowed and have effects:

- `rm -r` (or `mv`) on a vital path (`/`, `/etc`, `/usr`, `/var`, `/home` and the other
  top-level system dirs, so also `rm -rf /*`) raises the built-in **outage** event: a funny
  message, a money penalty (default €100, a scenario may override it) and the machine restored
  from its starting snapshot. What the player learned (counters, hints shown) stays.
- A scenario adds its own **events**: a condition, a message, an optional money change, an
  optional reset, an optional flag. Each fires once per session. Example: deleting the
  database in "Disk full" costs €150 and restores the machine.

### Session lifecycle

`src/sim/session.ts`. `createSession(scenario, {t, hintBoost})` compiles every condition once
(throwing on bad content, which the validator already prevents) and builds the starting
state. Then, for each line the player types, `run(session, line)`:

1. clones the state, parses the line, expands globs, runs the pipeline;
2. counts the command, and a failed attempt when the command says so (default: non-zero exit;
   `systemctl status` on a failed unit and a `grep` without matches do not count);
3. on an outage, records the event and resets the machine;
4. evaluates, in order: the scenario's events (once each), its hints (the first newly true
   one, so hints trickle), and its objectives;
5. returns `{out, exit, ui, events, hints, objectives, won, justWon}`.

`saveFile(session, path, content)` (the editor's Save) writes the file and runs step 4.

The UI layer renders the output in xterm.js, shows objectives and hints next to it, applies
money changes from events to the game state, and on `justWon` closes the quest.

**Hints** are conditions too, so a scenario can say "after two failed attempts and if the
player has not run df yet". The `fails` fact includes the homelab's `hint_boost`, which is
how "faster hints" works without special code.

## The condition language

Win conditions, hints, events, restart rules and NPC dialogue all use one small expression
language (`src/rules/expr.ts`). It is parsed into an AST and evaluated by walking the AST. It
is never passed to `eval` or `new Function`, has no property access, no assignment, no loops
and no way to name anything the engine did not register.

```
expr    := or
or      := and (("||" | "or") and)*
and     := not (("&&" | "and") not)*
not     := ("!" | "not") not | cmp
cmp     := atom (("==" | "!=" | "<" | "<=" | ">" | ">=") atom)?     no chaining
atom    := NUMBER | STRING | true | false | IDENT | IDENT "(" args ")" | "(" expr ")"
NUMBER  := 12 | 2.5 | 500M | 2G                                       K M G T = powers of 1024
STRING  := "..." | '...'                                              escapes \\ \" \' \n \t
```

Examples from the brief, all valid:

```yaml
done_when: 'disk_usage("/var") < 80'
done_when: 'service("nginx") == "active"'
done_when: 'pipeline_valid == true'
when: 'fails >= 2 && !ran("journalctl")'
when: 'quest("disk-full") == "done"'          # NPC dialogue, progress facts
```

**Types.** Values are numbers, strings or booleans. A checker runs before anything is
evaluated: names and functions must exist in the registry, arity and argument types must
match, `<`-style comparisons take numbers, `&&`/`||`/`!` take booleans, and a condition must be
boolean. String facts with a closed set of values (`service()` is `active`, `inactive` or
`failed`) reject literals outside the set, so `service("nginx") == "actve"` fails in CI.
Path arguments given as literals must be absolute.

**Limits.** 512 characters, nesting depth 24, at most 4 arguments. A runtime error (which the
checker should make impossible) evaluates to false instead of crashing.

**Registries** (`src/rules/registries.ts`) declare what may be asked; implementations live
with the state they read:

| Scenario facts (`sim/facts.ts`) | Type |
| ------------------------------- | ---- |
| `disk_usage(path)` | number, percent of the mount holding `path` |
| `size(path)` | number, bytes in a file or below a dir |
| `exists(path)`, `removed(path)` | boolean; `removed` = existed at the start and is gone |
| `file_contains(path, text)` | boolean |
| `service(name)` | `active` \| `inactive` \| `failed` |
| `restarted(name)` | boolean, service or deployment |
| `pods_running(deployment)` | boolean, all pods Running |
| `ran(command)` | boolean, `"df"` or `"git commit"` |
| `flag(name)` | boolean, set by events |
| `pipeline_valid` | boolean, the pipeline file in the working tree validates |
| `pipeline_status` | `none` \| `passed` \| `failed`, the last CI run |
| `git_clean`, `commits`, `fails`, `commands` | boolean, numbers |

| Progress facts (`core/progress.ts`) | Type |
| ----------------------------------- | ---- |
| `quest(id)` | `locked` \| `available` \| `active` \| `done` |
| `xp(branch)`, `money`, `tech_debt` | numbers |
| `has_item(id)`, `flag(name)` | booleans |

Adding a fact is one line in a registry, its implementation and a test. The validator picks
the registry by field: scenario fields use scenario facts, NPC dialogue uses progress facts.

## Content

### Layout

```
content/
  locales/en.yaml, nl.yaml        UI, roadmap, shop and terminal strings
  roadmap.yaml                    towns, branches, nodes (the Career Trail)
  shop.yaml                       homelab items
  maps/<id>.json                  Tiled maps (MVP build)
  npcs/<id>/                      world NPCs that give no quest (optional)
    npc.yaml, <sprite>.png, locales/en.yaml, nl.yaml
  quests/<id>/                    one quest = one folder = one cameo pull request
    quest.yaml                    who gives it, where it starts, the reward, quest dialogue
    scenario.yaml                 the machine and its conditions
    npc.yaml                      optional: the quest giver
    <sprite>.png                  optional: the giver's sheet (16x16 or 32x32 frames)
    locales/en.yaml, nl.yaml      every string the folder uses
```

Strings in a quest folder are keys into that folder's own locale files (`title`,
`offer.1`). The bundler namespaces them as `quest.<id>.<key>` so folders never collide; world
NPC keys become `npc.<id>.<key>`.

### Schemas

`/schemas` holds JSON Schema (draft 2020-12) files, all strict (`additionalProperties:
false`): `quest`, `scenario`, `npc`, `locale`, `roadmap`, `shop`, plus `common` for shared
definitions (ids, locale keys, conditions, absolute paths, sizes, authors). The `$id`s use
the reserved `.invalid` host: they are names, never fetched.

Key shapes, in brief (the schema files are the source of truth and carry descriptions):

```yaml
# quest.yaml
schema: 1
id: disk-full                      # = folder name
author: {name: "Nines team", handle?: "@x", url?: "https://..."}   # credits
title: title                       # locale keys
summary: summary
stage: junior                      # junior | medior | senior
branch: linux                      # one of the eight roadmap branches
track: any                         # any | sre | platform
roadmap_node: linux-disk           # lights up when done
requires: []                       # quest ids
giver: femke                       # npc id
start: {map: server-room, object: rack-web-01}   # interactable that opens the terminal
reward: {money: 150, xp: 20, tech_debt?: 0}
dialogue: {offer: [..], active: [..], done: [..]}

# scenario.yaml
schema: 1
host: web-01
user: dev
home: /home/dev
cwd?: /home/dev
motd: motd                          # shown when the terminal opens
mounts: [{path: /, device: /dev/sda1, size: 20G, base_used: 6G}]
dirs: [/tmp]
files:
  /etc/app.conf: "port 80\n"        # text file
  /var/log/big.log: {size: 2.4G, content: "last lines\n"}
services:
  nginx: {description: "...", state: failed, logs: [..],
          restart: {succeeds_if: '<condition>', logs_on_success?: [..], logs_on_failure?: [..]}}
deployments:
  api: {status: CrashLoopBackOff, restarts: 4, logs: [..], restart: {succeeds_if: '...'}}
git: {root: /home/dev/shop, pipeline: {file: .nines-ci.yml, validator: nines-ci}}
objectives: [{id, text, done_when}]          # all true = quest complete
hints: [{id, when, text}]
events: [{id, when, say, money?, reset?, set_flag?}]
outage?: {say?, money?}                       # override the built-in outage

# npc.yaml
schema: 1
id: femke
author: {name: ...}
name: npc.name
sprite?: {file: femke.png, frame: 16, source: "drawn by ...", license: CC0-1.0}
tint?: "#c86848"                   # placeholder sprite colour when there is no sheet
spawn: {map: junior-village, slot: npc-1, facing: down}
dialogue: [{when?: '<progress condition>', lines: [..]}]   # first match is spoken

# locales/en.yaml (flat; same keys and {placeholders} in nl.yaml)
title: "Disk full"
```

### Validation

`tools/content/load.ts` runs in Node: in the Vite plugin (an invalid content folder fails the
build), in `npm test` and as `npm run validate:content` in CI. It checks the schema of every
file and then what a schema cannot express:

- the content folder holds only YAML, PNG sprites and Tiled JSON (no scripts, ever);
- ids match folder names; ids and NPC spawn slots are unique across all folders;
- references resolve: `giver`, `requires`, `roadmap_node` (and its branch), maps;
- every condition parses and type-checks against the right registry, and names used in
  `service("...")`, `pods_running("...")` and `restarted("...")` exist in that scenario;
- every locale key a file uses exists in English and Dutch, both languages have the same keys
  and the same `{placeholders}`, and a folder has no unused keys;
- paths are absolute and normalised, a `/` mount exists, a pipeline file has content;
- the scenario actually starts (`createSession`);
- sprites are real PNGs whose size is 3 x 4 frames;
- no string or author name uses a denylisted name (Pokémon, Nintendo and friends).

## Loading content offline

Content is bundled at build time. The Vite plugin `tools/vite-plugin-content.ts` resolves the
virtual module `virtual:nines-content`: it loads and validates `/content` and emits one JSON
object (`ContentBundle`: merged locales, quests with their scenarios and NPCs, roadmap, shop,
credits). Sprite sheets are emitted as hashed files in `dist/assets/` and referenced by
relative URL. YAML is parsed at build time; the game never parses content YAML at runtime.

At runtime the game reads only files inside its own `dist/`. Maps (Tiled JSON) are imported
as modules and handed to Phaser as objects; tileset and sprite images load from same-origin
relative URLs. `base: './'` keeps every URL relative, so the same `dist/` works from a
sub-path on GitHub Pages and from the Capacitor WebView.

Guards:

- `index.html` carries a Content Security Policy: `default-src 'self'`, `connect-src 'self'`,
  `img-src 'self' data: blob:` (Phaser makes its default textures from data URIs),
  `object-src 'none'`. A request to another origin is refused by the browser.
- `tests/guards.test.ts` fails on `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
  `sendBeacon`, any `http(s)://` URL, `eval` or `new Function` in `src/`.
- Phaser's bundle contains the strings `https://phaser.io` (its console banner, which we turn
  off) and two XML namespace URIs. They are strings, not requests.
- The MVP's acceptance check is a devtools Network panel with zero requests outside the origin,
  documented with a screenshot in the MVP pull request (a browser task, see AGENTS.md).

The one runtime use of a YAML parser is the pipeline quest: the player's edited
`.nines-ci.yml` has to be parsed to be validated. That uses the same `yaml` package the build
uses (no dependencies of its own); it never sees content files.

## Saves

`src/core/save.ts`. One key, `nines.save`, in `localStorage`:

```json
{
  "format": "nines-save",
  "version": 1,
  "game": {
    "locale": "nl",
    "money": 350,
    "xp": {"linux": 20, "cicd": 25},
    "quests": {"disk-full": "done", "broken-pipeline": "active"},
    "items": ["raspberry-pi"],
    "flags": {},
    "tech_debt": 0,
    "player": {"map": "junior-village", "x": 7, "y": 6, "facing": "down"}
  }
}
```

- **Versioning.** `version` is the save format, not the game version. A format change bumps
  `SAVE_VERSION` and adds `MIGRATIONS[n]`, a pure function from version n to n+1; loading runs
  the chain. A save from a newer version is refused, never overwritten.
- **Robust loading.** After migration every field is checked and anything missing or of the
  wrong type falls back to a new game's value, so a hand-edited or partly broken save still
  loads. An unreadable save is copied to `nines.save.unreadable` before a new game starts, and
  the player is told.
- **What is not saved.** Terminal sessions. Opening a quest's terminal again starts its machine
  fresh, so content changes can never strand a save in a half-finished scenario. Quest ids are
  stable; a save that mentions a quest the content no longer has keeps the entry and ignores it.
- **When.** After a quest completes, after a purchase, on a locale change, when entering a map,
  and on `visibilitychange` to hidden (covers closing the tab and Android backgrounding).

## i18n

- English and Dutch. Every player-facing string is a key in a locale file: global strings in
  `content/locales/`, quest strings in the quest folder. `t(key, params)` falls back to
  English, then to the key itself (visible, and the validator stops it from shipping).
- The first visit picks Dutch on a Dutch device (`navigator.languages`), English otherwise.
  The NL/EN toggle in the menu overrides it and is stored in the save.
- **The terminal boundary.** Messages are keys (`sh.*`). Those that imitate a real tool
  (`rm: cannot remove ...`, `On branch main`) keep the tool's English wording in `nl.yaml` too,
  because the player should learn the messages real systems print. Messages in the game's own
  voice (`sh.unsupported`, `sh.vi_note`), `help.*`, hints, objectives and dialogue are
  translated. Command names, flags, column headers and log lines in scenarios are the
  interface being taught and are not translated.
- `tests/guards.test.ts` checks that every key used in `src/` exists in both languages.

## The Phaser layer (MVP build)

- **WorldScene**: a Tiled map with layers `ground`, `detail`, `above` (drawn over the player)
  and `collision` (tiles with property `collides: true`), plus an object layer with named points:
  `player-start`, `npc-1..n`, `cameo-1..n` (free slots for guest NPCs), interactables (`type:
  terminal`, named as a quest's `start.object`), doors (`type: door`, properties `to_map`,
  `to_point`) and the shop counter (`type: shop`). Tilesets are embedded in the map JSON. Grid
  movement on 16 px tiles, four directions.
- **HudScene**: money, menu, roadmap button, the dialogue box, the on-screen controls on touch
  devices.
- **TerminalOverlay**: DOM, not canvas, so text is crisp and the Android soft keyboard works.
  xterm.js renders the output (ANSI colours for prompts and errors). Input is our own
  `<input>` under it (`autocapitalize=off`, `autocorrect=off`, `spellcheck=false`,
  `enterkeyhint=send`): xterm's hidden-textarea input is unreliable with Android IMEs. A strip
  of quick-command buttons fills the input; Tab completes commands and paths; ↑/↓ walk the
  history. The editor is a `<textarea>` with a line-number gutter that marks lines with tabs.
- **RoadmapScene**, **ShopScene**, **CreditsScene**: canvas, driven by `roadmap.yaml`,
  `shop.yaml` and the bundle's `credits`.
- **Economy** (`core/game.ts`, pure): completing a quest adds its money and XP (to its branch),
  plus `income_per_quest` from owned items; events add or subtract money, never below zero; a
  purchase subtracts the price. `tech_debt` from meme side-quests is stored for later world
  events, which will use progress conditions (`tech_debt >= 3`).

## Android (Capacitor)

- `capacitor.config.ts` sets `appId` from `NINES_APP_ID`, default `work.westerweel.nines`
  (Mark's choice, the same pattern as his other apps), `webDir: 'dist'`.
- Flow: `npm ci && npm run build` → `npx cap sync android` copies `dist/` into
  `android/app/src/main/assets/public` → Gradle builds the AAB. The `android/` project is
  committed (it is source), but signing material never is: `.gitignore` excludes keystores, and
  the release signing config reads `NINES_KEYSTORE_FILE`, `NINES_KEYSTORE_PASSWORD`,
  `NINES_KEY_ALIAS` and `NINES_KEY_PASSWORD` from the environment.
- Capacitor serves `dist/` from inside the APK through its local scheme; no server, no
  network. The release manifest removes `android.permission.INTERNET` (`tools:node="remove"`),
  which makes the no-network promise enforceable by the OS. The Android chunk verifies the app
  still loads without it.
- No Capacitor plugins in the MVP. Back button: the WebView's default (back, then exit) until
  a reason appears to add `@capacitor/app`.
- Orientation: both. The Phaser canvas is a fixed 240x160 view scaled by an integer where
  possible; the controls take the remaining space: below the view in portrait, on both sides in
  landscape. The terminal overlay is a flex layout that shrinks when the soft keyboard opens
  (`interactive-widget=resizes-content` in the viewport meta for Chrome on Android).
- Target SDK: the level Google Play requires for new apps at build time. The Android chunk
  confirms it in the Play Console documentation before building (API 36 is the expected value
  in late 2026) and records it in PLAY_STORE.md.

## Dependencies

Pinned exactly, each version published at least two weeks before it was added (checked with
`npm view <pkg> time`), the lockfile resolved with `npm install --before=<date>`.

| Package | Version | Where | Why |
| ------- | ------- | ----- | --- |
| phaser | 3.90.0 | runtime | the engine the brief names; the last Phaser 3 release |
| yaml | 2.9.1 | runtime + build | content at build time; the player's pipeline file at runtime; no dependencies |
| typescript | 5.9.3 | dev | stable; 6.x changes defaults and 7.x is the new native compiler, neither buys us anything yet |
| vite | 7.3.8 | dev | build; Node 20.19+ |
| vitest | 4.1.12 | dev | tests; 5.x needs Node 22, and the agents' host runs Node 20 |
| ajv | 8.20.0 | dev | JSON Schema validation, build time only (it generates code, so it never ships) |
| @types/node | 22.20.5 | dev | types for tools and tests |
| @xterm/xterm | 6.0.0 | runtime, MVP build | the terminal renderer; no addons |
| @capacitor/core, cli, android | 8.x | Android phase | pinned when that phase starts |

## Testing and CI

- Vitest, in Node: the condition language, the parser, every command, the CI validator, saves,
  i18n, progress facts, the content validator (including that it rejects broken content), the
  guards, and the three MVP quests played end to end on the real content files.
- `.github/workflows/ci.yml` on every push and pull request: `npm ci`, content validation,
  `npm test`, `npm run build`. Actions pinned to commit SHAs, read-only token.
- Browser checks (Playwright, devtools) are for the MVP build and run under the memory cap in
  AGENTS.md, one browser at a time.
