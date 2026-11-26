"""Browser smoke test: play the three MVP quests on the built game, typing real commands.

It serves dist/ under a sub-path (like GitHub Pages) from a server inside this process, walks
the player to each machine with the keyboard (paths come from the Tiled maps), plays the quest
in the terminal overlay, and fails on any request that leaves the page's origin or any page
error. Run it after `npm run build`, one browser at a time, under the memory cap (AGENTS.md):

    timeout -s KILL 900 systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0 \\
      uv run -q --with playwright==1.65.2 python -u tests/e2e/smoke.py [--shots DIR]

CHROME (an executable path) picks the browser; otherwise Playwright's own headless shell runs.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import sys
import threading
import time
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


# ---------------------------------------------------------------- serving dist/ at /nines/

class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
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
    def __init__(self, map_id: str, blocked_slots: set[str]):
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
        self.npcs = {(x, y) for n, (t, x, y) in self.objects.items() if n in blocked_slots}

    def free(self, p: tuple[int, int], goal: tuple[int, int]) -> bool:
        x, y = p
        if not (0 <= x < self.w and 0 <= y < self.h) or p in self.solid or p in self.npcs:
            return False
        return p not in self.doors or p == goal

    def path(self, start: tuple[int, int], goal: tuple[int, int]) -> list[str]:
        prev: dict[tuple[int, int], tuple[tuple[int, int], str] | None] = {start: None}
        q = deque([start])
        while q:
            cur = q.popleft()
            if cur == goal:
                break
            for d, (dx, dy) in DIRS.items():
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


def finish(page: Page, title_part: str) -> None:
    """The win: the overlay celebrates, Continue closes it, the giver's done lines follow."""
    dialog = page.locator(".nt-dialog")
    dialog.wait_for(state="visible", timeout=5000)
    text = dialog.inner_text()
    assert "Quest complete" in text, text
    assert "Reward" in text, text
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


def service_down(page: Page, shots: Path | None) -> None:
    run(page, "systemctl status nginx", "failed")
    run(page, "journalctl -u nginx", 'unknown directive "listn"')
    run(page, "edit /etc/nginx/conf.d/shop.conf")
    page.locator(".nt-editor").wait_for(state="visible")
    edit_file(page, SHOP_CONF_FIXED)
    run(page, "systemctl restart nginx")
    finish(page, "Service down")


def play(page: Page, village: Grid, room: Grid, shots: Path | None) -> None:
    _, sx, sy = village.objects["player-start"]
    p = Player(page, "junior-village", (sx, sy), "down")

    # 1. broken pipeline: Ravi's laptop in the village
    print("quest: broken-pipeline")
    open_terminal(page, p, village, "ravi-laptop")
    broken_pipeline(page, shots)

    # 2. into the server room
    _, dx, dy = village.objects["server-room-door"]
    p.go_to(village, (dx, dy))
    page.wait_for_timeout(900)  # the fade into the room
    _, ex, ey = room.objects["entrance"]
    p.map, p.pos, p.facing = "server-room", (ex, ey), "up"

    print("quest: disk-full")
    open_terminal(page, p, room, "rack-web-01")
    disk_full(page, shots)

    print("quest: service-down")
    open_terminal(page, p, room, "rack-app-01")
    service_down(page, shots)

    # the save says all three are done and paid
    save = json.loads(page.evaluate("localStorage.getItem('nines.save')"))
    quests = save["game"]["quests"]
    for q in ("disk-full", "broken-pipeline", "service-down"):
        assert quests.get(q) == "done", quests
    print(f"  save: quests {quests}, money {save['game']['money']}, xp {save['game']['xp']}")
    if shots:
        page.screenshot(path=str(shots / "world-after.png"))



# ---------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", type=Path, default=None, help="write screenshots here")
    args = ap.parse_args()
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    if not (DIST / "index.html").exists():
        print("dist/ is missing: run npm run build first", file=sys.stderr)
        return 2

    httpd, origin = serve()
    outside: list[str] = []
    errors: list[str] = []
    slots = {"npc-1", "npc-2", "npc-3", "npc-4", "gate-medior"}
    village = Grid("junior-village", slots)
    room = Grid("server-room", set())
    t0 = time.time()
    with sync_playwright() as pw:
        exe = os.environ.get("CHROME")
        browser = pw.chromium.launch(**({"executable_path": exe} if exe else {}), args=["--disable-gpu"])
        page = browser.new_page(viewport={"width": 1280, "height": 800}, locale="en-US")

        def on_request(req) -> None:
            u = req.url
            if not (u.startswith(origin + "/") or u.startswith("data:") or u.startswith("blob:")):
                outside.append(u)

        page.on("request", on_request)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(origin + BASE)
        page.wait_for_timeout(2500)  # boot: textures, maps, the world
        try:
            play(page, village, room, args.shots)
        except Exception:
            if args.shots:
                page.screenshot(path=str(args.shots / "failure.png"))
                print("terminal text at failure:\n" + (term_text(page) if page.locator(".nt-screen").count() else "(no terminal)"))
            raise
        browser.close()
    httpd.shutdown()

    print(f"requests outside {origin}: {len(outside)}")
    for u in outside:
        print("  " + u)
    for e in errors:
        print("page error: " + e)
    print(f"took {time.time() - t0:.0f}s")
    return 1 if outside or errors else 0




if __name__ == "__main__":
    sys.exit(main())
