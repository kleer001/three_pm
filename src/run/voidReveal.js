// Void reveal/expand: the per-cell lifecycle that makes reality breaks TEAR OPEN over a run
// instead of being baked at gen. Factored out of runScene's frame loop (like voidPull) so it
// can be driven in isolation by art-test/void-sandbox.html and by tests. The sim owns the state;
// the renderer reads it through getters (getVoidLife/getTearProgress/getVoidOrig), mirroring how
// getVoidClock is threaded — pure read, never a write.
//
// A cell runs two beats: WOBBLE → FADE → OPEN. The renderer crumbles the surface into the churn
// across both beats as one block dissolve (getTearProgress 0→1) — WOBBLE is the early telegraph
// half, FADE completes it. "Open" sets tiles[i]=RUBBLE and walkable[i]=0; from there voidPull and
// the void render-mask treat it as a visible hole.
//
// Reveal (#1) is purely COSMETIC: harvested gen craters keep their non-walkable hole from the
// first frame (so the director never spawns into them and collision blocks them) and only paint
// over as ground until the descent reveals their look — so walkable[i] is already 0 when a reveal
// cell opens. Expand (#7) grows a hole into real walkable ground, which only becomes non-walkable
// at OPEN (the WOBBLE→FADE beats are its step-off telegraph).
//
// Triggers:
//  - reveal (#1): a latent gen crater whose (jittered) Y is reached by the bottom of the
//    viewport tears into view — its hidden hole scrolling in becomes visible as you descend.
//  - expand (#7): a body swallowed by a hole (voidPull's two voidFalling.push sites, routed here
//    via queueSwallow) feeds that hole; accumulated feeding past a threshold opens one neighbor.
import { TILE } from "./levelgen.js";

export const VL = { NONE: 0, WOBBLE: 1, FADE: 2 }; // phase byte; OPEN cells are plain RUBBLE (no entry)

