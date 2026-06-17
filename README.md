# 3pm

A browser roguelite. It's 3pm and school's out — but Merriton High lets out into
a post-apocalyptic cartoon hellscape. Pick your party from nine 16-year-olds and
**get home alive**. Every day the way home is a forced march south while the world
caves in behind you.

Vanilla HTML/CSS/JavaScript — no build step, no dependencies.

▶ **Play in your browser:** <https://kleer001.github.io/three_pm/>

## How to play

- **Move:** `WASD`, arrow keys, or vim `hjkl`
- **Slingshot:** `SPACE` — auto-aims the nearest enemy (3s cooldown). A hit
  **freezes** an enemy; freeze it twice and it dies.
- **Goal:** descend to the **home band** at the bottom. The screen scrolls down
  on its own and won't wait — don't let it pin you against a wall, that's fatal.
- **Restart:** `SPACE` on the end screen starts another day (a fresh map).

## Run locally

ES modules need HTTP (not `file://`):

```bash
./run.sh            # serves the game + the screen recorder, opens both
# or
python3 -m http.server 8000   # then open http://localhost:8000
```

## Project layout

- `src/` — the game (entry `main.js`; the playable loop is `run/runScene.js`)
- `docs/` — the full design spec corpus (start at `docs/00-index.md`) and
  `ENGAGEMENT.md`
- `tests/smoke.mjs` — `node tests/smoke.mjs` checks the core logic
  (generation, connectivity, collision, pathfinding)
- `tools/` — a local browser screen recorder and the art-generation scripts
- `package.sh` — builds `dist/three_pm.zip` for itch.io

The current `src/` is an early **vertical slice** drawing colored shapes; it
proves the loop while the design in `docs/` is filled in.

## Status

Work in progress. Forced-descent core loop, procedural suburb generation with
tunable obstacle shape/density, BFS-driven enemies, and a freeze-slingshot are
playable; heroes, powerups, and meta-progression are designed in `docs/` and
being implemented.

## License

MIT — see [LICENSE](LICENSE).
