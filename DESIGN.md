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
gear, a Career Trail, and one of five career paths. The trail is our own idea of a skill map; roadmap.sh inspired the concept
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
| Map | Junior Village 40 x 30 tiles; server room 15 x 10 (one screen) |
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
devops, platform engineer and systems engineer." Five paths replace the two tracks (SRE,
Platform) of the first brief. They live in `content/roadmap.yaml` (`paths`, each with a title
and a one-line pitch in both languages), and every quest lists the paths it counts towards
(`paths` in quest.yaml; the validator checks they exist).

| Path | Pitch (EN) | Home branches |
| ---- | ---------- | ------------- |
| Software Engineer (`swe`) | You build the product: clean code, sound designs, and features that survive real users. | design, git, cicd |
| Site Reliability Engineer (`sre`) | You keep it up: SLOs, error budgets, on-call, and a quieter pager every month. | incident, observability, linux, kubernetes |
| DevOps Engineer (`devops`) | You get changes to production safely and often: pipelines, releases, and teams that ship together. | cicd, iac, containers, incident |
| Platform Engineer (`platform`) | You build the road other teams drive on: Kubernetes, golden paths, and self-service that just works. | kubernetes, containers, iac, observability |
| Systems Engineer (`systems`) | You know the machine: Linux, networks, storage and hardware, all the way down to the cables. | linux, networking, incident |

The Dutch pitches are in `content/locales/nl.yaml`.

**The choice at Medior City.** Junior Village is the same for everyone: every quest there is
open, whatever its tags. On arriving in Medior City (after the gate interview) a career coach
asks which path you want, showing the five pitches; the choice is stored in the save (`path`,
`core/game.ts choosePath`, refused before the road to Medior City is open and once made).
What a path unlocks:

- the path's own quest line in Medior City (a mentor NPC and three to five quests tagged with it),
- its own gate interview on the road to Senior Summit (the boss for that path),
- a path item in the Homelab Store (ideas in docs/content-backlog.md, Career paths),
- its name on the Career Trail and the credits.

Quests of other paths stay playable as side quests: nothing locks a player out for good. Until
Medior City has a map the choice exists only in the rules and the save.

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
