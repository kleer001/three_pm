// Void tentacles: the hazard that makes a reality break (TILE.RUBBLE hole) dangerous.
// A hole near a hero grows a purple tentacle that BUDS as a small circle on the rim,
// RISES, PAUSES (telegraph, aim locked), then LASHES out along the locked aim to grab a
// creature and drag it into the hole. Dodgeable by sidestepping during the pause — the same
// counterplay model as the charger (enemyAI.js): the aim is captured once, never tracked
// after the lock, so moving off the line whiffs. The void is NEUTRAL — it erupts where the
// player is (spawning is hero-driven) but grabs the nearest creature of EITHER faction, so a
// tentacle near a monster pack will yank monsters into the dark just as readily as the hero.
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
// (injure + knockback away), teal `root` (injure + root in place for a beat). A knock or root
// that strands a member north of the crush line is itself fatal (voidPerilT — the descent's
// dark takes a held-or-flung member, bypassing the forgiving clamp). A killed member is pushed
// into voidFalling (reusing voidPull's swallow) so it visibly sinks into the hole; the head's
// death instead ends the run via hurtMember → loseRun.
import { TILE, isWalkable } from "./levelgen.js";
import { THEME } from "./balance.js";
import { clamp } from "./draw.js";

const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// COLOR → on-hit action. Each onHit(member, ten, api) has the same shape so any row is a
// drop-in. `api` bundles { hurt, knockback, swallow, pin, hold, isEnemy, K, ts }. Both factions
// take the SAME hit — injured by the strike (api.hurt routes to the party or enemy resolver),
// then displaced/pinned/dragged. A drag always pulls its catch into the hole and swallows it; a
// knock/root that kills outright dies in place (a party member swallowed, a monster a plain
// corpse). A monster killed by the void grants the player NOTHING (no points/cash/loot — see
// hurtEnemy). The descent's dark (voidPerilT) only applies to party members.
function dragIntoHole(member, ten, api) {
  api.hurt(member, api.K.damage, "void tentacle"); // injure, same as any target
  if (member.dead) { api.swallow(member, ten); return; } // died on the strike → into the void
  // survived → the FSM enters `grab`, reeling it into the hole to kill it. Hold it for the
  // pull-in (rootT for party, the freeze pause for an enemy) so nothing fights the reel.
  ten.grabbed = member;
  api.hold(member);
}
function knockAway(member, ten, api) {
  api.hurt(member, api.K.damage, "void tentacle");
  if (member.dead) { if (!api.isEnemy(member)) api.swallow(member, ten); return; } // monster → normal looted corpse
  api.knockback(member, member.x - ten.baseX, member.y - ten.baseY, api.K.knockbackTiles * api.ts); // shoved 2 tiles off the hole
  if (!api.isEnemy(member)) member.voidPerilT = Math.max(member.voidPerilT || 0, api.K.perilT); // flung into the dark = fatal
}
function rootInPlace(member, ten, api) {
  api.hurt(member, api.K.damage, "void tentacle");
  if (member.dead) { if (!api.isEnemy(member)) api.swallow(member, ten); return; }
  ten.rooting = member; // the shaft stays stuck to the held member for rootT (the "stick" state) before retracting
  if (api.isEnemy(member)) { api.pin(member); return; } // monster pinned via the freeze pause
  member.rootT = Math.max(member.rootT || 0, api.K.rootT); // held fast for a beat (heroMove/follower re-home honor it)
  member.voidPerilT = Math.max(member.voidPerilT || 0, api.K.rootT); // held at the crush line → no escaping the dark
}

// `wave` names the shaft motion each renderer draws — the color/threat read at a glance: the
// slow purple drag CURLS, the magenta knock WHIPS, the teal root SNAKES. `weight` is the spawn
// share: knock 3 : root 2 : drag 1 — the lethal grab is the rarest.
export const TENTACLE_TYPES = [
  { id: "drag", color: THEME.voidTentacle.colors.drag, wave: "curl", weight: 1, onHit: dragIntoHole },
  { id: "knock", color: THEME.voidTentacle.colors.knock, wave: "whip", weight: 3, onHit: knockAway },
  { id: "root", color: THEME.voidTentacle.colors.root, wave: "snake", weight: 2, onHit: rootInPlace },
];

