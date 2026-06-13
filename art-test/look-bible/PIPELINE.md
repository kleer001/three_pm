# 3pm look & resolution pipeline

The locked house look is **Milton-Glaser flat-color shapes, chunked down to a
pixel grid**. Color comes from the flat-shape generator; chunk comes from a
post downscale. The game must then render at that same pixel grid so sprites,
tiles, and motion all share one resolution.

## Asset generation (the look)

1. **Generate flat-color art** — Flux.1-dev + `MiltonGlaser-Flux` LoRA
   (`tools/gen_lookbible.py`, style `milton_glaser`). Bold flat saturated shapes,
   limited palette, plain backgrounds.
   - Do **not** stack a pixel-art LoRA on the generator — it overrides the flat
     coloring with rendered shading/mud. Keep the gen flat; pixelate in post.
2. **Downscale to the pixel grid** — nearest-neighbour both ways so the flats stay
   crisp and the palette is untouched:
   ```
   convert in.png -filter point -resize <100/N>% -resize <N*100>% out.png
   ```
   `N` = downscale factor. A crisper alternative for hard pixel edges is the
   **k-centroid** downscale in `image_gen/scripts/flux2_spritesheet_test.py`
   (`kcentroid_downscale`) — per output pixel, quantize the source tile and keep
   the dominant color; use it when nearest-neighbour aliases too much.
3. **Chunk levels** (source gens are 832×1216 chars, 1216×832 environments):
   - **Characters / enemies: 1/16** — reads as clean 16-bit sprite work.
   - **Environments: start 1/8**, likely a different filter (a busy scene aliases
     at 1/16); tune per the pixel-size invariant below, not by ratio.

## The pixel-size invariant (in-engine)

The chunk **ratio** (1/8, 1/16) is per-source-image and is *not* the thing to keep
constant. What must be constant is the **on-screen pixel size** — one "game pixel"
is the same number of screen pixels everywhere. A character (downscaled from an
832px gen) and a background (downscaled from a larger gen) must land on that same
final pixel size, so they use *different* source ratios to reach the *same* grid.

To enforce it the game renders to a **low-resolution offscreen buffer** at the
native game-pixel scale, then upscales the whole frame **nearest-neighbour** to the
display. Consequences, all desired:

- Sprites, tiles, and FX share one pixel grid — no low-res sprite sliding over a
  high-res background.
- Motion is quantized to the grid — no sub-pixel "high-res" gliding; movement
  steps in whole game-pixels.
- The camera/scroll (docs/09) snaps to the grid for the same reason.

A looser alternative is to snap every entity's draw position to the game-pixel grid
without a low-res buffer; the offscreen-buffer approach is preferred because it
quantizes everything (FX, camera, scroll) for free.

**Status:** the slice renders procedurally at full canvas resolution. Adopting this
means adding a low-res render target + integer nearest-neighbour upscale to the
renderer (docs/09 presentation) — noted here, not yet built.

## Animation / character sheets

Identity-locked sheets run on the isolated FLUX.2 Klein instance
(`image_gen` `:8189`, started via `imggen`'s flux2 path / `comfyui_flux2`):

- **Turnaround** — `scripts/flux2_character_sheet.py "<desc>"` or with a `--ref`
  image: front → side-profile → back → face close-up, identity locked.
- **Walk cycle** — `scripts/flux2_spritesheet_test.py --ref <char>.png`: a 4×4 walk
  spritesheet from one character image, auto-sliced to frames. Needs the
  `pixel_4walk_small_flux2_klein_base_4b_v1` LoRA installed.

Flow: generate the hero in `milton_glaser` flat color → feed that image as `--ref`
to the turnaround / walk-sheet → chunk-downscale every output frame (step 2) so the
animation lives on the same pixel grid as everything else.
