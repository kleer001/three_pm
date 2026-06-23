// Soft-body spatial resolution for the run scene: keep circles (hero, enemies,
// corpses) from overlapping, and hard-block the hero from pushing into a living
// body — all wall-aware (a nudge that lands in a wall is reverted). Built once per
// run via createSoftBody(env); env carries the live level/hero/enemies by reference.
import { boxBlocked } from "./collision.js";
import { BALANCE } from "./balance.js";

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export function createSoftBody({ level, hero, enemies }) {
  function shift(e, dx, dy) {
    e.x += dx; e.y += dy;
    if (boxBlocked(level, e)) { e.x -= dx; e.y -= dy; }
  }

  function separate(a, b, moveA) {
    const dx = b.x - a.x, dy = b.y - a.y;
    let d = Math.hypot(dx, dy) || 0.001;
    const min = a.r + b.r;
    if (d >= min) return;
    const o = min - d, nx = dx / d, ny = dy / d;
    if (moveA) { const p = BALANCE.softBodyPush; shift(a, -nx * o * p, -ny * o * p); shift(b, nx * o * p, ny * o * p); }
    else shift(b, nx * o, ny * o);
  }

  function separateHero(a, b, aYield) {
    const dx = b.x - a.x, dy = b.y - a.y;
    let d = Math.hypot(dx, dy) || 0.001;
    const min = a.r + b.r;
    if (d >= min) return;
    // ay = min(ny, 0): the hero's y-shift is never northward, so no crowd can press
    // the head back into the advancing crush line — only the camera/input move it there.
    const o = min - d, nx = dx / d, ny = dy / d, ay = Math.min(ny, 0);
    shift(a, -nx * o * aYield, -ay * o * aYield);
    shift(b, nx * o * (1 - aYield), ny * o * (1 - aYield));
  }

  function bodyDeeper(px, py) {
    for (const e of enemies) {
      if (e.dead) continue; // corpses are pushable; only living enemies hard-block
      const min = hero.r + e.r;
      const nd = dist(hero.x, hero.y, e.x, e.y);
      if (nd < min && nd < dist(px, py, e.x, e.y)) return true;
    }
    return false;
  }

  function heroMove(dx, dy) {
    const ox = hero.x;
    hero.x += dx;
    if (boxBlocked(level, hero) || bodyDeeper(ox, hero.y)) hero.x = ox;
    const oy = hero.y;
    hero.y += dy;
    if (boxBlocked(level, hero) || bodyDeeper(hero.x, oy)) hero.y = oy;
  }

  return { shift, separate, separateHero, bodyDeeper, heroMove };
}