export function createVoidTentacles({
  level, ts, heroTargets, enemies, balance, hurtMember, hurtEnemy, knockback,
  voidFalling, corpseColor, hero, removeMember, rng,
}) {
  const TS = ts;
  const K = balance.voidTentacle;
  const tentacles = [];
  const holeCd = new Map(); // rim-tile index → seconds of cooldown remaining
  let spawnCd = K.spawnInterval; // first attempt waits one interval

  const tileVoid = (tx, ty) =>
    tx >= 0 && ty >= 0 && tx < level.w && ty < level.h && level.tiles[ty * level.w + tx] === TILE.RUBBLE;

  const isEnemy = (m) => m.faction === "enemy";

  // Faction-aware injury: route to the party resolver (hit number + i-frames, head death ends
  // the run) or the enemy resolver (hit number + death, but NO reward — the void is not the
  // player's weapon, so a tentacle kill grants no points/cash/loot/charge). Same DAMAGE either
  // way — that's the "enemies get the same treatment" contract; only the spoils differ.
  const hurt = (m, amount, src) => (isEnemy(m) ? hurtEnemy(m, amount) : hurtMember(m, amount, src));

  // Hold a grabbed creature still during the pull-in: a party member is rooted (heroMove /
  // follower re-home honor rootT); an enemy uses the freeze pause its brain already honors.
  const hold = (m) => {
    if (isEnemy(m)) m.frozenT = Math.max(m.frozenT || 0, K.grabHoldT);
    else m.rootT = Math.max(m.rootT || 0, K.grabHoldT);
  };

  // Where tentacles WANT to erupt: party members (alive, not still-materializing). Spawning is
  // hero-driven so the hazard appears where the player is, even though it grabs either faction.
  const partyAnchors = () => heroTargets.filter((m) => !m.dead && !(m.fadeT > 0));

  // Everything a tentacle can grab/pin: BOTH factions. The void is neutral — it lashes at the
  // nearest creature near its hole, hero or monster alike.
  const livingTargets = () => {
    const out = partyAnchors();
    for (const e of enemies) if (!e.dead && !(e.fadeT > 0)) out.push(e);
    return out;
  };

  const nearestTarget = (x, y) => {
    let best = null, bestD = Infinity;
    for (const m of livingTargets()) {
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  };

  // Nearest living creature (either faction) whose body overlaps the strike tip, or null.
  const hitTest = (x, y, tipR) => {
    let best = null, bestD = Infinity;
    for (const m of livingTargets()) {
      const reach = m.r + tipR + K.tipHitPad;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d <= reach && d < bestD) { bestD = d; best = m; }
    }
    return best;
  };

  // The rim a single RUBBLE tile offers TOWARD a member: the 4-neighbor that is genuine open
  // floor (isWalkable excludes both WALL and RUBBLE) and whose outward normal points at the
  // member (dot > 0 → the hero-facing side). Pick the best-aligned face (score = alignment
  // minus a small distance penalty). Base sits at the lip (hole center pushed half a tile
  // outward) — the shaft anchors there; a grabbed member is reeled toward holeCX/holeCY. Null
  // if the tile offers no facing open side. `score` rides along for cross-tile comparison.
  function rimForTile(tx, ty, member) {
    const hcx = tx * TS + TS / 2, hcy = ty * TS + TS / 2;
    const tdx = member.x - hcx, tdy = member.y - hcy, dm = Math.hypot(tdx, tdy) || 1;
    const lip = TS / 2 - (K.lipOffsetTiles || 0) * TS; // bud sits at the lip, set back into the void by the knob
    let best = null, bestScore = -Infinity;
    for (const [dx, dy] of NEIGHBORS) {
      if (!isWalkable(level, tx + dx, ty + dy)) continue;
      const dot = (dx * tdx + dy * tdy) / dm;
      if (dot <= 0) continue; // only the side facing the member
      const bx = hcx + dx * lip, by = hcy + dy * lip;
      const score = dot - 0.002 * Math.hypot(member.x - bx, member.y - by);
      if (score > bestScore) { bestScore = score; best = { tx, ty, baseX: bx, baseY: by, holeCX: hcx, holeCY: hcy, score }; }
    }
    return best;
  }

  // The single best rim any hole offers a member, scanning the ±rangeTiles box (used by the
  // sandbox/tests). Spawning uses eligibleRims() below instead.
  function rimToward(member) {
    const R = K.rangeTiles;
    const mtx = Math.floor(member.x / TS), mty = Math.floor(member.y / TS);
    let best = null;
    for (let ty = mty - R; ty <= mty + R; ty++)
      for (let tx = mtx - R; tx <= mtx + R; tx++) {
        if (!tileVoid(tx, ty)) continue;
        const rim = rimForTile(tx, ty, member);
        if (rim && (!best || rim.score > best.score)) best = rim;
      }
    return best;
  }

  // Every distinct void-edge cell in range of a party member that faces one, deduped by tile
  // (a cell seen by two members keeps the better-aligned face). The spawn roll walks this set.
  // Driven by party anchors only — tentacles erupt where the player is, then grab either faction.
  function eligibleRims() {
    const R = K.rangeTiles, seen = new Map();
    for (const m of partyAnchors()) {
      const mtx = Math.floor(m.x / TS), mty = Math.floor(m.y / TS);
      for (let ty = mty - R; ty <= mty + R; ty++)
        for (let tx = mtx - R; tx <= mtx + R; tx++) {
          if (!tileVoid(tx, ty)) continue;
          const rim = rimForTile(tx, ty, m);
          if (!rim) continue;
          const key = ty * level.w + tx, prev = seen.get(key);
          if (!prev || rim.score > prev.score) seen.set(key, rim);
        }
    }
    return [...seen.values()];
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

  // Pin a creature in place: enemies honor the freeze pause (the brain loop skips a frozenT
  // enemy), which `rootT` does not gate. Doesn't touch freezeCount, so it's a pure hold and
  // never counts toward a freeze-kill.
  function pin(e) { e.frozenT = Math.max(e.frozenT || 0, K.rootT); }

  // The grab completed: the creature has been dragged into the hole and is pulled under. It dies
  // unconditionally (a grab ignores i-frames) through its own resolver — a party member's head
  // death ends the run; a monster dies but rewards the player nothing — then the body is
  // swallowed into the void (sucked in) instead of left as a corpse.
  function pullKill(member, ten) {
    member.iframes = 0; // a grab can't be shrugged off by a lingering i-frame window
    hurt(member, member.hp * 2 + K.damage, "dragged into the void"); // guaranteed lethal (resist ≤ 50%)
    if (member !== hero && member.dead) swallow(member, ten); // hero loss already routed via loseRun
  }

  const api = { hurt, knockback, swallow, pin, hold, isEnemy, K, ts: TS };

  function beginRetract(t) { t.retractFrom = t.len; t.state = "retract"; t.timer = K.retractT; }

  // Advance one tentacle by dt. bud/rise/telegraph/retract are duration-driven; strike is
  // geometry-driven (reaching maxReach) with `timer` as a safety cap — same split as the
  // charger (telegraph timed, lunge movement + capped).
  function step(t, dt) {
    switch (t.state) {
      case "bud": {
        t.timer -= dt;
        t.budT = clamp(1 - t.timer / K.budT, 0, 1);
        if (t.timer <= 0) { t.state = "rise"; t.timer = K.riseT; }
        break;
      }
      case "rise": {
        t.timer -= dt;
        const tgt = nearestTarget(t.baseX, t.baseY); // still tracking: lean toward the target
        if (tgt) {
          const m = Math.hypot(tgt.x - t.baseX, tgt.y - t.baseY) || 1;
          t.aimX = (tgt.x - t.baseX) / m; t.aimY = (tgt.y - t.baseY) / m;
        }
        t.len = t.restLen * clamp(1 - t.timer / K.riseT, 0, 1);
        if (t.timer <= 0) {
          // Lock the reach to the target's distance so the lash extends exactly far enough to
          // catch it and no farther — computed from the creature's location, not a fixed knob.
          // Captured here with the aim, so a sidestep after this whiffs. Falls back to reachTiles
          // only if the target vanished mid-rise.
          const reach = tgt ? Math.hypot(tgt.x - t.baseX, tgt.y - t.baseY) + tgt.r : K.reachTiles * TS;
          t.maxReach = Math.max(t.restLen, reach);
          t.state = "telegraph"; t.timer = K.telegraphT; // aim now LOCKED
        }
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
        // Time-driven lash: extend from the resting length out to the locked reach over strikeT,
        // so the strike always takes the same beat no matter how far the target is. Hit-test the
        // current tip each frame (it starts at restLen) so a member already inside reach is
        // caught — the lash never steps over it.
        t.len = t.restLen + (t.maxReach - t.restLen) * clamp(1 - t.timer / K.strikeT, 0, 1);
        if (!t.hit) {
          const tipX = t.baseX + t.aimX * t.len, tipY = t.baseY + t.aimY * t.len;
          const m = hitTest(tipX, tipY, t.tipR);
          if (m) { t.hit = true; t.type.onHit(m, t, api); }
        }
        if (t.grabbed) { t.state = "grab"; t.timer = K.grabHoldT; t.grabFromX = t.grabbed.x; t.grabFromY = t.grabbed.y; break; }
        if (t.rooting) { t.state = "stick"; t.timer = K.rootT; break; } // root: cling to the held member for rootT
        if (t.timer <= 0) beginRetract(t);
        break;
      }
      case "stick": {
        t.timer -= dt;
        const m = t.rooting;
        if (!m || m.dead) { t.rooting = null; beginRetract(t); break; }
        // Cling to the rooted member: keep the shaft reaching exactly to it (re-aimed each frame
        // in case it's nudged), so the tentacle is visibly stuck for rootT, then lets go + retracts.
        const dx = m.x - t.baseX, dy = m.y - t.baseY, d = Math.hypot(dx, dy) || 1;
        t.aimX = dx / d; t.aimY = dy / d; t.len = d;
        if (t.timer <= 0) { t.rooting = null; beginRetract(t); }
        break;
      }
      case "grab": {
        t.timer -= dt;
        const m = t.grabbed;
        if (!m || m.dead) {
          if (m && m.dead) swallow(m, t); // already dead → into the void
          t.grabbed = null; beginRetract(t); break;
        }
        // Reel the member from where it was caught toward the hole INTERIOR over grabHoldT (we
        // ignore that it's non-walkable — this is a death animation). When it reaches the center
        // (or the timer ends) it's pulled under and KILLED — dragged into the void and gone.
        const f = clamp(1 - t.timer / K.grabHoldT, 0, 1);
        m.x = t.grabFromX + (t.holeCX - t.grabFromX) * f;
        m.y = t.grabFromY + (t.holeCY - t.grabFromY) * f;
        t.len = Math.hypot(m.x - t.baseX, m.y - t.baseY); // shaft visibly holds the victim
        const d = Math.hypot(t.holeCX - m.x, t.holeCY - m.y);
        if (d <= K.pullInRadius || t.timer <= 0) {
          pullKill(m, t);
          t.grabbed = null; beginRetract(t);
        }
        break;
      }
      case "retract": {
        t.timer -= dt;
        const f = clamp(t.timer / K.retractT, 0, 1);
        t.len = t.retractFrom * f;
        t.budT = f;
        if (t.timer <= 0) t.done = true;
        break;
      }
    }
  }

  // Weighted spawn roll over TENTACLE_TYPES.weight (knock 3 : root 2 : drag 1).
  function pickType() {
    let r = rng.next() * TENTACLE_TYPES.reduce((s, t) => s + t.weight, 0);
    for (const t of TENTACLE_TYPES) if ((r -= t.weight) < 0) return t;
    return TENTACLE_TYPES[TENTACLE_TYPES.length - 1];
  }

  // Force-spawn at a rim (tests/sandbox); typeId picks a specific color, else weighted-seeded.
  function _spawnAt(rim, typeId) {
    const type = typeId ? TENTACLE_TYPES.find((x) => x.id === typeId) : pickType();
    const t = {
      type, color: type.color,
      baseX: rim.baseX, baseY: rim.baseY, holeCX: rim.holeCX, holeCY: rim.holeCY,
      aimX: 0, aimY: 0, len: 0,
      maxReach: K.reachTiles * TS, restLen: K.restTiles * TS,
      holeKey: rim.ty * level.w + rim.tx,
      state: "bud", timer: K.budT, hit: false, grabbed: null, rooting: null,
      budT: 0, tipR: THEME.voidTentacle.tipR, seed: rng.next() * Math.PI * 2,
      retractFrom: 0, done: false,
    };
    tentacles.push(t);
    return t;
  }

  // Per-edge-cell spawn: on each attempt (every spawnInterval, so the scan never costs per-
  // frame work), every void-edge cell near a hero independently rolls spawnChancePerRim to
  // grow a tentacle — ~1 in 20 by default. Capped at maxActive; a cell that already hosts a
  // live tentacle or is still cooling down is skipped so it never doubles up or spams.
  function trySpawn(dt) {
    spawnCd -= dt;
    if (spawnCd > 0) return;
    spawnCd = K.spawnInterval * (0.75 + 0.5 * rng.next()); // re-attempt later either way
    for (const rim of eligibleRims()) {
      if (tentacles.length >= K.maxActive) break;
      const key = rim.ty * level.w + rim.tx;
      if (holeCd.has(key)) continue;                            // still cooling from its last tentacle
      if (tentacles.some((t) => t.holeKey === key)) continue;   // already has a live tentacle
      if (rng.next() < K.spawnChancePerRim) _spawnAt(rim);
    }
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
