"""Browser smoke test for the battle overlay, on the built site (dist/), by real key presses and
clicks. Not part of `npm test` (CI has no browser); run it by hand after `npm run build`, under
the memory cap from AGENTS.md:

  CHROME=~/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell \
  timeout -s KILL 900 systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0 \
    uv run -q --with playwright==1.65.2 python -u tests/e2e/battle_smoke.py [screenshot-dir]

It serves dist/ itself on 127.0.0.1 for the length of the run (no dev server) and plays:

  1. the rate-limiter interview (talk to Ingrid at the Medior gate) to a win: the reward, the
     giver's done lines and "Medior City opens later";
  2. the Friday scope talk with Daan to a loss (keyboard, clicks and one drag in the order
     round), then Try again, a hint on the second try, and a win;
  3. the 3 AM pager going off on entering the map (a seed chosen so the roll fires), a few
     rounds in, for a screenshot;
  4. the screen in Dutch, left half-way with Escape (nothing recorded).

It fails when any request leaves the origin.
"""

import functools
import http.server
import json
import os
import pathlib
import sys
import threading
import time

from playwright.sync_api import Page, sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
SHOTS = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "test-results")
CHROME = os.environ.get("CHROME")

BASE_DONE = {"disk-full": "done", "service-down": "done", "broken-pipeline": "done"}


# ---- the game's seeded roll (src/battle/seed.ts), to pick a save whose pager fires


def hash32(s: str) -> int:
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def imul(a: int, b: int) -> int:
    return (a * b) & 0xFFFFFFFF


def first_random(seed: int) -> float:
    a = (seed + 0x6D2B79F5) & 0xFFFFFFFF
    t = a
    t = imul(t ^ (t >> 15), t | 1)
    t ^= (t + imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF
    return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296


def roll(key: str) -> int:
    return int(first_random(hash32(key)) * 100)


def save(quests: dict, x: int, y: int, facing: str, seed: int = 4242, ticks: int = 3, locale: str = "en") -> str:
    game = {
        "locale": locale,
        "money": 0,
        "xp": {},
        "quests": quests,
        "items": [],
        "flags": {},
        "tech_debt": 0,
        "seed": seed,
        "ticks": ticks,
        "claimed": [],
        "player": {"map": "junior-village", "x": x, "y": y, "facing": facing},
    }
    return json.dumps({"format": "nines-save", "version": 2, "game": game})


# ---- helpers


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve() -> tuple[http.server.ThreadingHTTPServer, str]:
    handler = functools.partial(Quiet, directory=str(DIST))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def check(cond: bool, what: str) -> None:
    if not cond:
        raise AssertionError(what)
    print(f"  ok  {what}")


def open_game(browser, origin: str, save_json: str, outside: list, viewport=(1280, 800)) -> Page:
    ctx = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]})
    ctx.add_init_script(f"if (!sessionStorage.getItem('seeded')) {{ localStorage.setItem('nines.save', {json.dumps(save_json)}); sessionStorage.setItem('seeded', '1'); }}")
    page = ctx.new_page()

    def on_request(req):
        url = req.url
        if not (url.startswith(origin) or url.startswith("data:") or url.startswith("blob:")):
            outside.append(url)

    page.on("request", on_request)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.errors = errors  # type: ignore[attr-defined]
    page.goto(origin + "/index.html")
    page.wait_for_selector("canvas")
    page.wait_for_timeout(1200)  # boot, map fade-in
    return page


def press_until_overlay(page: Page, tries: int = 25) -> None:
    """Talk (Enter) and read through the dialogue pages until the battle overlay opens."""
    for _ in range(tries):
        if page.locator(".nb-battle").count() > 0:
            return
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
    raise AssertionError("the battle overlay did not open")


def card_ids(page: Page) -> list[str]:
    return page.locator(".nb-answer [data-id]").evaluate_all("els => els.map(e => e.dataset.id)")


def focused_id(page: Page) -> str | None:
    return page.evaluate("() => document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id || null : null")


