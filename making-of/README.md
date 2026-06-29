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

## art-test sandbox screenshots

`screenshots/` also holds a capture of every sandbox under `art-test/` — those
pages stay live there as working tools; these are a point-in-time visual record
(filenames mirror the path, `/` → `-`). They span the slice's visual/audio
exploration:

- **Audio** — `sfx-editor`, `sfx-candidates`, `sfx-win-death`, `sound-test`.
- **Void / tentacles** — `void-sandbox`, `void-wipes`, `holes_in_reality`,
  `tentacle-timing`.
- **Wobble line** — `wobble`, `art_wobble`.
- **Tiles** — `tiles`, `tilemap_compare`.
- **UI comps** — `summary-preview`, `popup-layout`, the `picker-redesign-*` party
  screen explorations, and the `msn-mock-*` post-run messenger mockups (each set's
  many variants are the design search; the shipped picks are the `-final-comp` /
  `3a-uv-console` ones).
