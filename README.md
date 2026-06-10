# three_pm

TODO: describe three_pm — a browser game.

Vanilla HTML/CSS/JS, no build step. The one rule that keeps it portable across
all three targets below: **`index.html` lives at the repo root and every path
is relative** (no leading `/`).

## Run locally

ES modules need HTTP, not `file://`:

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>.

## Play on the web (GitHub Pages)

Pushed to `main`, the game is live at <https://kleer001.github.io/three_pm/>.
No build — Pages serves the repo root as-is.

## Publish to itch.io

```bash
./package.sh
```

Produces `dist/three_pm.zip` with `index.html` at the archive root (itch.io's
requirement). Upload it as a new HTML5 project and tick **"This file will be
played in the browser."**
