"""Browser smoke test: play the three MVP quests and the sample guest cameo on the built game,
typing real commands.

It serves dist/ under a sub-path (like GitHub Pages) from a server inside this process, walks
the player to each machine with the keyboard (paths come from the Tiled maps), plays the quest
in the terminal overlay, and fails on any request that leaves the page's origin or any page
error. Run it after `npm run build`, one browser at a time, under the memory cap (AGENTS.md):

    timeout -s KILL 900 systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0 \\
      uv run -q --with-requirements tests/e2e/requirements.txt python -u tests/e2e/smoke.py [--shots DIR]

CHROME (an executable path) picks the browser; otherwise Playwright's own headless shell runs.
"""

from __future__ import annotations

import argparse
import re
import functools
import http.server
import json
import os
import re
import sys
import threading
import struct
import time
import zlib
from collections import deque
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
MAPS = ROOT / "content" / "maps"
BASE = "/nines/"
TILE = 16
DIRS = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}
KEYS = {"up": "ArrowUp", "down": "ArrowDown", "left": "ArrowLeft", "right": "ArrowRight"}
# NPC slots, as the game reads them (isNpcSlot in src/world/grid.ts): an NPC may stand there, so
# the walk never plans through one, whichever quests the content folder holds.
NPC_SLOT = re.compile(r"^(npc|cameo)-[0-9]+$|^gate-[a-z0-9-]+$")


# ---------------------------------------------------------------- serving dist/ at /nines/

class Handler(http.server.SimpleHTTPRequestHandler):
    served: list[str] = []  # every request that reached the server (the offline check reads it)

    def translate_path(self, path: str) -> str:
        Handler.served.append(path)
        path = path.split("?", 1)[0]
        if path.startswith(BASE):
            path = "/" + path[len(BASE):]
        return super().translate_path(path)

    def log_message(self, *args) -> None:  # quiet
        pass


def serve() -> tuple[http.server.ThreadingHTTPServer, str]:
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(DIST)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


# ---------------------------------------------------------------- the maps, as a grid

