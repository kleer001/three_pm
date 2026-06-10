// Suburb generator (vertical-slice subset of docs/02-world-structure.md):
// jittered street grid -> houses -> decay pass -> connectivity repair -> home band.
// Emits geometry only; entities are spawned elsewhere.
import { makeRng, subSeed } from "../core/rng.js";

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

export function generate(seed, { w = 48, h = 48, bearing = 0 } = {}) {
  const rng = makeRng(subSeed(seed, "gen"));
  const tiles = new Uint8Array(w * h).fill(TILE.YARD);

  // 1. Jittered street grid (period ~10, width 2) + sidewalk borders.
  const period = 10;
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
    const jx = gx + rng.range(-2, 2);
    const cells = [];
    for (let y = 0; y < h; y++) cells.push([jx, y], [jx + 1, y]);
    carveStreet(cells);
  }
  for (let gy = period; gy < h - 2; gy += period) {
    const jy = gy + rng.range(-2, 2);
    const cells = [];
    for (let x = 0; x < w; x++) cells.push([x, jy], [x, jy + 1]);
    carveStreet(cells);
  }

  // 2. Houses: drop footprints onto yard blocks, walls with one door gap.
  for (let y = 2; y < h - 6; y += 1) {
    for (let x = 2; x < w - 6; x += 1) {
      if (!rng.chance(0.012)) continue;
      const hw = rng.range(4, 6), hh = rng.range(4, 6);
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

  // 3. Decay pass (cellular automata) -> coherent rubble fields.
  let damage = new Uint8Array(w * h);
  for (let i = 0; i < damage.length; i++)
    if (WALKABLE.has(tiles[i]) && tiles[i] !== TILE.FLOOR) damage[i] = rng.chance(0.42) ? 1 : 0;
  for (let pass = 0; pass < 3; pass++) {
    const nxt = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            if (inBounds(w, h, x + dx, y + dy) && damage[idx(w, x + dx, y + dy)]) n++;
          }
        nxt[idx(w, x, y)] = n >= 5 ? 1 : n <= 2 ? 0 : damage[idx(w, x, y)];
      }
    damage = nxt;
  }
  for (let i = 0; i < tiles.length; i++)
    if (damage[i] && WALKABLE.has(tiles[i]) && tiles[i] !== TILE.FLOOR) tiles[i] = TILE.RUBBLE;

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

  return { w, h, tileSize: 24, tiles, walkable, bearing, start, homeBand, homeEdge: edge, regions: [] };
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
