# Contributing: a guest cameo

Nines is built so that anyone can add a quest without writing code. A **cameo** is one pull
request that adds one folder under `content/quests/`: your quest, your character, and either a
terminal puzzle or a battle, in Dutch and English. Your name goes on the credits screen
automatically.

```
content/quests/<your-quest-id>/
  quest.yaml          who gives the quest, where it starts, what it pays
  scenario.yaml       a terminal quest: the simulated machine and the conditions that win it
  battle.yaml         or a battle: someone questions the player (never both in one folder)
  npc.yaml            your character (optional)
  <name>.png          your character's sprite sheet (optional, CC0; lower-case, e.g. yara.png)
  locales/en.yaml     every string, in English
  locales/nl.yaml     the same keys, in Dutch
```

The rules, short:

- **Data only.** YAML, one PNG, nothing else. The validator refuses any other file.
- **Your sprite is your own work or CC0**, and you release it as CC0. A sheet is 3 columns x 4
  rows of 16 x 16 (or 32 x 32) frames; `npc.yaml` records its source and licence. No sprite?
  Leave it out and give a `tint`; the game draws a placeholder in your colour.
- **Nothing from Pokémon or Nintendo**, in names, art or jokes.
- **Both languages**, same keys, same `{placeholders}`.
- **Credit yourself** in the `author` field (`name`, optionally `handle` and `url`). The URL is
  shown as text; the game never opens it.
- **Pick a free cameo slot** for your character and, for a terminal quest, a free cameo rack for
  your machine; the validator tells you when one is taken.

