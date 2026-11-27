# Nines architecture

Nines is a static browser game that later ships as an Android app. The player walks a career
trail in a top-down pixel world and fixes simulated machines in an in-game terminal. This
document is the Architect's part of the brief: the modules, the terminal simulator, battles,
the condition language, the content schemas, saves, i18n, offline loading and the Android build.

Principles, in priority order:

1. **Content drives a small engine.** Quests, NPCs, dialogue, machines and win conditions are
   YAML in `/content`. The engine knows a fixed set of commands and facts; content combines
   them. Contributors never write JavaScript.
2. **Nothing leaves the device unless the player opts in.** Today the game makes no network
   calls at runtime: no tracking, no analytics, no ads. Saves live in `localStorage`. Content is
   bundled at build time. Since 27 Nov 2026 (AGENTS.md, rule 3) an optional online feature such
   as share-my-progress may come, opt-in and documented here before it ships.
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
    base.ts         the shared base machine: /etc, users, logins, the fake clock
    state.ts        SimState and createState(scenario, carried flags)
    vfs.ts          filesystem queries and changes, globbing, disk usage
    path.ts, size.ts  path and size helpers
    ci.ts           the "nines-ci" pipeline validator
    facts.ts        SCENARIO_FACTS implemented over SimState
    check.ts        fair grading of free text (an objective's `check`), with a note on what is wrong
    unknown.ts      the dev-only list of commands players typed that no machine has
    shell/parse.ts  command line and flag parser
    shell/util.ts   what commands share: the signature, flags, usage lines, the fake clock
    shell/commands.ts  files, services, git, help and man; COMMANDS gathers every module
    shell/basic.ts  the base shell: whoami, id, hostname, uname, env, echo, date, uptime, head,
                    wc, sort, uniq, find, history, which
    shell/procs.ts  logins and processes: who, w, last, ps, kill, pkill, killall, logout
    shell/nginx.ts  nginx -t|-T|-v|-s and the config test systemctl runs before starting nginx
    shell/kubectl.ts  kubectl against the stored cluster model
    session.ts      run a line, save a file, evaluate events, hints, objectives
  battle/         battles: someone questions the player (pure)
    engine.ts       BattleState, rounds, meters, retry, hints
    score.ts        scoring per question type, perfect and worst answers, explanations
    seed.ts         seeded hash, PRNG and shuffle (no Math.random)
    triggers.ts     pager rolls and town gates; whether a gate's town has a map yet
    screen.ts       what the battle screen shows: phases, picks, transcript, whiteboard, debrief
  core/           game rules without rendering (pure)
    i18n.ts         t(key, params), locale choice
    save.ts         save format, versioning, migrations
    progress.ts     PROGRESS_FACTS implemented over the saved game
    game.ts         money, XP, quest completion, shop purchases, the Career Trail's state, hustles
    choice.ts       a dialogue choice's karma and flag
    karma.ts        karma, the meter, fines, the agency, community service, the seeded risk roll,
                    the contractor's multipliers
    tokens.ts       AI tokens: hints cost a token and scale a quest's reward
    persist.ts      the save slot over a key-value storage; never writes over a newer save
    talk.ts         what an NPC says, from the save
  world/          the map as a grid (pure)
    grid.ts         collision, objects, facing, steps, reachability, gates (closedGates, openMaps);
                    the validator uses it too
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
    ui/             HudScene + DialogueBox, TrailScene, ShopScene, CreditsScene, CareerScene (the
                    career coach's screen), the pixel font
    terminal/       TerminalOverlay.ts (DOM + xterm.js), terminal.css, wire.ts (to the GameApi)
    battle/         BattleOverlay.ts (DOM) + battle.css, open.ts (open, record, reward, gate line)
    touch/          layout.ts (pure: where the view and controls go), controls.ts (the D-pad and
                    buttons, DOM), pad.ts (their events), settings.ts, viewport.ts (soft keyboard)
    offline.ts      registers the service worker (not inside the Android app)
    back.ts         the Android back button: window.ninesBack(), called by MainActivity.java
  offline/sw.js     the service worker (hand-written; the build adds the file list and version)
assets/           tilesets and sheets outside content (Kenney packs, own art), each in ASSETS.md;
                  store/icon-512.png for the Play listing
android/          the Capacitor Android project (committed; dist/ is copied in by `cap sync`)
tools/
  content/load.ts         load + validate + bundle /content (Node, build time only)
  vite-plugin-content.ts  exposes the bundle as `virtual:nines-content`
  vite-plugin-sw.ts       writes dist/sw.js: src/offline/sw.js plus the built files and their hash
  art/draw-art.mjs        draws our own sprites, tiles and launcher icons (reproducible; --check in npm test)
  maps/build-maps.mjs     wrote the first versions of the Tiled maps from text layouts
schemas/          JSON Schemas for every content file
content/          the game's data
tests/            Vitest: rules, sim, terminal input, quests played end to end, content, guards
  e2e/smoke.py      the browser smoke test: the three quests, the shop and the trail, offline;
                    then touch on emulated phones and a tablet
  e2e/battle_smoke.py  the battles in a browser (PHONE=portrait|landscape: on a phone)
  e2e/medior_smoke.py  the gate, Medior City, the career coach and one path quest in a browser
```

Dependencies point one way: `game → battle, core, sim, rules, terminal, world, content/types`;
`terminal → sim, rules`; `sim → rules`; `battle → core, rules`; `core → battle/seed.ts` (the
seeded roll only: that file imports nothing); `tools → battle, sim, rules, world` (to validate content with the same code
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
| Pods | `pods: {name, namespace, deployment, status, restarts, age, logs[]}[]` | Derived from `deployments` in the scenario. `kubectl rollout restart` replaces a deployment's pods with new, deterministically named ones whose status follows `restart.succeeds_if`. `kubectl describe pod` derives the phase, container state, last state, envFrom (`config_map`) and events from the status. A `NotReady` pod runs but fails its readiness probe: `get pods` shows `Running` with READY `0/1`, `describe` the probe's failure (`readiness_failure`), and `pods_running()` is false. Applying a changed Deployment that the scenario runs (same name and namespace) rolls it out like a restart, as a real cluster does. |
| Cluster | `cluster: Record<objectKey, content>` | What the cluster runs, per object (`configmap/shop/shop-api-config`: kind, `metadata.namespace` or the `-n` namespace, `metadata.name`): the manifests listed in the scenario's `cluster` at their starting content, then whatever `kubectl apply -f` sent for that object, from any file (a directory applies its `*.yaml`/`*.yml` files). Saving a manifest changes the disk, not the cluster; `applied_value(object, key)` and `applied_contains(object, text)` read the cluster's copy. Apply checks only the shape (`kind`, `metadata.name`, no tab in the indentation), ignores comments and blank lines, and prints `created`, `configured` or `unchanged` with kubectl's resource name (`deployment.apps/x`). |
| Git | `git: {root, branch, head, index, commits}` | `head` and `index` map repo-relative paths to a content signature. The working tree is the filesystem. `status` diffs the three; `add` copies working tree to index; `commit` copies index to head. |
| Pipeline | `pipeline: {status: none\|passed\|failed, runs}` | When the scenario names a pipeline file, every commit "runs CI": the committed file goes through the `nines-ci` validator and the result is printed and stored. `nines-ci` (`sim/ci.ts`) knows stages, jobs with `stage`, `script`, `needs`, `image`, and since Medior City a `cache` (`key`: a file whose hash keys it, `paths`) and `secrets` (names from the CI's secret store, never values). |
| Base | `/etc` (passwd, group, hostname, hosts, os-release, motd, shells), `/home`, `/root`, `/tmp`, `/usr/bin`, `/var/log`; nginx's package files where nginx is configured | `src/sim/base.ts`, Mark's playtest of 27 Nov 2026. The scenario's own files override these; their bytes count as part of the mount's `base_used`, so `df` and `disk_usage()` do not move. |
| Logins | `logins: {id, user, tty, from, login, pid, self, active, logout?, relogin?}[]` | From the scenario's `sessions`, or the player's own default shell (`you`). `who`, `w`, `last` read them; `logout`, `kill <pid>` and `pkill -u/-t` end them. A `relogin` session is a kiosk: logging out of it logs straight back in, anonymously, and the shell stays. `session_active(id)` reads it. Processes for `ps` are derived: init, cron, sshd, one per running service (nginx as master and worker), one shell per login; killing a service's process fails the service. |
| Rollouts | `rollouts: Record<deployment, {replicas, revisions: {rs, cause}[]}>`, `kubeEdit` | `kubectl scale` sets replicas (and adds or removes pods), each rollout adds a revision (`rollout history`, `undo`). `kubectl edit` writes the object to a temporary file in `/tmp`, opens the editor and remembers it in `kubeEdit`; saving applies that file to the object (kind and name may not change), cancelling removes it. |
| Bookkeeping | `history`, `unknown`, `cwd`, `oldpwd`, `counters {commands, fails}`, `ran[]`, `restarted[]`, `flags`, `firedEvents[]`, `shownHints[]`, `generation` | What the player did, for hints and conditions. `ran` holds command names and, for systemctl, kubectl and git, "name subcommand" (`git commit`). |

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
| `systemctl` | `status`, `restart`, `start`, `stop`, `reload`, `is-active`; for nginx a start or reload runs the config test first and fails with its error |
| `journalctl` | `-u unit`, `-n N`, `-xe` accepted, `--no-pager` |
| `nginx` | only where nginx is installed: `-t` (OK, or `[emerg]` with file:line), `-T` (the test and every file it read), `-v`, `-V`, `-s reload\|stop\|quit\|reopen`; includes and globs relative to `/etc/nginx`, `types`/`map` blocks as data, a list of known directives |
| `kubectl` | `get pods\|deploy\|svc\|cm\|ns\|events\|rs\|nodes\|all [name] [-n ns \| -A] [-o wide\|yaml\|name] [-l app=x]`, `describe pod\|deploy\|svc\|cm\|node`, `logs [-f] pod\|deployment/x [--tail N]`, `apply -f file\|dir`, `rollout restart\|status\|history\|undo` (status does not wait), `scale --replicas=N`, `edit` (the built-in editor), `delete pod` (its Deployment makes a new one, which starts like any fresh pod; also `delete cm\|svc`), `top pods\|nodes` (simulated), `version`, `config current-context` |
| `git` | `status`, `add <paths> \| . \| -A`, `commit -m msg [-a]`, `log [--oneline] [-n N]`, `diff [--staged] [--name-only]`, `restore [--staged]`, `branch`, `-C <dir>`; outside the repository it names where the repository is |
| `edit` (`nano`, `vi`, `vim`) | opens the built-in editor (a UI action); saving calls `saveFile` |
| the base shell | `whoami`, `id`, `hostname`, `uname [-a]`, `env`/`printenv`, `echo`, `date`, `uptime`, `head`, `wc`, `sort [-r -n -h -u -f]`, `uniq [-c -d -u]`, `find [-name -iname -type -maxdepth -size]`, `which`, `man`, `history`; `who`, `w`, `last`, `ps [aux \| -ef]`, `kill`, `pkill`/`killall [-u -t]`, `logout` |
| `clear`, `exit` | UI actions |

**Unknown commands** answer honestly: "foo: command not found. This machine's shell has no 'foo' (yet); help lists what it does have." Each name goes once into `SimState.unknown` and into a page-wide list (`src/sim/unknown.ts`, at most 200, never shown to the player and never sent anywhere). The browser exposes it as `ninesUnknownCommands()` in `vite dev` or with `localStorage nines.debug = 1`; the smoke test sets that and prints the list, so the gaps players hit show up in test runs.

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
restart rules see the real count. A hint whose condition holds has *unlocked*; the player still
pays an AI token to read it (`core/tokens.ts`, below), so the session decides when a hint is
ready and the game decides what it costs.

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
NUMBER  := 12 | 2.5 | 500M | 2G | -20                                 K M G T = powers of 1024; a minus only against the digit
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
| `applied_contains(object, text)` | boolean: the cluster's copy of `object` (`kind/namespace/name`) contains `text` |
| `applied_value(object, key)` | string: the value of the first `key: value` line in the cluster's copy (quotes and a trailing comment removed), or `""` |
| `service(name)` | `active` \| `inactive` \| `failed` |
| `restarted(name)` | boolean, service or deployment |
| `pods_running(deployment)` | boolean, all pods Running |
| `ran(command)` | boolean, `"df"` or `"git commit"` |
| `flag(name)` | boolean, set by events |
| `touched(path)` | boolean: a command named `path` or something inside it as an operand (cd, cat, ls, less, edit, any pipe stage; not flag values or grep's pattern), or a recursive command (grep -r, du, rm -r; the working directory without an operand) walked a folder above it |
| `opened(path)` | boolean: a reading command (cat, less, tail, grep, edit, mv) opened that file or one inside that folder, or grep -r read through a folder above it; `ls` and `du` only touch |
| `pipeline_valid` | boolean, the pipeline file in the working tree validates |
| `pipeline_status` | `none` \| `passed` \| `failed`, the last CI run |
| `nginx_config_ok` | boolean: `nginx -t` passes (false without an nginx config) |
| `session_active(id)` | boolean: the login with this id (scenario `sessions`, or `you`) is still logged in |
| `git_clean`, `commits`, `fails`, `commands` | boolean, numbers |

| Progress facts (`core/progress.ts`) | Type |
| ----------------------------------- | ---- |
| `quest(id)` | `locked` \| `available` \| `active` \| `done` |
| `xp(branch)`, `money`, `tech_debt` | numbers |
| `has_item(id)`, `flag(name)` | booleans |
| `karma`, `strikes` | numbers: -100..100, times caught since the last community service |
| `probation`, `contractor` | booleans |
| `path_chosen`, `career_path(id)` | booleans: a career path is chosen; it is this one (ids from `roadmap.yaml`) |

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
branch: linux                      # a roadmap branch (ten, kubernetes included)
paths: [sre, systems, devops]      # career paths it counts towards: swe sre devops platform systems ethical
roadmap_node: linux-disk           # lights up when done
requires: []                       # quest ids
kind?: job                         # job (default) | hustle (rolls its risk) | service (community service)
available_when?: 'karma >= 0 && !probation'   # a progress condition, no quest(); gates the offer
giver: femke                       # npc id
start: {map: server-room, object: rack-web-01}   # interactable that opens the terminal
reward: {money: 150, xp: 20, tech_debt?: 0, karma?: 0}
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
  api: {status: CrashLoopBackOff, restarts: 4, logs: [..], restart: {succeeds_if: '...'},
        namespace?, replicas?, image?, config_map?}   # image and config_map show in kubectl describe
cluster?: [/home/dev/shop-k8s/configmap.yaml]   # manifests whose objects the cluster runs at the start
git: {root: /home/dev/shop, pipeline: {file: .nines-ci.yml, validator: nines-ci}}
objectives: [{id, text, done_when?, check?, procedure?}]   # all true = quest complete; a contractor skips procedures
#   check: {file, fields?: [Name | {name, number}], choice?: {field, scale, accept, wrong?}, mentions?: [{any, missing}]}
#   free text graded fairly (src/sim/check.ts): `Name: value` lines filled in (1.25 = 1,25 = €1.25),
#   exactly one scale value on a `Field:` line (Dutch words too; two values is a note, not a pass),
#   words in any case. While it fails, once the player has written the file, the objectives
#   panel shows a note saying what is wrong ("Severity line has two values: high, critical. Pick one.").
sessions?: [{id, user?, tty, from, login?, self?, logout?, relogin?, cover?: {flag, from}}]   # logins (who, w, last)
carry?: [{flag, caught_fine?}]                # progress flags from the save the machine starts with (flag() reads them)
hints: [{id, when, text}]
events: [{id, when, say, money?, karma?, reset?, set_flag?}]
risk?: {base, factors: [{id, when, add, text}]}   # a hustle's chance of getting caught (only a hustle)
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
dialogue: [{when?: '<progress condition>', lines: [..], intro?: true, choices?: [{text, lines?, karma?, set_flag?}]}]   # first match is spoken;
                                   # an intro entry that holds is also said before a quest offer
role?: coach                       # the career coach: her lines, then the career screen

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
  roadmap and shop `requires` have no cycles; a roadmap node that a quest lights never requires
  (directly or further down) a node that no quest lights, so it can always open;
- karma: `available_when` is a progress condition without `quest()` (use `requires`); a hustle
  is a terminal quest with a `risk` and a negative `reward.karma`, and only a hustle has a risk;
  `procedure` objectives belong to jobs, and at least one objective is not a procedure;
- every condition parses and type-checks against the right registry; name arguments must be
  quoted literals and must exist: `service`, `pods_running` and `restarted` in that scenario,
  `flag` among that scenario's `set_flag`s, `ran` among the terminal's commands, `quest`,
  `has_item` and `xp` among the quests, shop items and branches;
- no string holds a control character (no ANSI or OSC escape sequences can reach xterm.js);
- every locale key a file uses exists in English and Dutch, both languages have the same keys
  and the same `{placeholders}`, and a folder has no unused keys;
- paths are absolute and normalised, a `/` mount exists, a pipeline file has content, nothing
  lies below a file, `home` and `cwd` are directories;
- a `check` names locale keys that exist (`missing`, `wrong`) and accepts only values on its scale;
  session ids are unique, at most one is `self`, a cover names a carried flag; a carried flag is
  set by something (an event's `set_flag` or a dialogue choice's), and `caught_fine` is a hustle's;
  `session_active` names a session of that scenario; `flag()` may name a carried flag;
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
  spawns and `to_map`, `to_point` (and `facing`, `town`) on doors; a door with `town` is a gate,
  shut until the road to that town is open, and names a town of `roadmap.yaml`; spawns and doors on open ground; a
  door leads to a spawn point of a map that exists; exactly one map has `player-start`;
- against the content: every NPC's `spawn.slot` is a spawn point of its map; a quest's
  `start.object` exists (a `terminal` for a terminal quest, a `battle` or the giver's spawn for
  a battle); every terminal and battle object starts exactly one quest, except that a spare
  `cameo-*` object may start none until a guest quest claims it (so a terminal cameo needs no map
  edit); a gate battle's `gate-<town>` exists;
- on foot: from `player-start` and every door's arrival point, every spawn and door can be
  walked to, and every NPC slot, terminal, battle and shop has a reachable neighbour (NPC slots
  count as occupied).

**Content ahead of its map.** A town in `roadmap.yaml` names its map (`map: senior-summit`).
While `content/maps` has no file of that name the map is *planned*: quests and NPCs may already
use it in `start.map` and `spawn.map`, and everything else about them is checked as usual
(schema, locales, the battle played both ways, slots unique). The checks against map objects
wait until the map lands and then apply in full; until then the game cannot reach that content,
because no map shows the giver. Doors may not lead to a planned map. Any other unknown map is an
error. The URL shortener waited this way for Medior City until its map landed. The two Senior Summit interviews (`ticket-booking-interview`, `collab-editor-interview`)
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
- The acceptance check is zero requests outside the origin: `tests/e2e/smoke.py` fails on any
  (it listens to every request of the browser context, the service worker's included, and to
  failed requests), and `docs/how-to/verify-offline.md` is the same check by hand in devtools.

**The service worker** (`src/offline/sw.js`, hand-written, no dependency). The build
(`tools/vite-plugin-sw.ts`) prepends `VERSION`, a hash of every built file, and `FILES`, the
list of them, and emits `dist/sw.js`. `src/game/offline.ts` registers it (built site only, a
secure context, not inside the Capacitor app). Install: every file into the cache
`nines:<scope>:<VERSION>` (bypassing the HTTP cache), then take over at once. Activate: delete
the older caches of the same scope only (a GitHub Pages user site shares its origin with other
projects, forks and previews). Fetch: only GET requests for the same origin and the worker's
scope; files come from the cache first, the page itself (a navigation) from the network first
and from the cache when that fails, so a new deploy's index.html is never shadowed by an old one;
a file missing from the cache is asked of the same origin. That is the one `fetch` in the code
base, allowed by name, once, after the origin check, in `check:dist` and `tests/guards.test.ts`
(which also scans `src/**/*.js`); requests for other origins are not touched. A new deploy is a
new `VERSION`: the open page keeps running the files it already loaded, the next online load
runs the new build, and the new worker replaces the cache in the background.

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
  "version": 4,
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
    "tokens": 2,
    "hints": {"service-down": ["hint.status"]},
    "path": null,
    "karma": -10,
    "strikes": 0,
    "caught": 1,
    "probation": false,
    "contractor": false,
    "player": {"map": "junior-village", "x": 7, "y": 6, "facing": "down"}
  }
}
```

`seed` is chosen once for a new game by the game layer (the pure core has no randomness) and
fixes card orders and pager rolls; `ticks` counts pager ticks (map changes); `claimed` lists
the one-off event bonuses already paid (`<quest>/<event>`); `tokens` is the AI token balance,
`hints` the hints paid for per quest (by locale key), `path` the career path (null until Medior
City); `karma` (-100..100), `strikes` (times caught since the last community service), `caught`
(times caught ever, which with the seed fixes the next risk roll), `probation` and `contractor`
(DESIGN.md, Karma).

- **Versioning.** `version` is the save format, not the game version. A format change bumps
  `SAVE_VERSION` and adds `MIGRATIONS[n]`, a pure function from version n to n+1; loading runs
  the chain. Version 2 (MVP build) added `seed`, `ticks` and `claimed`; `MIGRATIONS[1]` fills
  them in. Version 3 (27 Nov 2026) added `tokens`, `hints` and `path`; `MIGRATIONS[2]` gives an
  old save the new game's 3 tokens, counts no hint against any quest (they were free until now)
  and chooses no path. Version 4 (27 Nov 2026, karma) added `karma`, `strikes`, `caught`,
  `probation` and `contractor`; `MIGRATIONS[3]` starts an old save where a new game starts
  (karma 0, a clean record, employed). Karma is clamped to -100..100 and rounded; a broken
  count repairs to 0; the two flags are true only when stored as `true`. Bad values are repaired (a missing, negative or fractional token count
  to 0, never a gift; non-string hint keys dropped); the store drops a `path` the roadmap does not
  have. A save from a newer version loads as `{kind: 'newer'}`: the game tells the player
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
- **When.** After a quest completes, after a purchase, after a hint is paid for, on a locale change, when entering a map,
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
  quest's `start.object`; the server room keeps two spare racks, `cameo-rack-1` and
  `cameo-rack-2`, for terminal cameos, which do nothing until a quest claims one), battle
  starts (`type: battle`), doors (`type: door`, properties `to_map`, `to_point`) and the shop
  counter (`type: shop`). Tilesets are embedded in the map
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
- **HudScene**: money, menu, roadmap button, the dialogue box. The bar has its own 12 px band
  above the view: the canvas is 240 x 172, and the world and the screens draw in the 240 x 160
  under it (their cameras' viewports start at y 12), so the bar never covers a row of the map.
  The menu also holds the touch-controls setting (Auto, On, Off; a device setting, kept under
  its own localStorage key `nines.controls`, not in the save).
- **Touch controls and layout** (`src/game/touch/`): DOM around the canvas, not in it, so the
  targets are real CSS pixels. `layout.ts` (pure, tested for phone and tablet shapes) places the
  canvas, scaled by a whole number from 2 up where that keeps 80% of the room and by the exact
  fit otherwise, and the controls: below the view in portrait, beside it in landscape, inside the
  safe-area insets. They show on touch screens and windows under 600 px wide, or as the setting
  says. The D-pad (144 px, a cross of 48 px arms; sliding a finger changes direction), the use
  button (64 px), back (56 px) and big menu and Career Trail buttons (48 px) put out the held
  direction (`padState`, read by the world each frame like the arrow keys) and events on
  `game.events` (`pad:move`, `pad:use`, `pad:back`), which `keyboardNav` (every screen and the
  menu) and the HUD's dialogue box handle like their keys; for screen readers and switch access a
  click with no pointer before it does the same. A tap on the map walks the shortest
  grid path there (`findPath` in `src/world/grid.ts`; doors only as the goal); a tap on an NPC,
  a terminal, a battle object or the shop counter walks up to it (`approach`), faces it and uses
  it; a tap on a wall does nothing. A key or the D-pad takes over from a tap walk. No zoom or scroll: `touch-action: none` on
  the canvas and the controls, `manipulation` on the page and the overlays, no overscroll.
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
  - **The win.** On `justWon` the overlay calls `completeQuest` (pays once, saves) and shows the
    done banner ("Assignment complete", "Quest complete!" and the reward) with two buttons: Close
    (focused) and Practice again. Practice again starts the same machine fresh in the same overlay
    (a "practice" tag in the header); the quest is done, so a win pays nothing and says so, hints
    are free and penalties still cost (Economy, below). A done quest's terminal opened from the
    world starts as a practice run too. After Close, `showQuestDone` plays the giver's done lines
    and the world takes control back. A battle's end screen offers Practice again after a win and
    Try again after a loss.
  - **Notes.** An objective with a `check` that still fails shows its note under it, in orange,
    once the player has written that file.
  - **Underscores.** xterm draws with `lineHeight: 1.2` (and `fit()` counts rows with it), so a
    glyph's descender stays inside its row: Mark's screenshots showed "[U_]" as "[U ]". The smoke
    test prints `a_b` and checks the underscore's pixels on a desktop and on an emulated phone.
  - **Look.** The device's monospace font (`ui-monospace, monospace`), DESIGN.md's terminal
    colours (prompt in ice, failed commands in orange). xterm is sized by measuring one cell in
    that font, without the fit addon. Every string is a locale key; the machine's own output
    stays as the real tools print it (i18n, The terminal boundary).
- **BattleOverlay** (`src/game/battle/`): DOM, like the terminal, over the dimmed world: the
  transcript, the whiteboard, the two meters, the answer cards (DESIGN.md, Battles). It renders
  a `Screen` from `src/battle/screen.ts`, which is pure and holds every rule the screen follows:
  three phases (answer, review with the explanations, end with the debrief), a pick-one round
  replaces its pick, a pick-many round refuses more than `pick`, an order round starts with
  every card and moves them, Send works only for a complete answer, and Try again calls
  `retryBattle`. Tries are counted per battle while the game runs (`attemptsAfter`, not saved),
  so a battle closed after a loss or half-way and opened again starts at the next attempt, with
  its hints and a new card order. Locale keys only, translated when drawn. The first `intro` line is the
  announcement (`PAGER 03:07 · ...`); the whiteboard of a design interview holds every prompt
  line before a round's question (the requirements so far) and, during a `flaw` round, only the
  proposal. The attacker's portrait is the giver's standing frame cropped to the head and drawn
  into a small canvas. Buttons are native, so mouse, touch and keyboard all work: arrows move
  between cards, Enter or Space picks; an order step is picked up with Space, moved with the
  arrows and put down with Space, or moved with its ↑/↓ buttons, or dragged by its handle
  (pointer events, so a finger works too); Escape leaves (nothing is recorded for a battle left
  half-way). Key presses inside the overlay are stopped on `window` in the capture phase, so
  Phaser never sees them.
- **Battle wiring** (`src/game/bridge.ts` → `src/game/battle/open.ts`): a talk whose
  conversation names a battle opens it (npc and gate triggers); a battle object (`meeting-room`,
  `on-call-laptop`) replays its quest's battle once the quest is active or done; `enterMap`
  returning a pager battle starts that quest and opens it at once. Each finished try calls
  `recordBattle`: a win pays once and shows the reward on the end screen, a loss keeps the quest
  active and costs nothing. After the overlay closes, the giver's done lines follow. The Medior
  gate is Ingrid herself (she stands on `gate-medior` and her quest's start object is that
  spot); while no map belongs to a gate's town (a map id equal to the town id or starting with
  it), winning, and talking to her afterwards, says that the town opens later. Medior City has
  its map since its own pull request, so the win opens the road itself (below).
- **Gates in the world** (`src/world/grid.ts` `closedGates`, `openMaps`): a door with a `town`
  property is the road to that town. While `townOpen` (core/game.ts) says no, WorldScene counts
  its tile as occupied (no step, no tap path) and draws the barrier from the `props` layer; the
  moment the gate battle is won the store change clears the barrier. Junior Village's road east
  has two such doors at (39,14) and (39,15). A save that stands on a map the player cannot walk to
  through open doors (hand-edited, say) starts at `player-start` instead, so no save skips a gate.
- **The career coach** (`src/game/ui/CareerScene.ts`, `core/game.ts` `choosePath` and
  `changePath`): an NPC with `role: coach` (Petra, `content/npcs/petra`) says her lines, then the
  bridge opens the career screen: one path per page with its pitch (left and right turn the
  pages), Choose, and a confirmation. Once a path is chosen the same screen offers a switch for
  `CAREER_CHANGE_FEE` (€300; issue 24's default), which keeps XP, quests and karma. When the
  choice changes she speaks again, and her dialogue (keyed on `career_path()`) names the mentor.
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
- **AI tokens** (`core/tokens.ts`, pure; DESIGN.md, AI tokens): asking for an unlocked hint costs
  `HINT_COST` (1) token and records the hint's locale key under `hints[quest]` (with no tokens
  and less money than the cheapest credits it costs no token but is still recorded); a quest's
  money and XP are paid at `rewardPercent(hints) = max(40, 100 − 20 × hints)` percent, counting
  only keys the quest still has, rounded down
  (`scaled`), never negative. A paid hint stays paid (a terminal opened again shows it free); a
  done quest's hints are free. Homelab income and tech debt are not scaled. The `Reward` carries
  `percent`, `hints` and the `full` amounts for the UI. Tokens come from a new game (3) and from
  consumable shop items (`consumable: true`, `effects.tokens`), which are never owned and can be
  bought again; a consumable has no other effect and nothing can require it.
- **Career paths** (`core/game.ts` `choosePath`): six paths in `roadmap.yaml`; a quest lists
  the paths it counts towards in `paths`. The choice is stored in the save (`path`, null until
  chosen), refused before the road to Medior City opens and once chosen; `changePath` switches
  for a fee. Content reads it through `path_chosen` and `career_path(id)`: the mentors' first
  quests open with `available_when: 'path_chosen'`, and a mentor's `intro` dialogue greets their
  own path differently from a side-quester (DESIGN.md, Medior City).
- **Dialogue choices** (`core/talk.ts`, `core/choice.ts`): an NPC dialogue entry may end in two
  or three choices, shown as a panel like the menu (`HudScene.choose`); a choice's `karma` goes
  through `changeKarma`, its `set_flag` into the save, then the NPC replies. Ans's desk
  (content/npcs/ans) is the social-engineering one: pocketing a library card sets
  `borrowed-card` (karma -10). The vending job `carry`s that flag: its kiosk login shows that
  card, its risk drops, and being caught with it adds `caught_fine` to the fine and takes the card
  (`finishHustle(..., {caughtFine, confiscate})`). Game mechanics only: a choice, never a method.
- **Karma** (`core/karma.ts`, pure; DESIGN.md, Karma): `reward.karma` and event `karma` go through
  `changeKarma` (bounds; a drop below zero reopens community service; a drop to -60 or below off
  probation brings the agency: a fine and probation). A hustle's terminal win calls
  `finishHustle(risk)`: `RunResult.risk` (sim/session.ts: base plus the factors that hold, 0 to
  100) is capped at 95 and checked against `riskRoll` (battle/seed.ts `roll` of the save's seed,
  the quest and `caught`). Clean pays through the same path as any quest; caught fines, costs
  karma and a strike and keeps the quest active; the second strike is an arrest (probation).
  `completeQuest` refuses a hustle. A service quest ends probation, wipes the strikes and lifts
  karma to at least 0; its XP and the homelab's income are paid once per save (`claimed`
  `service/<id>`). A hustle's first ending carries `lesson` (`claimed` `lesson/<id>`). A contractor (`contracted`: the flag, a job whose scenario has a `procedure`) skips `procedure`
  objectives (`createSession` `skipProcedures`), is paid `CONTRACT_PERCENT` (150) of the money
  and billed `DAMAGE_MULTIPLIER` (3) times every penalty. The terminal shows a hustle's heat, a
  contractor's tag and skipped procedures; the HUD toasts karma changes; the Career Trail's
  header draws the meter; the menu toggles "Work as".
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
| `applyTerminalEvents(questId, events)` | terminal | money, karma and flags from `RunResult.events`; returns what changed and the agency's fine |
| `finishHustle(questId, risk)` | terminal | a hustle's win: roll, then pay (clean) or fine (caught, arrested); saves |
| `setContractor(on)` | HUD menu | work as an independent contractor or an employee; saves |
| `hintBoost()` | terminal, battle | pass to `createSession` and `startBattle` |
| `hintOffer(questId, key)`, `askHint(questId, key)` | terminal, battle | the price of an unlocked hint (`shown`, `free`, `ask` with the reward percent before and after, `broke`); pay a token and save at once |
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
  (Mark's choice, the same pattern as his other apps), `webDir: 'dist'`, the game's background
  colour behind the WebView, and light system-bar icons. `android/app/build.gradle` reads the
  same `NINES_APP_ID` for `applicationId`; the Java namespace stays `work.westerweel.nines`.
- Flow: `npm ci && npm run build` → `npx cap sync android` copies `dist/` into
  `android/app/src/main/assets/public` (gitignored, like the generated
  `capacitor-cordova-android-plugins/`) → Gradle builds the APK or AAB. The rest of `android/` is
  committed source, as Capacitor intends. Capacitor 8.6.0, the Gradle wrapper 8.14.3 (with its
  distribution checksum), AGP 8.13.0, compile and target SDK 36, min SDK 24.
- Signing material never enters the repository: both `.gitignore` files exclude keystores, and
  the release signing config reads only `NINES_KEYSTORE`, `NINES_KEYSTORE_PASSWORD`,
  `NINES_KEY_ALIAS` and `NINES_KEY_PASSWORD` from the environment. With none set the release is
  unsigned (CI) and Gradle says so; with some set the build stops. `versionName` is
  `package.json`'s version; `versionCode` is `-PninesVersionCode=N` (default 1; a signed build
  requires it and refuses a `NINES_APP_ID` override). PLAY_STORE.md, Release, has the steps.
