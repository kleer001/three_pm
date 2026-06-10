# Spec 15 — Run summary: DEATH / VICTORY resolution

The two resolution scenes that end a run and bridge Run → Meta. A run ends when
the hero dies (`emit('death', hero, source)`, spec 04) → **DEATH**, or when the
hero touches the home band (`player tile ∈ homeBand`, spec 02) → **VICTORY**.
There is no final boss; the win is pure navigation (spec 02, spec 04).

These scenes commit the run result to the durable save (spec 08) and show what
was earned. They redefine no narrative (tone bible, spec 14) and no
meta-progression or HUD internals (spec 08, spec 09) — they consume them.

## Decisions in force
- **Win = edge-touch.** Reaching the home band is VICTORY; hero death is DEATH.
  No other end states.
- **Groundhog-day framing.** DEATH = "another day." VICTORY = "made it home
  today." Light tone per spec 14; the loop continues at META either way.
- **Commit on enter, exactly once.** Each scene folds the run into the save with
  one `save(recordRun(load(), result))` transaction (spec 08), then shows the
  deltas. Re-entering the scene must not re-commit (idempotency below).
- **Result is the only payload.** The scene receives the spec 08
  `result = { distanceFraction, kills, won }`, extended with display-only fields
  (below). It carries no live `runState`; the run tier is already dropped.

## `RunResult` — Run → resolution payload
Built by `RUN.exit()` from `runState` (spec 01) at the instant the run ends,
before the run tier is discarded. The contract fields are exactly the spec 08
`recordRun` payload; the rest are display-only and never reach the save.

```
RunResult {
  // --- spec 08 recordRun contract (the only fields that touch meta) ---
  distanceFraction,   // 0..1, southward descent progress toward homeBand (spec 02)
  kills,              // enemy death count this run (death listener, spec 07)
  won,                // bool: reached homeBand

  // --- display only (never persisted) ---
  cause,              // death `source` entity/label (spec 04) | null on victory
  heroId,             // active hero id (spec 05) — for unlock diff + flavor
  seed,               // runState.active seed (spec 01) — daily-seed share line
  scrapDiscarded      // runState.scrap at end — shown as "lost", not banked (spec 07)
}
```

| Field | From | Notes |
|---|---|---|
| `distanceFraction` | run progress vs `homeBand` | clamped `0..1`; `1.0` on win |
| `kills` | run kill tally | the `death`-listener count (spec 07) |
| `won` | end reason | `true` on edge-touch, `false` on death |
| `cause` | `death` event `source` (spec 04) | `null` when `won` |
| `heroId` | `runState` active hero | drives unlock diff + screen flavor |
| `seed` | `runState` active seed | the day's seed, for the share line |
| `scrapDiscarded` | `runState.scrap` | volatile; **dropped**, shown for the sting |

`scrap` never converts to `credits` (spec 08) — it is shown as discarded, not
added to the payout.

## Commit flow (both scenes, in `enter()`)
One transaction, guarded against re-entry. The payout the screen displays is
**derived from the pre-commit blob**, not re-read after, so it is exact.

```
enter(result):
  if this._committed: return            // idempotent: re-entry shows cached deltas
  before  = load()                      // spec 08
  payout  = computePayout(result)       // spec 08 formula (below)
  after   = save( bankCurrency(recordRun(before, result), payout) )
  this._deltas = {
    payout,
    creditsAfter:  after.credits,
    newUnlocks:    after.unlockedHeroes \ before.unlockedHeroes,   // set diff
    bestBeaten:    result.distanceFraction > before.stats.bestDistance,
  }
  for id in this._deltas.newUnlocks: emit('meta:hero-unlocked', { id })  // spec 08/01
  this._committed = true
```

- **Order.** `recordRun` first (folds payout into `credits`, bumps `runCount`,
  recomputes `unlockedHeroes`), then `bankCurrency(payout)` is a no-op-equivalent
  guard step — `recordRun` already added the payout, so the displayed `payout`
  comes from `computePayout`, not a second bank. The single `save` is the only
  writer (spec 08). *(If a build folds payout solely via `bankCurrency`, call it
  before `recordRun` — pick one path; do not add the payout twice.)*
- **Unlock surfacing.** The new-id set diff drives `meta:hero-unlocked` per
  newcomer; the META scene and audio (`unlock` SFX, spec 09) react. No other
  system computes unlocks (spec 08).
- **Idempotency.** `_committed` is scene-instance state, reset only by a fresh
  scene instance on the next run. A pause/redraw/back-into-scene re-render reads
  `this._deltas`; it never re-`load`s or re-`save`s.

