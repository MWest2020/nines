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
gear, a Career Trail. The trail is our own idea of a skill map; roadmap.sh inspired the concept
of nodes lighting up, and we copy none of its content, layout or branding.

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
| Kenney Fonts | https://kenney.nl/assets/kenney-fonts | bitmap/pixel fonts | the in-canvas font, if it has €, ë, é and ï; otherwise we draw a 5x7 font ourselves |

Checked on 26 Nov 2026: each page lists "Creative Commons CC0"; the RPG Urban Pack and Tiny
Town pages list 16 x 16 tiles. Roguelike Modern City (https://kenney.nl/assets/roguelike-modern-city)
is the fallback if the Urban Pack misses something.

**What we draw ourselves** (own work, released CC0, listed in ASSETS.md as own work): the
player and NPC walk cycles (Kenney's character sprites have no four-direction walk cycles), the
server racks, blinking LEDs, laptops and the Raspberry Pi, the Career Trail markers, the
dialogue and terminal frames, and the placeholder NPC that is tinted per `npc.yaml`.

The terminal uses the device's monospace font (`ui-monospace, monospace`): crisp at any size,
nothing to download or license.

## Sizes

| Thing | Size |
| ----- | ---- |
| Logical view | 240 x 160 px (15 x 10 tiles), scaled by an integer where it fits, `pixelArt: true` |
| Tile | 16 x 16 |
| Character frame | 16 x 16 (cameos may use 32 x 32) |
| Character sheet | 3 columns (step, stand, step) x 4 rows (down, left, right, up): 48 x 64 px, or 96 x 128 px with 32 px frames. The validator enforces this. |
| Walk | 4 frames per tile step at 8 fps (step, stand, step, stand); one tile per 250 ms |
| Map | Junior Village 40 x 30 tiles; server room 15 x 10 (one screen) |
| Canvas text | 8 px pixel font, 10 px line height |
| Touch targets | at least 48 x 48 CSS px; D-pad 144 x 144 |
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

A counter in the village. One item in the MVP; later items show as silhouettes with the town
that unlocks them.

```
┌─ Homelab Store ─────────────────────────────────── €350 ─┐
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

On a desktop without touch the controls are hidden. The terminal overlay replaces the controls
while it is open, so the D-pad never fights the soft keyboard.
