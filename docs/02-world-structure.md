# Spec 02 — World / level structure

One day = one fixed-size, top-down **suburban** map. The hero starts at the
**north** edge and wins by reaching **home**, the fixed band along the
**south** edge. A camera window auto-scrolls south at a slow fixed rate and
holds the hero inside it; the advancing top edge forces continuous descent.

## Decisions in force
- **Single large map**, fixed dimensions; the camera window auto-scrolls south
  and clamps to the map bottom.
- Layout is **suburbia**: street grid, sidewalks, houses, yards, alleys —
  ruined by a post-apocalypse decay pass.
- **Win = touch the south home band** (forced southward descent).
- Home is always downhill (south); there is no compass bearing.
- Generation is a pluggable module behind `run/levelgen.js`:
  `generate(seed, params) -> Level`.

## Tile model
Grid of `W × H` tiles (fixed), tile size in px. Each tile has a `type` and a
derived `walkable` flag.

| Type | Walkable | Role |
|---|---|---|
| street | yes | main movement corridors |
| sidewalk | yes | lines streets; safe-ish edges |
| yard | yes | open lots around houses |
| alley | yes | narrow mid-block shortcuts |
| floor | yes | house interior (cover, loot) |
| wall | no | house/structure walls; have door gaps |
| rubble | no | decay obstruction (collapsed structure) |
| void | no | hard map boundary |

## Generation pipeline (the "suburbia" generator)
Cellular automata is the **decay pass**, not the carver. Order:

1. **Road grid** — lay major + minor streets on a *jittered* grid so block
   sizes vary. Streets + bordering sidewalks are the connective tissue.
2. **Blocks** — each region bounded by streets is a block. Subdivide into lots.
3. **Houses** — place a rectangular footprint per lot: `wall` ring with a door
   gap, `floor` interior, surrounding `yard`. An `alley` runs behind the lot row.
4. **Decay pass (CA)** — seed a random damage mask, run a few smoothing
   iterations to grow coherent `rubble` fields and craters; also *breach* some
   walls (wall→floor) so ruins are porous. This is the hellscape texture.
5. **Connectivity guarantee** — flood-fill from start. If decay severed the
   route to the south edge, clear the minimal `rubble` to reconnect. The map
   is always solvable; no fallback path, the repair is the contract.
6. **Home band** — the strip along the south edge is the win zone.
7. **Start** — placed at the north edge, so the run crosses the map.

## Level object (generator output)
```
Level {
  w, h, tileSize,
  tiles: Uint8Array,          // type per tile
  walkable: Uint8Array,       // derived
  start: {x, y},              // north edge
  homeBand: {edge, range},    // win region; edge is always south
  regions: [...],             // tagged areas for later spawn/loot placement
}
```
`regions` is metadata only here; the director/content specs consume it. Levelgen
produces geometry, never entities.

## Camera
A window that auto-scrolls south at a slow fixed rate, its top edge advancing to
force descent. No vertical follow; the window clamps to the map bottom. Camera X
follows the hero, clamped to `[0, w*tileSize - viewport]`. The hero is clamped
inside the moving window. Render spec owns the draw; this spec only fixes the
scroll model and that the map exceeds the viewport.

## RNG usage
All gen draws come from the `gen` sub-stream of the run seed (spec 01), so the
same day reproduces the same neighborhood.

## Interfaces this spec freezes
- `generate(seed, params) -> Level`
- `Level` shape above; `tiles` type enum; `walkable` derivation
- Win check: player tile ∈ `homeBand` (south edge band)
- Coordinate convention: tile (col,row); world px = tile * tileSize