**Licence of your contribution.** Everything you add under `/content` (text and sprites) is
contributed under CC0-1.0, so the project can use it whatever licence the code ends up with
(open question: https://github.com/MWest2020/nines/issues/3).

The rest of this file walks through a real cameo, file by file.

## Worked example: "It's always DNS"

`content/quests/its-always-dns/` is a sample cameo. It came in as one commit that adds that
folder and changes nothing else; see it with:

```sh
git log --diff-filter=A --stat -- content/quests/its-always-dns
```

```
content/quests/its-always-dns/locales/en.yaml |  19 +++++
content/quests/its-always-dns/locales/nl.yaml |  19 +++++
content/quests/its-always-dns/npc.yaml        |  15 ++++
content/quests/its-always-dns/quest.yaml      |  20 +++++
content/quests/its-always-dns/scenario.yaml   | 105 ++++++++++++++++++++++++++
content/quests/its-always-dns/yara.png        | Bin 0 -> 588 bytes
6 files changed, 178 insertions(+)
```

**The story.** Yara from the network team moved the invoice database to a new server last
night. She updated DNS and checked it three times, but `invoice-api` on `api-02` will not start.
The service log says `db.internal resolved to 10.0.4.12`: the old server. DNS answers
`10.0.4.30`. The cause is a "temporary" line from 2024 in `/etc/hosts`, and
`/etc/nsswitch.conf` says `hosts: files dns`, so the file is read before DNS is asked. The
player finds it with `systemctl status`, `journalctl`, `cat` and `grep`, removes the line with
`edit` and restarts the service. It is Junior level: commands they already know, and one idea
(name lookups have an order).

Before you write anything, open the folder next to this walkthrough. Every file below is quoted
in part; the folder has the whole thing.

### 1. The folder name is the quest id

`its-always-dns`: lower-case words joined by single dashes, at most 40 characters, the same as
`id` in `quest.yaml`. Every quest id in `content/quests/` must be unique, and so must every NPC
id.

### 2. `quest.yaml`: who, where, what it pays

Schema: `schemas/quest.schema.json`. Every top-level field is required (`reward.tech_debt`,
`author.handle` and `author.url` are optional).

```yaml
schema: 1
id: its-always-dns                      # = the folder name
author: {name: "Nines sample cameo"}    # you: name, optionally handle: "@you", url: "https://..."
title: title                            # locale keys, from this folder's locales/
summary: summary
stage: junior                           # junior | medior | senior
branch: linux                           # linux, networking, git, cicd, containers, iac,
                                        # observability, incident, design or kubernetes
paths: [systems, sre]                   # the career paths it counts towards: swe, sre,
                                        # devops, platform, systems, ethical (all six for everyone)
roadmap_node: linux-services            # a node in content/roadmap.yaml, on the same branch
requires: []                            # quest ids that must be done first; [] for none
giver: yara                             # the id in your npc.yaml
start: {map: server-room, object: cameo-rack-1}   # where the terminal opens
reward: {money: 125, xp: 20}            # money 0-5000, xp 0-500
dialogue:
  offer: [offer.1, offer.2, offer.3]    # what the giver says when offering the quest
  active: [active.1]                    # ... while it is under way
  done: [done.1, done.2]                # ... when it is finished
```

- **`roadmap_node`** must already exist in `content/roadmap.yaml`, on the branch you give: a
  cameo lights an existing stone on the Career Trail and does not add one. The sample picked
  `linux-services` ("Services and their logs", Junior): the quest is about DNS, but there is no
  Junior networking stone, and a Junior quest lights a Junior stone.
- **`start`** for a terminal quest is a cameo rack: a spare terminal object kept free for
  guests. Today the server room has `cameo-rack-1` (taken by this sample) and `cameo-rack-2`
  (free), and The Stack in Medior City has `cameo-desk-1` (free) for a Medior guest. An unclaimed rack is a rack like any other in the game; yours becomes a machine the
  moment your `quest.yaml` names it. Two quests on one rack are refused:

  ```
  content/maps/server-room.json: terminal "cameo-rack-1" is the start of more than one quest (its-always-dns, your-quest); pick a free one
  ```

  When every rack is taken, say so in your pull request; a maintainer adds one to the map (a
  separate change, so your cameo stays one folder).
- **`author`** is what the credits screen prints. The `name` may not use a denylisted name
  (see "The IP rule" below).

### 3. `npc.yaml`: your character

Schema: `schemas/npc.schema.json`. Optional: without it, `giver` must name an NPC that already
exists. With it, your character stands in the world.

```yaml
schema: 1
id: yara
author: {name: "Nines sample cameo"}
name: npc.name                          # a locale key: the name shown above the dialogue
tint: "#a868a8"                         # placeholder colour if the sprite is left out
sprite: {file: yara.png, frame: 16, source: "own work, Nines sample cameo: drawn in the style of tools/art/draw-art.mjs", license: CC0-1.0}
spawn: {map: junior-village, slot: cameo-1, facing: down}
dialogue:                               # tried in order; the first whose condition holds is said
  - when: 'quest("its-always-dns") == "done"'
    lines: [npc.after]
  - lines: [npc.idle]
```

- **`spawn.slot`** is a free cameo slot: `cameo-1` (taken by this sample) or `cameo-2` (free) in
  Junior Village. A slot used twice is refused (`content: spawn slot junior-village/cameo-1 is
  taken twice`).
- **`dialogue`** conditions use progress facts: `quest("<id>")` is `locked`, `available`,
  `active` or `done`; `xp("<branch>")`, `money`, `has_item("<id>")`, `flag("<name>")`.
  ARCHITECTURE.md (The condition language) has the full list.
- **`sprite`** is optional; when you give one, `source` (who drew it) and `license: CC0-1.0`
  are required. This is where a cameo records its sprite: not in ASSETS.md, so the cameo stays
  one folder. The credits screen lists the sprite with its source and licence.

### 4. `yara.png`: the sprite sheet

48 x 64 pixels: 3 columns (step, stand, step) x 4 rows (facing down, left, right, up) of 16 x 16
frames (or 96 x 128 with `frame: 32`). Transparent background. The validator checks that it is
a real PNG of that size and that an `npc.yaml` in the folder declares it.

Draw it in any pixel editor, or do what the sample did: reuse the character style of
`tools/art/draw-art.mjs` (the script that draws Femke, Ravi and Bas) with your own hair style
and colours from the palette in DESIGN.md. This rebuilds `yara.png` exactly:

```sh
node --input-type=module -e "
import { writeFileSync } from 'node:fs';
import { drawCharacter, PALETTE as P } from './tools/art/draw-art.mjs';
import { encodePng } from './tools/art/png.mjs';
writeFileSync('content/quests/its-always-dns/yara.png', encodePng(drawCharacter({
  styles: ['bun', 'headphones'],
  colours: { H: P.brick, h: P.shadow, S: P.sand, s: P.wood, C: P.lilac, c: P.plum,
             A: P.phosphor, P: P.night, p: P.ink, F: P.bark },
})));"
```

The styles are `short`, `bun`, `glasses`, `beard`, `headphones` and `lanyard`; the letters are
hair (`H`, shade `h`), skin (`S`, `s`), top (`C`, `c`), accent (`A`), trousers (`P`, `p`) and
shoes (`F`). Only the PNG goes into your folder; the command stays out of it.

### 5. `scenario.yaml`: the machine

Schema: `schemas/scenario.schema.json`. Required: `schema`, `host`, `user`, `home`, `motd`,
`mounts`, `objectives`. A terminal quest has this file; a battle has `battle.yaml` instead
(never both).

**The machine.** A host name, a user, a home directory, the filesystem and its services. Files
are plain text; give a big file a `size` and only its last lines as `content`.

```yaml
schema: 1
host: api-02
user: dev
home: /home/dev
motd: motd                              # a locale key, shown when the terminal opens
mounts:
  - {path: /, device: /dev/sda1, size: 20G, base_used: 4G}   # a / mount is required
dirs: [/tmp, /var/log/invoice-api]
files:
  /home/dev/migration.txt: |
    Database move, 25 Nov (Yara)
    - 18:00 invoice database copied to db-02 (10.0.4.30)
    - 18:05 DNS record updated: db.internal -> 10.0.4.30
    ...
  /etc/hosts: |
    127.0.0.1   localhost
    127.0.1.1   api-02
    # temporary, during the 2024 network change. Remove when DNS is back! (Bas)
    10.0.4.12   db.internal
  /etc/nsswitch.conf: |
    ...
    hosts:    files dns
  # also /etc/resolv.conf, the app's config and its systemd unit, so a curious player can read them
```

Paths are absolute and normalised (no trailing `/`, no `..`). Nothing may lie below a file.

**Services.** What `systemctl` and `journalctl` show, and what happens on a restart:

```yaml
services:
  invoice-api:
    description: Invoice API
    state: failed                       # active | inactive | failed
    enabled: true
    logs:                               # the journal, as journalctl prints it
      - "Nov 25 18:12:30 api-02 invoice-api[2210]: check-db: db.internal resolved to 10.0.4.12"
      - "Nov 25 18:12:30 api-02 invoice-api[2210]: check-db: connect to 10.0.4.12:5432 failed: Connection refused"
      ...
    restart:
      succeeds_if: '!file_contains("/etc/hosts", "\n10.0.4.12 ") && (!file_contains("/etc/hosts", "\n10.0.4.") || file_contains("/etc/hosts", "\n10.0.4.30 "))'
      logs_on_success: [...]            # optional; the default is systemd's Starting/Started
      logs_on_failure: [...]            # appended before systemd's failure lines
```

Make it technically right: the log lines, the config files and the fix should be what a real
machine would show. Here, `succeeds_if` accepts what really fixes it (the stale line removed,
commented out, or pointing at the new address) and refuses what does not (a wrong address, or
a new line while the stale one stays). `"\n10.0.4."` matches only at the start of a line, so a
comment does not count and `10.0.4.300` is not `10.0.4.30`. Do not demand one exact spelling
of a fix when several are correct.

**Dates in logs.** The terminal has a fake clock: it starts at Nov 26 09:00:00 and moves 7
seconds per command, and systemd's own lines on a restart use it. Date what happened before the
player arrived earlier than that (the sample's incident is Nov 25 18:12), so the journal never
runs backwards. `logs_on_success` and `logs_on_failure` are fixed text; by convention they say
Nov 26 09:00:00.

**Objectives, hints, events.** All three are conditions in the condition language
(ARCHITECTURE.md): parsed and type-checked by the validator, never run as code.

```yaml
objectives:                             # all true = quest complete (at most 8)
  - {id: api, text: obj.api, done_when: 'service("invoice-api") == "active"'}
  - {id: names, text: obj.names, done_when: 'file_contains("/etc/hosts", "localhost") && file_contains("/etc/hosts", "api-02")'}
hints:                                  # the first newly true one unlocks (at most 12); the
                                        # player pays an AI token to read it, so each hint text
                                        # is unique and worth a token (DESIGN.md, AI tokens)
  - {id: status, when: 'commands >= 3 && !ran("systemctl status") && !ran("journalctl")', text: hint.status}
  - {id: resolved, when: '(ran("journalctl") || ran("systemctl status")) && service("invoice-api") == "failed" && commands >= 6', text: hint.resolved}
  - {id: hosts, when: '(ran("journalctl") || ran("systemctl status")) && service("invoice-api") == "failed" && (fails >= 2 || commands >= 10)', text: hint.hosts}
events:                                 # consequences, not blocks (at most 12)
  - {id: hosts-gone, when: 'removed("/etc/hosts")', say: event.hosts_gone, reset: true}
  - {id: pinned-again, when: 'service("invoice-api") == "active" && file_contains("/etc/hosts", "\n10.0.4.30 ")', say: event.pinned_again}
quick:                                  # the tap-to-fill command strip (at most 10)
  - systemctl status invoice-api
  - journalctl -u invoice-api
  - "cat ~/migration.txt"
  ...
```

- The second objective is true from the start, and its text does not give the puzzle away
  ("api-02 still knows its own names"). It turns false only if the player cuts too much from
  `/etc/hosts`: then the API runs, but the quest is not won until `localhost` and `api-02` are
  back.
- Hints trickle: from "look at the service", to "the log says the old address", to "read
  `/etc/hosts`". A stuck player gets there; a quick one never sees them. The last two wait
  until the player has read the service's log, so someone who first tries `dig` or `ping`
  (which this terminal does not have) gets "look at the service", not the answer.
- Events let the player do something unwise and learn from it. Deleting all of `/etc/hosts`
  explains what went with it and restores the machine (`reset: true`; add `money: -50` for a
  fine). Pinning the new address works, with a word on why that will break again. An event can
  also `set_flag: <name>`, which your NPC's dialogue can read with `flag("<name>")`.
- Names inside conditions are checked: `service("invoice-api")` and `restarted(...)` must be a
  service of this scenario, `ran("...")` a command of the terminal, `flag("...")` one an event
  sets. A typo fails the validator, not the player.
- Quick commands must start with a command the terminal has: `help`, `ls`, `cd`, `pwd`, `cat`,
  `less`, `tail`, `grep`, `df`, `du`, `rm`, `mv`, `edit` (`nano`, `vi`, `vim`), `systemctl`,
  `journalctl`, `kubectl`, `git`, `clear`, `exit`. ARCHITECTURE.md (Commands) lists their flags.
  There is no `dig`, `ping` or `curl`, which is why the sample's clues are in the files and the
  journal. A command your quest really needs is a code change: ask for it in an issue first.

### 6. `locales/en.yaml` and `locales/nl.yaml`: every string, twice

Schema: `schemas/locale.schema.json`: a flat map of key to text (at most 600 characters each).

```yaml
# en.yaml
title: "It's always DNS"
offer.3: "It's not DNS. It can't be DNS. Could you look? api-02 is the spare rack in the server room."
hint.resolved: "The log says db.internal resolved to 10.0.4.12, the old server. ..."
```

```yaml
# nl.yaml
title: "Het is altijd DNS"
offer.3: "Het is geen DNS. Het kan geen DNS zijn. Wil jij even kijken? api-02 is het reserverek in de serverruimte."
hint.resolved: "Het log zegt dat db.internal 10.0.4.12 werd, de oude server. ..."
```

**NL/EN parity.** Both files have exactly the same keys, and each string has the same
`{placeholders}` in both languages. Every key a YAML file of the folder uses must exist, and
the folder may not have keys that nothing uses. Keys are yours alone: the game reads them as
`quest.its-always-dns.<key>`, so they never clash with another folder's. What the machine prints
(paths, commands, log lines) stays as the real tool prints it, in both languages; what people
say is translated. The validator names the file and the key, for example:

```
content/quests/its-always-dns/locales/nl.yaml: missing key "obj.names"
```

Strings ship inside the game, so they may not contain a URL or name a network API (`fetch(`,
`WebSocket` and the like); the build's scan would refuse them.

### 7. The IP rule and the denylist

- Art is your own work or CC0, and you release your sprite as CC0. No traced, ripped or
  "inspired by" sprites from any game.
- Nothing from Pokémon or Nintendo: no names, creatures, sounds, menus, catchphrases or framing
  (no "trainers", "gyms", badges, creature collecting or creature fights). A battle in Nines is
  an engineering conversation.
- The validator refuses a denylist in every file and path of your folder: the franchise and
  company names (and spellings like `Poke mon` or look-alike letters), the famous "a wild ...
  appeared" line in English and Dutch, the effectiveness and fainting lines, the town-leader
  titles and the battle-menu words. It reads through invisible characters and Cyrillic or Greek
  look-alikes. If ordinary prose trips it ("a wild guess appears"), rephrase.
- The denylist is a floor, not the check: a reviewer still reads your art and jokes.

### 8. Check your folder

```sh
npm ci                     # once
npm run validate:content   # the content validator: schemas, references, conditions, locales, sprites, maps
npm test                   # everything, including the validator
```

The validator also starts your scenario once (a machine that cannot start is refused) and plays
a battle twice. It does not play your terminal quest to the end, so do that yourself:
`npm run build`, open `dist/index.html` through a local web server (`npx vite preview`), talk to
your character, walk to your rack and win it. A maintainer may add a play-through test in
`tests/quests/` later; you do not have to write code.

After the merge your character stands on the map, the terminal opens at your rack, the Career
Trail stone lights when the quest is done, and the credits screen lists your name, your quest,
your character and your sprite. None of that needs a change outside your folder.

## A battle cameo

The same folder, with `battle.yaml` instead of `scenario.yaml`. Instead of a machine, your
character asks the questions: a design interview, a production incident or a demanding
stakeholder (`kind`). Schema: `schemas/battle.schema.json`; required: `schema`, `kind`,
`attacker`, `intro`, `trigger`, `rounds`, `outro`.

What differs from the walkthrough:

- **`start`** in `quest.yaml` is your character's own slot, not a rack:
  `start: {map: junior-village, object: cameo-2}`. The battle starts where they stand, so a
  battle cameo needs no rack.
- **`trigger: {kind: npc}`** in `battle.yaml`: talking to your character starts it. (`pager`
  and `gate` triggers exist for the game's own story beats.)
- **The first `intro` line** is how the battle reaches the player and opens the screen:
  `PAGER 03:07 · ...` for an incident, `Incoming: ...` for a stakeholder, `Whiteboard interview
  · Topic: ...` for an interview. In a round's `prompt`, the lines before the last are context
  (an interview writes them on the whiteboard) and the last line is the question.
- **Rounds** of five types: `tradeoff` (a choice with its reason), `flaw` (spot the flaw in a
  proposal), `clarify` (what to ask first), `order` (put steps in order) and `estimate` (pick
  the range of a back-of-envelope number). Every option has a `grade` (`best`, `fair`, `weak`)
  and a `why` in both languages, because the explanation is the point; say so when something
  is debatable.
- **The validator plays your battle twice**: perfect answers must win, the worst answers must
  lose. It also checks that every round has a best option, that estimate ranges ascend and touch
  and that the value lies in the best range.
- The locale, IP, sprite, credits and slot rules are the same.

`content/quests/friday-scope/` is a short example, `docs/content-backlog.md` lists topics that
still need a battle, and ARCHITECTURE.md (Battles) explains the scoring.
