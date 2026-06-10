// Node smoke test for the pure (browser-free) slice logic.
// Run: node tests/smoke.mjs
import { generate, isWalkable, TILE } from "../src/run/levelgen.js";
import { moveAndCollide, boxBlocked } from "../src/run/collision.js";
import { findPath, localWalkableTile } from "../src/ai/ai.js";
import { makeRng } from "../src/core/rng.js";

let failures = 0;
const ok = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); failures++; }
};

function reachable(level) {
  const { w, h, start, homeBand } = level;
  const id = (x, y) => y * w + x;
  const home = new Set(homeBand.map(([x, y]) => id(x, y)));
  const seen = new Set([id(start.x, start.y)]);
  const q = [start];
  while (q.length) {
    const { x, y } = q.pop();
    if (home.has(id(x, y))) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (isWalkable(level, nx, ny) && !seen.has(id(nx, ny))) {
        seen.add(id(nx, ny));
        q.push({ x: nx, y: ny });
      }
    }
  }
  return false;
}

// Generation + connectivity across many seeds and bearings.
let walkRatioMin = 1;
for (let seed = 1; seed <= 200; seed++) {
  const bearing = (seed / 200) * Math.PI * 2;
  const level = generate(seed, { w: 48, h: 48, bearing });
  ok(level.w === 48 && level.h === 48, `seed ${seed}: dimensions`);
  ok(isWalkable(level, level.start.x, level.start.y), `seed ${seed}: start walkable`);
  ok(level.homeBand.length > 0, `seed ${seed}: home band non-empty`);
  ok(reachable(level), `seed ${seed}: start reaches home band`);
  const walk = level.walkable.reduce((a, v) => a + v, 0) / level.walkable.length;
  walkRatioMin = Math.min(walkRatioMin, walk);
}

// Determinism: same seed -> identical tiles.
const a = generate(42, { bearing: 1 }), b = generate(42, { bearing: 1 });
ok(a.tiles.every((v, i) => v === b.tiles[i]), "same seed reproduces map");

// AI: BFS path from start to a home-band tile is contiguous and walkable.
{
  const level = generate(9, { w: 48, h: 48, bearing: (3 * Math.PI) / 2 });
  const [hx, hy] = level.homeBand[level.homeBand.length >> 1];
  const path = findPath(level, level.start.x, level.start.y, hx, hy);
  ok(path && path.length > 0, "findPath returns a path to home");
  if (path) {
    let prev = [level.start.x, level.start.y], contiguous = true, allWalk = true;
    for (const [x, y] of path) {
      if (Math.abs(x - prev[0]) + Math.abs(y - prev[1]) !== 1) contiguous = false;
      if (!isWalkable(level, x, y)) allWalk = false;
      prev = [x, y];
    }
    ok(contiguous, "path steps are 4-connected");
    ok(allWalk, "path tiles are all walkable");
    ok(prev[0] === hx && prev[1] === hy, "path ends at the target");
  }
  ok(findPath(level, 5, 5, 5, 5).length === 0, "findPath same-tile returns empty");
}

// Clear start approach: the first 6 tiles forward (south) from start are walkable.
for (let seed = 1; seed <= 50; seed++) {
  const level = generate(seed, { w: 48, h: 64, bearing: (3 * Math.PI) / 2 });
  let clear = true;
  for (let i = 0; i <= 6; i++) if (!isWalkable(level, level.start.x, level.start.y + i)) clear = false;
  ok(clear, `seed ${seed}: 6-tile forward lane is clear`);
}

// localWalkableTile stays within radius and returns a walkable tile.
{
  const level = generate(3, { w: 48, h: 64, bearing: (3 * Math.PI) / 2 });
  const rng = makeRng(123);
  const [sx, sy] = [level.start.x, level.start.y + 3];
  const [lx, ly] = localWalkableTile(level, rng, sx, sy, 10);
  ok(isWalkable(level, lx, ly), "localWalkableTile returns walkable");
  ok(Math.abs(lx - sx) <= 10 && Math.abs(ly - sy) <= 10, "localWalkableTile within radius");
}

// Collision: box (x,y) is its CENTER (must match how entities are drawn).
const lvl = { w: 3, h: 1, tileSize: 24, walkable: Uint8Array.from([1, 0, 1]) };
const box = { x: 12, y: 12, w: 8, h: 8 };
moveAndCollide(lvl, box, 20, 0); // would push the center into the wall tile (24..47)
ok(box.x < 24, `collision blocks entry into wall (x=${box.x})`);
const box2 = { x: 12, y: 12, w: 8, h: 8 };
moveAndCollide(lvl, box2, 6, 0); // stays within open tile 0
ok(box2.x === 18, `collision allows free movement (x=${box2.x})`);

// Regression: a box centered on a walkable tile is NOT blocked, even with a wall
// adjacent — collision must sample symmetrically around the center, not offset.
ok(!boxBlocked(lvl, { x: 12, y: 12, w: 20, h: 20 }), "centered on walkable tile: clear");
ok(boxBlocked(lvl, { x: 36, y: 12, w: 20, h: 20 }), "centered on wall tile: blocked");
ok(boxBlocked(lvl, { x: 12, y: 12, w: 34, h: 20 }), "box overlapping into wall: blocked");

console.log(failures === 0
  ? `PASS — 200 maps generated, all connected; min walkable ratio ${walkRatioMin.toFixed(2)}`
  : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
