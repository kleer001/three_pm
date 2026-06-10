# three_pm

TODO: describe three_pm — a browser game.

## What this is

A vanilla browser game: plain HTML, CSS, and ES modules. No build system, no
bundler, no dependencies. Open it by serving the folder over HTTP.

Ships to three targets — local, GitHub Pages, and itch.io — from one layout.
The invariant that makes that work: **`index.html` stays at the repo root and
all paths are relative** (no leading `/`). A leading slash 404s on GitHub Pages
(served under `/three_pm/`) and breaks inside itch.io's iframe.

## Quick commands

- Run: `python3 -m http.server 8000`, then open <http://localhost:8000>
  (ES modules require HTTP, not `file://`).
- Package for itch.io: `./package.sh` → `dist/three_pm.zip` (index.html at zip root).
- GitHub Pages: auto-served from `main` at <https://kleer001.github.io/three_pm/>.

## Project structure

- `index.html` — page shell, loads `src/main.js` as a module
- `src/main.js` — entry point; boots the game
- `src/game.js` — game loop and state
- `styles.css` — page chrome
- `assets/` — images, audio, data
- `package.sh` — builds the itch.io zip into `dist/` (gitignored)
- `.nojekyll` — tells GitHub Pages to serve files verbatim (skip Jekyll)
- `.scaffold.json` — record of how this repo was generated (do not edit by hand)

## Code style

- `snake_case` is for Python; here use `camelCase` for functions/vars,
  `PascalCase` for classes (standard JS).
- ES modules with explicit `import`/`export`. No globals.
- Comments explain *why*, not *what*.

## Git

Atomic commits. Conventional Commits: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`.

## Boundaries

- Don't touch `.scaffold.json` by hand.
- One path, no fallbacks. Fail loudly. (See `~/.claude/CLAUDE.md` for the full philosophy.)