export function createVoidReveal({ level, ts, rng, balance, cam, viewH, harvestRubble = false }) {
  const K = balance.voidReveal;
  const w = level.w, h = level.h, n = w * h;
  const TS = ts;

  const phase = new Uint8Array(n);   // VL.*
  const timer = new Float32Array(n); // seconds left in the current phase
  const orig = new Uint8Array(n);    // ground tile captured at schedule, for the FADE crossfade
  const trigJit = new Float32Array(n); // per-cell reveal stagger (px), so a row doesn't pop in lockstep
  const active = new Set();          // indices currently animating (renderer + stepper iterate this)
  const latent = new Set();          // gen craters not yet revealed
  const pressure = new Map();        // open-void tile index → accumulated swallow pressure
  const swallowQ = [];               // {x,y} from voidPull, drained each update

  const inBounds = (tx, ty) => tx >= 0 && ty >= 0 && tx < w && ty < h;

  // Harvest the generated craters: paint each over with neighbouring ground so the map reads CLEAN,
  // but leave below-screen craters NON-WALKABLE — they are real holes from the first frame (the
  // director never spawns into them, collision blocks them), and the descent only reveals their
  // look. Only those below the initial viewport become latent; craters on the starting screen are
  // filled in as permanent walkable ground so the spawn clearing stays safe and hole-free.
  if (harvestRubble) {
    const initialBottom = (cam ? cam.y : 0) + (viewH || 0);
    const groundUnder = (i) => {
      const tx = i % w, ty = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx + dx, ny = ty + dy;
        if (inBounds(nx, ny) && level.walkable[ny * w + nx] === 1) return level.tiles[ny * w + nx];
      }
      return TILE.YARD; // fully enclosed by walls/rubble — fall back to grass
    };
    for (let i = 0; i < n; i++) {
      if (level.tiles[i] !== TILE.RUBBLE) continue;
      level.tiles[i] = groundUnder(i); // ground appearance until (if ever) revealed
      const ty = (i / w) | 0, cy = ty * TS + TS / 2;
      if (cy > initialBottom) { // below the first screen → a hidden hole, revealed as we scroll to it
        latent.add(i); // walkable stays 0: the hole is functional from the start
        trigJit[i] = rng ? rng.next() * K.revealStagger * TS : 0;
      } else {
        level.walkable[i] = 1; // starting screen: fill in as permanent safe ground
      }
    }
  }

  function schedule(i) {
    if (phase[i] !== VL.NONE) return false;        // already animating
    if (level.tiles[i] === TILE.RUBBLE) return false; // already an open hole
    if (level.tiles[i] === TILE.WALL) return false;   // never tear a wall/structure
    orig[i] = level.tiles[i];                      // remember the ground we'll crossfade from
    phase[i] = VL.WOBBLE;
    timer[i] = K.beat;
    active.add(i);
    latent.delete(i);
    return true;
  }

  function open(i) {
    level.tiles[i] = TILE.RUBBLE;
    level.walkable[i] = 0;
    phase[i] = VL.NONE;
    timer[i] = 0;
    active.delete(i);
  }

  // #1 — latent craters reach the bottom of the viewport and tear open.
  function stepReveal() {
    if (!cam || !viewH || latent.size === 0) return;
    const bottom = cam.y + viewH;
    for (const i of latent) {
      const ty = (i / w) | 0, cy = ty * TS + TS / 2;
      if (cy + trigJit[i] <= bottom) schedule(i);
    }
  }

  const nearestRubbleTile = (x, y, range) => {
    const cx = Math.floor(x / TS), cy = Math.floor(y / TS);
    let best = -1, bestD = Infinity;
    for (let ty = cy - range; ty <= cy + range; ty++)
      for (let tx = cx - range; tx <= cx + range; tx++) {
        if (!inBounds(tx, ty) || level.tiles[ty * w + tx] !== TILE.RUBBLE) continue;
        const d = (tx - cx) * (tx - cx) + (ty - cy) * (ty - cy);
        if (d < bestD) { bestD = d; best = ty * w + tx; }
      }
    return best;
  };

  // A walkable, non-void, not-already-animating 4-neighbor of an open hole — the cell it can grow
  // into. Picks one at random (seeded) so the bloom direction isn't biased.
  const eligibleNeighbor = (i) => {
    const tx = i % w, ty = (i / w) | 0, opts = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = tx + dx, ny = ty + dy;
      if (!inBounds(nx, ny)) continue;
      const ni = ny * w + nx;
      if (level.tiles[ni] === TILE.RUBBLE || level.walkable[ni] !== 1 || phase[ni] !== VL.NONE) continue;
      opts.push(ni);
    }
    if (opts.length === 0) return -1;
    return opts[rng ? (rng.next() * opts.length) | 0 : 0];
  };

  // #7 — drain swallow events into per-hole pressure, decay it, and bloom a neighbor when a hole
  // has been fed past the threshold. Pressure-with-decay makes sustained edge-fighting grow a hole
  // while a single kill never runs away.
  function stepExpand(dt) {
    for (const s of swallowQ) {
      const hole = nearestRubbleTile(s.x, s.y, K.expandRangeTiles);
      if (hole >= 0) pressure.set(hole, (pressure.get(hole) || 0) + K.swallowPressurePerEat);
    }
    swallowQ.length = 0;
    for (const [i, p0] of pressure) {
      let p = p0 - K.swallowPressureDecay * dt;
      while (p >= K.expandThreshold) {
        const nb = eligibleNeighbor(i);
        if (nb < 0) break;            // hole is fully surrounded — stop accumulating
        schedule(nb);
        p -= K.expandThreshold;
      }
      if (p <= 0) pressure.delete(i); else pressure.set(i, p);
    }
  }

  function update(dt) {
    stepReveal();
    stepExpand(dt);
    for (const i of active) {
      timer[i] -= dt;
      if (timer[i] > 0) continue;
      if (phase[i] === VL.WOBBLE) { phase[i] = VL.FADE; timer[i] = K.beat; }
      else open(i); // FADE complete
    }
  }

  function queueSwallow(x, y) { swallowQ.push({ x, y }); }

  // Read-only view for the renderer (threaded like getVoidClock).
  const getVoidLife = (i) => phase[i];
  const getFadeProgress = (i) => phase[i] === VL.FADE ? Math.max(0, Math.min(1, 1 - timer[i] / K.beat)) : 0;
  // Combined tear progress 0→1 across the WOBBLE+FADE window — the renderer dissolves the cell over
  // the whole transition, so WOBBLE supplies the first half and FADE the second (no telegraph beat).
  const getTearProgress = (i) =>
    phase[i] === VL.WOBBLE ? 0.5 * Math.max(0, Math.min(1, 1 - timer[i] / K.beat)) :
    phase[i] === VL.FADE ? 0.5 + 0.5 * Math.max(0, Math.min(1, 1 - timer[i] / K.beat)) : 0;
  const getVoidOrig = (i) => orig[i];

  return {
    update, queueSwallow, schedule, open,
    getVoidLife, getFadeProgress, getTearProgress, getVoidOrig,
    active, latent, // exposed for the sandbox/tests (read-only by convention)
  };
}
