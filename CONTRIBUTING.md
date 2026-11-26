# Contributing: a guest cameo

Nines is built so that anyone can add a quest without writing code. A **cameo** is one pull
request that adds one folder under `content/quests/`: your quest, your character, your
terminal puzzle, in Dutch and English. Your name goes on the credits screen automatically.

```
content/quests/<your-quest-id>/
  quest.yaml          who gives the quest, where it starts, what it pays
  scenario.yaml       the simulated machine and the conditions that win it
  npc.yaml            your character (optional)
  <name>.png          your character's sprite sheet (optional, CC0)
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
- **Pick a free cameo slot** on the map (`spawn: {map: junior-village, slot: cameo-1}`); the
  validator tells you when a slot is taken.

Check your folder before you open the pull request:

```sh
npm ci
npm run validate:content
npm test
```

The schemas in `/schemas` describe every field, and ARCHITECTURE.md describes the condition
language and the commands your scenario can use. The three MVP quests in `content/quests/` are
working examples.

A complete, step-by-step worked example arrives with the first sample cameo (the "fourth quest"
proof in the roadmap).
