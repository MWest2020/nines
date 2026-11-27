"""Browser smoke test for Medior City, on the built site (dist/, served under /nines/ like GitHub
Pages), by real key presses. CI runs it after the battle smoke tests (same requirements.txt). By
hand, after `npm run build`, under the memory cap from AGENTS.md:

  timeout -s KILL 900 systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0 \\
    uv run -q --with-requirements tests/e2e/requirements.txt python -u tests/e2e/medior_smoke.py [screenshot-dir]

It plays, in one page:

  1. the road east is shut before the gate interview: walking into the barrier keeps the player in
     Junior Village;
  2. the rate-limiter interview with Ingrid to a win (perfect answers);
  3. the walk through the opened gate into Medior City (the save says so);
  4. Joyce, the career coach: her lines, then the career screen (found from the canvas pixels),
     paging to Systems Engineer with the arrow keys, Choose, the confirmation, Yes (the save has
     the path), and her line about the mentor;
  5. into The Stack and Wim's first quest, "One disk left", played in the terminal by typing.

It fails on any request that leaves the origin and on any page error.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from playwright.sync_api import Page, sync_playwright  # noqa: E402

from battle_smoke import INTERVIEW, answer_for, card_ids, check, cont, pick_by_click, press_until_overlay, send_by_keys  # noqa: E402
from smoke import BASE, DIST, Grid, Player, edit_file, finish, objectives, png_pixels, run, serve  # noqa: E402

SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "test-results"
CHROME = os.environ.get("CHROME")
BAND = 12  # the HUD band above the 240 x 160 view
INK = (0x10, 0x18, 0x20)

TICKET = """Remote hands request
Site: Medior City colocation, rack B4
Server: fs-02
Action: replace one failed disk with a new spare of the same size
Bay: 1
Serial of the disk to pull: WD-WCC4E9X8Y7Z6
Backup checked before the swap (yes/no): yes
"""


def save_json() -> str:
    game = {
        "locale": "en",
        "money": 0,
        "xp": {},
        "quests": {"disk-full": "done", "service-down": "done", "broken-pipeline": "done", "night-pager": "done", "friday-scope": "done"},
        "items": [],
        "flags": {},
        "tech_debt": 0,
        "seed": 4242,
        "ticks": 3,
        "claimed": [],
        "player": {"map": "junior-village", "x": 37, "y": 15, "facing": "up"},
    }
    return json.dumps({"format": "nines-save", "version": 2, "game": game})


def game_save(page: Page) -> dict:
    return json.loads(page.evaluate("() => localStorage.getItem('nines.save')"))["game"]


def shot(page: Page, name: str) -> str:
    SHOTS.mkdir(parents=True, exist_ok=True)
    path = SHOTS / name
    page.screenshot(path=str(path))
    print(f"  shot {path}")
    return str(path)


def inked(page: Page, points: list[tuple[int, int]]) -> bool:
    """Are these view pixels all plain ink? Panels and the dialogue box are; the world is not."""
    box = page.locator("canvas").bounding_box()
    w, h, bpp, rows = png_pixels(page.screenshot(clip=box))
    k = w / 240

    def ink(vx: int, vy: int) -> bool:
        row = rows[min(h - 1, int((BAND + vy + 0.5) * k))]
        x = min(w - 1, int((vx + 0.5) * k)) * bpp
        return all(abs(row[x + i] - INK[i]) <= 6 for i in range(3))

    return all(ink(x, y) for x, y in points)


def career_open(page: Page) -> bool:
    """The career screen is a canvas panel: plain ink in its margins, where the world never is."""
    return inked(page, [(12, 60), (228, 60), (228, 40), (12, 100), (228, 100)])


def dialogue_open(page: Page) -> bool:
    """The dialogue box: an ink panel along the bottom of the view."""
    return inked(page, [(8, 152), (232, 152), (232, 118)])


def read_dialogue(page: Page) -> None:
    """Press Enter until the dialogue box has gone (each Enter shows a page in full or turns it)."""
    for _ in range(20):
        page.wait_for_timeout(700)
        if not dialogue_open(page):
            page.wait_for_timeout(300)
            return
        page.keyboard.press("Enter")
    raise AssertionError("the dialogue did not end")


def main() -> None:
    if not (DIST / "index.html").exists():
        sys.exit("dist/ is missing: run npm run build first")
    httpd, origin = serve()
    outside: list[str] = []
    shots: list[str] = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=CHROME) if CHROME else pw.chromium.launch()
            try:
                ctx = browser.new_context(viewport={"width": 1280, "height": 800})
                ctx.add_init_script(
                    f"if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('nines.save', {json.dumps(save_json())}); sessionStorage.setItem('seeded', '1'); }}"
                )
                page = ctx.new_page()
                page.on("request", lambda r: None if r.url.startswith(origin) or r.url.startswith(("data:", "blob:")) else outside.append(r.url))
                errors: list[str] = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.goto(origin + BASE + "index.html")
                page.wait_for_selector("canvas")
                page.wait_for_timeout(1500)

                village = Grid("junior-village")
                p = Player(page, "junior-village", (37, 15), "up")

                print("the gate is shut before the interview")
                p.tap("right", 30)
                page.wait_for_timeout(160)
                p.facing = "right"
                for _ in range(3):  # one step to (38,15), then the barrier
                    p.tap("right", 150)
                    page.wait_for_timeout(330)
                page.wait_for_timeout(600)
                check(game_save(page)["player"]["map"] == "junior-village", "walking into the barrier keeps the player in Junior Village")
                p.pos = (38, 15)
                p.go_to(village, (37, 15))
                p.face("up")

                print("the gate interview: Ingrid, to a win")
                press_until_overlay(page)
                n = 0
                while page.locator(".nb-answer [data-id]").count() > 0:
                    n += 1
                    for a in answer_for(card_ids(page), INTERVIEW):
                        pick_by_click(page, a)
                    send_by_keys(page)
                    cont(page)
                page.wait_for_selector(".nb-end:not([hidden])")
                end = page.locator(".nb-end").inner_text()
                check("You held your ground." in end and n == 8, "won in eight rounds")
                check("opens later" not in end, "no more \"Medior City opens later\"")
                page.keyboard.press("Enter")  # Close
                page.wait_for_timeout(500)
                read_dialogue(page)  # Ingrid's done lines

                print("through the gate into Medior City")
                p.face("right")
                p.walk(village, ["right", "right"])
                page.wait_for_timeout(1500)
                g = game_save(page)
                check(g["player"]["map"] == "medior-city" and (g["player"]["x"], g["player"]["y"]) == (2, 15), f"arrived in Medior City at the village road {g['player']}")

                city = Grid("medior-city")
                p.map, p.pos, p.facing = "medior-city", (2, 15), "right"
                p.go_to(city, (13, 13))
                page.wait_for_timeout(400)
                shots.append(shot(page, "medior-city.png"))

                print("the career coach")
                spot, facing = city.stand_by("npc-1", p.pos)
                p.go_to(city, spot)
                p.face(facing)
                page.keyboard.press("Enter")
                page.wait_for_timeout(700)
                for _ in range(20):
                    if career_open(page):
                        break
                    page.keyboard.press("Enter")
                    page.wait_for_timeout(800)
                check(career_open(page), "after Joyce's lines the career screen opens")
                for _ in range(4):  # swe, sre, devops, platform -> systems
                    page.keyboard.press("ArrowRight")
                    page.wait_for_timeout(200)
                shots.append(shot(page, "medior-career-coach.png"))
                page.keyboard.press("Enter")  # Choose this path
                page.wait_for_timeout(400)
                check(career_open(page) and game_save(page).get("path") is None, "a confirmation first: nothing chosen yet")
                shots.append(shot(page, "medior-career-confirm.png"))
                page.keyboard.press("Enter")  # Yes
                page.wait_for_timeout(600)
                check(game_save(page).get("path") == "systems", "the save has the path: systems")
                # her line about the mentor
                check(dialogue_open(page), "Joyce names the mentor")
                read_dialogue(page)
                check(not career_open(page), "the screen is closed and the world is free")

                print("Wim's first quest in The Stack")
                p.go_to(city, (17, 10))  # The Stack's door
                page.wait_for_timeout(1500)
                check(game_save(page)["player"]["map"] == "the-stack", "inside The Stack")
                stack = Grid("the-stack")
                p.map, p.pos, p.facing = "the-stack", (9, 10), "up"
                spot, facing = stack.stand_by("stack-rack-storage", p.pos)
                p.go_to(stack, spot)
                p.face(facing)
                page.keyboard.press("Enter")
                page.locator(".nt-overlay").wait_for(state="visible", timeout=5000)
                page.wait_for_timeout(300)
                run(page, "cat ~/notes.txt", "mirrors two disks")
                run(page, "cat /proc/mdstat", "[U_]")
                run(page, "cat ~/disks/smart-sdb.txt", "FAILED!")
                shots.append(shot(page, "medior-quest-raid.png"))
                run(page, "tail -n 3 /var/log/backup.log", "restore test")
                check(objectives(page) == (2, 3), f"backup checked, healthy disk off the ticket {objectives(page)}")
                run(page, "edit ~/tickets/DC-REQUEST.txt")
                page.locator(".nt-editor").wait_for(state="visible")
                edit_file(page, TICKET)
                finish(page, "One disk left", "€450")
                g = game_save(page)
                check(g["quests"].get("degraded-raid") == "done" and g["xp"].get("linux") == 50, "the save has the quest and its XP")
                check(not errors, f"no page errors {errors}")
                ctx.close()
            finally:
                browser.close()
    finally:
        httpd.shutdown()
    check(outside == [], f"no request left the origin {outside}")
    print("medior smoke passed; screenshots:")
    for s in shots:
        print("  " + s)


if __name__ == "__main__":
    main()