class Grid:
    def __init__(self, map_id: str):
        m = json.loads((MAPS / f"{map_id}.json").read_text())
        self.w, self.h = m["width"], m["height"]
        collides = set()
        for ts in m["tilesets"]:
            for t in ts.get("tiles", []):
                if any(p["name"] == "collides" and p["value"] is True for p in t.get("properties", [])):
                    collides.add(ts["firstgid"] + t["id"])
        layer = next(l for l in m["layers"] if l["name"] == "collision")
        self.solid = {(i % self.w, i // self.w) for i, g in enumerate(layer["data"]) if (g & 0x0FFFFFFF) in collides}
        self.objects = {}
        for l in m["layers"]:
            if l["type"] != "objectgroup":
                continue
            for o in l["objects"]:
                x = int((o["x"] + o.get("width", 0) / 2) // TILE)
                y = int((o["y"] + o.get("height", 0) / 2) // TILE)
                self.objects[o["name"]] = (o["type"], x, y)
        self.doors = {(x, y) for (t, x, y) in self.objects.values() if t == "door"}
        self.npcs = {(x, y) for n, (t, x, y) in self.objects.items() if NPC_SLOT.match(n)}

    def free(self, p: tuple[int, int], goal: tuple[int, int]) -> bool:
        x, y = p
        if not (0 <= x < self.w and 0 <= y < self.h) or p in self.solid or p in self.npcs:
            return False
        return p not in self.doors or p == goal

    def path(self, start: tuple[int, int], goal: tuple[int, int], order: list[str] | None = None) -> list[str]:
        prev: dict[tuple[int, int], tuple[tuple[int, int], str] | None] = {start: None}
        q = deque([start])
        while q:
            cur = q.popleft()
            if cur == goal:
                break
            for d in order or list(DIRS):
                dx, dy = DIRS[d]
                nxt = (cur[0] + dx, cur[1] + dy)
                if nxt not in prev and self.free(nxt, goal):
                    prev[nxt] = (cur, d)
                    q.append(nxt)
        if goal not in prev:
            raise RuntimeError(f"no path from {start} to {goal}")
        steps, cur = [], goal
        while prev[cur] is not None:
            cur, d = prev[cur]
            steps.append(d)
        return steps[::-1]

    def stand_by(self, name: str, start: tuple[int, int]) -> tuple[tuple[int, int], str]:
        """A free tile next to an object, and the facing that looks at it: the nearest one."""
        _, ox, oy = self.objects[name]
        best = None
        for d, (dx, dy) in DIRS.items():
            spot = (ox - dx, oy - dy)
            if not self.free(spot, spot):
                continue
            try:
                n = len(self.path(start, spot))
            except RuntimeError:
                continue
            if best is None or n < best[0]:
                best = (n, spot, d)
        if best is None:
            raise RuntimeError(f"cannot stand next to {name}")
        return best[1], best[2]


# ---------------------------------------------------------------- the player

class Player:
    def __init__(self, page: Page, map_id: str, pos: tuple[int, int], facing: str):
        self.page, self.map, self.pos, self.facing = page, map_id, pos, facing

    def tap(self, d: str, hold_ms: int) -> None:
        self.page.keyboard.down(KEYS[d])
        self.page.wait_for_timeout(hold_ms)
        self.page.keyboard.up(KEYS[d])

    def walk(self, grid: Grid, steps: list[str]) -> None:
        for d in steps:
            if d != self.facing:
                self.tap(d, 30)  # a short tap only turns
                self.page.wait_for_timeout(160)
                self.facing = d
            self.tap(d, 150)  # held past the turn delay: one step, released before the next
            self.page.wait_for_timeout(330)
            dx, dy = DIRS[d]
            self.pos = (self.pos[0] + dx, self.pos[1] + dy)

    def face(self, d: str) -> None:
        if d != self.facing:
            self.tap(d, 30)
            self.page.wait_for_timeout(160)
            self.facing = d

    def go_to(self, grid: Grid, spot: tuple[int, int]) -> None:
        self.walk(grid, grid.path(self.pos, spot))


# ---------------------------------------------------------------- the terminal

def term_text(page: Page) -> str:
    return page.locator(".nt-screen .xterm-rows").inner_text()


def run(page: Page, line: str, expect: str | None = None) -> None:
    page.locator(".nt-input").click()
    page.keyboard.type(line, delay=8)
    page.keyboard.press("Enter")
    if expect is not None:
        page.wait_for_function(
            "s => document.querySelector('.nt-screen .xterm-rows').innerText.includes(s)", arg=expect, timeout=5000
        )
    else:
        page.wait_for_timeout(150)


def objectives(page: Page) -> tuple[int, int]:
    done = page.locator(".nt-objectives li.nt-done").count()
    return done, page.locator(".nt-objectives li").count()


def edit_file(page: Page, text: str) -> None:
    """Replace the editor's text by typing it (Tab would indent; this text has none), then Ctrl+S."""
    area = page.locator(".nt-area")
    area.click()
    page.keyboard.press("Control+A")
    page.keyboard.press("Delete")
    page.keyboard.type(text, delay=2)
    page.keyboard.press("Control+S")
    page.locator(".nt-editor").wait_for(state="hidden")


def finish(page: Page, title_part: str, reward: str | None = None) -> None:
    """The win: the overlay celebrates, Continue closes it, the giver's done lines follow."""
    dialog = page.locator(".nt-dialog")
    dialog.wait_for(state="visible", timeout=5000)
    text = dialog.inner_text()
    assert "Quest complete" in text, text
    assert "Reward" in text, text
    if reward is not None:
        assert reward in text, text
    page.keyboard.press("Enter")  # the Continue button has focus
    page.locator(".nt-overlay").wait_for(state="detached", timeout=5000)
    # The giver's "done" lines follow in the HUD dialogue box. Press Enter until the world is
    # free again: the player still faces the machine, so that Enter opens its terminal again
    # (a done quest replays without a reward). Leave it with exit.
    for _ in range(12):
        page.wait_for_timeout(450)
        page.keyboard.press("Enter")
        page.wait_for_timeout(250)
        if page.locator(".nt-overlay").count() > 0:
            break
    else:
        raise AssertionError("the world did not take control back after the quest")
    run(page, "exit")
    page.locator(".nt-overlay").wait_for(state="detached", timeout=5000)
    page.wait_for_timeout(300)
    print(f"  done: {title_part}")


def open_terminal(page: Page, p: Player, grid: Grid, obj: str) -> None:
    spot, facing = grid.stand_by(obj, p.pos)
    p.go_to(grid, spot)
    p.face(facing)
    page.keyboard.press("Enter")
    page.locator(".nt-overlay").wait_for(state="visible", timeout=5000)
    page.wait_for_timeout(300)
    # the Enter that opened the terminal did not also run an empty line
    assert "$" not in term_text(page), term_text(page)


# ---------------------------------------------------------------- the quests

def disk_full(page: Page, shots: Path | None) -> None:
    run(page, "df -h", "/dev/sdb1")
    assert "95% /var" in term_text(page), term_text(page)
    run(page, "du -sh /var/*", "/var/log")
    # Tab completion of a path, typed for real
    page.locator(".nt-input").click()
    page.keyboard.type("cd /var/lo")
    page.keyboard.press("Tab")
    assert page.locator(".nt-input").input_value() == "cd /var/log/", page.locator(".nt-input").input_value()
    page.keyboard.press("Enter")
    run(page, "ls -lh nginx", "access.log.9.gz")
    if shots:
        page.screenshot(path=str(shots / "terminal-disk-full.png"))
    # a dangerous command: the consequence is told in dialogue and the machine is restored
    run(page, "rm -r /var/lib/postgresql")
    dialog = page.locator(".nt-dialog")
    dialog.wait_for(state="visible", timeout=5000)
    assert "Femke" in dialog.inner_text() and "deleted the database" in dialog.inner_text(), dialog.inner_text()
    if shots:
        page.screenshot(path=str(shots / "terminal-consequence.png"))
    page.keyboard.press("Enter")
    dialog.wait_for(state="hidden")
    # history: up brings the last line back
    page.locator(".nt-input").click()
    page.keyboard.press("ArrowUp")
    assert page.locator(".nt-input").input_value() == "rm -r /var/lib/postgresql"
    # Ctrl-C drops it
    page.keyboard.press("Control+C")
    assert page.locator(".nt-input").input_value() == ""
    # the machine was restored from its snapshot, so the shell is back in the home directory
    run(page, "pwd", "/home/dev")
    assert objectives(page) == (2, 3), objectives(page)
    run(page, "rm /var/log/nginx/*.gz")
    finish(page, "Disk full")


PIPELINE_FIXED = """stages:
  - build
  - test

build:
  stage: build
  script:
    - npm ci
    - npm run build

test:
  stage: test
  needs: [build]
  script:
    - npm test
"""

SHOP_CONF_FIXED = """server {
  listen 80;
  server_name shop.example.test;
  root /var/www/shop;
}
"""


def broken_pipeline(page: Page, shots: Path | None) -> None:
    run(page, "cat ci-last-run.log", "Tabs are not allowed")
    page.locator(".nt-input").click()
    page.keyboard.type("edit .ni")
    page.keyboard.press("Tab")
    assert page.locator(".nt-input").input_value() == "edit .nines-ci.yml ", page.locator(".nt-input").input_value()
    page.keyboard.press("Enter")
    page.locator(".nt-editor").wait_for(state="visible")
    gutter = page.locator(".nt-gutter").inner_text()
    assert "15⇥" in gutter, gutter
    assert "Tab on line 15" in page.locator(".nt-status").inner_text()
    if shots:
        page.screenshot(path=str(shots / "editor-pipeline.png"))
    edit_file(page, PIPELINE_FIXED)
    assert objectives(page) == (1, 2), objectives(page)
    run(page, "git status", "modified:")
    run(page, "git add .nines-ci.yml")
    run(page, 'git commit -m "fix pipeline"')
    finish(page, "Broken pipeline")


def service_down(page: Page, shots: Path | None, reward: str | None = None) -> None:
    run(page, "systemctl status nginx", "failed")
    run(page, "journalctl -u nginx", 'unknown directive "listn"')
    # Esc on a changed buffer asks for a second Esc before it throws the change away
    run(page, "edit /etc/nginx/conf.d/shop.conf")
    page.locator(".nt-editor").wait_for(state="visible")
    page.locator(".nt-area").click()
    page.keyboard.type("x")
    page.keyboard.press("Escape")
    assert page.locator(".nt-editor").is_visible()
    assert "Esc again" in page.locator(".nt-status").inner_text()
    page.keyboard.press("Escape")
    page.locator(".nt-editor").wait_for(state="hidden")
    run(page, "edit /etc/nginx/conf.d/shop.conf", "Closed /etc/nginx/conf.d/shop.conf without saving.")
    page.locator(".nt-editor").wait_for(state="visible")
    edit_file(page, SHOP_CONF_FIXED)
    run(page, "systemctl restart nginx")
    finish(page, "Service down", reward)


def save_game(page: Page) -> dict:
    return json.loads(page.evaluate("localStorage.getItem('nines.save')"))["game"]


def through_door(page: Page, p: Player, grid: Grid, door: str, to_map: str, to: tuple[int, int], facing: str) -> None:
    _, dx, dy = grid.objects[door]
    p.go_to(grid, (dx, dy))
    page.wait_for_timeout(900)  # the fade into the next map
    p.map, p.pos, p.facing = to_map, to, facing
    page.wait_for_function("m => JSON.parse(localStorage.getItem('nines.save')).game.player.map === m", arg=to_map, timeout=5000)


def shop(page: Page, p: Player, village: Grid, shots: Path | None) -> None:
    """Money from quests buys the Raspberry Pi at the shop counter in the village."""
    before = save_game(page)
    assert before["money"] >= 200 and "raspberry-pi" not in before["items"], before
    spot, facing = village.stand_by("homelab-store", p.pos)
    p.go_to(village, spot)
    p.face(facing)
    page.keyboard.press("Enter")  # use the counter: the Homelab Store opens
    page.wait_for_timeout(700)
    if shots:
        page.screenshot(path=str(shots / "shop-before.png"))
    page.keyboard.press("Enter")  # Buy has the focus
    page.wait_for_function("() => JSON.parse(localStorage.getItem('nines.save')).game.items.includes('raspberry-pi')", timeout=5000)
    page.wait_for_timeout(300)
    if shots:
        page.screenshot(path=str(shots / "shop-pi.png"))
    after = save_game(page)
    assert after["money"] == before["money"] - 200, (before["money"], after["money"])
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    print(f"  bought the Raspberry Pi: money {before['money']} -> {after['money']}, items {after['items']}")


# The Career Trail (src/game/ui/TrailScene.ts), on the canvas: the screen sits under the 12 px HUD
# band; the chosen town's branch rows start at view y 52, 13 apart (11 when a town has six rows);
# a done stone is a filled gold diamond 9 px wide on its row, an open one an outline, a locked one
# a grey square.
BAND = 12
GOLD = (0xF8, 0xD0, 0x70)


def trail_rows() -> list[int]:
    n = len(junior_trail()[0])
    return [52 + (13 if n <= 5 else 11) * r for r in range(n)]


def png_pixels(data: bytes) -> tuple[int, int, int, list[bytes]]:
    """A small PNG decoder (8-bit RGB or RGBA, not interlaced): Playwright's screenshots."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat, w, h, bpp = 8, b"", 0, 0, 0
    while pos < len(data):
        n, typ = struct.unpack(">I4s", data[pos : pos + 8])
        body = data[pos + 8 : pos + 8 + n]
        pos += 12 + n
        if typ == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", body[:10])
            assert depth == 8 and ctype in (2, 6), (depth, ctype)
            bpp = 3 if ctype == 2 else 4
        elif typ == b"IDAT":
            idat += body
    raw, stride, rows, prev, i = zlib.decompress(idat), w * bpp, [], bytearray(w * bpp), 0
    for _ in range(h):
        f, line = raw[i], bytearray(raw[i + 1 : i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line))
        prev = line
    return w, h, bpp, rows


def done_stones(page: Page) -> list[list[float]]:
    """The filled gold diamonds on each branch row of the Career Trail, from the pixels: their
    centres (view x) per row."""
    box = page.locator("canvas").bounding_box()
    w, h, bpp, rows = png_pixels(page.screenshot(clip=box))
    k = w / 240  # screen pixels per canvas pixel

    def gold(cx: int, cy: int) -> bool:
        row = rows[min(h - 1, int((cy + 0.5) * k))]
        x = min(w - 1, int((cx + 0.5) * k)) * bpp
        return all(abs(row[x + i] - GOLD[i]) <= 16 for i in range(3))

    rows_found = []
    for ry in trail_rows():
        centres, run = [], 0
        for cx in range(100, 241):
            if cx < 240 and gold(cx, BAND + ry):
                run += 1
                continue
            if 5 <= run <= 11:
                centres.append(cx - run / 2 - 0.5)
            run = 0
        rows_found.append(centres)
    return rows_found


def junior_trail() -> tuple[list[str], dict[str, list[str]]]:
    """From content/roadmap.yaml: the branches with Junior stones in row order, and each row's stones."""
    text = (ROOT / "content" / "roadmap.yaml").read_text()
    branches = re.findall(r"^\s*- \{id: ([\w-]+), title: branch\.", text, re.M)
    rows: dict[str, list[str]] = {}
    for node, branch in re.findall(r"^\s*- \{id: ([\w-]+), branch: ([\w-]+), stage: junior\b", text, re.M):
        rows.setdefault(branch, []).append(node)
    return [b for b in branches if b in rows], rows


def quest_node(quest: str) -> str:
    return re.search(r"^roadmap_node: ([\w-]+)", (ROOT / "content" / "quests" / quest / "quest.yaml").read_text(), re.M).group(1)


def trail(page: Page, shots: Path | None) -> None:
    """The HUD's Career Trail button opens the trail; Junior Village shows three done stones."""
    box = page.locator("canvas").bounding_box()
    k = box["width"] / 240
    page.mouse.click(box["x"] + 232 * k, box["y"] + 6 * k)  # the milestone icon, right of the bar
    page.wait_for_timeout(700)
    if shots:
        page.screenshot(path=str(shots / "career-trail.png"))
    found = done_stones(page)
    counts = [len(c) for c in found]
    assert sum(counts) == 3, f"done stones per branch row: {counts}"
    # and they are the three quests' own stones: the right row, the right place in it (the
    # first stone of a row sits at x 120, later ones further right)
    order, rows = junior_trail()
    for q in ("broken-pipeline", "disk-full", "service-down"):
        node = quest_node(q)
        branch = next(b for b in order if node in rows[b])
        r, j = order.index(branch), rows[branch].index(node)
        assert len(found[r]) == 1, (q, node, found)
        x = found[r][0]
        assert (abs(x - 120) <= 1) if j == 0 else (x > 128), f"{q}: {node} is stone {j} of {branch}, gold at x {x}"
        print(f"  Career Trail: {q} lit {node} (row {branch}, stone {j + 1})")
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)


HOSTS_FIXED = """127.0.0.1   localhost
127.0.1.1   api-02
"""


def its_always_dns(page: Page, shots: Path | None) -> None:
    """The sample cameo (content/quests/its-always-dns): one folder, played like any quest."""
    run(page, "systemctl status invoice-api", "failed")
    run(page, "journalctl -u invoice-api", "db.internal resolved to 10.0.4.12")
    run(page, "cat /etc/nsswitch.conf", "files dns")
    run(page, "grep db.internal /etc/hosts", "10.0.4.12")
    run(page, "edit /etc/hosts")
    page.locator(".nt-editor").wait_for(state="visible")
    if shots:
        page.screenshot(path=str(shots / "editor-hosts.png"))
    edit_file(page, HOSTS_FIXED)
    run(page, "systemctl restart invoice-api")
    finish(page, "It's always DNS")


CONFIGMAP_FIXED = """apiVersion: v1
kind: ConfigMap
metadata:
  name: shop-api-config
  namespace: shop
data:
  DB_HOST: postgres.shop.svc.cluster.local
  DB_PORT: "5432"
  LOG_LEVEL: info
"""


def ask_the_ai(page: Page, shots: Path | None) -> None:
    """A hint that has unlocked shows its price first (DESIGN.md, AI tokens); asking pays a token,
    shows the hint, and is saved at once."""
    card = page.locator(".nt-hints .nh-card")
    card.wait_for(state="visible", timeout=5000)
    text = card.inner_text()
    assert "Ask the AI?" in text and "-1 token" in text and "-20% XP" in text, text
    if shots:
        page.screenshot(path=str(shots / "terminal-ask-ai.png"))
    before = save_game(page)["tokens"]
    card.locator(".nh-ask").click()
    page.wait_for_function("t => JSON.parse(localStorage.getItem('nines.save')).game.tokens === t", arg=before - 1, timeout=5000)
    assert page.locator(".nt-hints .nh-card").count() == 0
    hint = page.locator(".nt-hints .nt-hint").last.inner_text()
    assert "kubectl get pods" in hint, hint
    print(f"  asked the AI: tokens {before} -> {before - 1}, hint: {hint[:60]}...")


def crashloop_config(page: Page, shots: Path | None) -> None:
    """The first Kubernetes quest (content/quests/crashloop-config), with one paid hint."""
    run(page, "ls")
    run(page, "pwd")
    run(page, "cat ~/handover.txt", "namespace")
    ask_the_ai(page, shots)
    run(page, "kubectl get pods -n shop", "CrashLoopBackOff")
    run(page, "kubectl describe pods -n shop", "Back-off restarting failed container")
    run(page, "kubectl logs deployment/shop-api -n shop", "invalid LOG_LEVEL")
    run(page, "edit ~/shop-k8s/configmap.yaml")
    page.locator(".nt-editor").wait_for(state="visible")
    edit_file(page, CONFIGMAP_FIXED)
    run(page, "kubectl apply -f ~/shop-k8s/configmap.yaml", "configmap/shop-api-config configured")
    run(page, "kubectl rollout restart deployment/shop-api -n shop")
    # 80% of 175 after one hint, plus the Pi's 10 (never scaled)
    finish(page, "CrashLoopBackOff", reward="€150")


def buy_ai_credits(page: Page, p: Player, village: Grid, shots: Path | None) -> None:
    """AI credits: the shop's second page, bought with the keyboard; three tokens for €40."""
    before = save_game(page)
    spot, facing = village.stand_by("homelab-store", p.pos)
    p.go_to(village, spot)
    p.face(facing)
    page.keyboard.press("Enter")  # the Homelab Store opens on the Pi, owned: ‹ has the focus
    page.wait_for_timeout(700)
    page.keyboard.press("Enter")  # ‹ turns to the AI credits; Buy takes the focus
    page.wait_for_timeout(400)
    if shots:
        page.screenshot(path=str(shots / "shop-ai-credits.png"))
    page.keyboard.press("Enter")
    page.wait_for_function("t => JSON.parse(localStorage.getItem('nines.save')).game.tokens === t", arg=before["tokens"] + 3, timeout=5000)
    after = save_game(page)
    assert after["money"] == before["money"] - 40, (before["money"], after["money"])
    assert "ai-credits" not in after["items"], after["items"]
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    print(f"  bought AI credits: tokens {before['tokens']} -> {after['tokens']}, money {before['money']} -> {after['money']}")


def play(page: Page, village: Grid, room: Grid, shots: Path | None) -> None:
    _, sx, sy = village.objects["player-start"]
    p = Player(page, "junior-village", (sx, sy), "down")
    assert page.evaluate("document.querySelector('canvas').height") == 160 + BAND, "the canvas has the HUD band above the view"

    # 1. broken pipeline: Ravi's laptop in the village
    print("quest: broken-pipeline")
    open_terminal(page, p, village, "ravi-laptop")
    broken_pipeline(page, shots)

    # 2. into the server room
    _, ex, ey = room.objects["entrance"]
    through_door(page, p, village, "server-room-door", "server-room", (ex, ey), "up")
    if shots:
        page.screenshot(path=str(shots / "server-room.png"))  # the top wall and its whiteboard, under the HUD

    print("quest: disk-full")
    open_terminal(page, p, room, "rack-web-01")
    disk_full(page, shots)

    # 3. out to the shop: 200 for the pipeline, 150 lost on the database, 150 for the disk
    print("shop: the Raspberry Pi")
    _, vx, vy = village.objects["server-room-exit"]
    through_door(page, p, room, "exit", "junior-village", (vx, vy), "down")
    shop(page, p, village, shots)
    through_door(page, p, village, "server-room-door", "server-room", (ex, ey), "up")

    # 4. the Pi pays 10 more after the next quest: 175 + 10
    print("quest: service-down")
    open_terminal(page, p, room, "rack-app-01")
    service_down(page, shots, reward="€185")

    # the three MVP quests are done and paid, and the Pi is owned
    save = save_game(page)
    quests = save["quests"]
    for q in ("disk-full", "broken-pipeline", "service-down"):
        assert quests.get(q) == "done", quests
    # 200 + 150 + 175 in rewards, minus the 150 database mistake, minus 200 for the Pi, plus 10
    assert save["money"] == 185, save["money"]
    assert save["items"] == ["raspberry-pi"], save["items"]
    assert save["xp"] == {"cicd": 25, "linux": 20, "incident": 25}, save["xp"]
    print(f"  save: quests {quests}, money {save['money']}, items {save['items']}, xp {save['xp']}")

    # 5. the Career Trail lights the three MVP quests' own stones
    trail(page, shots)

    # 6. the sample cameo: Yara's machine is the spare rack cameo-rack-1
    print("quest: its-always-dns (sample cameo)")
    open_terminal(page, p, room, "cameo-rack-1")
    its_always_dns(page, shots)

    # the save says all four are done and paid
    save = save_game(page)
    quests = save["quests"]
    for q in ("disk-full", "broken-pipeline", "service-down", "its-always-dns"):
        assert quests.get(q) == "done", quests
    # 125 for the cameo plus the Pi's 10
    assert save["money"] == 320, save["money"]
    assert save["xp"] == {"cicd": 25, "linux": 40, "incident": 25}, save["xp"]
    print(f"  save: quests {quests}, money {save['money']}, xp {save['xp']}")
    assert save["tokens"] == 3, save["tokens"]  # no hint asked for yet

    # 7. the Kubernetes quest on the jump host rack-k8s-01, with one hint from the AI
    print("quest: crashloop-config (Kubernetes, one AI hint)")
    open_terminal(page, p, room, "rack-k8s-01")
    crashloop_config(page, shots)
    save = save_game(page)
    assert save["quests"].get("crashloop-config") == "done", save["quests"]
    assert save["hints"] == {"crashloop-config": ["hint.start"]}, save["hints"]
    assert save["tokens"] == 2 and save["money"] == 470, (save["tokens"], save["money"])
    assert save["xp"].get("kubernetes") == 20, save["xp"]  # 80% of 25

    # 8. more tokens from the shop
    print("shop: AI credits")
    through_door(page, p, room, "exit", "junior-village", (vx, vy), "down")
    buy_ai_credits(page, p, village, shots)
    save = save_game(page)
    assert save["tokens"] == 5 and save["money"] == 430, (save["tokens"], save["money"])
    if shots:
        page.screenshot(path=str(shots / "world-after.png"))


# ---------------------------------------------------------------- touch: phones and a tablet

# A stand-in for a soft keyboard that only shrinks the visual viewport (as browsers do without
# interactive-widget=resizes-content): window.visualViewport is wrapped, and window.__keyboard(h)
# makes it h px tall (null: closed). The page sees the same events a real keyboard sends.
FAKE_KEYBOARD = """
(() => {
  const real = window.visualViewport;
  if (!real) return;
  const fake = new EventTarget();
  let over = null;
  for (const k of ['width', 'height', 'offsetTop', 'offsetLeft', 'pageTop', 'pageLeft', 'scale'])
    Object.defineProperty(fake, k, { get: () => (over && k in over ? over[k] : real[k]) });
  for (const t of ['resize', 'scroll']) real.addEventListener(t, () => fake.dispatchEvent(new Event(t)));
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
  window.__keyboard = (h) => { over = h == null ? null : { height: h }; fake.dispatchEvent(new Event('resize')); };
})();
"""

FACINGS = ["down", "left", "right", "up"]  # the game's order (src/world/grid.ts), for ties


def approach(grid: Grid, start: tuple[int, int], name: str) -> tuple[tuple[int, int], str]:
    """Where the game's tap walk stops next to an object, and the facing (src/world/grid.ts approach)."""
    _, ox, oy = grid.objects[name]
    best = None
    for d in FACINGS:
        dx, dy = DIRS[d]
        spot = (ox - dx, oy - dy)
        if spot != start and not grid.free(spot, spot):
            continue
        try:
            n = len(grid.path(start, spot, FACINGS)) if spot != start else 0
        except RuntimeError:
            continue
        if best is None or n < best[0]:
            best = (n, spot, d)
    assert best is not None, name
    return best[1], best[2]


class Touch:
    """A finger on the page: taps on the map, the D-pad held for steps, the buttons."""

    def __init__(self, page: Page, grid: Grid, pos: tuple[int, int], facing: str):
        self.page, self.grid, self.pos, self.facing = page, grid, pos, facing
        self.cdp = page.context.new_cdp_session(page)

    def hold(self, x: float, y: float, ms: int) -> None:
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        self.page.wait_for_timeout(ms)
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})

    def centre(self, selector: str) -> tuple[float, float]:
        b = self.page.locator(selector).bounding_box()
        assert b, selector
        return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2

    def button(self, selector: str) -> None:
        x, y = self.centre(selector)
        self.hold(x, y, 60)
        self.page.wait_for_timeout(200)

    def dpad(self, steps: list[str]) -> None:
        for d in steps:
            x, y = self.centre(f".tc-{d}")
            if d != self.facing:
                self.hold(x, y, 30)  # a short press only turns
                self.page.wait_for_timeout(160)
                self.facing = d
            self.hold(x, y, 150)
            self.page.wait_for_timeout(330)
            dx, dy = DIRS[d]
            self.pos = (self.pos[0] + dx, self.pos[1] + dy)

    def screen_xy(self, tile: tuple[int, int]) -> tuple[float, float] | None:
        """Where a tile is on screen: the camera follows the player, clamped to the map."""
        box = self.page.locator("canvas").bounding_box()
        k = box["width"] / 240
        sx = min(max(self.pos[0] * TILE + 8 - 120, 0), self.grid.w * TILE - 240)
        sy = min(max(self.pos[1] * TILE + 16 - 80, 0), self.grid.h * TILE - 160)
        vx, vy = tile[0] * TILE + 8 - sx, tile[1] * TILE + 8 - sy
        if not (4 <= vx <= 236 and 4 <= vy <= 156):
            return None
        return box["x"] + vx * k, box["y"] + (BAND + vy) * k

    def tap_tile(self, tile: tuple[int, int], steps: int) -> None:
        xy = self.screen_xy(tile)
        assert xy, f"tile {tile} is not on screen"
        self.page.touchscreen.tap(*xy)
        self.page.wait_for_timeout(300 + 260 * steps)

    def tap_walk(self, goal: tuple[int, int]) -> None:
        """Tap open ground, nearer the goal each time, until the goal itself is on screen."""
        while self.pos != goal:
            if self.screen_xy(goal):
                target = goal
            else:
                at, target = self.pos, self.pos
                for d in self.grid.path(self.pos, goal, FACINGS):
                    at = (at[0] + DIRS[d][0], at[1] + DIRS[d][1])
                    if self.screen_xy(at):
                        target = at
                assert target != self.pos, f"no step towards {goal} on screen"
            # the game walks the same breadth-first path (same direction order), so it ends
            # facing the way of its last step
            route = self.grid.path(self.pos, target, FACINGS)
            self.tap_tile(target, len(route))
            self.pos, self.facing = target, route[-1]


def layout_info(page: Page) -> dict:
    return page.evaluate(
        """() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
      const tc = document.querySelector('.tc');
      return {
        mode: document.documentElement.dataset.layout,
        canvas: r(document.querySelector('canvas')),
        controls: !!tc && !tc.hidden,
        targets: [...document.querySelectorAll('.tc button')].map((b) => ({ name: b.className, ...r(b) })),
        scrollW: document.scrollingElement.scrollWidth, scrollH: document.scrollingElement.scrollHeight,
        vw: innerWidth, vh: innerHeight,
        touchAction: getComputedStyle(document.getElementById('game')).touchAction,
        padTouchAction: tc ? getComputedStyle(tc.querySelector('.tc-dpad')).touchAction : null,
        viewport: document.querySelector('meta[name=viewport]').content,
      };
    }"""
    )


def check_layout(page: Page, name: str, mode: str) -> dict:
    info = layout_info(page)
    c = info["canvas"]
    assert info["mode"] == mode, (name, info["mode"])
    assert info["controls"], f"{name}: the touch controls show"
    assert info["scrollW"] <= info["vw"] and info["scrollH"] <= info["vh"], f"{name}: the page does not scroll {info}"
    assert c["x"] >= 0 and c["y"] >= 0 and c["x"] + c["w"] <= info["vw"] + 0.5 and c["y"] + c["h"] <= info["vh"] + 0.5, f"{name}: canvas {c}"
    assert abs(c["w"] / c["h"] - 240 / 172) < 0.02, f"{name}: the canvas keeps its shape {c}"
    for t in info["targets"]:
        assert t["w"] >= 48 and t["h"] >= 48, f"{name}: {t['name']} is {t['w']}x{t['h']} CSS px"
        overlap = t["x"] < c["x"] + c["w"] and c["x"] < t["x"] + t["w"] and t["y"] < c["y"] + c["h"] and c["y"] < t["y"] + t["h"]
        assert not overlap, f"{name}: {t['name']} covers the view"
    assert info["touchAction"] == "none" and info["padTouchAction"] == "none", info
    assert "interactive-widget=resizes-content" in info["viewport"], info["viewport"]
    scale = c["w"] / 240
    print(f"  {name}: {mode}, canvas {c['w']:.0f}x{c['h']:.0f} (x{scale:.2f}), {len(info['targets'])} touch targets >= 48 px, no scroll")
    return info


def in_view(page: Page, selector: str, bottom: float) -> bool:
    b = page.locator(selector).bounding_box()
    return b is not None and b["y"] >= 0 and b["y"] + b["height"] <= bottom + 0.5


def touch_portrait(browser, origin: str, device: dict, village: Grid, room: Grid, shots: Path | None, watch) -> None:
    """A Pixel-class phone in portrait: tap to walk and use, the terminal with a soft keyboard,
    the D-pad, the use, back and menu buttons, and the controls setting."""
    ctx = browser.new_context(**device, locale="en-US")
    ctx.add_init_script(FAKE_KEYBOARD)
    watch(ctx)
    page = ctx.new_page()
    page.goto(origin + BASE)
    page.wait_for_timeout(2500)
    check_layout(page, "Pixel 7 portrait", "portrait")
    if shots:
        page.screenshot(path=str(shots / "touch-portrait-village.png"))
    _, sx, sy = village.objects["player-start"]
    f = Touch(page, village, (sx, sy), "down")

    # tap to walk, then tap Ravi's laptop: the player walks up to it and the terminal opens
    _, lx, ly = village.objects["ravi-laptop"]
    spot, facing = approach(village, f.pos, "ravi-laptop")
    if not f.screen_xy((lx, ly)):
        f.tap_walk(spot)
    spot, facing = approach(village, f.pos, "ravi-laptop")
    f.tap_tile((lx, ly), len(village.path(f.pos, spot, FACINGS)) if f.pos != spot else 0)
    page.locator(".nt-overlay").wait_for(state="visible", timeout=5000)
    f.pos, f.facing = spot, facing
    print("  tap on Ravi's laptop: walked up to it, the terminal opened")
    vh = page.evaluate("innerHeight")

    # the terminal on a phone: input line and quick strip on screen, typing works
    assert in_view(page, ".nt-inputline", vh) and in_view(page, ".nt-quick", vh)
    run(page, "cat ci-last-run.log", "Tabs are not allowed")

    # a keyboard that only shrinks the visual viewport (the overlay follows it)
    kb = round(vh * 0.55)
    page.evaluate(f"window.__keyboard({kb})")
    page.wait_for_timeout(300)
    assert in_view(page, ".nt-inputline", kb), page.locator(".nt-inputline").bounding_box()
    assert in_view(page, ".nt-quick", kb), page.locator(".nt-quick").bounding_box()
    if shots:
        # draw where the keyboard would be, for the picture only
        page.evaluate(
            f"""() => {{ const k = document.createElement('div'); k.id = 'fake-kb';
            k.textContent = 'soft keyboard ({vh - kb} px)';
            Object.assign(k.style, {{ position: 'fixed', left: 0, right: 0, top: '{kb}px', bottom: 0, zIndex: 99, background: '#b0b8b8', color: '#101820', font: '16px monospace', display: 'flex', alignItems: 'center', justifyContent: 'center' }});
            document.body.append(k); }}"""
        )
        page.screenshot(path=str(shots / "touch-terminal-keyboard.png"))
        page.evaluate("document.getElementById('fake-kb').remove()")
    # the quick strip scrolls sideways to its last key; a tap fills the input, focus stays put
    strip = page.locator(".nt-quick")
    assert strip.evaluate("el => el.scrollWidth > el.clientWidth"), "the strip is wider than a phone"
    page.locator(".nt-quick button", has_text="exit").scroll_into_view_if_needed()
    assert strip.evaluate("el => el.scrollLeft > 0") and in_view(page, ".nt-quick", kb)
    page.locator(".nt-quick button", has_text="git status").scroll_into_view_if_needed()
    f.button(".nt-quick button:has-text('git status')")
    assert page.locator(".nt-input").input_value() == "git status", page.locator(".nt-input").input_value()
    page.evaluate("window.__keyboard(null)")

    # a keyboard that shrinks the page itself (Chrome with interactive-widget=resizes-content)
    size = page.viewport_size
    page.set_viewport_size({"width": size["width"], "height": kb})
    page.wait_for_timeout(400)
    assert in_view(page, ".nt-inputline", kb) and in_view(page, ".nt-quick", kb)
    page.keyboard.press("Enter")
    page.wait_for_function("() => document.querySelector('.nt-screen .xterm-rows').innerText.includes('$ git status')", timeout=5000)
    page.set_viewport_size(size)
    page.wait_for_timeout(400)
    print(f"  soft keyboard ({vh - kb} px, both kinds): input line and quick strip stay above it")
    f.button(".nt-close")
    page.locator(".nt-overlay").wait_for(state="detached", timeout=5000)
    page.wait_for_timeout(500)

    # the D-pad walks to the data centre door; the room has its top wall in view under the HUD
    _, dx, dy = village.objects["server-room-door"]
    f.dpad(village.path(f.pos, (dx, dy)))
    page.wait_for_function("() => JSON.parse(localStorage.getItem('nines.save')).game.player.map === 'server-room'", timeout=5000)
    page.wait_for_timeout(500)
    print("  the D-pad walked to the door: in the server room")
    if shots:
        page.screenshot(path=str(shots / "touch-portrait-server-room.png"))
    f.grid, f.pos, f.facing = room, room.objects["entrance"][1:], "up"
    spot, facing = room.stand_by("rack-web-01", f.pos)
    f.dpad(room.path(f.pos, spot))
    if f.facing != facing:
        x, y = f.centre(f".tc-{facing}")
        f.hold(x, y, 30)
        page.wait_for_timeout(200)
    f.button(".tc-use")
    page.locator(".nt-overlay").wait_for(state="visible", timeout=5000)
    print("  the use button opened the rack's terminal")
    f.button(".nt-close")
    page.locator(".nt-overlay").wait_for(state="detached", timeout=5000)
    page.wait_for_timeout(500)

    # the menu button, the D-pad and the use button change the controls setting; back closes
    f.button(".tc-menu")
    for _ in range(2):
        f.button(".tc-down")
    f.button(".tc-use")
    assert page.evaluate("localStorage.getItem('nines.controls')") == "on"
    f.button(".tc-use")
    assert page.evaluate("localStorage.getItem('nines.controls')") == "off"
    assert not layout_info(page)["controls"], "the setting 'off' hides the controls"
    page.keyboard.press("Enter")  # the keyboard still works the menu: back to auto
    page.wait_for_timeout(300)
    assert page.evaluate("localStorage.getItem('nines.controls')") == "auto"
    assert layout_info(page)["controls"], "auto shows them again on a touch screen"
    f.button(".tc-back")
    page.wait_for_timeout(300)
    # the menu is closed: the use button reaches the world again and opens the rack
    f.button(".tc-use")
    page.locator(".nt-overlay").wait_for(state="visible", timeout=5000)
    f.button(".nt-close")
    page.locator(".nt-overlay").wait_for(state="detached", timeout=5000)
    print("  menu, D-pad, use and back: the controls setting cycles auto, on, off, auto")
    ctx.close()


def touch_landscape(browser, origin: str, device: dict, village: Grid, room: Grid, shots: Path | None, watch) -> None:
    ctx = browser.new_context(**device, locale="en-US")
    watch(ctx)
    page = ctx.new_page()
    page.goto(origin + BASE)
    page.wait_for_timeout(2500)
    info = check_layout(page, "Pixel 7 landscape", "landscape")
    assert info["canvas"]["w"] == 480, "a whole-number scale (x2) between the controls"
    _, sx, sy = village.objects["player-start"]
    f = Touch(page, village, (sx, sy), "down")
    # tap to walk all the way to the data centre door
    _, dx, dy = village.objects["server-room-door"]
    f.tap_walk((dx, dy))
    page.wait_for_function("() => JSON.parse(localStorage.getItem('nines.save')).game.player.map === 'server-room'", timeout=5000)
    page.wait_for_timeout(600)
    print("  tap to walk: in the server room")
    if shots:
        page.screenshot(path=str(shots / "touch-landscape.png"))
    ctx.close()


def touch_layout_only(browser, origin: str, name: str, device: dict, mode: str, shot: str, shots: Path | None, watch) -> None:
    ctx = browser.new_context(**device, locale="en-US")
    watch(ctx)
    page = ctx.new_page()
    page.goto(origin + BASE)
    page.wait_for_timeout(2500)
    check_layout(page, name, mode)
    # a D-pad press in the world does not scroll or zoom the page
    Touch(page, Grid("junior-village"), (0, 0), "down").button(".tc-up")
    assert page.evaluate("[scrollX, scrollY, visualViewport.scale]") == [0, 0, 1]
    if shots:
        page.screenshot(path=str(shots / shot))
    ctx.close()


# ---------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", type=Path, default=None, help="write screenshots here")
    ap.add_argument("--only", choices=["desktop", "touch"], default=None, help="run one part")
    args = ap.parse_args()
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    if not (DIST / "index.html").exists():
        print("dist/ is missing: run npm run build first", file=sys.stderr)
        return 2

    httpd, origin = serve()
    outside: list[str] = []
    failed: list[str] = []
    errors: list[str] = []
    village = Grid("junior-village")
    room = Grid("server-room")
    t0 = time.time()

    def watch(ctx) -> None:
        """Every request of the context (pages and the service worker) stays on the origin."""

        def on_request(req) -> None:
            u = req.url
            if not (u.startswith(origin + "/") or u.startswith("data:") or u.startswith("blob:")):
                outside.append(u)

        ctx.on("request", on_request)
        def on_failed(req) -> None:
            # Offline, the service worker first asks the network for the page itself (network
            # first for navigations) and answers from its cache when that fails: that one failure
            # is the design, not a broken file. Any other failure counts.
            if req.service_worker is not None and req.url == origin + BASE and "INTERNET_DISCONNECTED" in (req.failure or ""):
                return
            failed.append(f"{req.url} ({req.failure})")

        ctx.on("requestfailed", on_failed)
        ctx.on("page", lambda pg: pg.on("pageerror", lambda e: errors.append(str(e))))

    with sync_playwright() as pw:
        exe = os.environ.get("CHROME")
        browser = pw.chromium.launch(**({"executable_path": exe} if exe else {}), args=["--disable-gpu"])

        if args.only in (None, "desktop"):
            # Desktop: load once, let the service worker keep the files, go offline, reload, and
            # play everything with the network off.
            print("desktop, offline after the first load")
            ctx = browser.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
            watch(ctx)
            page = ctx.new_page()
            page.goto(origin + BASE)
            page.wait_for_function("() => navigator.serviceWorker && navigator.serviceWorker.controller !== null", timeout=15000)
            cached = page.evaluate("async () => (await (await caches.open((await caches.keys()).find(k => k.startsWith('nines:')))).keys()).length")
            files = (DIST / "sw.js").read_text().split("const FILES = ", 1)[1].split(";", 1)[0]
            assert cached == len(json.loads(files)), f"the service worker keeps every built file: {cached} cached"
            ctx.set_offline(True)
            served = len(Handler.served)
            page.reload()
            page.wait_for_timeout(2500)  # boot: textures, maps, the world
            assert page.evaluate("navigator.onLine") is False
            info = layout_info(page)
            assert info["mode"] == "plain" and not info["controls"], info
            assert (info["canvas"]["w"], info["canvas"]["h"]) == (960, 688), f"a sharp x4 canvas on 1280x800: {info['canvas']}"
            print(f"  offline: reloaded from the service worker's cache ({cached} files), canvas x4, no touch controls")
            try:
                play(page, village, room, args.shots)
                # with the network off nothing reached the server: every file came from the cache
                # The browser itself checks for a new sw.js on navigation (the service worker
                # update check, same origin, outside the page). Playwright's offline switch does
                # not reach that check; on a real offline device it simply fails. Nothing else
                # may reach the server.
                late = [u for u in Handler.served[served:] if u != BASE + "sw.js"]
                assert not late, f"requests reached the server while offline: {late}"
                print("  offline: no request reached the server during the whole play")
            except Exception:
                if args.shots:
                    page.screenshot(path=str(args.shots / "failure.png"))
                    print("terminal text at failure:\n" + (term_text(page) if page.locator(".nt-screen").count() else "(no terminal)"))
                raise
            ctx.close()

        if args.only in (None, "touch"):
            phone = pw.devices["Pixel 7"]
            print("touch: Pixel 7 portrait")
            touch_portrait(browser, origin, phone, village, room, args.shots, watch)
            print("touch: Pixel 7 landscape")
            touch_landscape(browser, origin, pw.devices["Pixel 7 landscape"], village, room, args.shots, watch)
            print("touch: a small phone and a tablet")
            small = {"viewport": {"width": 360, "height": 640}, "device_scale_factor": 2, "is_mobile": True, "has_touch": True, "user_agent": phone["user_agent"]}
            touch_layout_only(browser, origin, "360x640 phone", small, "portrait", "touch-small-phone.png", args.shots, watch)
            touch_layout_only(browser, origin, "tablet portrait", pw.devices["Galaxy Tab S4"], "portrait", "touch-tablet.png", args.shots, watch)
            touch_layout_only(browser, origin, "tablet landscape", pw.devices["Galaxy Tab S4 landscape"], "landscape", "touch-tablet-landscape.png", args.shots, watch)
        browser.close()
    httpd.shutdown()

    print(f"requests outside {origin}: {len(outside)}")
    for u in outside:
        print("  " + u)
    print(f"failed requests: {len(failed)}")
    for u in failed:
        print("  " + u)
    for e in errors:
        print("page error: " + e)
    print(f"took {time.time() - t0:.0f}s")
    return 1 if outside or failed or errors else 0


if __name__ == "__main__":
    sys.exit(main())
