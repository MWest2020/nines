# Nines architecture

Nines is a static browser game that later ships as an Android app. The player walks a career
trail in a top-down pixel world and fixes simulated machines in an in-game terminal. This
document is the Architect's part of the brief: the modules, the terminal simulator, battles,
the condition language, the content schemas, saves, i18n, offline loading and the Android build.

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
  battle/         battles: someone questions the player (pure)
    engine.ts       BattleState, rounds, meters, retry, hints
    score.ts        scoring per question type, perfect and worst answers, explanations
    seed.ts         seeded hash, PRNG and shuffle (no Math.random)
    triggers.ts     pager rolls and town gates
  core/           game rules without rendering (pure)
    i18n.ts         t(key, params), locale choice
    save.ts         save format, versioning, migrations
    progress.ts     PROGRESS_FACTS implemented over the saved game
    game.ts         money, XP, quest completion, shop purchases, the Career Trail's state
    persist.ts      the save slot over a key-value storage; never writes over a newer save
    talk.ts         what an NPC says, from the save
  world/          the map as a grid (pure)
    grid.ts         collision, objects, facing, steps, reachability; the validator uses it too
  terminal/       the terminal's input line without the DOM (pure)
    history.ts      up/down history with the line being typed kept as a draft
    complete.ts     Tab completion: commands, subcommands, units, deployments, paths
    editor.ts       the editor buffer: tab lines and the gutter, line/column, Tab = 2 spaces
  content/
    types.ts        TypeScript mirror of the schemas; the bundle's shape
  game/           Phaser and DOM (thin)
    BootScene.ts    loads tilesets and sheets, tints placeholder NPCs, starts the world
    WorldScene.ts   the map, grid movement, NPCs, doors, talk and use
    world/          events.ts (what the world emits), sprites.ts, PlaceholderDialogue.ts
    store.ts        GameStore: the live GameState behind core/game.ts, saves, change events
    api.ts          GameApi: what the world, terminal and battle code call (see below)
    bridge.ts       answers the world's talk, use and enter events through the GameApi
    storage.ts      localStorage, or memory when the browser blocks it
    ui/             HudScene + DialogueBox, TrailScene, ShopScene, CreditsScene, the pixel font
    terminal/       TerminalOverlay.ts (DOM + xterm.js), terminal.css, wire.ts (to the GameApi)
    (MVP) BattleOverlay (DOM)
assets/           tilesets and sheets outside content (Kenney packs, own art), each in ASSETS.md
tools/
  content/load.ts         load + validate + bundle /content (Node, build time only)
  vite-plugin-content.ts  exposes the bundle as `virtual:nines-content`
  art/draw-art.mjs        draws our own sprites and tiles (reproducible; --check in npm test)
  maps/build-maps.mjs     wrote the first versions of the Tiled maps from text layouts
schemas/          JSON Schemas for every content file
content/          the game's data
tests/            Vitest: rules, sim, terminal input, quests played end to end, content, guards
  e2e/smoke.py      the browser smoke test: the three quests typed into the real overlay
