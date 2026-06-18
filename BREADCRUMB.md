# BREADCRUMB

## Current state

The vertical slice runs a party-based descent: the **head** fires its active weapon
(Space), each **follower** contributes only its passive **signature** (no weapon). Heroes
show a shrinking-dot cooldown readout, collide physically with enemies, and the train
spawns progressively (head first; followers materialize at their trail slot with a quick
color fade as the head clears room). All on `main`, deployed to Pages.

## Open / next

- **Feel-tune the balance knobs in `balance.js`** (human browser playtest — `./run.sh`):
  - `heroFireCooldownMult` (1.2) — the dominant difficulty lever (see Reference). Under the
    head-weapon/follower-passive model, 1.2 already gives a tense-but-winnable curve;
    pushing toward ~2 was a near-wipe in testing, so tune gently.
  - `partyThreatScale` (1.0) — party-size threat ramp. Survival is firepower-gated, so more
    heroes = more guns = safer head; party-size cost shows up as **follower attrition**, not
    head death. Decide if that's the intended "more friends to lose" framing or push threat
    higher to flatten it.
  - Collision/ spawn feel: `heroCrowdYield` (0.15, crowd drag on the head), `followerReturn`
    (0.35, train re-homing), `spawnFade` (0.25s materialize).
- **Reconcile `partyPreview.js`** — the party-select live preview still shows the highlighted
  hero auto-firing BOTH weapon and signature, but in-game the head only fires its weapon and
  a follower only its signature. The preview should show role-accurate behavior.

## Reference

- **Headless balance harness:** `node tests/gauntlet.mjs [seeds] [maxSec] [greedy|flow] [knob=val,...]`.
  `flow` nav reaches deep game (grades combat); `greedy` models a crush-limited naive player.
  Knobs: `iframe,heal,threat,cd,base,slope,maxlive,hspeed`. Reports win%/depth/kills/headHP%/
  follower-loss. Drives the real `runScene` via the `_probe` hook with a no-render stub ctx.
- **Key finding:** survival is **firepower-gated** — fire rate (`cd`) ≫ enemy count ≫ hero
  speed for head survival. i-frames/heal barely matter for a *moving* head; it lives by
  clearing the path faster than enemies arrive.
- **Crush safety:** the hero's collision push is clamped to never go north (`min(ny,0)` in
  `separateHero`), so a swarm can slow/jostle the head but never press it into the crush line.
- Local serve note: a sandboxed `python -m http.server` gets killed here; a Node static
  server survives. `./run.sh` is the normal launcher.

## Crew-select redesign (UV-Rave direction)

Design exploration lives in `art-test/picker-redesign/` (HTML/CSS stills, the game's own
stack so it ports to the canvas `partySelectScene`). Locked direction: **3A "Console"** —
black UV-rave look (fluoro on black, heavy condensed type, strict grid), bust avatars
(head+shoulders) per card, mini-equaliser stats, place-in-line numerals (no cardinal
numbering), three card states (in-party full / unlocked-unpicked dim / not-won = grey
silhouette + redacted blocks), the live action-preview as a panel, and a footer split into
control hints (left) + background selector (right). Portraits are the player's picks in
`art-test/look-bible/img/selected/` (full-body + `_chunk` pixel versions), cropped into
`portraits/` + `portraits/busts/`; backgrounds knocked out by hand (matte not automated).

Still open before the canvas port: head/order interaction (who's the controllable head),
banked-credits placement, bundling the display fonts, and portraits-as-droppable-assets
with a fallback (the game must boot without the PNGs).

### Background ↔ hero pairing (drives the "Automatic" backdrop)

The void backgrounds (`src/run/voidBackgrounds.js`) map to each hero's music genre, so the
"Automatic" backdrop option picks the void that matches the **head** of the party:

| Hero | Genre | Background | Feel |
|---|---|---|---|
| Marvin | House | **Flow** | smooth looping groove streaks |
| Chad | Industrial | **Datamosh** | harsh broken-signal glitch |
| Dash | Psytrance | **Truchet** | fractal geometric tiling |
| Wendolyn | Dubtechno | **Perlin** | deep, dark, slow pulse |
| Eugene | Techno | **Code Soup** | engineered / machine code |
| Jess | Trance | **Starfield** | cosmic, euphoric lift |
| ZigZag | Acid | **Lightning** | electric 303 zap |
| Jasper | Ambient | **Moiré** | hypnotic, meditative drift |
| Valentine | Synthwave | **Pink Tubes** | pink-neon retro |

## Shelved (do NOT start without the user re-opening)

- **Tiles island-wobble** — full design in `TILES_WOBBLE_PLAN.md` (repo root). Shelved
  2026-06-14. Do not start, integrate, or delete it.
