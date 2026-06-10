// Per-axis AABB vs walkable tiles (docs/03-entity-stats.md movement contract).
// box is {x, y, w, h} in world px; mutated in place.
import { isWalkable } from "./levelgen.js";

function overlapsSolid(level, x, y, w, h) {
  const ts = level.tileSize;
  const x0 = Math.floor(x / ts), x1 = Math.floor((x + w - 1e-6) / ts);
  const y0 = Math.floor(y / ts), y1 = Math.floor((y + h - 1e-6) / ts);
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
