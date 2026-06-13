# BIOME_FX — rendering spec for biome screen-effects

Implementation companion to **`docs/19-biomes.md`**. Spec 19 names each biome's
*dominant FX* in design terms; this doc is the **programmer's contract**: the
render primitives those FX decompose into, where they hook into the spec 09
pipeline, what's a render job vs. a sim job, and how each scales with the descent.

Scope: the per-biome atmosphere effects only. It adds no game logic and changes no
frozen interface (spec 09 render contract, spec 03 sprite, spec 02 camera). All FX
are **read-only over sim state** (spec 09): they draw, they never mutate — except
the two gameplay-coupled cases (§5), which are explicitly sim + render.

## 1. Where FX live in the pipeline

Spec 09 draws four layers back-to-front: (1) tiles, (2) entities y-sorted,
(3) projectiles/particles, (4) HUD. Biome FX add **Layer 3.5 — atmosphere**,
between projectiles and HUD:

```
1 tiles → 2 entities → 3 projectiles/FX → 3.5 ATMOSPHERE → 4 HUD
```

Two coordinate spaces, and a primitive must declare which it uses:
- **World-space** (drawn inside the camera transform, offset by `-cam.x/-cam.y`):
  effects pinned to map geometry — streetlight pools, fissures, ghost-cars, the
  neon-glow re-pass. Subject to the spec 09 cull range.
- **Screen-space** (drawn after camera, full viewport `VIEW_W×VIEW_H`): full-frame
  tints, vignettes, rain/ash/bug overlays, warp, camera-shake offset.

Implementation surface: `src/run/runScene.js render()` already uses
`ctx.fillRect`, `drawImage`, `globalAlpha`, `globalCompositeOperation`. The
atmosphere pass is one new block before the HUD draw, dispatching on the active
biome's FX config.

## 2. The descent-ramp contract

Every FX intensity is a pure function of `f` — the director's distance fraction
(0 = north start, 1 = south home band, spec 06). No FX reads wall-clock time for
its *strength*; only for animation phase. Each effect declares `lo` (params at
`f=0`) and `hi` (params at `f=1`); the renderer lerps by `f` each frame:

```
p = lerp(lo, hi, f)            // f from director; reused, not recomputed
```

This is what makes "it gets worse as you descend" uniform and tunable. All
numbers live in a config block (§6), never inline.

## 3. Render primitives (the toolbox)

Each biome FX is built from these. Cost is the rough canvas-2D budget.

| ID | Primitive | Technique (canvas 2D) | Space | Cost |
|---|---|---|---|---|
| **P1** | **Tint / darkness overlay** | one `fillRect` over the viewport, `rgba` color + alpha lerped by `f` | screen | trivial |
| **P2** | **Brightness pulse / flicker** | extra overlay whose alpha is driven by a **noise/`Math.random` gate** (never a beat); brief lighten or darken | screen | trivial |
| **P3** | **Radial mask** (spotlight / vignette / fog-of-war) | radial `createRadialGradient`; cut light-holes with `globalCompositeOperation='destination-out'`, or restrict sight with a dark ring around a clear center | screen (fog) / world (light pools) | low |
| **P4** | **Particle overlay** (fall / drift) | fixed pool of small rects/sprites advected by a velocity (gravity = rain/snow/ash; drift = bugs/fog); wrap at viewport edges | screen | low–med (pool-capped) |
| **P5** | **Additive glow re-pass** | re-draw sprites flagged `glow` with `globalCompositeOperation='lighter'` (optionally a blurred copy underneath) so they pop through a dark tint | world | med |
| **P6** | **Camera shake** | add a transient `(dx,dy)` to `cam` for the frame; decays over the shake window; render-only, sim camera untouched | screen | trivial |
| **P7** | **Warp / blurry edges** | cheap path: a rippling edge **vignette** (animated alpha gradient hugging the frame) + a translucent hue layer; expensive path: per-scanline horizontal offset re-blit of the framebuffer with a `sin` displacement. Default to cheap. | screen | low (cheap) / high (true warp) |
| **P8** | **Hue shift** | translucent single-color `fillRect` (often folded into P1) to push the palette — sickly green, ash orange, emergency red | screen | trivial |
| **P9** | **Tile/palette look** | *not an FX pass* — per-biome tile frames/palette (snow, waterlogged, ash ground). Asset + layer-1 concern; listed so it isn't mistaken for an overlay. | (tiles) | none |

## 4. Per-biome FX → primitives

All ramped by `f` (§2).