```

Dependencies point one way: `game → battle, core, sim, rules, terminal, world, content/types`;
`terminal → sim, rules`; `sim → rules`; `battle → core, rules`; `tools → battle, sim, rules, world` (to validate content with the same code
the game runs). Nothing in
`rules`, `sim`, `core`, `battle`, `world` or `terminal` imports Phaser or touches `window`, `document` or `localStorage`
directly (`save.ts` takes a storage object); `tests/guards.test.ts` checks it.

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
  optional reset, an optional flag. An event fires once per session, except one that resets
  the machine: the reset makes its condition false again, so it stays armed and doing the same
  damage twice costs twice. (If its condition is still true after the reset, because it reads
  something the reset keeps such as `fails`, it counts as fired for good.) Example: deleting the database in "Disk full" costs €150 and
  restores the machine. A flag set by an event comes back in the result (`setFlag`); the game
  stores it in the save, where progress conditions read it with `flag()`.

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
money changes from events to the game state, and on `justWon` closes the quest (see
TerminalOverlay below).

**Hints** are conditions too, so a scenario can say "after two failed attempts and if the
player has not run df yet". When hints are evaluated, the `fails` fact includes the homelab's
`hint_boost`, which is how "faster hints" works without special code; events, objectives and
restart rules see the real count.

**Names on `Object.prototype`.** Every lookup of a name that came from content or from the
player (commands, units, deployments, registry entries, git paths, locale keys) goes through
`own()`/`has()` (`src/rules/own.ts`), so `constructor` or `__proto__` is just an unknown name.
Tests cover it.

## Battles

A battle is the other kind of quest: instead of a machine, a person questions the player.
Mark's brief (26 Nov 2026): "someone attacks you with questions about design choices or a
production incident", at the level of a software-engineering interview. A quest folder holds
`battle.yaml` instead of `scenario.yaml`; the rest of the folder (quest.yaml, npc.yaml,
locales) is the same, so XP goes to the quest's branch, money comes from its `reward`, its
`roadmap_node` lights up, and `requires` and `quest("id")` work as for any quest.

**Kinds.** `design` (a system-design interview), `incident` (triage under pressure) and
`stakeholder` (a demanding colleague: scope, trade-offs, saying no well). The kind picks the
screen's framing and the name of the attacker's meter (DESIGN.md, Battles); the engine treats
them alike.

**Rounds.** Each round is one question with a prompt, `stakes` (pressure a perfect answer
removes) and `cost` (confidence a fully wrong answer costs; default = stakes). The answer is a
list of ids, and every type turns it into a quality from 0 to 1 (`src/battle/score.ts`):

| Type | The player | Quality |
| ---- | ---------- | ------- |
| `tradeoff` | picks one option; each option is a choice *with its reason*, so the right choice with the wrong reason is a distractor | grade of the pick: best 1, fair 0.5, weak 0 |
| `flaw` | reads a proposal on the whiteboard and picks its flaw | as tradeoff |
| `clarify` | picks the `pick` questions to ask the interviewer first | sum of the picks' grades / the best sum that many picks can reach |
| `order` | puts all steps in order; equal `rank`s are interchangeable (for steps that really run in parallel) | share of pairs with different ranks in the right order, rescaled `max(0, 2·share − 1)`: a random order scores about 0, one adjacent swap of six about 0.87 |
| `estimate` | picks a range for a back-of-envelope number; ranges ascend and touch, and `value` (the reference answer) must lie in the range graded best | grade of the range |

**Meters.** The player's *Confidence* and the attacker's *Pressure* both start at 100 (a
battle may set other maxima). An answer of quality q lowers Pressure by `round(stakes·q)`
and Confidence by `round(cost·(1−q))`; both are clamped to `[0, max]`. Every round is played,
so the player meets every question and its explanation, unless Confidence reaches 0, which
loses at once. After the last round the battle is **won when Pressure is 0** and lost
otherwise. Stakes may add up to more than the maximum, which leaves room for a slip: the battles
in content add up to 120.

**Explanations, every time.** Every option, step and range has a `why` (locale key, both
languages, enforced by the schema and the validator). After each answer the engine returns the
explanations of what was picked, then of the best answer when the answer was not perfect, and
for an estimate the `working`; for an order round, every step's reason in the right order. The
debrief after the battle shows them all again. Answer cards are written so that length gives
nothing away: tests check that the best card is neither usually the longest nor usually at any
one length rank, and that always picking the longest or the shortest cards loses.

**Losing never blocks.** `retryBattle` starts a fresh try from any state: meters refilled,
`attempt` + 1, wins kept, no money lost. Even the gate battle only waits for a win, with
unlimited tries and hints that grow with each attempt.

**Hints** reuse the condition language with the `BATTLE_FACTS` registry: `attempts` (tries
before this one), `misses` (answers in this try that were not the best), `round` (1-based),
`confidence`, `pressure`. A hint may name a `round`, then it shows only while that round is on
screen. Hints are computed from the state, not stored: all that apply are shown. The homelab's
`hint_boost` is added to `attempts` and `misses` for hints only, which makes the Raspberry Pi's
"hints come one try sooner" literally true here as well.

**Determinism.** No clock and no `Math.random` (`tests/guards.test.ts` checks the pure
modules). Cards are shown in a seeded shuffle of (battle, game seed, attempt, round): the same
save sees the same order, a retry sees a new one, and an order round is never shown already
solved. Estimate ranges stay ascending.

**Where battles come from** (`trigger` in battle.yaml, `src/battle/triggers.ts`):

- `npc`: talking to the quest's giver starts it; the giver is the one asking.
- `pager`: a random event, "the 3 AM pager". Once its progress condition `when` holds and its
  quest is not done, every tick the game counts (a map change, say) pages the player with
  `chance` percent, decided by a seeded roll on (battle id, game seed, tick). After that the quest's
  `start` object replays it.
- `gate`: the boss between career stages. The road to `town` stays closed until the battle is
  won; the quest must be of the stage before that town, and a town has at most one gate.

**API** (`src/battle/engine.ts`, all pure): `compileBattle(id, spec)`, `startBattle(b, {seed,
hintBoost})`, `presentRound(b, s)` → round, cards in display order, how many to pick, hints;
`answerRound(b, s, ids)` → new state and a `RoundResult` (quality, grade, meter changes,
explanations, the best answer, status); `retryBattle(b, s)`. An answer of the wrong shape or an
answer to a finished battle throws `BattleError`: the UI builds answers, so that is a bug.
Battle sessions are not saved, like terminal sessions; the quest's state is.

**Validation** of a battle, besides its schema: every locale key exists in both languages;
ids are unique; a pick round has an option graded best and `pick` below the number of options;
an order round lists its steps in the right order (ranks never go down) and has at least two
ranks; an estimate has exactly one best range, ranges ascend and touch, and `value` lies in the
best one; hint rounds exist and hint conditions type-check against `BATTLE_FACTS`; a pager's
condition type-checks against `PROGRESS_FACTS` and names real quests; a gate's town exists.
Finally the validator **plays the battle twice**: the perfect answers must win and the worst
answers must lose.

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

**Limits.** 512 characters, nesting depth 24, at most 4 arguments, finite numbers. Path
arguments given as literals must be absolute and normalised (`/var/log`, not `/var/log/`). A
runtime error (which the checker should make impossible) evaluates to false instead of
crashing.

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

| Battle facts (`battle/engine.ts`) | Type |
| --------------------------------- | ---- |
| `attempts`, `misses`, `round`, `confidence`, `pressure` | numbers (battle hints only) |

Adding a fact is one line in a registry, its implementation and a test. The validator picks
the registry by field: scenario fields use scenario facts, NPC dialogue and pager triggers use
progress facts, battle hints use battle facts.

## Content

### Layout

```
content/
  locales/en.yaml, nl.yaml        UI, roadmap, shop and terminal strings
  roadmap.yaml                    towns (and their maps), branches, nodes (the Career Trail)
  shop.yaml                       homelab items
  maps/<id>.json                  Tiled maps (JSON, tilesets embedded; schemas/map.schema.json)
  npcs/<id>/                      world NPCs that give no quest (optional)
    npc.yaml, <sprite>.png, locales/en.yaml, nl.yaml
  quests/<id>/                    one quest = one folder = one cameo pull request
    quest.yaml                    who gives it, where it starts, the reward, quest dialogue
    scenario.yaml                 the machine and its conditions (a terminal quest), or
    battle.yaml                   the rounds of questions (a battle quest); never both
    npc.yaml                      optional: the quest giver
    <sprite>.png                  optional: the giver's sheet (16x16 or 32x32 frames)
    locales/en.yaml, nl.yaml      every string the folder uses
