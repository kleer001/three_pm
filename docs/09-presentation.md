# Spec 09 — Presentation: rendering, camera, HUD, audio

Defines how the live game is drawn and heard: the canvas 2D render pipeline, the
sprite/animation abstraction, the follow camera, the HUD kit, and the WebAudio
layer. Presentation is **read-only over sim state** — it interpolates, draws, and
plays sound; it never advances or mutates game logic. The fixed-timestep loop
(spec 01) drives it via `render(alpha)`; entities carry the `sprite` component
(spec 03); the camera draws the `Level` (spec 02). This spec adds no game content.

## Decisions in force
- **Pre-drawn bitmap sprites** on a tile atlas, drawn to a single canvas 2D
  context. A `sprite`/animation abstraction is backed by sheet + frame data
  (`sprites.json`); heroes, enemies, and pickups all render through it.
- **Full HUD kit:** HP bar, mana bar, signature-cooldown indicator, edge-arrow
  compass to home, scrap counter, and a minimap.
- **Compass = edge arrow:** an arrow pinned to the screen edge, pointing toward
  home along the run bearing (spec 01).
- **Audio = SFX + music** via WebAudio: one-shot effects (hits, pickups,
  abilities) and a looping music track per scene/state. SFX are **event-driven**
  — subscribed to `events` (spec 01), never polled.

## Render pipeline (`render/renderer.js`)
`render(alpha)` is called once per frame by the loop after the sim has settled
(spec 01). `alpha = accumulator / DT` ∈ `[0,1)` is the interpolation factor
between the previous and current sim step. The renderer owns no sim state; the
loop owns no draw state.

**Interpolation contract.** Each rendered entity keeps `transform.x,y` (current
step) and `transform.prevX,prevY` (snapshot taken at the top of `update(dt)`).
The draw position is:
```
drawX = lerp(prevX, x, alpha)
drawY = lerp(prevY, y, alpha)
```
Only `transform` is interpolated; anim state, HP, etc. read current values.
`prevX/prevY` are written by the integrator at step start, so the renderer reads
them without touching sim logic.

**Layer order** (back to front), one pass each:
| # | Layer | Source | Notes |
|---|---|---|---|
| 1 | tiles | `Level.tiles` via atlas | only visible tiles (cull range below) |
| 2 | entities | actors + pickups with `sprite` | **sorted ascending by `drawY`** for top-down depth |
| 3 | projectiles / FX | transient hit sources (spec 04), particles | drawn over actors; no depth sort |
| 4 | HUD overlay | sim/run/meta state (below) | screen space, ignores camera |

Layer 2's y-sort is the depth rule: an entity lower on screen (greater `drawY`)
occludes one above it. Tiles and HUD are not sorted. The active scene (spec 01)
decides which screens draw; RUN draws all four layers, TITLE/DEATH/VICTORY/META
draw their own screen plus the HUD only where meaningful.

## Sprite & animation (`render/sprite.js`, `assets/sprites.json`)
A sprite is a region of a sheet image; an animation is a named sequence of
frames played at a fps. The `sprite` component (spec 03) names a visual id and
carries mutable anim state; the renderer resolves it to a source rect each draw.

**Descriptor — `sprites.json`:**
```
sprites.json = {
  sheet: "assets/sprites.png",       // single sheet image (atlas)
  frames: {
    "<frameId>": { x, y, w, h }      // source rect in sheet px
  },
  anims: {
    "<visualId>": {                  // matches sprite component's visual id
      "<animName>": {                // e.g. "idle" | "walk" | "attack" | "hit"
        frames: ["<frameId>", ...],  // ordered frame ids
        fps,                         // playback rate
        loop                         // bool; non-loop holds last frame
      }
    }
  }
}
```
The tile atlas is the same sheet (or a sibling sheet loaded the same way): each
tile `type` (spec 02) maps to a `frameId`, drawn at `tile*tileSize`.

