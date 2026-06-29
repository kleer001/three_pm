# Making-of — build & exploration pages

Throwaway web tools and previews used while building the game, kept for reference
rather than deleted. Each is a single self-contained HTML page.

**Run them over HTTP from the repo root** (`./run.sh`, or `python3 -m http.server`),
never `file://` — several import live modules from `../src/` or pull audio from
`../art-test/`, which only resolve when the whole repo is served.

`screenshots/` holds a point-in-time capture of each page, so the look is preserved
even if a page's live imports drift as the game changes.

## Pages

- **powerup-pickup-tuner.html** — compares the ground-pickup with and without its
  backing disc across the three real ground colors (street/sidewalk/yard), plus an
  interactive RGBA tuner for the disc fill and ring edge. Used to pick the pickup
  disc colors in `THEME.pickup` (`src/run/balance.js`).
- **powerup-emoji-preview.html** — renders every powerup as its real ground pickup
  (disc + ring + emoji) using the live game draw helpers and theme. Used to choose
  the per-powerup emoji in `POWERUPS` (`src/run/powerups.js`).
- **freeze-candidates.html** — auditions the icy/crystalline samples in the foley
  pool as candidates for the `freeze` sound. Audio plays from
  `../art-test/sfx-preview/pool/` (the local sample pool is gitignored, so a fresh
  checkout has no clips — the screenshot is the durable record).
