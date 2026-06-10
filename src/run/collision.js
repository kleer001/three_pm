// Per-axis AABB vs walkable tiles (docs/03-entity-stats.md movement contract).
// box is {x, y, w, h} in world px where (x, y) is the box CENTER (matching how
// entities are positioned and drawn); mutated in place.
import { isWalkable } from "./levelgen.js";

function overlapsSolid(level, cx, cy, w, h) {
  const ts = level.tileSize;
  const hw = w / 2, hh = h / 2;
  const x0 = Math.floor((cx - hw) / ts), x1 = Math.floor((cx + hw - 1e-6) / ts);
  const y0 = Math.floor((cy - hh) / ts), y1 = Math.floor((cy + hh - 1e-6) / ts);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (!isWalkable(level, tx, ty)) return true;
  return false;
}

// True if the box currently overlaps any non-walkable tile (used for crush checks).
export function boxBlocked(level, box) {
  return overlapsSolid(level, box.x, box.y, box.w, box.h);
}

export function moveAndCollide(level, box, dx, dy) {
  box.x += dx;
  if (overlapsSolid(level, box.x, box.y, box.w, box.h)) box.x -= dx;
  box.y += dy;
  if (overlapsSolid(level, box.x, box.y, box.w, box.h)) box.y -= dy;
  return box;
}