**`sprite` component anim state** (the spec 03 `sprite` fields, made concrete):
```
sprite { visualId, anim, frame, t, flipX }
  visualId  // key into sprites.json anims
  anim      // current animation name
  frame     // current frame index into anims[visualId][anim].frames
  t         // seconds accumulated in the current frame
  flipX     // horizontal mirror (facing), from transform.facing
```
**Advance** (during `update(dt)`, so it is deterministic, not frame-rate bound):
```
advanceSprite(sprite, dt):
  a = anims[sprite.visualId][sprite.anim]
  sprite.t += dt
  while sprite.t >= 1/a.fps:
    sprite.t -= 1/a.fps
    sprite.frame += 1
    if sprite.frame >= a.frames.length:
      sprite.frame = a.loop ? 0 : a.frames.length - 1
```
**Resolve** (during `render`): `rect = frames[a.frames[sprite.frame]]`; blit that
source rect to the draw position. Setting `sprite.anim` (e.g. idle→walk on
movement, →attack on `useAttack`, →hit on `applyDamage`) resets `frame`/`t`;
this is a sim-side state change, not a render concern.

## Camera (`render/camera.js`)
Follows the player, clamped to map bounds (spec 02 fixed the scroll + the
coordinate convention: tile (col,row); world px = tile*tileSize).
```
camera { x, y, vw, vh }     // top-left world px of the viewport; viewport px size

follow(player):
  x = clamp(player.drawX - vw/2, 0, w*tileSize - vw)
  y = clamp(player.drawY - vh/2, 0, h*tileSize - vh)
```
Centers on the player's interpolated position, clamped so the viewport never
shows past the map edge (the spec 02 clamp range `[0, w*tileSize - viewport]`).

**World→screen:** `screenX = drawX - camera.x`, `screenY = drawY - camera.y`.
The mouse→world `aim` derivation (spec 04) is the inverse and stays owned by
input.

**Visible-tile cull range** (layer 1 only draws these):
```
col0 = floor(camera.x / tileSize)        rowMin = floor(camera.y / tileSize)
col1 = ceil((camera.x + vw) / tileSize)  rowMax = ceil((camera.y + vh) / tileSize)
```
Clamp to `[0, w)` / `[0, h)`. Entities outside the viewport are skipped in layer 2
by the same screen-rect test.

## HUD (`render/hud.js`)
Drawn in screen space (layer 4), ignoring the camera. Each element is pure
read-over state — it draws current values from the sources below and writes
nothing back.

| Element | Data source | Draws |
|---|---|---|
| HP bar | `hero.health` `{hp,maxHp}` (spec 03) | filled fraction `hp/maxHp` |
| Mana bar | `hero.mana` `{mana,maxMana}` (spec 03) | filled fraction `mana/maxMana` |
| Signature cooldown | `hero.cooldowns['signature']` + def `cooldown` (spec 04) | radial fill = `1 - timer/cooldown`; ready when `timer<=0` |
| Compass | `Level.bearing` (spec 01) + `hero.transform` + `camera` | edge-pinned arrow (math below) |
| Scrap counter | `runState.scrap` (spec 07) | icon + integer |
| Minimap | `Level` (tiles/walkable, homeBand) + `hero.transform` | explored tiles, player dot, home band |

**Minimap.** A scaled top-down render of the map: explored tiles shaded (a
visited-tile mask grown as the player moves), the player as a dot at its tile,
and the `homeBand` edge (spec 02) highlighted as a colored band so the goal is
always locatable. It shows geometry only — no enemies — keeping it a navigation
aid, not a radar.

### Edge-arrow compass math
Given the player world position, the home bearing, and the viewport, the arrow is
pinned to the screen edge and rotated to point home. Home lies along the run
bearing; the arrow shows the constant direction, not a moving target, so it is a
pure function of `bearing` (spec 01) — no per-frame target tracking.
```
dir   = { cos(bearing), sin(bearing) }        // unit vector toward home (world)
angle = bearing                               // arrow rotation = bearing
// project from screen center to the viewport edge along dir, with margin m:
cx, cy = vw/2, vh/2
// scale dir to the nearest edge of the [m, vw-m] × [m, vh-m] box:
tx = (dir.x > 0 ? (vw-m - cx) : (cx - m)) / |dir.x|     // ∞ if dir.x == 0
ty = (dir.y > 0 ? (vh-m - cy) : (cy - m)) / |dir.y|     // ∞ if dir.y == 0
t  = min(tx, ty)
arrowX = cx + dir.x * t
arrowY = cy + dir.y * t                        // clamped onto the edge box
// draw the arrow sprite at (arrowX, arrowY) rotated by `angle`.
```
The arrow rides the viewport edge in the bearing direction and rotates to match,
so it always reads as "home is this way." Screen-space y grows downward, matching
the world px convention (spec 02); `bearing`'s sin/cos use the same axis sense.

