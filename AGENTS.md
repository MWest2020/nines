# Rules for agents working on Nines

Read this, then ARCHITECTURE.md and DESIGN.md, before changing anything. These rules come
from Mark's brief (26 Nov 2026, rule 3 revised 27 Nov 2026); a reviewer blocks a pull request
that breaks one.

## Hard constraints

1. **No Nintendo or Pokémon IP.** No sprites, names, sounds, UI or creatures that could be
   recognised as Pokémon; no creature collecting or battling, no "trainer"/"gym"/badge framing,
   no look-alike dialogue boxes or menus (DESIGN.md lists what to avoid). Only own pixel art or
   CC0 assets (for example Kenney.nl). The content validator refuses a denylist of names; that
   is a floor, not the check.
   Battles (Mark, 26 Nov 2026) are engineering conversations, not creature fights, and follow
   this rule in full: our own announcement, layout and meter names (DESIGN.md, Battles).
2. **Every asset is recorded.** A row in ASSETS.md (path, source, author, licence) in the same
   commit that adds the file. `npm test` fails on an unlisted binary outside `content/`. A
   quest sprite records its source and licence in its `npc.yaml` (licence `CC0-1.0`).
3. **Privacy kept sensible; network features opt-in.** Nines is not a children's app (Mark,
   27 Nov 2026), so "no network" is no longer absolute: optional online features such as
   share-my-progress may come (DESIGN.md, Share my progress). What stays: no third-party
   analytics, no ads and no tracking unless Mark asks for them; no fonts or scripts from a CDN.
   Every network feature is opt-in (off until the player turns it on), documented in
   ARCHITECTURE.md and PLAY_STORE.md (Data safety) before it ships, and approved by Mark when it
   adds a server or a public endpoint. Until such a feature lands the game makes no requests
   beyond its own files: saves stay in `localStorage`, the CSP in `index.html` stays strict and
   `tests/guards.test.ts` stays green. Loosen either only in the pull request that adds the
   feature, never to make something else work.
4. **Fully static.** `npm ci && npm run build` produces `dist/`, which must run from GitHub
   Pages (a sub-path) and offline inside the Android app. Relative URLs only (`base: './'`).
5. **Content is data, not code.** Quests, NPCs, dialogue, scenarios and conditions live in
   `/content` as YAML (plus PNG sprites and Tiled JSON). Contributors never write JavaScript.
   When content needs something new, add a fact to `src/rules/registries.ts` (with its
   implementation and a test) or a command to the simulator, never a script hook in content.
   Conditions are parsed by `src/rules/expr.ts`; nothing is ever passed to `eval` or
   `new Function`.
6. **Boring and auditable.** Few dependencies. Every version pinned exactly and published at
   least two weeks before you add it: check with `npm view <pkg> time`, install with
   `npm install --save-exact --before=<today minus 14 days> <pkg>@<version>`. Justify a new
   dependency in the pull request and in ARCHITECTURE.md's table. Actions pinned to commit SHAs.
   The README stays short.

## Machine load (shared host)

The agents' host is an LXC with 4 CPUs and 10 GB RAM, shared with other agents that run
browsers.

- **One browser at a time**, and only under the memory cap, with a hard timeout:

  ```sh
  timeout -s KILL 900 systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0 \
    npx playwright test
  ```

  The same prefix for any other browser or headless Chrome. If another agent's browser is
  running (`pgrep -fa chrom`), wait.
- No long-running dev servers. If you need `vite preview` for a browser check, start it inside
  the same capped scope and stop it when the check ends.
- `npm ci`, `npm run build` and `npm test` are fine; run them one at a time, not in parallel.
- Phase 1 (architecture) used no browser at all.

## Working agreements

- Use the global git identity (`git config --global`); don't override `user.email`. Push over SSH. Small commits, one concern
  each. Work on a branch in a worktree; open a pull request; wait for green CI; merge with
  `gh pr merge --squash --delete-branch --match-head-commit <sha>`. A pull request whose separate
  commits are the point (the fourth-quest proof: one commit that only adds a cameo folder) merges
  with `--rebase` instead, so those commits survive on main.
- Tests: the parser and the condition language have tests for every change. A new command gets
  tests in `tests/sim/commands.test.ts`. A new quest gets a play-through in `tests/quests/`.
- `docs/reference/roadmap.yml` is the overview's source: when work changes what "done" means
  or finishes an item, update it in the same pull request. An item is done only with evidence
  (a merged PR, a CI run, a document).
- A decision only Mark can take: open an issue labelled `waiting-on-mark` with the question as
  the title, a link, and a line `Default: ...`; then continue with the default.
- Never commit secrets or signing material. Android signing comes from environment variables
  (`NINES_KEYSTORE`, `NINES_KEYSTORE_PASSWORD`, `NINES_KEY_ALIAS`, `NINES_KEY_PASSWORD`).
- Android builds (Gradle) are heavy: one at a time, memory-capped and without a daemon:
  `systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=0 ./gradlew --no-daemon ...`,
  then `./gradlew --stop`. Check `pgrep -f 'GradleDaemon|gradlew'` first and wait if one runs.
- The app id is `work.westerweel.nines` (Mark, 26 Nov 2026), configurable with `NINES_APP_ID`.
- GitHub Pages deploys main to https://mwest2020.github.io/nines/ (Mark's "mag openbaar", 26 Nov
  2026). Any other new public surface needs his explicit go-ahead.
- Hints cost AI tokens (DESIGN.md, AI tokens). A new hint in content costs the player a token,
  so it must be worth one: point the way, never just print the answer.

## Acceptance (from the brief)

- `npm ci && npm run build` produces a static site that runs offline.
- `npm test` passes; content validation runs in CI.
- All three MVP quests completable on desktop and on an Android device.
- A fourth quest needs only a new `/content` folder (proved by a sample cameo in its own commit).
- ASSETS.md lists a source and licence for every asset.
- No runtime network requests: verified in the browser's devtools and documented (until an
  opt-in network feature lands under rule 3).