| # | Biome | FX | Primitives | Notes |
|---|---|---|---|---|
| 01 | Suburbia After Dark | the light dying | **P1** (black, alpha↑`f`) + **P3** (streetlight pools, world-space holes) | enemies dim outside pools (per-sprite alpha by distance to nearest light tile) |
| 02 | Rave-Gone-Wrong | blacklight | **P1** (near-black) + **P5** (neon glow) + **P2** (strobe — non-rhythmic flicker) | only `glow`-flagged sprites (enemies, drops) read through the dark |
| 03 | Freak Winter | ice-slick | **P9** (snow tiles) + **P4** (snow drift, optional) | the slide itself is **sim**, see §5 |
| 04 | Brushfire / Santa Ana | wind | **P8/P1** (orange) + **P4** (ash/embers advected along wind dir) | particles read the same wind vector the sim uses (§5) |
| 05 | Flood / El Niño | downpour | **P4** (rain streaks) + **P9** (waterlogged tiles) | cosmetic only — no reactive water, no sim effect |
| 06 | Earthquake | aftershocks | **P6** (pulsed shake) + **P4** (dust haze) + fissures (§5) | shake pulses gated by `f`; fissures are sim + render |
| 07 | Innsmouth-on-Sea | fog + warp | **P3** (fog sight-radius) + **P1** (gray beyond) + **P7** (warp/blurry edges) + **P8** (sickly green) | radius shrinks with `f`; use P7 cheap path |
| 08 | Dead Mall | power surges | **P1/P8** (emergency-red brownout) + **P2** (surge brightness pulses + sign/spark flicker) | |
| 09 | Backyard / Block Party | bug haze | **P4** (drifting bug-cloud patches that occlude) | patches are denser clumps, not uniform fall |
| 10 | Freeway / The 405 | cross-traffic | ghost-cars (§5) + **P5** (headlight-flare telegraph) | cars are hazard entities, not a full-screen overlay |

## 5. Not-pure-render FX (flag for programmers)

Don't hunt for a shader for these — they live in sim/collision, with render as a
secondary tell:

- **Ice-slick (03)** — a friction term in the movement integrator (spec 03);
  hero + enemies carry momentum. Render side is only P9 tile look.
- **Santa Ana wind (04)** — a wind vector added in the movement integrator for
  hero, enemies, **and projectiles**. Render side is the P4 ash blowing the same
  direction (share the vector).
- **Fissures (06)** — *sim + render*: cracks temporarily flip walkable tiles to
  hazard/non-walkable (spec 02 grid), telegraphed by P6 rumble + a crack-open
  sprite, then close. Collision change is sim; the crack art is render.
- **Cross-traffic (10)** — *sim + render*: ghost-cars are transient hazard
  entities that sweep lanes on a spawn pattern (director-adjacent), telegraphed by
  a P5 headlight glow before each pass. They draw through the normal entity/
  projectile layers, not the atmosphere pass.

## 6. Config shape

One declarative block per biome (lives next to the balance knobs, e.g.
`src/run/balance.js`), consumed by the atmosphere pass. Effects are data; the
renderer is a fixed dispatcher over primitive ids.

```
biomeFX = {
  "<biomeId>": {
    tint?:    { color, lo, hi },                 // P1/P8 alpha lerp
    pulse?:   { color, rate, lo, hi },           // P2 flicker gate (rate = noise freq, NOT a beat)
    mask?:    { kind: "lightPools"|"sightRadius", lo, hi },  // P3
    particles?: { kind: "rain"|"snow"|"ash"|"bugs", count, vel, lo, hi },  // P4
    glow?:    true,                              // P5 enable neon re-pass
    shake?:   { lo, hi },                        // P6 magnitude
    warp?:    { mode: "cheap"|"scanline", lo, hi },  // P7
  }
}
```

`lo`/`hi` are the `f=0` / `f=1` endpoints the renderer lerps each frame (§2). A
biome lists only the keys it uses; sim-side effects (ice, wind, fissures,
traffic) are **not** in this block — they're owned by the integrator / hazard
systems and are cross-referenced in §5.

## 7. Perf & ordering notes

- Cap every particle pool (P4) to a fixed count; advect and wrap, never allocate
  per-frame.
- P1/P2/P8 are single `fillRect`s — effectively free; stack them in one pass.
- P5 (glow) and P7-scanline are the only real costs. Prefer P7's cheap path; gate
  the glow re-pass to on-screen `glow` sprites (reuse the spec 09 cull).
- Camera shake (P6) offsets the **render** camera for the frame only; the sim
  camera (spec 02 auto-scroll) is never touched, so determinism holds.
- The whole atmosphere pass must remain skippable: if a biome has no FX config,
  draw nothing and fall through to the HUD. Art/FX stay droppable (CLAUDE.md).
