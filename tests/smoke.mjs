// Node smoke test for the pure (browser-free) slice logic.
// Run: node tests/smoke.mjs
import { generate, isWalkable, TILE } from "../src/run/levelgen.js";
import { moveAndCollide } from "../src/run/collision.js";

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

// Collision: a box may not move into a wall, and may move through open space.
const lvl = { w: 3, h: 1, tileSize: 24, walkable: Uint8Array.from([1, 0, 1]) };
const box = { x: 4, y: 4, w: 8, h: 8 };
moveAndCollide(lvl, box, 20, 0); // would cross into the wall tile (x 24..47)
ok(box.x < 24, `collision blocks entry into wall (x=${box.x})`);
const box2 = { x: 4, y: 4, w: 8, h: 8 };
moveAndCollide(lvl, box2, 6, 0); // stays within open tile 0
ok(box2.x === 10, `collision allows free movement (x=${box2.x})`);

console.log(failures === 0
  ? `PASS — 200 maps generated, all connected; min walkable ratio ${walkRatioMin.toFixed(2)}`
  : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
