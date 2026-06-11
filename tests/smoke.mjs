// Node smoke test for the pure (browser-free) slice logic.
// Run: node tests/smoke.mjs
import { generate, isWalkable, TILE } from "../src/run/levelgen.js";
import { moveAndCollide, boxBlocked } from "../src/run/collision.js";
import { findPath, localWalkableTile } from "../src/ai/ai.js";
import { makeRng } from "../src/core/rng.js";
import { distanceFraction, budget, eligible, makeDirector } from "../src/run/director.js";
import { BALANCE } from "../src/run/balance.js";

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

// Wall-density knob scales obstacle coverage roughly linearly (no percolation collapse).
{
  const obst = (d) => {
    let o = 0;
    for (let s = 1; s <= 15; s++) {
      const l = generate(s, { w: 48, h: 96, bearing: (3 * Math.PI) / 2, wallDensity: d });
      o += l.walkable.reduce((a, v) => a + (v === 0 ? 1 : 0), 0);
    }
    return o / 15;
  };
  const half = obst(0.5), full = obst(1.0);
  ok(half < full * 0.7 && half > full * 0.3, `density 0.5 ~= half of 1.0 obstacles (${half | 0} vs ${full | 0})`);
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

// Director: depth-scaled budget, distanceBand eligibility, and a spawn run.
{
  const cfg = BALANCE.director;
  ok(budget(1, cfg) > budget(0, cfg), "budget rises with distance");
  ok(budget(0, cfg) === cfg.baseThreat, "budget at the start is baseThreat");

  const defs = Object.values(BALANCE.enemies);
  ok(eligible(defs, 0).every((d) => d.distanceBand === 0), "f=0 unlocks only band-0 defs");
  ok(eligible(defs, 0).length >= 1, "at least one def spawns from the start");
  ok(eligible(defs, 1).length === defs.length, "f=1 unlocks the full roster");

  const ts = 96;
  const level = generate(7, { w: 48, h: 192, bearing: (3 * Math.PI) / 2, tileSize: ts });
  ok(distanceFraction({ y: -1e9 }, level, ts) === 0, "distanceFraction clamps below 0");
  ok(distanceFraction({ y: 1e9 }, level, ts) === 1, "distanceFraction clamps above 1");

  const cam = { x: 0, y: 0 }, viewH = 600;
  const hero = { x: level.start.x * ts + ts / 2, y: level.start.y * ts + ts / 2 };
  const enemies = [];
  const spawnEnemy = (def, tx, ty) => enemies.push({ def, tx, ty, dead: false });
  const dir = makeDirector({ level, rng: makeRng(7), defs, cam, viewH, cfg, ts });

  dir.update(cfg.tickInterval, hero, enemies, spawnEnemy); // one tick at f≈0
  ok(enemies.length > 0, "director spawns under budget at the start");
  ok(enemies.length <= cfg.maxLive, "director respects maxLive");
  ok(enemies.every((e) => e.def.distanceBand <= 0), "start spawns are band-0 eligible");
  ok(enemies.every((e) => isWalkable(level, e.tx, e.ty)), "spawn tiles are walkable");
  const bandTop = Math.floor((cam.y + viewH) / ts);
  ok(enemies.every((e) => e.ty >= bandTop), "spawns land in the off-screen south band");
  ok(enemies.reduce((a, e) => a + e.def.threatValue, 0) <= budget(0, cfg), "spend stays within budget");

  const before = enemies.length;
  dir.update(cfg.tickInterval, hero, enemies, spawnEnemy);
  ok(enemies.length === before, "no spawns while live threat already meets budget");
}

// Roster stat invariants: every enemy has a real HP pool; casters (and only
// casters) carry mana, sized so a full pool affords at least one cast.
for (const [id, d] of Object.entries(BALANCE.enemies)) {
  ok(d.maxHp > 0, `${id}: has maxHp`);
  ok(d.freezesToKill >= 1, `${id}: freezesToKill >= 1`);
  const casts = d.behavior === "shooter";
  ok(casts === (d.maxMana !== undefined), `${id}: mana pool iff it casts`);
  if (casts) {
    ok(d.maxMana >= d.manaCost, `${id}: pool affords a cast`);
    ok(d.manaRegen > 0, `${id}: mana regenerates`);
  }
}

console.log(failures === 0
  ? `PASS — 200 maps generated, all connected; min walkable ratio ${walkRatioMin.toFixed(2)}`
  : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
