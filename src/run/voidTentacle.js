// Void tentacles: the hazard that makes a reality break (TILE.RUBBLE hole) dangerous.
// A hole near a hero grows a purple tentacle that BUDS as a small circle on the rim,
// RISES, PAUSES (telegraph, aim locked), then LASHES out along the locked aim to grab a
// member and drag it into the hole. Dodgeable by sidestepping during the pause — the same
// counterplay model as the charger (enemyAI.js): the aim is captured once, never tracked
// after the lock, so moving off the line whiffs.
//
// One factory bound to the live world (the same heroTargets/voidFalling/enemies runScene
// owns), mirroring voidPull: runScene wires update(dt) into its frame loop and the
// renderer reads `tentacles`. Tests/the sandbox drive the same methods by hand.
//
// The on-hit effect is COLOR-KEYED and deterministic: TENTACLE_TYPES maps each color to
// one action, and a tentacle picks its type once at spawn from a dedicated seeded rng —
// never Math.random, never re-rolled per strike. Color is both the telegraph signal and
// the effect selector. Three colors ship: purple `drag` (grab + drag the member INTO the
// hole, where it's pulled under and KILLED — gone, swallowed by the void), magenta `knock`
// (injure + knockback away), teal `root` (injure + root in place for a beat). A killed
// member is pushed into voidFalling (reusing voidPull's swallow) so it visibly sinks into
// the hole; the head's death instead ends the run via hurtMember → loseRun.
import { TILE, isWalkable } from "./levelgen.js";
import { THEME } from "./balance.js";

const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// COLOR → on-hit action. Each onHit(member, ten, api) has the same shape so any row is a
// drop-in. `api` bundles { hurtMember, knockback, swallow, K, ts }. All three first damage
// (and swallow a kill into the void); they differ only in what they do to a survivor.
function dragIntoHole(member, ten, api) {
  api.hurtMember(member, api.K.damage, "void tentacle"); // flat injury, no fake attacker
  if (member.dead) { api.swallow(member, ten); return; } // died on the strike → into the void
  // survived → the FSM enters `grab`, reeling it into the hole to kill it. Root it for the
  // hold so neither player input (head) nor the follower train fights the pull-in.
  ten.grabbed = member;
  member.rootT = Math.max(member.rootT || 0, api.K.grabHoldT);
}
function knockAway(member, ten, api) {
  api.hurtMember(member, api.K.damage, "void tentacle");
  if (member.dead) { api.swallow(member, ten); return; }
  api.knockback(member, member.x - ten.baseX, member.y - ten.baseY, api.K.knockbackMag); // shoved off the hole
}
function rootInPlace(member, ten, api) {
  api.hurtMember(member, api.K.damage, "void tentacle");
  if (member.dead) { api.swallow(member, ten); return; }
  member.rootT = Math.max(member.rootT || 0, api.K.rootT); // held fast for a beat (heroMove/follower re-home honor it)
}

export const TENTACLE_TYPES = [
  { id: "drag", color: THEME.voidTentacle.colors.drag, onHit: dragIntoHole },
  { id: "knock", color: THEME.voidTentacle.colors.knock, onHit: knockAway },
  { id: "root", color: THEME.voidTentacle.colors.root, onHit: rootInPlace },
];