## Audio (`audio/audio.js`, `assets/audio.json`)
A small module over one WebAudio graph. SFX are one-shots; music is a single
looping track swapped on scene/state change. Buffers are decoded once at boot
from the asset registry.

**Module API:**
```
init()                  // build AudioContext + the bus graph, decode audio.json
playSfx(id)             // one-shot: id → buffer → through sfxBus → master
playMusic(trackId)      // start/replace the loop on musicBus (no-op if same track)
stopMusic()             // stop the current loop
setMasterGain(v) / setSfxGain(v) / setMusicGain(v)   // 0..1
```

**Graph:**
```
sources (sfx one-shots) → sfxBus (gain) ┐
current music source (loop) → musicBus (gain) ┤→ master (gain) → destination
```
Three `GainNode`s (master, sfx, music) so SFX and music level independently.
Each `playSfx` creates a throwaway `AudioBufferSourceNode` → `sfxBus`; `playMusic`
holds one looping source on `musicBus` and replaces it on track change.

**Asset registry — `audio.json`:**
```
audio.json = {
  sfx:   { "<id>": "assets/sfx/<file>" },     // hit, pickup, ability_cast, ui, ...
  music: { "<trackId>": "assets/music/<file>" }
}
```

**Per-scene music** (driven by the spec 01 scene FSM; `enter()` calls `playMusic`,
`exit()` leaves it or the next scene replaces it):
| Scene / state | Track |
|---|---|
| TITLE | `title` |
| RUN | `run` (looping action bed) |
| DEATH | `death` (stinger → loop) |
| VICTORY | `victory` |
| META | `meta` |

**Event-driven SFX** (subscribe at `init` to the spec 01 `events` pub/sub; fire
SFX in the handler — no polling):
| Event (spec) | SFX id |
|---|---|
| `death` (spec 04) | `enemy_die` if `target.faction==='enemy'`, else `hero_die` |
| hit / `applyDamage` landed (spec 04) | `hit` |
| ability used / `useAttack` (spec 04) | `ability_cast` (signature) / `swing` (basic) |
| pickup collected (spec 07) | `pickup` |
| `meta:hero-unlocked` (spec 08) | `unlock` |
Handlers only call `playSfx`; they read the event payload, never sim internals.
(Combat/pickup/meta systems already emit these; this spec adds no new emits.)

## Interfaces this spec freezes
- `render(alpha)` interpolation contract: lerp `transform.prev{X,Y}`→`{x,y}` by
  `alpha`; renderer reads sim state, never writes it; the four-layer order with
  layer-2 ascending-`drawY` depth sort.
- `sprites.json` descriptor (sheet + `frames` rects + named `anims` with frame
  lists + fps + loop) and the `sprite` component anim-state fields
  (`visualId, anim, frame, t, flipX`); `advanceSprite` ticks in `update(dt)`,
  resolve-to-rect in `render`.
- Camera `follow`/clamp to `[0, w*tileSize - viewport]`, world→screen transform,
  and the visible-tile cull range (consumes the spec 02 `Level` + coordinate
  convention).
- HUD element → data-source table (health, mana, cooldowns, `Level.bearing`,
  `runState.scrap`, `Level`) and the edge-arrow compass math.
- `audio` module API (`init`, `playSfx`, `playMusic`, `stopMusic`, gain setters),
  the master/sfx/music bus graph, `audio.json` registry shape, the per-scene
  music map, and the `events`-driven SFX subscriptions.
