// Tile-grid AI helpers, ported from BrainMaze (src/ai/pathfinding.py,
// behaviors.py): BFS shortest path + waypoint pickers. Enemies move
// continuously but steer along a BFS path so they navigate walls.
import { isWalkable } from "../run/levelgen.js";

// BFS from (sx,sy) to (tx,ty). Returns an array of [tileX,tileY] steps to walk
// (excluding the start, including the target), or null if unreachable.
export function findPath(level, sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  const w = level.w;
  const key = (x, y) => y * w + x;
  const came = new Map();
  const seen = new Set([key(sx, sy)]);
  const q = [[sx, sy]];
  let head = 0;
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  while (head < q.length) {
    const [x, y] = q[head++];
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      const k = key(nx, ny);
      if (seen.has(k) || !isWalkable(level, nx, ny)) continue;
      seen.add(k);
      came.set(k, key(x, y));
      if (nx === tx && ny === ty) {
        const path = [];
        let cur = k;
        const startKey = key(sx, sy);
        while (cur !== startKey) {
          path.push([cur % w, Math.floor(cur / w)]);
          cur = came.get(cur);
        }
        return path.reverse();
      }
      q.push([nx, ny]);
    }
  }
  return null;
}

export function randomWalkableTile(level, rng) {
  for (let i = 0; i < 40; i++) {
    const x = rng.int(level.w), y = rng.int(level.h);
    if (isWalkable(level, x, y)) return [x, y];
  }
  return [level.start.x, level.start.y];
}

// Nearest walkable tile to a point (BFS expand) — for placing patrol waypoints.
export function nearestWalkable(level, tx, ty) {
  if (isWalkable(level, tx, ty)) return [tx, ty];
  const w = level.w;
  const seen = new Set([ty * w + tx]);
  const q = [[tx, ty]];
  let head = 0;
  while (head < q.length) {
    const [x, y] = q[head++];
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
      const k = ny * w + nx;
      if (seen.has(k)) continue;
      seen.add(k);
      if (isWalkable(level, nx, ny)) return [nx, ny];
      q.push([nx, ny]);
    }
  }
  return [level.start.x, level.start.y];
}