export function createVoidTentacles({
  level, ts, heroTargets, balance, hurtMember, knockback,
  voidFalling, corpseColor, hero, removeMember, rng,
}) {
  const TS = ts;
  const K = balance.voidTentacle;
  const tentacles = [];
  const holeCd = new Map(); // rim-tile index → seconds of cooldown remaining
  let spawnCd = K.spawnInterval; // first attempt waits one interval

  const tileVoid = (tx, ty) =>
    tx >= 0 && ty >= 0 && tx < level.w && ty < level.h && level.tiles[ty * level.w + tx] === TILE.RUBBLE;

  // Player-faction members that can be targeted/hit (skip dead + still-materializing).
  const livingTargets = () => heroTargets.filter((m) => !m.dead && !(m.fadeT > 0));

  const nearestTarget = (x, y) => {
    let best = null, bestD = Infinity;
    for (const m of livingTargets()) {
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  };

  // Nearest living member whose body overlaps the strike tip, or null.
  const hitTest = (x, y, tipR) => {
    let best = null, bestD = Infinity;
    for (const m of livingTargets()) {
      const reach = m.r + tipR + K.tipHitPad;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d <= reach && d < bestD) { bestD = d; best = m; }
    }
    return best;
  };

  // The rim point a hole offers TOWARD a member: a RUBBLE tile in range whose 4-neighbor is
  // genuine open floor (isWalkable excludes both WALL and RUBBLE) and whose outward normal
  // points at the member (dot > 0 → the hero-facing side). Score by alignment minus a small
  // distance penalty. Base sits at the lip (hole center pushed half a tile outward) — the
  // shaft anchors there; a grabbed member is reeled from it toward holeCX/holeCY (interior).
  function rimToward(member) {
    const R = K.rangeTiles;
    const mtx = Math.floor(member.x / TS), mty = Math.floor(member.y / TS);
    let best = null, bestScore = -Infinity;
    for (let ty = mty - R; ty <= mty + R; ty++)
      for (let tx = mtx - R; tx <= mtx + R; tx++) {
        if (!tileVoid(tx, ty)) continue;
        const hcx = tx * TS + TS / 2, hcy = ty * TS + TS / 2;
        const tdx = member.x - hcx, tdy = member.y - hcy, dm = Math.hypot(tdx, tdy) || 1;
        for (const [dx, dy] of NEIGHBORS) {
          if (!isWalkable(level, tx + dx, ty + dy)) continue;
          const dot = (dx * tdx + dy * tdy) / dm;
          if (dot <= 0) continue; // only the side facing the member
          const bx = hcx + dx * TS / 2, by = hcy + dy * TS / 2;
          const score = dot - 0.002 * Math.hypot(member.x - bx, member.y - by);
          if (score > bestScore) {
            bestScore = score;
            best = { tx, ty, baseX: bx, baseY: by, holeCX: hcx, holeCY: hcy };
          }
        }
      }
    return best;
  }

  // Reuse voidPull's swallow animation: a killed member drifts into the hole and shrinks
  // (stepFall, run from runScene) instead of leaving a normal corpse. Inward velocity comes
  // from the rim→interior normal (baseX/Y → holeCX/Y) so it's always non-zero, even when the
  // body is already at the hole center. The hero is never removed — its loss already routed
  // through hurtMember → loseRun.
  function swallow(member, ten) {
    if (member === hero) return; // head loss is handled by hurtMember/loseRun; never remove it
    const dx = ten.holeCX - ten.baseX, dy = ten.holeCY - ten.baseY, m = Math.hypot(dx, dy) || 1;
    voidFalling.push({
      x: member.x, y: member.y, r: member.r,
      color: member.color || (member.def && member.def.color) || corpseColor,
      vfx: (dx / m) * K.swallowVel, vfy: (dy / m) * K.swallowVel,
    });
    removeMember(member); // enemy: splice from `enemies`. follower: no-op (reapDead drops it).
  }

  // The grab completed: the member has been dragged into the hole and is pulled under — it
  // dies, unconditionally (a grab ignores i-frames). hurtMember routes the head's death to
  // loseRun and plays the scream for others; non-heroes then sink into the void via swallow.
  function pullKill(member, ten) {
    member.iframes = 0; // a grab can't be shrugged off by a lingering i-frame window
    hurtMember(member, member.hp * 2 + K.damage, "dragged into the void"); // guaranteed lethal (resist ≤ 50%)
    if (member !== hero && member.dead) swallow(member, ten);
  }

  const api = { hurtMember, knockback, swallow, K, ts: TS };

  function beginRetract(t) { t.retractFrom = t.len; t.state = "retract"; t.timer = K.retractT; }

  // Advance one tentacle by dt. bud/rise/telegraph/retract are duration-driven; strike is
  // geometry-driven (reaching maxReach) with `timer` as a safety cap — same split as the
  // charger (telegraph timed, lunge movement + capped).
  function step(t, dt) {
    switch (t.state) {
      case "bud": {
        t.timer -= dt;
        t.budT = clamp01(1 - t.timer / K.budT);
        if (t.timer <= 0) { t.state = "rise"; t.timer = K.riseT; }
        break;
      }
      case "rise": {
        t.timer -= dt;
        const tgt = nearestTarget(t.baseX, t.baseY); // still tracking: lean toward the hero
        if (tgt) {
          const m = Math.hypot(tgt.x - t.baseX, tgt.y - t.baseY) || 1;
          t.aimX = (tgt.x - t.baseX) / m; t.aimY = (tgt.y - t.baseY) / m;
        }
        t.len = t.restLen * clamp01(1 - t.timer / K.riseT);
        if (t.timer <= 0) { t.state = "telegraph"; t.timer = K.telegraphT; } // aim now LOCKED
        break;
      }
      case "telegraph": {
        t.timer -= dt; // aim frozen at the value captured on the rise→telegraph edge
        t.len = t.restLen;
        if (t.timer <= 0) { t.state = "strike"; t.timer = K.strikeT; t.hit = false; }
        break;
      }
      case "strike": {
        t.timer -= dt;
        // Test at the CURRENT tip before advancing, so a member sitting inside the resting
        // reach (closer than restLen) is still caught — the lash doesn't step over it.
        if (!t.hit) {
          const tipX = t.baseX + t.aimX * t.len, tipY = t.baseY + t.aimY * t.len;
          const m = hitTest(tipX, tipY, t.tipR);
          if (m) { t.hit = true; t.type.onHit(m, t, api); }
        }
        if (t.grabbed) { t.state = "grab"; t.timer = K.grabHoldT; break; }
        if (t.len >= t.maxReach || t.timer <= 0) { beginRetract(t); break; }
        t.len = Math.min(t.maxReach, t.len + K.strikeSpeed * dt);
        break;
      }
      case "grab": {
        t.timer -= dt;
        const m = t.grabbed;
        if (!m || m.dead) {
          if (m && m.dead) swallow(m, t); // already dead → into the void
          t.grabbed = null; beginRetract(t); break;
        }
        // Reel the member toward the hole INTERIOR (we ignore that it's non-walkable — this
        // is a death animation). When it reaches the center (or the safety cap fires) it's
        // pulled under and KILLED — dragged into the void and gone, never deposited back.
        const dx = t.holeCX - m.x, dy = t.holeCY - m.y, d = Math.hypot(dx, dy);
        const stepLen = Math.min(d, K.dragSpeed * dt);
        if (d > 1e-3) { m.x += (dx / d) * stepLen; m.y += (dy / d) * stepLen; }
        t.len = Math.hypot(m.x - t.baseX, m.y - t.baseY); // shaft visibly holds the victim
        if (d <= K.pullInRadius || t.timer <= 0) {
          pullKill(m, t);
          t.grabbed = null; beginRetract(t);
        }
        break;
      }
      case "retract": {
        t.timer -= dt;
        const f = clamp01(t.timer / K.retractT);
        t.len = t.retractFrom * f;
        t.budT = f;
        if (t.timer <= 0) t.done = true;
        break;
      }
    }
  }

  // Force-spawn at a rim (tests/sandbox); typeId picks a specific color, else seeded.
  function _spawnAt(rim, typeId) {
    const type = typeId ? TENTACLE_TYPES.find((x) => x.id === typeId)
                        : TENTACLE_TYPES[rng.int(TENTACLE_TYPES.length)];
    const t = {
      type, color: type.color,
      baseX: rim.baseX, baseY: rim.baseY, holeCX: rim.holeCX, holeCY: rim.holeCY,
      aimX: 0, aimY: 0, len: 0,
      maxReach: K.reachTiles * TS, restLen: K.restTiles * TS,
      holeKey: rim.ty * level.w + rim.tx,
      state: "bud", timer: K.budT, hit: false, grabbed: null,
      budT: 0, tipR: THEME.voidTentacle.tipR, seed: rng.next() * Math.PI * 2,
      retractFrom: 0, done: false,
    };
    tentacles.push(t);
    return t;
  }

  // Proximity-gated, capped spawn. The rim scan only runs on a spawn ATTEMPT (every
  // spawnInterval, skipped at maxActive), so it never costs per-frame work.
  function trySpawn(dt) {
    spawnCd -= dt;
    if (spawnCd > 0 || tentacles.length >= K.maxActive) return;
    let chosen = null, chosenD = Infinity;
    for (const m of livingTargets()) {
      const rim = rimToward(m);
      if (!rim) continue;
      const d = Math.hypot(m.x - rim.baseX, m.y - rim.baseY);
      if (d < chosenD) { chosenD = d; chosen = rim; }
    }
    spawnCd = K.spawnInterval * (0.75 + 0.5 * rng.next()); // re-attempt later either way
    if (!chosen) return;
    if (holeCd.has(chosen.ty * level.w + chosen.tx)) return; // this hole is still cooling
    _spawnAt(chosen);
  }

  function update(dt) {
    for (const [k, v] of holeCd) { const nv = v - dt; if (nv <= 0) holeCd.delete(k); else holeCd.set(k, nv); }
    trySpawn(dt);
    for (const t of tentacles) step(t, dt);
    for (let i = tentacles.length - 1; i >= 0; i--) {
      if (tentacles[i].done) { holeCd.set(tentacles[i].holeKey, K.holeCooldown); tentacles.splice(i, 1); }
    }
  }

  return { update, tentacles, rimToward, TENTACLE_TYPES, _step: step, _spawnAt };
}
