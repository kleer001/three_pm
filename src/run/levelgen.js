// Suburb generator (vertical-slice subset of docs/02-world-structure.md):
// jittered street grid -> houses -> decay pass -> connectivity repair -> home band.
// Emits geometry only; entities are spawned elsewhere.
import { makeRng, subSeed } from "../core/rng.js";
import { LEVELGEN } from "./balance.js";

export const TILE = {
  STREET: 0,
  SIDEWALK: 1,
  YARD: 2,
  ALLEY: 3,
  FLOOR: 4,
  WALL: 5,
  RUBBLE: 6,
};
const WALKABLE = new Set([TILE.STREET, TILE.SIDEWALK, TILE.YARD, TILE.ALLEY, TILE.FLOOR]);

const idx = (w, x, y) => y * w + x;
const inBounds = (w, h, x, y) => x >= 0 && y >= 0 && x < w && y < h;

// bearing (radians, 0 = +x/east, CCW) -> which edge is "home".
function homeEdge(bearing) {
  const a = ((bearing % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (a < Math.PI / 4 || a >= (7 * Math.PI) / 4) return "E";
  if (a < (3 * Math.PI) / 4) return "N";
  if (a < (5 * Math.PI) / 4) return "W";
  return "S";
}

export function generate(seed, {
  w = 48, h = 48, bearing = 0, tileSize = 24,
  // Obstacle ("brown wall feature") knobs:
  //  wallScaleX/Y stretch feature shapes (1 = baseline; 2 = features 2x wider/taller,
  //  0.5 = 2x smaller) while preserving coverage.
  //  wallDensity scales how much obstacle there is overall (1 = baseline).
  wallScaleX = 1, wallScaleY = 1, wallDensity = 1,
} = {}) {
  const rng = makeRng(subSeed(seed, "gen"));
  const tiles = new Uint8Array(w * h).fill(TILE.YARD);

  // 1. Jittered street grid (period ~10, width 2) + sidewalk borders.
  const period = LEVELGEN.streetPeriod;
  const carveStreet = (cells) => {
    for (const [x, y] of cells) {
      if (!inBounds(w, h, x, y)) continue;
      tiles[idx(w, x, y)] = TILE.STREET;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (inBounds(w, h, nx, ny) && tiles[idx(w, nx, ny)] === TILE.YARD)
          tiles[idx(w, nx, ny)] = TILE.SIDEWALK;
      }
    }
  };
  for (let gx = period; gx < w - 2; gx += period) {
    const jx = gx + rng.range(-LEVELGEN.streetJitter, LEVELGEN.streetJitter);
    const cells = [];
    for (let y = 0; y < h; y++) cells.push([jx, y], [jx + 1, y]);
    carveStreet(cells);
  }
  for (let gy = period; gy < h - 2; gy += period) {
    const jy = gy + rng.range(-LEVELGEN.streetJitter, LEVELGEN.streetJitter);
    const cells = [];
    for (let x = 0; x < w; x++) cells.push([x, jy], [x, jy + 1]);
    carveStreet(cells);
  }

  // 2. Houses: drop footprints onto yard blocks, walls with one door gap.
  const { houseMargin: hm, houseSize: hs } = LEVELGEN;
  for (let y = hm; y < h - hs.max; y += 1) {
    for (let x = hm; x < w - hs.max; x += 1) {
      if (!rng.chance(LEVELGEN.houseChanceBase * wallDensity)) continue;
      const hw = rng.range(hs.min, hs.max), hh = rng.range(hs.min, hs.max);
      let clear = true;
      for (let yy = y - 1; yy <= y + hh && clear; yy++)
        for (let xx = x - 1; xx <= x + hw; xx++)
          if (!inBounds(w, h, xx, yy) || tiles[idx(w, xx, yy)] !== TILE.YARD) clear = false;
      if (!clear) continue;
      for (let yy = y; yy < y + hh; yy++)
        for (let xx = x; xx < x + hw; xx++) {
          const edge = xx === x || xx === x + hw - 1 || yy === y || yy === y + hh - 1;
          tiles[idx(w, xx, yy)] = edge ? TILE.WALL : TILE.FLOOR;
        }
      tiles[idx(w, x + (hw >> 1), y + hh - 1)] = TILE.FLOOR; // door gap
    }
  }

  // 3. Decay pass -> coherent rubble fields, with two independent knobs.
  //    Smoothed noise on a grid scaled by 1/wallScale (so features stretch
  //    anisotropically when upsampled), then thresholded at the wallDensity
  //    quantile so obstacle coverage is exactly proportional to density.
  const sw = Math.max(1, Math.round(w / wallScaleX));
  const sh = Math.max(1, Math.round(h / wallScaleY));
  const N = sw * sh;
  let field = new Float32Array(N);
  for (let i = 0; i < N; i++) field[i] = rng.next();
  for (let pass = 0; pass < LEVELGEN.decayPasses; pass++) { // box-blur into coherent blobs
    const nf = new Float32Array(N);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        let s = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < sw && ny < sh) { s += field[ny * sw + nx]; c++; }
          }
        nf[y * sw + x] = s / c;
      }
    field = nf;
  }
  const cover = Math.min(LEVELGEN.coverCap, Math.max(0, LEVELGEN.coverBase * wallDensity)); // baseline 42% at density 1
  const sorted = Float32Array.from(field).sort();
  const thr = sorted[Math.min(N - 1, Math.floor((1 - cover) * N))];
  for (let y = 0; y < h; y++) // upsample (nearest) + apply over decayable tiles
    for (let x = 0; x < w; x++) {
      const sx2 = Math.min(sw - 1, Math.floor((x * sw) / w));
      const sy2 = Math.min(sh - 1, Math.floor((y * sh) / h));
      if (field[sy2 * sw + sx2] <= thr) continue;
      const ti = idx(w, x, y);
      if (WALKABLE.has(tiles[ti]) && tiles[ti] !== TILE.FLOOR) tiles[ti] = TILE.RUBBLE;
    }

  // 4. Bearing -> home band (far edge strip) and start (opposite edge center).
  const edge = homeEdge(bearing);
  const homeBand = [];
  const setHome = (x, y) => {
    tiles[idx(w, x, y)] = TILE.STREET;
    homeBand.push([x, y]);
  };
  if (edge === "E") for (let y = 0; y < h; y++) setHome(w - 1, y);
  else if (edge === "W") for (let y = 0; y < h; y++) setHome(0, y);
  else if (edge === "N") for (let x = 0; x < w; x++) setHome(x, 0);
  else for (let x = 0; x < w; x++) setHome(x, h - 1);
  const start =
    edge === "E" ? { x: 1, y: h >> 1 }
    : edge === "W" ? { x: w - 2, y: h >> 1 }
    : edge === "N" ? { x: w >> 1, y: h - 2 }
    : { x: w >> 1, y: 1 };
  tiles[idx(w, start.x, start.y)] = TILE.STREET;

  // Guaranteed clear approach: a 3-wide walkable lane running forward (toward
  // home) from the start, so the player isn't immediately forced into a wall.
  const fwd = edge === "S" ? [0, 1] : edge === "N" ? [0, -1] : edge === "E" ? [1, 0] : [-1, 0];
  for (let i = 0; i <= LEVELGEN.clearLaneLen; i++) {
    const lx = start.x + fwd[0] * i, ly = start.y + fwd[1] * i;
    for (let s = -LEVELGEN.clearLaneHalfWidth; s <= LEVELGEN.clearLaneHalfWidth; s++) {
      const xx = lx + (fwd[0] ? 0 : s), yy = ly + (fwd[1] ? 0 : s);
      if (inBounds(w, h, xx, yy)) tiles[idx(w, xx, yy)] = TILE.STREET;
    }
  }

  // 5. Connectivity repair: BFS from start over walkable; if no home-band tile
  // is reached, carve a straight corridor toward the home edge. One guarantee,
  // no fallback path.
  const walkable = new Uint8Array(w * h);
  for (let i = 0; i < tiles.length; i++) walkable[i] = WALKABLE.has(tiles[i]) ? 1 : 0;
  if (!reaches(w, h, walkable, start, homeBand)) {
    let { x, y } = start;
    const step = edge === "E" ? [1, 0] : edge === "W" ? [-1, 0] : edge === "N" ? [0, -1] : [0, 1];
    while (inBounds(w, h, x, y)) {
      tiles[idx(w, x, y)] = TILE.STREET;
      walkable[idx(w, x, y)] = 1;
      x += step[0];
      y += step[1];
    }
  }

  return { w, h, tileSize, tiles, walkable, bearing, start, homeBand, homeEdge: edge, regions: [] };
}

function reaches(w, h, walkable, start, homeBand) {
  const home = new Set(homeBand.map(([x, y]) => idx(w, x, y)));
  const seen = new Uint8Array(w * h);
  const q = [start];
  seen[idx(w, start.x, start.y)] = 1;
  while (q.length) {
    const { x, y } = q.pop();
    if (home.has(idx(w, x, y))) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(w, h, nx, ny) && walkable[idx(w, nx, ny)] && !seen[idx(w, nx, ny)]) {
        seen[idx(w, nx, ny)] = 1;
        q.push({ x: nx, y: ny });
      }
    }
  }
  return false;
}

export const isWalkable = (level, x, y) =>
  inBounds(level.w, level.h, x, y) && level.walkable[idx(level.w, x, y)] === 1;