```

Strings in a quest folder are keys into that folder's own locale files (`title`,
`offer.1`). The bundler namespaces them as `quest.<id>.<key>` so folders never collide; world
NPC keys become `npc.<id>.<key>`.

### Schemas

`/schemas` holds JSON Schema (draft 2020-12) files, all strict (`additionalProperties:
false`): `quest`, `scenario`, `battle`, `npc`, `locale`, `roadmap`, `shop`, plus `common` for shared
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
quick?: ["df -h", "du -sh /var/*"]            # the quick-command strip; must parse, start with a command
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

- the content folder holds only YAML and PNG sprites (no scripts, ever), no symbolic links,
  and every PNG is declared by an `npc.yaml` with its source and licence;
- ids match folder names; ids and NPC spawn slots are unique across all folders;
- references resolve: `giver`, `requires`, `roadmap_node` (and its branch), maps; quest,
  roadmap and shop `requires` have no cycles;
- every condition parses and type-checks against the right registry; name arguments must be
  quoted literals and must exist: `service`, `pods_running` and `restarted` in that scenario,
  `flag` among that scenario's `set_flag`s, `ran` among the terminal's commands, `quest`,
  `has_item` and `xp` among the quests, shop items and branches;
- no string holds a control character (no ANSI or OSC escape sequences can reach xterm.js);
- every locale key a file uses exists in English and Dutch, both languages have the same keys
  and the same `{placeholders}`, and a folder has no unused keys;
- paths are absolute and normalised, a `/` mount exists, a pipeline file has content, nothing
  lies below a file, `home` and `cwd` are directories;
- the scenario actually starts (`createSession`); a battle is won by its perfect answers and
  lost by its worst (see Battles);
- sprites are real PNGs whose size is 3 x 4 frames;
- no file and no path in content uses a denylisted name (Pokémon, Nintendo and friends), nor
  that franchise's battle language in English or Dutch: its "a wild ... appeared" catchphrase,
  its effectiveness and fainting lines, its town leaders and its battle-menu words. Text is
  NFKC-normalised, invisible characters are removed and Cyrillic or Greek look-alike letters
  are read as Latin before the check. The phrases are broad on purpose ("wild" near "appear"
  is refused even in ordinary prose); rephrase when it trips.
- no locale string names what the scan of `dist/` refuses (a network API such as `WebSocket`,
  `fetch(`, or a URL): strings ship inside the bundle, so `tools/check-dist.mjs` would fail the build.

Maps (`content/maps/<id>.json`, schema `map`) are checked too:

- Tiled JSON, orthogonal, finite, 16 px tiles, tile data as plain arrays (no base64, no
  compression), tilesets embedded (no `.tsx`), one image each;
- tile layers from `ground`, `detail`, `props`, `above`, `collision`, each once and the map's
  size; `ground`, `collision` and the object layer `objects` are required; the collision layer
  is hidden and holds only tiles with `collides: true`; every tile id belongs to a tileset;
- tileset images: relative to the map, inside the repository but outside `content/`, real PNGs
  of the size the map says, columns and tile count matching, each with a row in ASSETS.md;
- objects: unique names; types `spawn`, `terminal`, `battle`, `door`, `shop`; only `facing` on
  spawns and `to_map`, `to_point` (and `facing`) on doors; spawns and doors on open ground; a
  door leads to a spawn point of a map that exists; exactly one map has `player-start`;
- against the content: every NPC's `spawn.slot` is a spawn point of its map; a quest's
  `start.object` exists (a `terminal` for a terminal quest, a `battle` or the giver's spawn for
  a battle); every terminal and battle object starts a quest; a gate battle's `gate-<town>`
  exists;
- on foot: from `player-start` and every door's arrival point, every spawn and door can be
  walked to, and every NPC slot, terminal, battle and shop has a reachable neighbour (NPC slots
  count as occupied).

**Content ahead of its map.** A town in `roadmap.yaml` names its map (`map: senior-summit`).
While `content/maps` has no file of that name the map is *planned*: quests and NPCs may already
use it in `start.map` and `spawn.map`, and everything else about them is checked as usual
(schema, locales, the battle played both ways, slots unique). The checks against map objects
wait until the map lands and then apply in full; until then the game cannot reach that content,
because no map shows the giver. Doors may not lead to a planned map. Any other unknown map is an
error. The two Senior Summit interviews (`ticket-booking-interview`, `collab-editor-interview`)
wait this way for the Senior Summit map.

**Content sprites and ASSETS.md.** A guest sprite records its source and licence in its
`npc.yaml`, not in ASSETS.md, so a cameo stays one folder; the credits screen lists it.
Waiting on Mark: https://github.com/MWest2020/nines/issues/2 (default: as described).

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
  `sendBeacon`, any `http(s)://` URL, `eval`, `Function(`, `window.open` or navigation
  (`location = ...`) in `src/`. Author URLs in the credits are text, never links.
- `npm run check:dist` (in CI after the build) scans what ships, Phaser included: no `fetch`,
  `WebSocket`, `EventSource`, `sendBeacon`, `window.open`, `eval` or `Function(`, and no URL
  outside an allowlist. The allowlist is exactly what Phaser carries as plain strings:
  `https://phaser.io` (its console banner, turned off) and two XML namespace URIs. Phaser also
  has `new Function("return this")` as a global-object fallback inside a try/catch; the CSP
  (no `'unsafe-eval'`) blocks it and the fallback continues. xterm.js carries its default
  handler for OSC 8 hyperlinks (`confirm(...)` then `window.open()`); the check allows exactly
  that code by its shape. It cannot run: the overlay passes its own `linkHandler`, whose
  activation does nothing, and no escape sequence reaches xterm (below). The check also
  insists on exactly one copy of that handler. `dist/THIRD-PARTY-LICENSES.txt` (the runtime
  dependencies' licence texts, written by `tools/vite-plugin-licenses.ts`) is plain text with
  author URLs; nothing loads it. Vite's module-preload
  polyfill is off because it fetches module URLs.
- Terminal output that comes from the player (a file they wrote with the editor, the line they
  typed) has control characters stripped before it reaches xterm.js; content cannot contain
  them at all. The only escape sequences xterm sees are the overlay's own colour codes.
- The MVP's acceptance check is a devtools Network panel with zero requests outside the origin,
  documented with a screenshot in the MVP pull request (a browser task, see AGENTS.md).

**"Runs offline"** means: `dist/` served over HTTP(S) by any static host (GitHub Pages, a
sub-path included) keeps working with the network off once loaded, and the Capacitor app
works with no network at all. It does not mean opening `dist/index.html` from `file://`:
browsers refuse ES module scripts from `file://`, and that is not a target.

The one runtime use of a YAML parser is the pipeline quest: the player's edited
`.nines-ci.yml` has to be parsed to be validated. That uses the same `yaml` package the build
uses (no dependencies of its own); it never sees content files.

## Saves

`src/core/save.ts`. One key, `nines.save`, in `localStorage`:

```json
{
  "format": "nines-save",
  "version": 2,
  "game": {
    "locale": "nl",
    "money": 350,
    "xp": {"linux": 20, "cicd": 25},
    "quests": {"disk-full": "done", "broken-pipeline": "active"},
    "items": ["raspberry-pi"],
    "flags": {},
    "tech_debt": 0,
    "seed": 2840192763,
    "ticks": 4,
    "claimed": [],
    "player": {"map": "junior-village", "x": 7, "y": 6, "facing": "down"}
  }
}
```

`seed` is chosen once for a new game by the game layer (the pure core has no randomness) and
fixes card orders and pager rolls; `ticks` counts pager ticks (map changes); `claimed` lists
the one-off event bonuses already paid (`<quest>/<event>`).

- **Versioning.** `version` is the save format, not the game version. A format change bumps
  `SAVE_VERSION` and adds `MIGRATIONS[n]`, a pure function from version n to n+1; loading runs
  the chain. Version 2 (MVP build) added `seed`, `ticks` and `claimed`; `MIGRATIONS[1]` fills
  them in. A save from a newer version loads as `{kind: 'newer'}`: the game tells the player
  to update and does not autosave, so the newer save is never overwritten. `core/persist.ts`
  also checks before every write, so a newer version saving from another tab stops this one
  writing. When the browser refuses storage, the game plays on in memory.
- **Robust loading.** After migration every field is checked and anything missing or of the
  wrong type falls back to a new game's value, so a hand-edited or partly broken save still
  loads. An unreadable save is copied to the next free `nines.save.unreadable.<n>` (never
  overwriting an earlier backup) before a new game starts, and the player is told.
- **What is not saved.** Terminal sessions and battle sessions. Opening a quest's terminal again starts its machine
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
  translated.
- **Not in locale files, on purpose:** the simulated machine's own output, which is the
  interface being taught rather than the game talking: command names and flags, usage syntax
  (`USAGE` in `commands.ts`), column headers (`df`, `kubectl get pods`), the `systemctl status`
  block, git's status labels (`modified:`, `new file:`, `deleted:`), commit lines, the
  `deployment.apps/x restarted` line, generated systemd journal lines, the `nines-ci`
  validator's messages and every log line or file in a `scenario.yaml`. These would be English
  on a Dutch server too. If Mark wants them translated, they move to `sh.*` keys.
- `tests/guards.test.ts` checks that every key used in `src/` exists in both languages.

## The Phaser layer (MVP build)

- **WorldScene**: a Tiled map with layers `ground`, `detail`, `props` (under the characters),
  `above` (drawn over them: tree crowns, lamp heads) and `collision` (hidden; tiles with property
  `collides: true`), plus an object layer `objects` with named objects: spawn points
  (`type: spawn`: `player-start`, `npc-1..n`, `cameo-1..n` as free slots for guest NPCs,
  `gate-<town>`, and where doors arrive), terminals (`type: terminal`, named as a terminal
  quest's `start.object`), battle starts (`type: battle`), doors (`type: door`, properties
  `to_map`, `to_point`) and the shop counter (`type: shop`). Tilesets are embedded in the map
  JSON. Grid movement on 16 px tiles, four directions: a tap turns, holding walks, one tile per
  250 ms; NPCs block their tile. Keyboard: arrows or WASD, Enter or Space to use or talk, Escape
  to close. Stepping onto a door fades to its map. The rack LEDs blink by swapping two tiles.
- **World events** (`src/game/world/events.ts`, on `game.events`): `world:talk` (an NPC, its
  quests), `world:use` (a terminal, battle or shop object and its quest) and `world:enter` (map
  and position, for saves). Talk and use hand control over until the listener calls `done()`.
  `src/game/bridge.ts` answers them through the GameApi (the real dialogue box, the shop,
  saving the position). Only when nobody listens, as in a scene test, does the world fall back
  to its own placeholder dialogue box. The world reads strings (`api.t`, so the NL/EN toggle
  reaches it) and progress (`api.store.game`) from the GameApi, does not move or act while
  `api.isBusy()`, and reads Enter, Space and Escape through `freshKeys`. `WorldScene` takes a
  `WorldStart` (`map`, `x`, `y`, `facing`, or a spawn `point`); a saved spot that is no longer
  open ground falls back to `player-start`.
- **HudScene**: money, menu, roadmap button, the dialogue box, the on-screen controls on touch
  devices.
- **TerminalOverlay**: DOM, not canvas, so text is crisp and the Android soft keyboard works.
  xterm.js renders the output (ANSI colours for prompts and errors). Input is our own
  `<input>` under it (`autocapitalize=off`, `autocorrect=off`, `spellcheck=false`,
  `enterkeyhint=send`): xterm's hidden-textarea input is unreliable with Android IMEs. A strip
  of quick-command buttons fills the input; Tab completes commands and paths; ↑/↓ walk the
  history. The editor is a `<textarea>` with a line-number gutter that marks lines with tabs.
  Built (`src/game/terminal/`):
  - **Opening.** Using a `terminal` object runs `openQuestTerminal(api, quest)` from
    `bridge.ts`. A locked quest only says so; an available one is accepted first, so a player
    may fix the machine before talking to its giver. A done quest's machine opens again as a
    replay that pays nothing. One terminal at a time, a fresh machine every time (sessions are
    not saved). The overlay holds the UI busy (`api.hold()`) while open.
  - **Input.** Our own `<input>`: Enter runs the line, Tab completes (`terminal/complete.ts`;
    several matches are listed in the output, like bash), ↑/↓ walk the history, Ctrl-C drops
    the line (`^C`), Ctrl-L clears. Keys typed in the overlay stop at its root, so Phaser's
    window listener never sees them. The Enter that opened the terminal is ignored until it is
    released, so it does not run an empty line.
  - **Quick strip.** Tab, ↑, ↓, then the keys phones hide (`| / - ~ *`, inserted at the
    cursor), then the scenario's `quick` lines (they fill the input; the player presses Enter),
    then `exit`. Buttons do not take focus, so the soft keyboard stays up.
  - **Side panel.** Objectives with a filled dot when done and a ring when open (shape, not
    only colour), and every hint unlocked so far with the latest one bright. Hints come from
    the scenario's conditions; `api.hintBoost()` goes into `createSession`, so the Raspberry Pi
    makes them come one try sooner. On a narrow screen the panel folds into a count in the
    header that opens it over the output.
  - **Consequences.** Every fired event (a scenario event or the built-in outage) is told in
    the overlay's own dialogue box, spoken by the quest's giver, with the money actually lost
    (`applyTerminalEvents`; money never goes below zero). Input waits until it is dismissed.
  - **Editor.** `edit <file>` (and `nano`, `vi`, `vim`) opens it over the terminal. The gutter
    marks lines that contain a tab with `⇥`, the status line names them, Tab inserts two
    spaces, Ctrl+S or Save calls `saveFile` and re-checks the objectives, Esc or Cancel
    discards.
  - **The win.** On `justWon` the overlay calls `completeQuest` (pays once, saves), shows
    "Quest complete!" with the reward, and Continue closes it; then `showQuestDone` plays the
    giver's done lines and the world takes control back.
  - **Look.** The device's monospace font (`ui-monospace, monospace`), DESIGN.md's terminal
    colours (prompt in ice, failed commands in orange). xterm is sized by measuring one cell in
    that font, without the fit addon. Every string is a locale key; the machine's own output
    stays as the real tools print it (i18n, The terminal boundary).
- **BattleOverlay**: DOM, like the terminal, over the dimmed world: the transcript, the
  whiteboard, the two meters, the answer cards (DESIGN.md, Battles). Map objects add
  `gate-<town>` (where a gate battle's giver stands and the road is blocked) and the `start`
  objects of battle quests.
- **TrailScene**, **ShopScene** (one item per page, ‹ › to page), **CreditsScene**: canvas, driven by `roadmap.yaml`,
  `shop.yaml` and the bundle's `credits`. Canvas text uses our own pixel font, drawn from glyph
  rows in `src/game/ui/font.ts` (no font file); a character it lacks shows as `?`, and a test
  checks every locale string is covered.
- **Economy** (`core/game.ts`, pure): completing a quest adds its money and XP (to its branch),
  plus `income_per_quest` from owned items; events add or subtract money, never below zero; a
  purchase subtracts the price and is refused without the money. Every reward is paid once: a
  done quest stays done (a battle won again pays nothing), and a positive event pays once per
  quest and event however often the terminal is replayed; penalties cost every time.
  `tech_debt` from meme side-quests is stored for later world events, which will use progress
  conditions (`tech_debt >= 3`).
- **The Career Trail's state** (`core/game.ts` `trail`): a node is done when a quest that names
  it is done; open when every node it requires is done and its town is open; locked otherwise.
  Towns lie on one road in roadmap order: a town is open when its gate battle is won and every
  town before it is open. XP is kept per branch and shown on the trail; content can gate on it
  with the `xp(branch)` progress fact (for example in NPC dialogue).

### The game API

Phaser code reaches the game state only through `GameApi` (`src/game/api.ts`), installed on
the game registry by `main.ts`; get it with `getGameApi(scene)`:

| Call | For | Does |
| ---- | --- | ---- |
| `talk(npcId)` | world | shows the NPC's lines (offer, reminder or own dialogue), accepts an offered quest; returns the conversation, whose `battle` names a battle quest to open |
| `showDialogue(lines)` | all | the dialogue box; lines are locale keys `{speaker?, text, params?}`; resolves when dismissed |
| `openShop()`, `openTrail()`, `openCredits()` | world, HUD | the screens; resolve when closed |
| `toast(key, params)` | all | a short line under the HUD |
| `startQuest(id)` | world | available becomes active; returns `started`, `active` or why it was refused |
| `completeQuest(id)` | terminal | pays at once (once only), saves, shows a reward toast; returns the `Reward`, or `null` if refused |
| `showQuestDone(reward)` | terminal, battle | the giver's done lines in the dialogue box, after the overlay has closed |
| `applyTerminalEvents(questId, events)` | terminal | money and flags from `RunResult.events` |
| `hintBoost()` | terminal, battle | pass to `createSession` and `startBattle` |
| `recordBattle(id, 'won' \| 'lost')` | battle | won pays like `completeQuest`; lost costs nothing |
| `hold()` | terminal, battle | marks the UI busy while a DOM overlay is open; call the returned function to release |
| `enterMap(player)` | world | stores the position, counts a pager tick, saves; returns a pager battle to open or `null` |
| `setLocale(locale)`, `isBusy()`, `store`, `t` | all | language; whether a dialogue or screen is open (also the `nines-ui` event on `game.events`); the state; strings |

Keyboard input reaches every scene, so the world checks `isBusy()` before moving the player. A
release lands one game step late, so the Enter that closed a dialogue is not a fresh press for a
world that polls `JustDown`. UI key handlers ignore keys typed into a DOM field (the terminal).
Phaser may deliver one DOM key event to a listener twice when keys arrive within one frame, and
to a listener added meanwhile; UI listeners are wrapped in `freshKeys` (`ui/widgets.ts`).

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
| @xterm/xterm | 6.0.0 | runtime | the terminal's output renderer (MIT); no addons; published 22 Dec 2025, the current release |
| @capacitor/core, cli, android | 8.x | Android phase | pinned when that phase starts |

## Testing and CI

- Vitest, in Node: the condition language, the parser, every command, the CI validator, saves,
  i18n, progress facts, the content validator (including that it rejects broken content), the
  guards, the three MVP quests played end to end on the real content files, the battle engine
  (every question type, meters in bounds, retry, hints, seeded cards, triggers) and every
  battle in content played perfectly, all wrong and at random.
- `.github/workflows/ci.yml` on every pull request and every push to `main`: `npm ci`, content
  validation, `npm test`, `npm run build`, `npm run check:dist`, the browser smoke test.
  Actions pinned to commit SHAs,
  read-only token.
- `tests/e2e/smoke.py` (Python Playwright, no npm dependency): serves `dist/` under a sub-path,
  walks the player to Ravi's laptop and the two server-room racks with the keyboard (paths from
  the Tiled maps), and plays all three MVP quests by typing real commands, the editor and a
  database-deleting mistake included. It fails on any request outside the origin and on any page
  error. CI runs it after `check:dist`; locally it runs under the memory cap in AGENTS.md, one
  browser at a time.
