# Nines design

The Designer's part of the brief: tileset, palette, sizes and mock-ups of the screens.

**The look.** A generic early-2000s handheld top-down pixel style: a small fixed view, 16 px
tiles, chunky outlines, a limited palette, a modern little town where engineers live. Our
world is about servers, laptops and coffee, not adventure, and its UI is our own.

**What we never do.** No Nintendo or Pokémon IP and nothing that could be mistaken for it: no
creature collecting or battling, no "trainer" or "gym" framing, no badges handed out by town
leaders, no pocket-monster-style encyclopedia, no white rounded dialogue box with a coloured
double border, no right-hand pop-up menu with a black triangle cursor, no A/B button labels, no
sound effects that imitate theirs. Progress is a career: XP per skill branch, money, homelab
gear, a Career Trail, karma, and one of six career paths. The trail is our own idea of a skill map; roadmap.sh inspired the concept
of nodes lighting up, and we copy none of its content, layout or branding.

Battles (below) are conversations with colleagues about engineering, not creature fights; this
section's rules apply to them in full, and the content validator also refuses that franchise's
battle language.

## Tileset (CC0)

All from Kenney (kenney.nl), all CC0 1.0. Nothing is downloaded into the repository in phase
1; the MVP build downloads the packs, keeps each pack's `License.txt`, and adds a row per file
to ASSETS.md.

| Pack | URL | Tile size | Use |
| ---- | --- | --------- | --- |
| RPG Urban Pack | https://kenney.nl/assets/rpg-urban-pack | 16 x 16 | the main outdoor set: modern streets, houses, offices, fences, cars, street furniture. Junior Village is a small modern town, which suits a game about engineers better than a fantasy village. |
| Tiny Town | https://kenney.nl/assets/tiny-town | 16 x 16 | grass, trees, paths and village details to soften the urban set |
| Roguelike Indoors | https://kenney.nl/assets/roguelike-indoors | 16 x 16 (verify on download) | interiors: floors, walls, desks and furniture for the server room and the shop |
| Pixel UI Pack | https://kenney.nl/assets/pixel-ui-pack | 9-slice panels | only as raw material for our own panels, recoloured to the palette |
| Kenney Fonts | https://kenney.nl/assets/kenney-fonts | bitmap/pixel fonts | not used: the in-canvas font is our own (below) |

