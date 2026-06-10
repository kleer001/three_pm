# Spec 16 — Title, menus, and the full scene flow

Completes the scene FSM reserved in spec 01. Spec 01 named the play scenes
(TITLE, RUN, DEATH, VICTORY, META) and froze the `Scene` interface; this spec
draws the **complete transition graph**, adds the two scenes spec 01 left
implicit — **HERO-SELECT** and a **PAUSE** overlay — and specifies the menu
screens (TITLE, SETTINGS) plus the menu input model. It adds no game content and
does not redesign META (spec 08) or presentation (spec 09); it references them.

## Decisions in force
- **Two new scenes beyond spec 01:** `HERO-SELECT` (its own scene) and `PAUSE`
  (an overlay scene that suspends RUN). All others are exactly the spec 01 set.
- **HERO-SELECT is its own scene, not a META panel.** It runs on both the cold
  start (TITLE → HERO-SELECT → RUN) and the between-runs loop (META →
  HERO-SELECT → RUN); making it a scene keeps one commit path into `RUN.enter()`
  instead of duplicating select UI inside both TITLE and META.
- **PAUSE is an overlay**, not a teardown: it does not call `RUN.exit()`, so the
  live `runState` (spec 01) survives untouched. It only stops the sim from
  stepping.
- **All scenes implement the spec 01 `Scene` interface** (`enter / update(dt) /
  render(alpha) / exit`); transitions are explicit, one active scene at a time
  (PAUSE is the single exception — it draws over a frozen RUN).
- **Groundhog-day tone** (spec 14): copy leans into the same-day-again loop with
  a light touch. Strings are placeholders here; final copy is tuning, not
  contract.

## Scene-transition graph
One active scene; PAUSE is the lone overlay (RUN stays loaded beneath it).
Edges are labeled with their trigger.

```
                          ┌──────────────────────────────────────┐
                          │                 TITLE                 │
                          │  Start ─┐   Continue* ─┐   Settings ─┐ │
                          └─────────┼──────────────┼─────────────┼─┘
                                    │              │             │
                                    ▼              ▼             ▼
                              HERO-SELECT ◀─────────────┐    SETTINGS
                                    │                   │        │ back
                          confirm hero                  │        ▼
                                    │                   │     (returns to
                                    ▼                   │      opener: TITLE
                                  RUN ◀──────────┐      │      or PAUSE)
                            │   │   │            │      │
                  pause ────┘   │   └──── win    │ play │ pick
                     │       arriving            │ again│ hero
                     ▼       home / death        │      │
                  PAUSE         │   │            │      │
              resume │ │ restart│   │            │      │
                ┌────┘ │        │   │            │      │
                │  quit │   (DEATH)(VICTORY)     │      │
       (back to RUN)    │        │   │           │      │
                        │        └─┬─┘           │      │
                        │       commit result    │      │
                        ▼          ▼             │      │
                     TITLE ◀──── META ───────────┘      │
                          back     │   pick hero ───────┘
                                   │
                                   └─ spend credits / view unlocks (in place)

  * Continue appears only when a save blob exists (spec 08 load()).
```

Edge triggers, exhaustively:

| From | To | Trigger |
|---|---|---|
| TITLE | HERO-SELECT | "Start" (and "Continue" — same route; the save just preloads META state) |
| TITLE | SETTINGS | "Settings"; SETTINGS returns to TITLE |
| HERO-SELECT | RUN | confirm an **unlocked** hero → commit id into `RUN.enter()` |
| HERO-SELECT | TITLE \| META | "Back" → returns to whichever scene opened it |
| RUN | PAUSE | pause key (overlay; RUN not exited) |
| RUN | DEATH | hero hp ≤ 0 |
| RUN | VICTORY | hero reaches home band (spec 02) |
| PAUSE | RUN | "Resume" (overlay closes, sim un-freezes) |
| PAUSE | RUN | "Restart" → `RUN.exit()` then new `RUN.enter()`, same hero, new seed |
| PAUSE | TITLE | "Quit to title" → `RUN.exit()`, run state dropped |
| DEATH | META | acknowledge → after `recordRun` commit (spec 08) |
| VICTORY | META | acknowledge → after `recordRun` commit (spec 08) |
| META | HERO-SELECT | "Play again" / pick → carries to a fresh RUN |
| META | TITLE | "Back" |