- Capacitor serves `dist/` from inside the APK through its local server
  (`https://localhost/`, answered by `WebViewLocalServer` in `shouldInterceptRequest`); no server,
  no network. The manifest removes `android.permission.INTERNET` (`tools:node="remove"`, so no
  library can merge it back), which makes the no-network promise enforceable by the OS: requests
  the WebView answers itself are expected to need no permission (WebView blocks network loads
  without it, and intercepted requests never reach the network), and anything else fails. That
  the game loads this way is to be confirmed on a real phone
  (https://github.com/MWest2020/nines/issues/20). The app declares no permissions at all; CI fails
  if the built APK or the release manifest asks for one.
- No backup: `android:allowBackup="false"` and data extraction rules that exclude everything from
  cloud backup and device-to-device transfer (Android 12+). The save stays on the device, so Data
  safety stays "no data collected".
- The service worker is not registered in the app (`src/game/offline.ts` returns when
  `window.Capacitor` exists): the files are in the APK. Capacitor injects its bridge as a
  document-start script on any WebView that supports it (every Play-updated WebView); on an old
  one it falls back to an inline script, which our CSP blocks, and then the worker would
  register. Harmless (it only caches the app's own files, versioned per build), so accepted.
- No Capacitor plugins. Back button: `MainActivity.java` registers an `OnBackPressedCallback`
  that calls `window.ninesBack()` (`src/game/back.ts`): it closes the newest DOM overlay (the
  terminal, with the editor's Esc rule, or a battle, like Escape), else sends the on-screen back
  button's event while a screen, the menu or a dialogue is open. With nothing open it returns
  false and the app moves to the background (the game saves on `visibilitychange`). The callback
  is always enabled, so with predictive back (on at target SDK 36) the system shows no
  back-to-home preview animation; the press itself still arrives. Untested on a device yet.
- Orientation: both (no `screenOrientation`). The Phaser canvas (the 240x160 view and the HUD
  band) is scaled by an integer where possible (above); the controls take the remaining space:
  below the view in portrait, on both sides in landscape. The terminal overlay is a flex layout
  that shrinks when the soft keyboard opens: `interactive-widget=resizes-content` in the viewport
  meta shrinks the page in Chrome on Android, and where a browser only shrinks the visual
  viewport, `src/game/touch/viewport.ts` fits the overlay to it, so the input line and the quick
  strip stay above the keyboard. Target SDK 36 draws edge to edge; Capacitor's built-in
  SystemBars (insets as CSS) and the `env(safe-area-inset-*)` padding in `touch.css` keep the
  controls clear of the status and gesture bars.
- Launcher icon and splash: own art (`tools/art/draw-art.mjs`, the player on night blue), no
  Capacitor template images; the launch screen is the game's background colour.
- Target SDK: 36, the level Google Play requires for new apps and updates since 31 Aug 2026
  (PLAY_STORE.md, Target API level, with the link).
- CI: the `android` job builds the debug APK and the unsigned release AAB on every pull request
  and push to `main`, checks the APK's badging (no permissions, target 36, no backup) and
  uploads both as workflow artifacts. No secrets.

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
| @capacitor/android | 8.6.0 | Android app only (in `dependencies` so its MIT notice ships in THIRD-PARTY-LICENSES.txt) | the native WebView shell that serves `dist/` inside the app; published 28 Oct 2026, the version Bazibo runs on the same toolchain |
| @capacitor/cli, @capacitor/core | 8.6.0 | dev | `npx cap sync android`; core is what the CLI requires, the web code never imports it (Capacitor injects its bridge) |
| playwright (Python) | 1.65.1 | e2e only (CI and by hand), never shipped or in package.json | the browser smoke tests in `tests/e2e/`, hash-pinned in `tests/e2e/requirements.txt` |

## Testing and CI

- Vitest, in Node: the condition language, the parser, every command, the CI validator, saves,
  i18n, progress facts, the content validator (including that it rejects broken content), the
  guards, the three MVP quests played end to end on the real content files, the battle engine
  (every question type, meters in bounds, retry, hints, seeded cards, triggers) and every
  battle in content played perfectly, all wrong and at random.
- `.github/workflows/ci.yml` on every pull request and every push to `main`: `npm ci`, content
  validation, `npm test`, `npm run build`, `npm run check:dist`, the browser smoke tests; in a
  separate `android` job, the debug APK and the unsigned release AAB with a badging check,
  uploaded as workflow artifacts. Actions pinned to commit SHAs, read-only token, no secrets.
- `tests/e2e/smoke.py` (Python Playwright, no npm dependency): serves `dist/` under a sub-path.
  Desktop: loads the game once, waits for the service worker, goes offline and reloads, then
  (all offline) walks the player to Ravi's laptop and the two server-room racks with the
  keyboard (paths from the Tiled maps) and plays all three MVP quests by typing real commands,
  the editor and a database-deleting mistake included; buys the Raspberry Pi at the shop counter
  with the quest money between the second and third quest, sees its €10 on the third reward,
  checks from the canvas pixels that exactly the three quests' own stones are lit on the Career
  Trail (right row, right place), then plays the sample cameo. Touch: on an emulated
  Pixel 7 in portrait it taps to walk to Ravi's laptop (the terminal opens), checks the input
  line and quick strip above a soft keyboard (both kinds, above), walks with the D-pad, uses a
  rack with the use button, and cycles the controls setting with the menu, D-pad, use and back
  buttons; in landscape it taps its way into the server room; on a 360x640 phone and a tablet it
  checks the layout. Every layout check: the controls show, every target is at least 48 CSS px,
  nothing covers the view, the page does not scroll. It fails on any request outside the origin,
  any failed request and any page error. CI runs it after `check:dist`; locally it runs under the
  memory cap in AGENTS.md, one browser at a time (`--only desktop|touch` runs one half).
- `tests/e2e/battle_smoke.py` (Python Playwright as well): serves `dist/` itself and plays the
  rate-limiter interview to a win, the Friday talk to a loss and a winning retry, the pager going
  off on a map entry, and the Dutch screen left half-way and opened again, by real key presses,
  clicks and a drag. It fails on any request that leaves the origin and on any page error. CI
  runs it after the terminal smoke test, then again with `PHONE=portrait` and `PHONE=landscape`
  on an emulated Pixel 7: the war room fits the screen, transcript, cards and both meters are on
  it, every button is at least 48 CSS px, and in portrait the hints open from the header count.
- `tests/e2e/medior_smoke.py` (Python Playwright, the helpers of the two scripts above): serves
  `dist/` under `/nines/` and, in one page, walks into the shut gate (the save stays in Junior
  Village), wins the gate interview, walks through the gate into Medior City, talks to Petra,
  finds her career screen from the canvas pixels, pages to Systems Engineer with the arrow keys,
  chooses it and confirms (the save has the path), walks into The Stack and plays Wim's "One disk
  left" in the terminal. It fails on any request outside the origin and on any page error. CI
  runs it after the battle smoke tests.
