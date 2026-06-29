// Flow-field "get-home" autopilot. One BFS flood-fill from the home band per run, then
// gradient-descend the distance field toward home — removes navigation as a confound so a
// driven run reaches deep game. Input-shaped so it stands in for the real input object the
// run scene reads (intent()/down()/firing/…); tick(probe) refreshes the aim each frame from
// the live {hero, level} probe. Shared by the headless gauntlet sweep (tests/gauntlet.mjs)
// and the browser playthrough harness (main.js under ?bot=1) so nav has one home.
//
// Dumb about combat on purpose: always fires, never dodges. The crush wall — not the mob —
// is the permanent threat, and a driven run is invincible anyway. Aims at tile CENTERS: the
// hero body is ~½ a tile wide, so hugging an edge straddles the neighbor column and snags.
import { isWalkable } from "./levelgen.js";

const DIRS8 = [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [0, -1]];
const norm = ([dx, dy]) => { const m = Math.hypot(dx, dy) || 1; return { x: dx / m, y: dy / m }; };

// BFS distance-to-home over walkable tiles (4-connected, matching enemy pathing).
// dist[i] = steps to the nearest home cell, or -1 if unreachable. Built once per run.
function buildFlow(level) {
  const W = level.w, H = level.h, dist = new Int32Array(W * H).fill(-1);
  const q = []; let qh = 0;
  for (const [x, y] of level.homeBand) { const i = y * W + x; if (isWalkable(level, x, y) && dist[i] < 0) { dist[i] = 0; q.push(i); } }
  const NB = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  while (qh < q.length) {
    const i = q[qh++], x = i % W, y = (i / W) | 0, d = dist[i];
    for (const [dx, dy] of NB) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (dist[ni] < 0 && isWalkable(level, nx, ny)) { dist[ni] = d + 1; q.push(ni); }
    }
  }
  return dist;
}

// A fresh autopilot per run (the flow field is bound to that run's level). Returns an
// object matching the run scene's input contract plus tick(probe).
export function createAutopilot() {
  let pulse = false, flow = null, vec = { x: 0, y: 1 };

  function chooseIntent(probe) {
    const { hero, level } = probe;
    const ts = level.tileSize, W = level.w;
    const htx = Math.floor(hero.x / ts), hty = Math.floor(hero.y / ts);
    const aim = (tx, ty) => norm([(tx + 0.5) * ts - hero.x, (ty + 0.5) * ts - hero.y]);
    if (!flow) flow = buildFlow(level);
    let best = null, bd = Infinity; // descend toward the lowest distance-to-home neighbor
    for (const [dx, dy] of DIRS8) {
      const nx = htx + dx, ny = hty + dy;
      if (!isWalkable(level, nx, ny)) continue;
      const nd = flow[ny * W + nx];
      if (nd >= 0 && nd < bd) { bd = nd; best = [dx, dy]; }
    }
    return best ? aim(htx + best[0], hty + best[1]) : { x: 0, y: 1 };
  }

  return {
    tick(probe) { pulse = !pulse; vec = chooseIntent(probe); },
    intent: () => vec,
    // Always fire; pulse KeyQ so any auto-opened shop modal gets a rising-edge "leave"
    // (holding it would only fire once and then stick on the next shop).
    down: (code) => code === "Space" || (code === "KeyQ" && pulse),
    touchActive: () => false,
    joystick: () => null,
    consumeTap: () => null,
    get firing() { return false; },
  };
}