DEATH and VICTORY both commit the run result to meta (spec 08
`save(recordRun(load(), result))`) on `enter()`, then route to META. They never
route straight back to RUN — META is always the between-runs gate.

## TITLE scene
The cold-open menu. Draws its own screen plus nothing from the HUD (RUN is not
loaded yet). Plays the `title` track (spec 09 per-scene music).

| Item | Shown when | Routes to |
|---|---|---|
| Game title + tagline | always | — (groundhog-day flavor line, e.g. "It's 3pm. Again.") |
| **Start** | always | HERO-SELECT |
| **Continue** | a save blob exists (`load()` returns non-default, spec 08) | HERO-SELECT (META is already populated from save) |
| **Settings** | always | SETTINGS |

"Start" and "Continue" share the HERO-SELECT route; the only difference is that a
returning player already has unlocked heroes and banked `credits` in the save.
There is no separate "new game" wipe here — clearing a save is out of scope for
this spec.

## HERO-SELECT scene
Lists **all five heroes** in unlock order, shows which are playable, and commits
the chosen one into the next run. Read-only over the save (spec 08 `load()`); it
spends nothing.

Hero roster (ids + gates from specs 05, 10–13):

| Order | id | Name | Archetype | `unlockAtRuns` | Stat spread (spd/con/str/mag) | Kit (basic / signature) |
|---|---|---|---|---|---|---|
| 1 | `marvin` | Marvin Merrick | The Median | 0 | 5 / 5 / 5 / 5 | Backpack Swing / Pop Quiz |
| 2 | `varsity` | Chad Brawnson | The Varsity | 1 | 3 / 8 / 9 / 2 | Haymaker / Body Slam |
| 3 | `wendolyn` | Wendolyn Crowe | The Occultist | 3 | 5 / 2 / 3 / 9 | Hex Bolt / Summon the Hall Monitor |
| 4 | `dash_velocity` | Dash Velocity | The Track Star | 5 | 9 / 2 / 5 / 4 | Baton Jab / Anchor Leg |
| 5 | `robotics` | Eugene Okafor | The Robotics Nerd | 8 | 2 / 8 / 3 / 8 | Wrench Whack / Deploy Sentry Turret |

- **Unlocked vs locked:** per hero, call `isHeroUnlocked(blob, id)` (spec 08).
  Unlocked heroes are selectable; locked heroes are dimmed and **not**
  selectable, with an unlock hint reading the runs still needed:
  `runs to go = max(0, def.unlockAtRuns − blob.runCount)` → e.g. "Unlocks in 2
  runs." Marvin (`unlockAtRuns: 0`) is always unlocked.
- **Per-hero detail panel** for the focused hero: name + archetype + blurb, the
  four-axis stat spread (1–10 scale, spec 05), and a one-line kit summary (basic
  + signature names). No live combat numbers — those are derived at run start
  (spec 03); this panel reads the static `characters.json` def only.
- **Commit:** confirming an unlocked hero hands its `id` to `RUN.enter()`, which
  spawns it and applies `applyHeroUpgrades(hero, id, load())` (spec 08) before
  `recomputeDerived` (spec 03). HERO-SELECT itself performs no save write.
- **Back** returns to the opener (TITLE on cold start, META in the loop).

## PAUSE scene (overlay over RUN)
A modal overlay that suspends the run without tearing it down. RUN remains the
scene **beneath** PAUSE; `RUN.exit()` is not called while paused.

Freezing the fixed-timestep sim (spec 01): when PAUSE is active, the loop stops
calling `RUN.update(dt)` and **drains its accumulator** — on resume, `accumulator`
is reset to 0 so no buffered steps fire at once and no wall-clock-vs-sim drift
accrues. `render(alpha)` still runs each frame: it draws the frozen RUN scene
(its last sim state, `alpha` held at 0) and then the PAUSE overlay on top.
Because `runState` is never touched, resume continues from the exact prior step.

| Item | Effect |
|---|---|
| **Resume** | close overlay; loop resumes `RUN.update(dt)` from the held state |
| **Restart** | `RUN.exit()` then `RUN.enter()` — same hero id, a **new** run seed (spec 01); current run state dropped, no meta write |
| **Quit to title** | `RUN.exit()`; run state dropped (no `recordRun` — quitting is not a completed run, spec 08); → TITLE |