def pick_by_keys(page: Page, target: str) -> None:
    """Arrow to a card and press Space: the keyboard path."""
    page.locator(".nb-answer [data-id][tabindex='0']").first.focus()
    for _ in range(12):
        if focused_id(page) == target:
            break
        page.keyboard.press("ArrowDown")
    check(focused_id(page) == target, f"arrow keys reach card {target}")
    page.keyboard.press("Space")


def pick_by_click(page: Page, target: str) -> None:
    page.locator(f".nb-answer [data-id='{target}']").click()


def send_by_keys(page: Page) -> None:
    page.keyboard.press("Tab")
    check(page.evaluate("() => document.activeElement.dataset.action") == "send", "Tab from the cards reaches Send")
    page.keyboard.press("Enter")
    page.wait_for_selector("[data-action='continue']")


def cont(page: Page) -> None:
    page.wait_for_function("() => document.activeElement && document.activeElement.dataset.action === 'continue'")
    page.keyboard.press("Enter")
    page.wait_for_timeout(120)


def order_by_keys(page: Page, target: list[str], drag_first: bool = False, click_arrow: bool = False) -> None:
    """Reorder: optionally one drag and one arrow-button click, then Space / arrows / Space."""
    if drag_first:
        cur = card_ids(page)
        last = cur[-1]
        handle = page.locator(f"li[data-id='{last}'] .nb-handle")
        handle.scroll_into_view_if_needed()
        dest = page.locator(f"li[data-id='{cur[-3]}']").bounding_box()
        hb = handle.bounding_box()
        page.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2)
        page.mouse.down()
        page.mouse.move(hb["x"] + hb["width"] / 2, dest["y"] + 4, steps=8)
        page.mouse.up()
        check(card_ids(page)[-3] == last, "dragging a step by its handle moves it up two places")
    if click_arrow:
        cur = card_ids(page)
        page.locator(f"li[data-id='{cur[1]}'] [data-arrow='up']").click()
        check(card_ids(page)[0] == cur[1], "the up button moves a step up")
    for i, want in enumerate(target):
        cur = card_ids(page)
        j = cur.index(want)
        if j == i:
            continue
        page.locator(f"li[data-id='{want}']").focus()
        page.keyboard.press("Space")
        for _ in range(j - i):
            page.keyboard.press("ArrowUp")
        page.keyboard.press("Space")
    check(card_ids(page) == target, f"order set by keyboard: {' > '.join(target)}")


def shot(page: Page, name: str) -> str:
    SHOTS.mkdir(parents=True, exist_ok=True)
    path = SHOTS / name
    page.screenshot(path=str(path))
    print(f"  shot {path}")
    return str(path)


def game_save(page: Page) -> dict:
    return json.loads(page.evaluate("() => localStorage.getItem('nines.save')"))["game"]


# ---- the plays

INTERVIEW = {  # a card that only appears in that round -> the perfect answer
    "language": ["key", "scale"],
    "bucket": ["bucket"],
    "right": ["right"],
    "multiply": ["multiply"],
    "sql": ["redis"],
    "thousands": ["thousands"],
    "too-many": ["too-many"],
    "open": ["open"],
}

FRIDAY_PERFECT = {"who": ["why", "scope"], "slice": ["slice"], "weeks": ["weeks"], "integration": ["integration"], "ship": ["hold"]}
FRIDAY_ORDER = ["ci", "deploy", "staff", "canary", "everyone", "cleanup"]
FRIDAY_WORST = {"who": ["who", "weekend"], "slice": ["yes"], "weeks": ["hours"], "integration": ["down"], "ship": ["ship"]}


def answer_for(ids: list[str], table: dict) -> list[str]:
    for sig, ans in table.items():
        if ans and sig in ids:
            return ans
    raise AssertionError(f"no answer for cards {ids}")


