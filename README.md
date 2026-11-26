# Nines

A retro top-down RPG about growing from Junior to Senior engineer. Walk a career trail in a
pixel-art town, fix simulated servers in an in-game terminal, earn money for homelab gear, and
pick a track (SRE or Platform Engineering) on the way to Senior.

No tracking, no ads, no network calls. It runs from static files and offline on Android.

```sh
npm ci
npm test          # unit tests, quests played end to end, content validation
npm run build     # static site in dist/
```

- [ARCHITECTURE.md](ARCHITECTURE.md): modules, the terminal simulator, content, saves, i18n, Android
- [DESIGN.md](DESIGN.md): tileset, palette, sizes, screen mock-ups
- [CONTRIBUTING.md](CONTRIBUTING.md): add a quest as a guest cameo (one folder, no code)
- [AGENTS.md](AGENTS.md): rules for the agents that build this
- [ASSETS.md](ASSETS.md): every asset with its source and licence
- [PLAY_STORE.md](PLAY_STORE.md): store listing and Data safety
- [docs/reference/roadmap.yml](docs/reference/roadmap.yml): phases and what "done" means

Status: phase 1 (architecture and skeleton). The game itself is not playable yet.