Restart and Quit discard the in-progress run without paying out: only DEATH and
VICTORY are completed runs that call `recordRun`.

## SETTINGS scene
Minimal. Adjusts the spec 09 audio gain buses and shows a controls reminder.
Reachable from TITLE and from PAUSE; "Back" returns to the opener.

| Setting | Control | Wired to (spec 09) |
|---|---|---|
| Master volume | slider 0–1 | `setMasterGain(v)` |
| Music volume | slider 0–1 | `setMusicGain(v)` |
| SFX volume | slider 0–1 | `setSfxGain(v)` |
| Controls | read-only reminder | move / aim / basic / signature / pause keys |

No graphics, key-rebinding, or difficulty options — out of scope. Volume values
persist as part of the save blob only if spec 08's schema is extended for them;
this spec does not extend the schema, so values reset per session unless that
field is added there.

## Per-scene music reference
The scene FSM drives music exactly as spec 09 specifies (`enter()` calls
`playMusic`); this spec only maps the menu/overlay scenes it adds. Actual files
live in `audio.json` (spec 09); track ids are the contract.

| Scene | Music |
|---|---|
| TITLE | `title` (spec 09) |
| HERO-SELECT | `title` (no separate bed — stays on the title loop through select) |
| RUN | `run` (spec 09) |
| PAUSE | none — `playMusic` is **not** called; the `run` loop keeps playing, muffled by mix is out of scope |
| DEATH | `death` (spec 09) |
| VICTORY | `victory` (spec 09) |
| META | `meta` (spec 09) |
| SETTINGS | inherits the opener's track (no `playMusic` on enter) |

PAUSE and SETTINGS deliberately do **not** swap the track, so resuming RUN or
backing out of a menu has no audible gap.

## Menu input / focus model
All menu scenes (TITLE, HERO-SELECT, PAUSE, SETTINGS) share one navigation model;
RUN uses gameplay input (specs 04 input), not this.

- **Keyboard:** Up/Down (or W/S) move focus between items, wrapping; Left/Right
  (or A/D) adjust the focused slider (SETTINGS) or change the focused hero
  (HERO-SELECT); Enter/Space activates the focused item; Esc = "Back" / "Resume"
  (the dismiss action of the current scene).
- **Mouse:** hover sets focus to the item under the cursor; click activates it;
  drag adjusts a slider. Mouse and keyboard share the single "focused item"
  cursor — moving one updates it for the other.
- **Pause key:** the dedicated pause binding toggles RUN → PAUSE and back; Esc
  inside PAUSE resolves to Resume.
- Exactly one item is focused per menu scene at all times; `enter()` sets the
  default focus (first selectable item — for HERO-SELECT, the last-played or
  first unlocked hero).

## Interfaces this spec freezes
- The **complete scene graph**: the spec 01 scenes plus `HERO-SELECT` (own scene)
  and `PAUSE` (overlay over RUN), with the labeled transition edges above as the
  authoritative set. DEATH/VICTORY always route through META, never straight to
  RUN.
- `HERO-SELECT` as the sole commit path into `RUN.enter()` (carries a hero `id`),
  reachable from both TITLE and META; read-only over the spec 08 save, gated by
  `isHeroUnlocked` with the `max(0, unlockAtRuns − runCount)` unlock hint.
- `PAUSE` as a non-destructive overlay: never calls `RUN.exit()`, freezes the sim
  by halting `RUN.update(dt)` and zeroing the accumulator on resume; Restart and
  Quit drop the run with **no** `recordRun` (only DEATH/VICTORY pay out).
- TITLE item set (Start, Continue-if-save, Settings) and SETTINGS' three
  gain-bus sliders wired to spec 09 `setMasterGain/setMusicGain/setSfxGain`.
- Per-scene music for the added scenes (HERO-SELECT/SETTINGS inherit, PAUSE keeps
  the `run` loop) layered on the spec 09 map; track ids are the contract.
- The shared keyboard+mouse menu focus model (single focused item, Esc =
  dismiss, pause key toggles PAUSE).