def play_interview(browser, origin: str, outside: list) -> list[str]:
    print("interview: Ingrid at the Medior gate, to a win")
    quests = {**BASE_DONE, "night-pager": "done", "friday-scope": "done"}
    page = open_game(browser, origin, save(quests, 37, 15, "up"), outside)
    press_until_overlay(page)
    shots = []
    check("Whiteboard interview · Ingrid" in page.locator(".nb-title").inner_text(), "header: Whiteboard interview · Ingrid")
    check(page.locator(".nb-announce").inner_text().startswith("Whiteboard interview · Topic"), "opening line: Whiteboard interview · ...")
    check(page.locator(".nb-board").is_visible(), "the whiteboard is up")
    check(page.locator(".nb-them canvas").count() >= 1, "the interviewer has a head-only portrait")
    n = 0
    while page.locator(".nb-answer [data-id]").count() > 0:
        n += 1
        ids = card_ids(page)
        ans = answer_for(ids, INTERVIEW)
        if len(ans) > 1:
            for a in ans:
                pick_by_click(page, a)
            check(page.locator(".nb-count").inner_text().startswith("2 of 2"), "pick-many counts its picks")
        elif n % 2:
            pick_by_keys(page, ans[0])
        else:
            pick_by_click(page, ans[0])
        if "multiply" in ids:
            check("proposal" in page.locator(".nb-board").inner_text().lower(), "the flaw round puts the proposal on the whiteboard")
            shots.append(shot(page, "battle-interview-whiteboard.png"))
        send_by_keys(page)
        check("Spot on" in page.locator(".nb-note").last.inner_text(), f"round {n}: marked Spot on")
        cont(page)
    check(n == 8, "eight rounds played")
    page.wait_for_selector(".nb-end:not([hidden])")
    end = page.locator(".nb-end").inner_text()
    check("You held your ground." in end, "won")
    check("+€300" in end, "the reward is on the end screen")
    check("Medior City itself opens later" in end, "the gate says Medior City opens later")
    check(page.locator(".nb-debrief > li").count() == 8, "the debrief lists every round")
    shots.append(shot(page, "battle-end-won.png"))
    check(page.evaluate("() => document.activeElement.dataset.action") == "close", "Close has the keyboard after a win")
    page.keyboard.press("Enter")
    page.wait_for_timeout(400)
    check(page.locator(".nb-battle").count() == 0, "the overlay closes")
    g = game_save(page)
    check(g["quests"].get("rate-limiter-interview") == "done" and g["money"] == 300, "the save has the win and the money")
    check(g["xp"].get("design") == 40, "XP went to System Design")
    check(not page.errors, f"no page errors {page.errors}")  # type: ignore[attr-defined]
    page.context.close()
    return shots