### Payout breakdown (display)
Computed once per spec 08 (`PAYOUT_DISTANCE`, `PAYOUT_PER_KILL`, `PAYOUT_WIN` are
tuning, not contract). Both screens itemize it so the number is legible:

| Line | Value | Shown when |
|---|---|---|
| Distance | `round(distanceFraction * PAYOUT_DISTANCE)` | always |
| Kills | `kills * PAYOUT_PER_KILL` | always |
| Made it home | `PAYOUT_WIN` | VICTORY only (`won`) |
| **Earned** | `payout` (their sum, rounded per spec 08) | always |
| Banked | `creditsAfter` | always |

## DEATH scene (`scenes/death.js`)
Music `death` (spec 09). Screen + HUD-where-meaningful only (spec 09 layer note);
no world layers.

```
+--------------------------------------------------+
|                ANOTHER DAY                       |   title beat (tone, spec 14)
|        <heroId> didn't make it home.             |
|                                                  |
|   Got <distancePct>% of the way.                 |   distanceFraction as %
|   Cause: <cause>                                 |   death source (spec 04)
|                                                  |
|   Distance .......... +<distCredits>             |   payout breakdown table
|   Kills (<kills>) .... +<killCredits>            |
|   -------------------------------                |
|   Earned ............ +<payout> credits          |
|   Scrap lost ........  <scrapDiscarded>          |   discarded, not banked
|   Banked ............  <creditsAfter>            |
|                                                  |
|   [ unlocked: <newUnlocks…> ]                    |   only if non-empty
|                                                  |
|            > try another day                     |   CTA → META
+--------------------------------------------------+
```
- No win-bonus line. `cause` is the `death` event `source` (spec 04) rendered as
  a short label.
- "try another day" is the only action.

## VICTORY scene (`scenes/victory.js`)
Music `victory` (spec 09). Same layout family as DEATH, plus the win bonus line.

```
+--------------------------------------------------+
|               MADE IT HOME                       |   title beat (tone, spec 14)
|         <heroId> made it home today.             |
|                                                  |
|   Distance .......... +<distCredits>             |   distanceFraction == 1.0
|   Kills (<kills>) .... +<killCredits>            |
|   Made it home ...... +<PAYOUT_WIN>              |   win bonus (VICTORY only)
|   -------------------------------                |
|   Earned ............ +<payout> credits          |
|   Banked ............  <creditsAfter>            |
|                                                  |
|   [ unlocked: <newUnlocks…> ]                    |   only if non-empty
|                                                  |
|              > head to tomorrow                   |   CTA → META
+--------------------------------------------------+
```
- `distanceFraction` is `1.0`; the Distance line still itemizes for consistency.
- `scrapDiscarded` may be shown or omitted — the win frame doesn't sting on it.

## Layout & type conventions
Both screens reuse the spec 09 HUD type/layout kit (same fonts, screen-space
draw, layer 4). Centered title beat, a left-aligned monospaced payout table so
the `+credits` column aligns, an optional unlock line, and one CTA prompt at the
bottom. No new font or color tokens are defined here; pull from spec 09.

## Transition & input
Wired into the spec 01 scene FSM: `(DEATH | VICTORY) → META`.

| Input | Action |
|---|---|
| confirm (Enter / primary) | advance to META (spec 01 transition) |

- A single **confirm** is the only input both scenes accept; there is no other
  branch (DEATH and VICTORY both lead only to META, spec 01).
- The transition hands control to META with the save already written; META reads
  it through `load()` and reacts to the `meta:hero-unlocked` events emitted here
  (spec 08).

## Interfaces this spec freezes
- `RunResult` shape: the spec 08 contract fields `{ distanceFraction, kills, won }`
  plus display-only `{ cause, heroId, seed, scrapDiscarded }`; only the contract
  fields reach `recordRun`. Built by `RUN.exit()` from `runState` (spec 01).
- The resolution commit: `enter()` runs `save(recordRun(load(), result))` +
  payout banking **exactly once**, guarded by `_committed`, deriving displayed
  deltas from the pre-commit blob and emitting `meta:hero-unlocked` per new
  unlock (spec 08).
- DEATH / VICTORY end-reason mapping: `death` event → DEATH; `homeBand` touch →
  VICTORY (spec 02, spec 04). No final boss, no other end states.
- The payout breakdown lines (distance / kills / win-bonus / earned / banked) as
  the display of the spec 08 formula — coefficients stay tuning, not contract.
- FSM wiring `(DEATH | VICTORY) → META` on a single confirm input (spec 01).
