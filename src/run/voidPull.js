// Reality-break ("void") interactions, factored out of runScene's frame loop so they can be
// driven in isolation — by tests and by art-test/void-sandbox.html — instead of only inside the
// full scrolling game. One factory bound to the live world (the same enemies/voidFalling arrays
// runScene owns); runScene wires it into its update, the sandbox calls the same methods by hand.
//
// Two membership tests, because bodies and shots probe the grid differently:
//  - inVoid(x,y)      point test — projectiles are points (combatKit's shot void-fall uses this).
//  - boxOverlapsVoid  AABB test — moveAndCollide keeps a body's box out of every non-walkable
//                     tile, so a body's CENTER never lands inside a hole; ask instead whether the
//                     shoved box would OVERLAP one (i.e. the void, not a wall, is stopping it).
import { TILE } from "./levelgen.js";

export function createVoidPull({ level, ts, enemies, voidFalling, balance, corpseColor }) {
  const TS = ts;
  const tileVoid = (tx, ty) =>
    tx >= 0 && ty >= 0 && tx < level.w && ty < level.h && level.tiles[ty * level.w + tx] === TILE.RUBBLE;

  const inVoid = (x, y) => tileVoid(Math.floor(x / TS), Math.floor(y / TS));

  const boxOverlapsVoid = (cx, cy, w, h) => {
    const hw = w / 2, hh = h / 2;
    const x0 = Math.floor((cx - hw) / TS), x1 = Math.floor((cx + hw - 1e-6) / TS);
    const y0 = Math.floor((cy - hh) / TS), y1 = Math.floor((cy + hh - 1e-6) / TS);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (tileVoid(tx, ty)) return true;
    return false;
  };

  // Center of the nearest reality-break tile within `rangeTiles`, or null — for the corpse vacuum.
  const nearestVoid = (x, y, rangeTiles) => {
    const ctx = Math.floor(x / TS), cty = Math.floor(y / TS);
    let best = null, bestD = Infinity;
    for (let ty = cty - rangeTiles; ty <= cty + rangeTiles; ty++)
      for (let tx = ctx - rangeTiles; tx <= ctx + rangeTiles; tx++) {
        if (!tileVoid(tx, ty)) continue;
        const vcx = tx * TS + TS / 2, vcy = ty * TS + TS / 2, d = Math.hypot(vcx - x, vcy - y);
        if (d < bestD) { bestD = d; best = { x: vcx, y: vcy, d }; }
      }
    return best;
  };

  // A shove whose next step would carry an enemy's box into a hole pulls it out of play (call
  // BEFORE applyKb so the body isn't also collided to a stop at the edge). Backwards for a safe splice.
  function convertKnocked() {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.kb && e.kb.frames > 0 && boxOverlapsVoid(e.x + e.kb.vx, e.y + e.kb.vy, e.w, e.h)) {
        voidFalling.push({ x: e.x, y: e.y, r: e.r, color: e.def.color, vfx: e.kb.vx, vfy: e.kb.vy });
        enemies.splice(i, 1);
      }
    }
  }

  // A hole tugs nearby corpses in: a dead body within rangeTiles accelerates toward the nearest
  // one; once its box reaches the hole it's swallowed into the void-fall list.
  function vacuumCorpses(dt) {
    const V = balance.voidVacuum;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (!e.dead) continue;
      const v = nearestVoid(e.x, e.y, V.rangeTiles); // tile-scan already bounds the pull to ±rangeTiles
      if (!v) continue;
      const m = v.d || 1;
      e.vacx = (e.vacx || 0) + ((v.x - e.x) / m) * V.accel * dt;
      e.vacy = (e.vacy || 0) + ((v.y - e.y) / m) * V.accel * dt;
      e.x += e.vacx * dt; e.y += e.vacy * dt;
      if (boxOverlapsVoid(e.x, e.y, e.w, e.h)) {
        voidFalling.push({ x: e.x, y: e.y, r: e.r, color: corpseColor, vfx: e.vacx * dt, vfy: e.vacy * dt });
        enemies.splice(i, 1);
      }
    }
  }

  // Drift on the carried velocity, decelerating and shrinking to a pixel, then drop the swallowed.
  // Same knobs the projectile void-fall uses (balance.voidFall).
  function stepFall(dt) {
    const vf = balance.voidFall, drag = Math.exp(-vf.drag * dt), shrink = Math.exp(-vf.shrink * dt);
    for (let i = voidFalling.length - 1; i >= 0; i--) {
      const b = voidFalling[i];
      b.x += b.vfx; b.y += b.vfy; b.vfx *= drag; b.vfy *= drag; b.r *= shrink;
      if (b.r <= vf.minR) voidFalling.splice(i, 1);
    }
  }

  return { inVoid, boxOverlapsVoid, nearestVoid, convertKnocked, vacuumCorpses, stepFall };
}
