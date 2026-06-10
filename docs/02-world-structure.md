# Spec 02 — World / level structure

One day = one fixed-size, top-down **suburban** map. The hero starts at one edge
and wins by reaching the map edge in the smart-watch's compass bearing.

## Decisions in force
- **Single large map**, fixed dimensions, camera scrolls and clamps to bounds.
- Layout is **suburbia**: street grid, sidewalks, houses, yards, alleys —
  ruined by a post-apocalypse decay pass.
- **Win = touch the edge band in the bearing direction** (pure navigation goal).
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
   route to the bearing edge, clear the minimal `rubble` to reconnect. The map
   is always solvable; no fallback path, the repair is the contract.
6. **Home band** — the strip of the bearing-direction edge is the win zone.
7. **Start** — placed at the edge opposite the bearing, so the run crosses the
   map.

## Level object (generator output)
```
Level {
  w, h, tileSize,
  tiles: Uint8Array,          // type per tile
  walkable: Uint8Array,       // derived
  bearing,                    // from run seed (spec 01)
  start: {x, y},
  homeBand: {edge, range},    // win region
  regions: [...],             // tagged areas for later spawn/loot placement
}
```
`regions` is metadata only here; the director/content specs consume it. Levelgen
produces geometry, never entities.

## Camera
Follows the player, clamped to `[0, w*tileSize - viewport]`. Render spec owns the
draw; this spec only fixes that the map exceeds the viewport and scrolls.

## RNG usage
All gen draws come from the `gen` sub-stream of the run seed (spec 01), so the
same day reproduces the same neighborhood. The `compass` sub-stream fixes the
bearing before gen runs (home placement depends on it).

## Interfaces this spec freezes
- `generate(seed, params) -> Level`
- `Level` shape above; `tiles` type enum; `walkable` derivation
- Win check: player tile ∈ `homeBand`
- Coordinate convention: tile (col,row); world px = tile * tileSize