def play_friday(browser, origin: str, outside: list) -> list[str]:
    print("friday: Daan's scope creep, to a loss, then a retry and a win")
    quests = {**BASE_DONE, "night-pager": "done"}
    page = open_game(browser, origin, save(quests, 20, 14, "up"), outside)
    press_until_overlay(page)
    check(page.locator(".nb-title").inner_text().startswith("Meeting · Daan"), "header: Meeting · Daan")
    check(page.locator(".nb-announce").inner_text().startswith("Incoming: Daan"), "opening line: Incoming: ...")
    check(not page.locator(".nb-board").is_visible(), "no whiteboard in a meeting")
    rounds = 0
    while page.locator(".nb-answer [data-id]").count() > 0:
        rounds += 1
        ids = card_ids(page)
        if "cleanup" in ids:
            order_by_keys(page, list(reversed(FRIDAY_ORDER)), drag_first=True, click_arrow=True)
            page.locator("[data-action='send']").click()
            page.wait_for_selector("[data-action='continue']")
        else:
            for a in answer_for(ids, FRIDAY_WORST):
                pick_by_click(page, a)
            send_by_keys(page)
        check("Not quite" in page.locator(".nb-note").last.inner_text(), f"round {rounds}: marked Not quite")
        cont(page)
    page.wait_for_selector(".nb-end:not([hidden])")
    check(rounds == 5, "confidence ran out after five weak answers")
    end = page.locator(".nb-end").inner_text()
    check("Not this time" in end, "lost")
    check(page.evaluate("() => document.activeElement.dataset.action") == "retry", "Try again has the keyboard after a loss")
    g = game_save(page)
    check(g["quests"].get("friday-scope") == "active" and g["money"] == 0, "a loss keeps the quest active and costs nothing")
    shots = [shot(page, "battle-end-lost.png")]
    page.keyboard.press("Enter")  # Try again
    page.wait_for_selector(".nb-answer [data-id]")
    check(page.locator(".nb-value").first.inner_text() == "100", "confidence refilled")
    check("Hint" in page.locator(".nb-side").inner_text(), "a hint shows on the second try")
    rounds = 0
    while page.locator(".nb-answer [data-id]").count() > 0:
        rounds += 1
        ids = card_ids(page)
        if "cleanup" in ids:
            order_by_keys(page, FRIDAY_ORDER)
            page.keyboard.press("Control+Enter")
            page.wait_for_selector("[data-action='continue']")
        else:
            ans = answer_for(ids, FRIDAY_PERFECT)
            if len(ans) == 1:
                pick_by_keys(page, ans[0])
            else:
                for a in ans:
                    pick_by_click(page, a)
            send_by_keys(page)
        cont(page)
    page.wait_for_selector(".nb-end:not([hidden])")
    check("You held your ground." in page.locator(".nb-end").inner_text(), "the retry wins")
    check(game_save(page)["quests"].get("friday-scope") == "done", "the save has the win")
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(200)
    shots.append(shot(page, "battle-end-phone.png"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check(page.locator(".nb-battle").count() == 0, "Escape closes the overlay")
    check(not page.errors, f"no page errors {page.errors}")  # type: ignore[attr-defined]
    page.context.close()
    return shots


def play_pager(browser, origin: str, outside: list) -> list[str]:
    print("pager: goes off on entering the map")
    ticks = 3
    seed = next(s for s in range(1, 10000) if roll(f"night-pager/{s}/pager/{ticks + 1}") < 20)
    page = open_game(browser, origin, save(dict(BASE_DONE), 19, 15, "down", seed=seed, ticks=ticks), outside)
    page.wait_for_selector(".nb-battle", timeout=5000)
    check(page.locator(".nb-title").inner_text().startswith("Incident · PAGER · checkout-api"), "header: Incident · PAGER · checkout-api")
    check(page.locator(".nb-announce").inner_text().startswith("PAGER 03:07"), "opening line: PAGER 03:07 · ...")
    check("Impact" in page.locator(".nb-side").inner_text(), "the attacker's meter is Impact")
    # two answers in, one of them weak, so both meters have moved
    for target in ("ack", "social"):
        ids = card_ids(page)
        pick = target if target in ids else ids[0]
        pick_by_click(page, pick)
        send_by_keys(page)
        cont(page)
    shots = [shot(page, "battle-incident.png")]
    check(game_save(page)["quests"].get("night-pager") == "active", "the page started its quest")
    check(not page.errors, f"no page errors {page.errors}")  # type: ignore[attr-defined]
    page.context.close()
    return shots


def check_dutch(browser, origin: str, outside: list) -> None:
    print("dutch: the same screen in Dutch")
    quests = {**BASE_DONE, "night-pager": "done"}
    page = open_game(browser, origin, save(quests, 20, 14, "up", locale="nl"), outside)
    press_until_overlay(page)
    check(page.locator(".nb-title").inner_text().startswith("Overleg · Daan"), "header: Overleg · Daan")
    side = page.locator(".nb-side").inner_text()
    check("Zelfvertrouwen" in side and "Druk" in side, "meters: Zelfvertrouwen and Druk")
    check(page.locator("[data-action='send']").inner_text() == "Versturen", "Send is Versturen")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check(page.locator(".nb-battle").count() == 0, "Escape leaves half-way")
    check(game_save(page)["quests"].get("friday-scope") == "active", "leaving records nothing: the quest stays active")
    page.context.close()


def main() -> None:
    if not (DIST / "index.html").exists():
        sys.exit("dist/ is missing: run npm run build first")
    httpd, origin = serve()
    outside: list[str] = []
    shots: list[str] = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch()
            try:
                shots += play_interview(browser, origin, outside)
                shots += play_friday(browser, origin, outside)
                shots += play_pager(browser, origin, outside)
                check_dutch(browser, origin, outside)
            finally:
                browser.close()
    finally:
        httpd.shutdown()
    check(outside == [], f"no request left the origin {outside}")
    print("battle smoke passed; screenshots:")
    for s in shots:
        print("  " + s)


if __name__ == "__main__":
    t0 = time.time()
    main()
    print(f"({time.time() - t0:.1f} s)")