Checked on 26 Nov 2026: each page lists "Creative Commons CC0"; the RPG Urban Pack and Tiny
Town pages list 16 x 16 tiles. Roguelike Modern City (https://kenney.nl/assets/roguelike-modern-city)
is the fallback if the Urban Pack misses something.

**What we draw ourselves** (own work, released CC0, listed in ASSETS.md as own work): the
player and NPC walk cycles (Kenney's character sprites have no four-direction walk cycles), the
server racks, blinking LEDs, laptops and the Raspberry Pi, the Career Trail markers, the
dialogue and terminal frames, and the placeholder NPC that is tinted per `npc.yaml`.

The in-canvas font is our own proportional pixel font, drawn in code (`src/game/ui/font.ts`):
capitals and digits 7 px tall, lower case with a 5 px x-height and 2 px descenders, 10 px line
height, with €, é, ë, ï, ö and the other accents the Dutch text needs.

The terminal uses the device's monospace font (`ui-monospace, monospace`): crisp at any size,
nothing to download or license.

## Sizes

| Thing | Size |
| ----- | ---- |
| Logical view | 240 x 160 px (15 x 10 tiles) under a 12 px HUD band (canvas 240 x 172), scaled by a whole number from 2 up where that keeps 80% of the room, else by the exact fit; `pixelArt: true` |
| Tile | 16 x 16 |
| Character frame | 16 x 16 (cameos may use 32 x 32) |
| Character sheet | 3 columns (step, stand, step) x 4 rows (down, left, right, up): 48 x 64 px, or 96 x 128 px with 32 px frames. The validator enforces this. |
| Walk | 4 frames per tile step at 8 fps (step, stand, step, stand); one tile per 250 ms |
| Map | Junior Village 40 x 30 tiles; server room 15 x 10 (one screen); Medior City 44 x 34; The Stack 20 x 12 |
| Canvas text | 8 px pixel font, 10 px line height |
| Touch targets | at least 48 x 48 CSS px for every DOM control (the touch controls, the terminal and battle overlays); D-pad 144 x 144 (48 px arms), use 64, back 56, menu and Career Trail 48. Buttons drawn on the canvas (the menu, shop and trail) scale with the view and are smaller on a phone: the D-pad moves their focus and the use button presses them |
| Dialogue box | 232 x 48 px at the bottom of the view, 4 px margin, 3 lines of text |

## Palette

26 colours. Every channel is a multiple of 8, so the palette fits 15-bit colour like the
handhelds of the era. Own art uses only these; Kenney tiles keep their colours unless they
clash, in which case the MVP build remaps them once and records "recoloured" in ASSETS.md.

| Group | Colours |
| ----- | ------- |
| Ink and paper | `#101820` ink · `#283840` shadow · `#485860` slate · `#788890` grey · `#b0b8b8` mist · `#f8f0d8` paper |
| Nature | `#183020` deep green · `#306838` forest · `#58a058` grass · `#88c070` leaf · `#604830` bark · `#987048` wood · `#d0a868` sand |
| Water and sky | `#183048` night · `#2860a0` water · `#4880c8` sky · `#88b8e8` ice |
| Warm | `#882828` brick · `#c86848` clay · `#e89858` orange · `#f8d070` gold |
| Accent | `#683878` plum (tech debt, the PHP side-route) · `#a868a8` lilac |
| Terminal | `#081008` screen · `#88e090` phosphor · errors in `#e89858`, prompts in `#88b8e8`, paths in `#f8d070` |

Meaning is never colour alone: done/open/locked nodes also differ in shape, and errors in the
terminal keep the tool's own wording.

## Screens

The mock-ups are text; proportions are approximate.

### World and dialogue box

The dialogue box is a dark ink panel with paper text, a name tab on its top edge and a small
blinking caret when there is more. Text types out; a tap or Enter shows it all, the next tap
advances. Our own shape: square corners, a 1 px gold rule under the name tab.

```
┌────────────────────────────────────────────┐
│ €350                              ☰    ◎   │  money · menu · Career Trail
│  ♣♣   ┌────┐ ┌────┐      ♣♣                │
│ ♣♣♣♣  │▤ ▤ │ │▤ ▤ │  ··  ♣♣♣♣              │
│       └─▯──┘ └─▯──┘  ··········            │
│  ···········☺··········  ☻ Femke           │
│ ┌─ Femke ─┐────────────────────────────┐   │
│ │ Checkouts are failing on web-01 and  │   │
│ │ the logs say: no space left.       ▸ │   │
│ └──────────────────────────────────────┘   │
└────────────────────────────────────────────┘
```

### Terminal overlay (desktop)

Opens over the dimmed world when the player uses a rack, a laptop or a quest terminal. Output
on the left in xterm.js; objectives and the latest hint in a side panel; quick commands below.

```
┌─ web-01 ─────────────────────────────────────────────────────┬──────────────────────┐
│ web-01. Checkouts fail with 'no space left on device'.       │ Objectives        1/3│
│ Free up /var, keep the database and the web server alive.    │ ○ /var below 80%     │
│                                                              │ ● database is there  │
│ dev@web-01:~$ df -h                                          │ ● nginx is running   │
│ Filesystem       Size  Used Avail Use% Mounted on            │                      │
│ /dev/sda1         20G  6.1G   14G  31% /                     │ Hint                 │
│ /dev/sdb1         10G  9.5G  525M  95% /var                  │ du -sh /var/* shows  │
│ dev@web-01:~$ du -sh /var/*                                  │ which folder is big. │
│ 50M     /var/cache                                           │                      │
│ 8.4G    /var/log                                             │                      │
├──────────────────────────────────────────────────────────────┤                      │
│ dev@web-01:~$ cd /var/log/nginx▏                             │                      │
├──────────────────────────────────────────────────────────────┴──────────────────────┤
│ [ls -lh] [cd ..] [df -h] [du -sh *] [cat] [tail] [grep] [|] [Tab] [↑] [↓]   [exit]  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Terminal on a phone, with the soft keyboard

Portrait. The overlay is a column that shrinks when the keyboard opens: header, output, input
line, quick-command strip, keyboard. Objectives collapse into a count in the header; tapping it
opens them over the output. The quick-command strip scrolls sideways and also carries the keys a
phone keyboard hides: Tab, ↑, ↓, `|`, `/`, `-`, `~`, `*`.

```
┌──────────────────────────────┐
│ web-01      ◉ 1/3       ✕    │  host · objectives · close
├──────────────────────────────┤
│ /dev/sdb1  10G 9.5G 95% /var │
│ dev@web-01:~$ du -sh /var/*  │
│ 50M   /var/cache             │
│ 8.4G  /var/log               │
│ Hint: du -sh /var/* shows… │  hint line, dismissable
├──────────────────────────────┤
│ $ cd /var/log/ng▏        [⏎] │  our own <input>: no autocorrect, no capitals
├──────────────────────────────┤
│ Tab  ↑  ↓  |  /  -  ~  *  ls │  quick keys, sideways scroll
├──────────────────────────────┤
│  q  w  e  r  t  y  u  i  o  p│
│   a  s  d  f  g  h  j  k  l  │  Android soft keyboard
│  ⇧  z  x  c  v  b  n  m  ⌫   │
│ ?123  /     space     .   ⏎  │
└──────────────────────────────┘
```

### Built-in editor

`edit <file>` opens it over the terminal. A line-number gutter marks lines that contain a tab
with `⇥`, and the status line says so, because tabs are what break YAML. The Tab key inserts two
spaces. Save (Ctrl+S) writes the file and re-checks the objectives; Cancel discards.

```
┌─ Editing /home/dev/shop/.nines-ci.yml ─────────────── [Cancel] [Save] ┐
│  1  stages:                                                           │
│  2    - build                                                         │
│  3    - test                                                          │
│ ...                                                                   │
│ 12    stage: tset                                                     │
│ 13    needs: [build]                                                  │
│ 14    script:                                                         │
│ 15⇥ 	- npm test                                                      │
├───────────────────────────────────────────────────────────────────────┤
│ Ln 15, Col 1 · line 15 contains a tab · Tab inserts 2 spaces          │
└───────────────────────────────────────────────────────────────────────┘
```

### Career Trail (roadmap screen)

A map, not a flowchart: the three towns sit on a road from left to right, and each branch is a
side path with milestone stones. A done stone is gold and filled, an open one is an outline, a
locked one is grey with a padlock notch. Selecting a stone shows its name, branch and the quest
that lights it. The MVP shows Junior Village's paths with its three done nodes.

```
┌─ Career Trail ──────────────────────────────────────── Junior · 3/10 ─┐
│                                                                       │
│         Linux  ◆──◇──◇                    Containers ▪──▪             │
│               ╱                                     ╱                 │
│   ┌─────────┐╱   CI/CD ◆          ┌─────────┐      ╱     ┌─────────┐  │
│   │ JUNIOR  ├──────────────────── │ MEDIOR  ├─────────── │ SENIOR  │  │
│   │ VILLAGE │╲   Git ◇            │  CITY   │╲           │ SUMMIT  │  │
│   └─────────┘ ╲                   └─────────┘ ╲          └─────────┘  │
│        Incident ◆                     DNS ▪    IaC ▪                  │
│                                                                       │
├───────────────────────────────────────────────────────────────────────┤
│ ◆ done   ◇ open   ▪ locked        ▸ Disks fill up · Linux · Junior    │
│                                     lit by: Disk full (done)          │
└───────────────────────────────────────────────────────────────────────┘
```

### Homelab Store

A counter in the village. One item per page: the Raspberry Pi and AI credits (AI tokens,
below); later items show as silhouettes with the town that unlocks them. The header shows the
token balance next to the money; the HUD band does too (`€350 AI 3`, tokens in lilac).

```
┌─ Homelab Store ─────────────────────── 3 AI tokens  €350 ─┐
│ ┌────────┐  Raspberry Pi                          €200   │
│ │  ▣▣▣   │  A tiny homelab. Pays €10 after every         │
│ │  ▣▣▣   │  quest; hints come one try sooner.            │
│ └────────┘                                     [ Buy ]   │
│ ┌────────┐  ? ? ?                                        │
│ │   ░░   │  More gear in Medior City.                    │
│ └────────┘                                               │
├──────────────────────────────────────────────── [Close] ─┤
└──────────────────────────────────────────────────────────┘
```

### AI tokens: hints cost something

Mark, 27 Nov 2026: "a hint is AI usage. It gives less XP or less money, or you buy tokens." So
hints come from an AI, and the AI costs tokens and takes a cut of the reward. The engine is in
ARCHITECTURE.md (AI tokens); `src/core/tokens.ts` holds the numbers.

**Rules, as built.**

| Rule | Value |
| ---- | ----- |
| Tokens in a new game (and for a save from before tokens) | 3 |
| A hint costs | 1 token |
| Reward after n hints on a quest | `max(40%, 100% − 20% × n)`: 100, 80, 60, then 40 |
| Scaled | the quest's money and XP, rounded down; never negative |
| Not scaled | homelab income (the Pi's €10) and tech debt |
| A hint paid before | free from then on, also in a terminal opened again |
| Hints on a done quest | free: nothing is at stake any more |
| No tokens | no hint; the card says where to buy some |
| No tokens and less money than the cheapest AI credits | the hint is on the house (no token), but it still lowers the reward: nobody is stuck for good |
| AI credits (shop) | €40 for 3 tokens; bought as often as you like, never "owned" |
| Raspberry Pi | hints unlock one try sooner (its little local model notices sooner that you are stuck); reading one still costs a token |

Why these numbers: a Junior quest pays €125 to €300 and 20 to 40 XP, so one hint costs about a
€13 token plus €25 to €60 and some XP. Noticeable, never ruinous; three hints still pay 40%, so a
stuck player always finishes with something. The starting 3 tokens let a new player try the
AI before learning what it costs. From the third hint on a quest the reward stays at the
floor, so later hints cost only the token: a quest that has beaten you three times should
still end. Battles work the same way: a battle is a quest, its hints are
paid in the war room, and the win pays the scaled reward.

**Never before the price.** A hint that has unlocked shows as a card, not as text:

```
│ Hint                             │
│ ┃ The AI thinks it knows what    │
│ ┃ is wrong.                      │
│ ┃ Ask the AI? -1 token, -20% XP  │
│ ┃ and money on this quest        │
│ ┃ (3 left).                      │
│ ┃ [ Ask the AI ]                 │
```

At the floor the line says the quest already pays its minimum; without tokens: "Out of AI
tokens. The Homelab Store sells credits. Or, radical idea: read the logs." The card has a lilac
rule (the palette's AI colour) and a button at least 48 px tall. The win says what the AI cost,
with the homelab's unscaled income on its own: "Reward: €140 and 20 XP 1 AI hint: 80% of the
full reward. +€10 from your homelab"

**Tone.** Fun, not preachy: the AI is "usually right, always confident, and it keeps a cut of
your reward". We never tell the player that asking is wrong; the price does the talking.

### Career paths

Mark, 27 Nov 2026: "the player needs money, picks a path to learn, grows. Paths are swe, sre,
devops, platform engineer and systems engineer." Five paths replaced the two tracks (SRE,
Platform) of the first brief; the same day he added a sixth, ethical hacker (Karma, below). They live in `content/roadmap.yaml` (`paths`, each with a title
and a one-line pitch in both languages), and every quest lists the paths it counts towards
(`paths` in quest.yaml; the validator checks they exist).

| Path | Pitch (EN) | Home branches |
| ---- | ---------- | ------------- |
| Software Engineer (`swe`) | You build the product: clean code, sound designs, and features that survive real users. | design, git, cicd |
| Site Reliability Engineer (`sre`) | You keep it up: SLOs, error budgets, on-call, and a quieter pager every month. | incident, observability, linux, kubernetes |
| DevOps Engineer (`devops`) | You get changes to production safely and often: pipelines, releases, and teams that ship together. | cicd, iac, containers, incident |
| Platform Engineer (`platform`) | You build the road other teams drive on: Kubernetes, golden paths, and self-service that just works. | kubernetes, containers, iac, observability |
| Systems Engineer (`systems`) | You know the machine: Linux, networks, storage and hardware, all the way down to the cables. | linux, networking, incident |
| Ethical Hacker (`ethical`) | You break in with permission: scoped pentests, CTFs, and findings written up so the hole gets fixed, not used. | linux, networking, incident (a `security` branch comes with its Medior content) |

The Dutch pitches are in `content/locales/nl.yaml`.

**The choice at Medior City.** Junior Village is the same for everyone: every quest there is
open, whatever its tags. On arriving in Medior City (after the gate interview) a career coach
asks which path you want, showing the six pitches; the choice is stored in the save (`path`,
`core/game.ts choosePath`, refused before the road to Medior City is open and once made).
What a path unlocks:

- the path's own quest line in Medior City (a mentor NPC and three to five quests tagged with it),
- its own gate interview on the road to Senior Summit (the boss for that path),
- a path item in the Homelab Store (ideas in docs/content-backlog.md, Career paths),
- its name on the Career Trail and the credits.

Quests of other paths stay playable as side quests: nothing locks a player out for good. The
choice happens in play since Medior City has its map (below); a switch later costs €300 at the
same coach (https://github.com/MWest2020/nines/issues/24, default 2).

**Existing content, tagged.**

| Quest | Kind | Paths |
| ----- | ---- | ----- |
| disk-full, service-down | terminal | sre, systems, devops |
| broken-pipeline | terminal | devops, platform, swe |
| its-always-dns | terminal (cameo) | systems, sre |
| crashloop-config | terminal (Kubernetes) | platform, sre, devops |
| rate-limiter-interview | battle, the Medior gate | swe, sre, platform |
| night-pager | battle (incident) | sre, devops |
| friday-scope | battle (stakeholder) | swe, devops |
| nearby-places, ticket-booking-interview, collab-editor-interview | battle (design) | swe |
| url-shortener | battle (design) | swe, sre |
| bank-pentest | terminal (pentest) | ethical, systems |
| vending-prices | terminal (hustle) | ethical, systems: same skills, other side of the law |
| bakery-hotfix | terminal (contractor variant) | devops, sre, swe |
| repair-cafe | terminal (community service) | all six |
| code-review | battle (stakeholder), Medior | swe |
| error-budget | battle (incident), Medior | sre |
| pipeline-secrets | terminal, Medior | devops |
| golden-path | battle (design), Medior | platform |
| degraded-raid | terminal, Medior | systems |
| webshop-scope | terminal (pentest), Medior | ethical |
| readiness-probe | terminal (Kubernetes, CKAD), Medior | platform, sre, devops |
| insurer-cert | terminal (enterprise job, procedures), Medior | sre, systems, devops |
| parking-garage | terminal (hustle), Medior | ethical, systems |

**The sixth slot.** Ethical hacker takes the sixth path. Kubernetes stays a branch every path can
walk, as the default of https://github.com/MWest2020/nines/issues/23 says. If Mark wants a
Kubernetes path after all, it would be a seventh.

### Medior City

Mark, 27 Nov 2026: "is city er al? want als die ok is, dan richting google play." The second
town, east of Junior Village along the same road: bigger and busier than the village, built from
the same CC0 Kenney sheets (no new sheets) and our own tiles by `tools/maps/build-maps.mjs`.

**The map** (44 x 34). A three-lane boulevard runs west to east with zebra crossings, parked taxis
and a van. North of it, west to east: the Career Office (Petra stands in front), The Stack
(co-working and colocation, the one interior), the Grachtgarant tower (a fictional insurer;
Marieke in front) and the Byte Bakery. A back alley behind the buildings, reached through the gap
between The Stack and the tower, is where Mo waits. South: the plaza with a fountain, a café
terrace (Lars), Hugo's whiteboard, Amara by the fountain and Kim on the plaza; the car park with
its pay station; a small park. The road east to Senior Summit is closed with barriers and a sign:
no gate for it yet.

**The Stack** (20 x 12): desks on wooden boards on the left (Ruben's pipeline, Esra's assessment
laptop, Jesse's Kubernetes jump host, a spare desk for a terminal cameo), a colocation room on
raised floor behind a glass wall on the right (Wim's file server, Grachtgarant's portal).

**The gate.** Junior Village's road east ends in two barriers on the road itself. They are doors
with `town: medior`: shut and drawn while the rate-limiter interview is not won, gone the moment
it is. The road back is the city's west edge, which leads to the spot next to the gate.

**The career coach.** Petra introduces the six paths and opens her screen: one path per page,
its title and pitch, "Choose this path", and a confirmation that says the mentor waits in town,
other paths stay open as side quests and a switch costs €300 later. After the choice she names
the mentor and where to find them. Our own screen: the ink panel and gold rule of every Nines
screen, words on buttons, no cursor triangle.

**Each path's mentor and first quest** (open once a path is chosen; anyone may take another
path's quest as a side quest, and the mentor greets their own path differently):

| Path | Mentor, where | First quest | What it teaches |
| ---- | ------------- | ----------- | --------------- |
| swe | Lars, café terrace | Code review (battle, stakeholder) | split a 900-line PR, what to block on, landing order |
| sre | Amara, by the fountain | Error budget (battle, incident) | 43.2 minutes a month at 99.9%, burn rate 14.4, multi-window alerts, an error budget policy |
| devops | Ruben, The Stack | Slow and leaky (terminal) | a secret moved to the CI's store and revoked, a cache keyed on the lockfile |
| platform | Kim, on the plaza | Golden path (battle, design) | namespace, quota and LimitRange, limits, non-root, default-deny, paved road vs mandate |
| systems | Wim, The Stack's colocation room | One disk left (terminal) | /proc/mdstat, SMART, check the backup, name the disk by serial |
| ethical | Esra, The Stack | Webshop staging assessment (terminal) | stay in scope, prove a debug page from config and logs, report don't fix |

**Also in town.** Hugo asks the URL shortener interview at his whiteboard (it moved from Ingrid
at the gate). Jesse's readiness probe is the CKAD start of the Kubernetes path. Marieke's
certificate renewal at Grachtgarant is the enterprise job: it needs a clean record (`karma >= 0
&& !probation`) and has procedures a contractor skips. Mo's car-park job is the city's side
hustle, only for players at karma -20 or below.

### Kubernetes learning path

Mark, 27 Nov 2026: "a k8s learning path: junior is associate, medior CKAD and senior CKA/S." A
`kubernetes` branch on the Career Trail follows the Linux Foundation's certifications, one node
per exam domain. Our own questions only: we follow the published domains and never copy exam
questions, dumps or official question text.

**Sources** (read 27 Nov 2026; the Linux Foundation and CNCF pages agree on domains and weights
unless noted; the Kubernetes version is stated on the Linux Foundation pages, the CNCF pages
point to its FAQ):

- KCNA: https://training.linuxfoundation.org/certification/kubernetes-cloud-native-associate/ and https://www.cncf.io/training/certification/kcna/ (online, multiple choice, 90 minutes, no prerequisite)
- CKAD: https://training.linuxfoundation.org/certification/certified-kubernetes-application-developer-ckad/ and https://www.cncf.io/training/certification/ckad/ (performance-based, command line, 2 hours, Kubernetes v1.37)
- CKA: https://training.linuxfoundation.org/certification/certified-kubernetes-administrator-cka/ and https://www.cncf.io/training/certification/cka/ (performance-based, 2 hours, Kubernetes v1.37)
- CKS: https://training.linuxfoundation.org/certification/certified-kubernetes-security-specialist/ and https://www.cncf.io/training/certification/cks/ (performance-based, 2 hours, Kubernetes v1.37; a passed CKA is required)
- Curricula: https://github.com/cncf/curriculum (the PDFs answered HTTP 503 that day; recheck them before writing CKS content)

**Nodes per stage.**

| Stage (exam) | Node | Exam domain and weight |
| ------------ | ---- | ---------------------- |
| Junior (KCNA) | `k8s-fundamentals` | Kubernetes Fundamentals, 44% (core concepts, administration, scheduling, containerization) |
| | `k8s-orchestration` | Container Orchestration, 28% (networking, security, troubleshooting, storage) |
| | `k8s-delivery` | Cloud Native Application Delivery, 16% (application delivery, debugging) |
| | `k8s-architecture` | Cloud Native Architecture, 12% (observability, the cloud native ecosystem and principles, community) |
| Medior (CKAD) | `ckad-design-build` | Application Design and Build, 20% |
| | `ckad-deployment` | Application Deployment, 20% |
| | `ckad-observability` | Application Observability and Maintenance, 15% |
| | `ckad-config-security` | Application Environment, Configuration and Security, 25% |
| | `ckad-networking` | Services and Networking, 20% |
| Senior (CKA) | `cka-storage` | Storage, 10% |
| | `cka-troubleshooting` | Troubleshooting, 30% |
| | `cka-workloads` | Workloads & Scheduling, 15% |
| | `cka-cluster` | Cluster Architecture, Installation & Configuration, 25% |
| | `cka-networking` | Services & Networking, 20% |
| Senior (CKS, its own row: `kubernetes-security`) | `cks-cluster-setup` | Cluster Setup, 15% on the LF page, 10% on the CNCF page |
| | `cks-cluster-hardening` | Cluster Hardening, 15% |
| | `cks-system-hardening` | System Hardening, 10% (LF) or 15% (CNCF) |
| | `cks-microservices` | Minimize Microservice Vulnerabilities, 20% |
| | `cks-supply-chain` | Supply Chain Security, 20% |
| | `cks-runtime` | Monitoring, Logging and Runtime Security, 20% |

The Junior nodes are in `content/roadmap.yaml` now (the Junior trail has six rows since then:
TrailScene packs six branch rows 11 px apart). The CKAD, CKA and CKS nodes arrive with their
first quests; CKS needs six stones on one row, which the trail fits once the stone spacing drops
to 14 px for that row. Each node's quest is listed in docs/content-backlog.md.

**Which form suits which exam.** KCNA is multiple choice about concepts, so its domains suit
battles (an interviewer on pods vs Deployments, Services, namespaces, the control plane) as
well as short terminal quests. CKAD, CKA and CKS are hands-on, so they suit terminal quests;
the simulator's kubectl grows with them (the backlog lists the commands each needs).

**Medior, the first CKAD piece: Not ready** (`content/quests/readiness-probe`, lights
`ckad-observability`). Jesse's invoice-api 2.0 moved its readiness endpoint to /readyz; the
manifest's probe still asks /healthz, so the pods run with READY 0/1, describe shows the 404, and
the Service sends them nothing. The fix is in the manifest; applying a changed pod template rolls
the Deployment out by itself. Deleting the probe makes the pods Ready too, which the game says is
not the fix. Kim's golden-path battle lights `ckad-config-security`.

**Written so far: CrashLoopBackOff** (`content/quests/crashloop-config`, Junior, lights
`k8s-fundamentals`). Mila from the platform team stands on the square; the jump host is the
rack at the back right of the server room. shop-api's two pods crash-loop after a ConfigMap
change. The player finds the pods in the `shop` namespace, reads `kubectl describe pod` (the
back-off, exit code 1, the environment from the ConfigMap) and `kubectl logs` (an invalid
`LOG_LEVEL`), fixes `~/shop-k8s/configmap.yaml`, sends it with `kubectl apply -f` (saving the
file alone changes nothing in the cluster; the cluster keeps objects, so a fixed copy applied
from elsewhere counts too, and only the four values the log names win) and starts fresh pods with `kubectl rollout restart`.
The last hint says why: a container reads its environment when it starts; crash-looping ones
would pick up the fix at their next restart attempt, but the back-off can take minutes, and a
running pod would never pick it up.

### Karma, side hustles, the contractor and the ethical hacker

Mark, 27 Nov 2026: "karma paths: a guy behind a building who asks you to hack something. Money,
but get caught (a bad hack) and it's a fine or an arrest (a big fine or negative karma), so no
bank jobs (other jobs, yes; very negative karma is the FBI or the CIA). Or an independent
contractor: skip procedures, but you pay for the damage. And a career path ethical hacker."

The engine is in `src/core/karma.ts` (numbers and rules) and `src/core/game.ts` (paying,
`finishHustle`); content reaches it only through data: a quest's `kind`, `available_when` and
`reward.karma`, a scenario event's `karma`, a scenario's `risk` and an objective's `procedure`.

**Karma, as built.**

| Rule | Value |
| ---- | ----- |
| Range, start | -100 to +100, starts at 0 (a save from before karma starts at 0 too) |
| Content asks | progress facts `karma`, `probation`, `strikes`, `contractor` in any progress condition: a quest's `available_when`, NPC dialogue. Negative numbers may be written (`karma <= -20`) |
| Clearance jobs (bank, enterprise) | `available_when: 'karma >= 0 && !probation'`: a clean record. Polderbank's pentest asks it |
| Shady jobs | the fixer works with `karma <= 20`: too clean and he does not know you. Later side jobs can ask lower karma (`karma <= -20`) |
| A hustle done clean | its reward and its `reward.karma` (the vending job: €350, karma -20) |
| Caught | a €150 fine, karma -10, a strike; the job stays open (a new roll next time) and pays nothing |
| Arrested (the second strike) | another €500 and karma -15, and probation |
| The agency | karma dropping to -60 or below while not on probation: the TLA (the Three-Letter Agency; in Dutch the DDL, Dienst Drie Letters) asks questions: a €400 fine and probation |
| Probation | shuts what asks `!probation` (bank and enterprise jobs). Other work goes on: nobody is locked out of the game |
| Community service (`kind: service`) | open on probation or below zero; ends probation, wipes the strikes and brings karma back to at least 0; pays karma, no money, and its XP (and the homelab's income) only the first time, so it cannot be farmed. A new dip below zero or a new probation opens it again; loading a save on probation reopens it too |
| Pentests | karma up (`reward.karma`: Polderbank +10). Opening data you did not need, or leaving the scope, costs karma (events) |
| Fines | never take money below zero |

Why these numbers: a Junior quest pays €125 to €300. A clean hustle pays €350, a good quest's
worth, for karma -20, which is enough to shut the bank until community service. Played
carefully the risk is 20%; a catch keeps the job open with a new roll, so a careful player gets
the €350 in the end, minus about €30 in expected fines and a 4% chance of a second catch (an
arrest: €650 more and probation), so about €290 on average. Played sloppily (95%) it is worth
less than nothing and an arrest is likely. Community service then costs a few minutes and pays
no money: the karma is the price.

**The meter.** The Career Trail's header shows "Karma +10", a bar from -100 to +100 with a tick
at 0, and the meter's name; the HUD toasts every change ("Karma -20: Hoodie in a stock photo").

| Karma | Name (EN) | Naam (NL) |
| ----- | --------- | --------- |
| 60 and up | Responsible disclosure saint | Heilige van de responsible disclosure |
| 20 to 59 | Trusted (LinkedIn verified) | Betrouwbaar (LinkedIn-geverifieerd) |
| -19 to 19 | Neutral, like a fresh VM | Neutraal, als een verse VM |
| -59 to -20 | Hoodie in a stock photo | Hoodie op een stockfoto |
| -60 and below | On the TLA's whiteboard | Op het whiteboard van de DDL |

The agency is comically generic on purpose: a made-up name that is its own joke, no logo, no
badge, no real service. Agent Jansen does the talking.

**Side hustles.** Vince stands behind the office, out of sight of the street, next to a crate
with a laptop (a shared kiosk). His jobs are quests of `kind: hustle`: big money, karma down.
Each hustle's scenario has a `risk`: a base chance plus factors, conditions on the machine that
add (or, for careful play, subtract) percentage points while they hold. The terminal shows the
heat live in its side panel ("Chance of getting caught: 30%", and why). When the last objective
is met the game rolls: the risk, capped at 95%, against a roll from 0 to 99 seeded by the save,
the quest and how often the player was caught before (`riskRoll`, never unseeded dice). The
same save finishing the same way always gets the same answer; closing the terminal to retry
never rerolls; only getting caught moves the dice on.

*The vending machine job* (`content/quests/vending-prices`): SnackoMat wants Munchr Vending's
2027 prices. Munchr left an internal folder on its public file share (a fictional company and a
fictional share, mounted on the kiosk). Read the README, find the price list, write two prices
in the drop file. What raises the heat: going through the HR folder (a recursive grep over the
share walks through it too, and that costs 5 karma), three failed commands (the kiosk beeps),
twenty commands (the barista stares), taking the file instead of reading it, and still being
signed in with your own library card when you drop. Careful play is 20%; sloppy play hits the cap.

*Safety.* The hack is abstract: no real technique, tool, exploit or payload, nothing that
teaches an intrusion. Reading a folder that someone left in a public place is the whole trick,
and the game says plainly that doing it for real is a crime (computervredebreuk in the
Netherlands) and what to do instead: report it through the company's security.txt or bug
bounty. A hustle's first ending, caught or not, ends on that line (once per job, so retries do
not preach), and Vince himself mentions security.txt.

**The independent contractor.** A setting in the menu, "Work as: employee / contractor",
stored in the save (`contractor`). As a contractor, on a job whose scenario has procedures to
skip (not a battle, a hustle, community service, or a job without procedures, which pays and
bills as usual; https://github.com/MWest2020/nines/issues/28):

| Rule | Value |
| ---- | ----- |
| Procedures | objectives marked `procedure: true` (a change ticket, a commit for review) do not count: crossed out, "skipped (contractor)" |
| Money | 150% of the job's money, after the AI-hint scaling; XP unchanged, the homelab's income unscaled |
| Damage | every penalty (a scenario event, the built-in outage) billed at 3 times, never below zero |
| When | the mode when the terminal opens holds for that session (the menu is shut while it is open) |

So "consequences, not blocks" gets sharper: the contractor is never stopped either, but `rm` on
the wrong thing costs triple. *The bakery hotfix* (`content/quests/bakery-hotfix`, from Femke
after Disk full) shows it: a price written with a comma takes a bakery's web shop down. On
payroll: fix it, fill in change ticket CHG-1042, commit the fix (€200). As a contractor: fix it
(€300), but deleting today's orders costs €360 instead of €120.

**Ethical hacker.** The sixth path: authorised pentests and CTF-style quests, responsible
disclosure, karma up. Its quests start from a signed scope, and the rules are the trade's: read
the scope first, report don't fix, stop at customer data, evidence not trophies.

*Pentest: Polderbank staging* (`content/quests/bank-pentest`, Junior, from Sanne in front of the
office; the bank's rack in the server room). Engagement PB-2026-11 is signed in
`~/engagement/scope.txt`: in scope the machine's `/etc` and its web root, out of scope
`/srv/customer-exports` and any change. The misconfiguration: nginx serves `/exports/` with
`autoindex on`, a directory listing, and a database backup lies in that folder, so anyone on
the internet can list and download it (the access log shows an outside address already did).
The player proves it with `ls -l` (name, size, place) without opening the backup, and writes
finding-01: the setting and the web path, a severity (high), and the fix (autoindex off, the
backup out of the web root). Reading the server before the scope gets a word from Sanne; a
recursive grep over `/srv` walks into the customer data (€100 and karma -10); opening the
backup with a reading command (cat, less, tail, grep, edit) costs 5 karma, while `ls -l` or
`du` on it is just evidence; changing their config is put back and costs €50. It pays €300, 30 XP
and karma +10, and needs a clean record.

**Community service.** *Repair Café* (`content/quests/repair-cafe`): Henk's stall in the park.
The booking page has been down since a power cut (stopped cleanly, not failed); start it and
write in the logbook what you did. Humble on purpose.

**The `touched()` fact.** Scope, snooping and peeking need to know what the player reached, so
scenarios have `touched(path)`: true when a command named that path, or something inside it, as
an operand (cd, cat, ls, less, edit, a pipe stage too; flag values and grep's pattern are not
operands), or when a recursive command (grep -r, du, rm -r; with no folder, the working
directory) walked a folder above it. And `opened(path)`: true only when a reading command (cat,
less, tail, grep, edit, mv) opened the file, or grep -r read through a folder above it. Listing
or sizing a file touches it without opening it.

### Share my progress (design only, not built)

Mark, 27 Nov 2026, wants "share my progress", and saw that without a server it can be
faked. Two options:

- **A. A self-reported share card.** A Share button renders a card in our pixel style: stage,
  path, XP per branch, quests done, and the brag line "with 2 AI hints". It is offered as a PNG
  (the Web Share sheet on Android, a download on desktop) and as a link to the Pages site with
  the progress in the URL fragment (`#share=...`, never sent to any server), which opens a
  read-only card. No server, no account, nothing sent unless the player shares it. Anyone can
  craft a fake link; for a game about fun that is fine.
- **B. A card signed by a small server.** The game sends its run (the commands and answers;
  the core is deterministic, so the server can replay the run in the same simulator) and gets
  back a signed card. It costs a backend to build, run, secure and pay for, abuse limits, and
  data leaving the device (Play's Data safety changes, AGENTS.md rule 3 applies in full). And it
  still cannot stop a determined cheater: the client is open source, so a script can produce a
  valid run. A signature proves that a valid run exists, not who played it.

**Recommendation: A first.** It is fun, private and needs no infrastructure. B only makes sense
if leaderboards or prizes ever matter, and then it needs Mark's approval for the server.

### Later

Not designed yet, kept in the roadmap so they are not lost: meme internet cafés (a place in
each town with tech-meme side quests, tech debt and a jukebox), miniature games (small arcade
cabinets: a log-grep race, packet Tetris, a YAML-indent rhythm game), and a swag shop (stickers,
hoodies and mugs, in-game first; real merchandise only if Mark wants it). Tech, memes and fun
lead (Mark, 27 Nov 2026).

### Battles: the war room

Mark asked for battles (26 Nov 2026): "someone attacks you with questions about design choices
or a production incident". Three kinds: a whiteboard interview, a production incident and a
demanding product manager. The engine is in ARCHITECTURE.md, Battles.

**Framing, and why.** The best-known battle screen in games belongs to the franchise we stay
away from: a "wild ..." announcement, two sprites facing each other with an HP bar over each,
and a four-item command menu at the bottom right. All three are recognisable on sight, so we use
none of them. Engineers already have their own pressure-cooker screen: the incident channel and
the whiteboard. Our battles take that shape.

- **Announcement.** A battle opens with how it reaches you at work: `PAGER 03:07 ·
  checkout-api · 5xx error rate 18%` for an incident, `Incoming: Daan, product manager` for a
  stakeholder, `Whiteboard interview · Topic: a rate limiter` for a design interview. Never the
  catchphrase; the validator refuses it in English and Dutch.
- **Layout.** A chat transcript, not an arena: the attacker's messages on the left with a small
  portrait (the NPC's own sprite, head only, never full figures facing off), the player's
  answers on the right, explanations as indented notes under each answer. Design interviews
  add a whiteboard panel above the transcript that holds the requirements so far (the context
  the interviewer gave before each question) and, in a "spot the flaw" round, only the proposal
  being judged. Another kind shows the whiteboard only for a proposal.
- **Meters.** Two labelled gauges in the side panel, with words and numbers, never bars over
  sprites. The player's is **Confidence**. The attacker's is **Pressure**, labelled by kind:
  **Doubt** for the interviewer, **Impact** for the incident, **Pressure** for the product
  manager. A good answer lowers it; a weak one costs Confidence.
- **Answers.** Cards that span the width under the transcript, picked by tap or click and
  sent with one Send button. An order round shows the cards as a list with ↑/↓ handles
  (dragging works too). No command menu, no cursor triangle, no letters on buttons.
- **Colours.** The panel is ink (`#101820`) with paper text. Confidence is grass (`#58a058`)
  above 50 and orange (`#e89858`) at or below; the attacker's meter is clay (`#c86848`). A
  graded answer gets a mark and a word, never colour alone: ✓ "Spot on", ½ "Half right",
  ✗ "Not quite".
- **Losing.** "Not this time" and the debrief, with Try again right under it. No money is
  taken, nothing is locked; hints are ready on the next try (each costs an AI token).

Desktop (an incident):

```
┌─ Incident · PAGER · checkout-api ────────────────────── Round 3/7 ─┬────────────────────┐
│ PAGER 03:07 · checkout-api · 5xx error rate 18% (alert at 1%)      │ Confidence     100 │
│                                                                    │ ██████████████████ │
│ ▣ Bas   18% of checkouts are failing. What's your first move?      │                    │
│              Acknowledge the page, then open the dashboard. ◂ you  │ Impact          70 │
│              ✓ Spot on: acknowledging is taking ownership...       │ ██████████████░░░░ │
│ ▣ Bas   Errors jumped at 03:00. Where do you look next?            │                    │
│               At what changed: v2.14 rolled out at 02:59. ◂ you    │ Hint               │
│              ✓ Spot on: a sudden step at an exact minute...        │ Stop the bleeding  │
│ ▣ Bas   OK, the deploy it is. Put the next steps in order.         │ before you study   │
├────────────────────────────────────────────────────────────────────┤ the wound.         │
│  ↑↓  Roll checkout-api back to v2.13                               │                    │
│  ↑↓  Find the root cause in v2.14                                  │                    │
│  ↑↓  Declare an incident and say who leads it                      │                    │
│  ↑↓  Check that the error rate is back to normal                   │                    │
│  ...                                                     [ Send ]  │                    │
└────────────────────────────────────────────────────────────────────┴────────────────────┘
```

Desktop (a design interview, "spot the flaw"):

```
┌─ Whiteboard interview · Ingrid, staff engineer ──────── Round 4/8 ─┬────────────────────┐
│ ┌─ whiteboard ───────────────────────────────────────────────────┐ │ Confidence     100 │
│ │ 20 API instances behind a round-robin load balancer            │ │ ██████████████████ │
│ │ each instance: a token bucket per API key, in its own memory   │ │                    │
│ │ each bucket allows the full 100 requests per minute            │ │ Doubt           55 │
│ └────────────────────────────────────────────────────────────────┘ │ ██████████░░░░░░░░ │
│ ▣ Ingrid  What is wrong with this?                                 │                    │
├────────────────────────────────────────────────────────────────────┤                    │
│ ( ) In-memory counters add latency to every call                   │                    │
│ (•) One client is spread over 20 instances: up to 2,000 per minute │                    │
│ ( ) A restarted instance hands every client a fresh burst          │                    │
│ ( ) Round-robin ignores how busy each instance is                  │                    │
│                                                         [ Send ]   │                    │
└────────────────────────────────────────────────────────────────────┴────────────────────┘
```

Phone, portrait: the side panel becomes two thin gauges under the header; hints collapse into
a count in the header (`? 1`) that opens them over the transcript. Phone, landscape (short and
wide): the transcript (with the whiteboard above it) and the answer cards side by side, the
meters and hints in a narrower column on the right.

```
┌──────────────────────────────┐
│ Meeting · Daan   ? 1  3/6  ✕ │
│ Confidence ████████████░  90 │
│ Pressure   █████████░░░░  70 │
├──────────────────────────────┤
│ ▣ Daan  And the full version │
│ with refunds? How long?      │
│ Discount codes took 6 days   │
│ plus 2 days of testing.      │
├──────────────────────────────┤
│ ( ) under a day              │
│ ( ) 1 to 3 working days      │
│ (•) 4 to 15 working days     │
│ ( ) 16 or more working days  │
│                     [ Send ] │
└──────────────────────────────┘
```

### Mobile controls

Touch devices get a D-pad, one action button and one back button, labelled with icons, not
letters. Tapping a tile walks there along a path; tapping an NPC or an object walks next to it
and uses it. Keyboard: arrows or WASD, Enter or Space to use, Escape to go back.

Portrait (view on top, controls below):

```
┌──────────────────────────────┐
│                              │
│      game view 240 x 160     │
│      (scaled x2 or x3)       │
│                              │
├──────────────────────────────┤
│ €350                ☰    ◎   │
│        ┌────┐                │
│   ┌────┤ ▲  ├────┐   ( ✋ )  │  use / talk
│   │ ◀  │    │  ▶ │           │
│   └────┤ ▼  ├────┘  ( ↩ )    │  back
│        └────┘                │
└──────────────────────────────┘
```

Landscape (controls on both sides of the view):

```
┌──────────────────────────────────────────────────────────────┐
│ €350                                                 ☰   ◎   │
│     ┌───┐       ┌──────────────────────────┐                 │
│ ┌───┤ ▲ ├───┐   │                          │      ( ✋ )     │
│ │ ◀ │   │ ▶ │   │    game view 240 x 160   │                 │
│ └───┤ ▼ ├───┘   │                          │   ( ↩ )         │
│     └───┘       └──────────────────────────┘                 │
└──────────────────────────────────────────────────────────────┘
```

On a desktop without touch the controls are hidden; a window under 600 px wide shows them, and
the menu's Controls setting (Auto, On, Off) overrides both. The icons are our own pixel shapes
(arrows, an open hand, a turn-back arrow, three bars, a milestone stone), never letters. The
money and the current quest stay in the HUD band on the canvas; the controls area carries big
menu and Career Trail buttons. The terminal overlay replaces the controls
while it is open, so the D-pad never fights the soft keyboard.
