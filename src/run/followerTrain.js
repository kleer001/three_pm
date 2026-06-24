// The follower train (spec-18 party, slice stand-in): the trailing heroes retrace
// the head's breadcrumb polyline a fixed arc-length apart, tick their passives, fire
// their signature, and permadie when crushed or killed. Built once per run via
// createFollowerTrain(env). update() stays the frame sequencer and calls these steps
// in order — their interleaving with hero movement and the enemy passes matters, so
// each operation is its own method rather than one monolithic tick.
import { regenMana } from "./combat.js";
import { boxBlocked } from "./collision.js";
import { BALANCE } from "./balance.js";
import { dist } from "../core/geom.js";

export function createFollowerTrain({ hero, followers, trail, gap, level, deadThisRun, heroTargets, combat, shift, separate }) {
  // Point on the breadcrumb trail `back` world-units behind the head, interpolated
  // along the polyline. Null only before the trail has any points.
  function trailPointBack(back) {
    if (trail.length < 2) return trail[0] || null;
    let acc = 0;
    for (let i = 1; i < trail.length; i++) {
      const seg = dist(trail[i].x, trail[i].y, trail[i - 1].x, trail[i - 1].y);
      if (acc + seg >= back) {
        const t = (back - acc) / (seg || 1);
        return { x: trail[i - 1].x + (trail[i].x - trail[i - 1].x) * t, y: trail[i - 1].y + (trail[i].y - trail[i - 1].y) * t };
      }
      acc += seg;
    }
    return trail[trail.length - 1];
  }

  // Breadcrumb the hero's path (newest first), sampling only on real movement and
  // keeping just enough length for the whole train. Call right after the head moves.
  function sampleTrail() {
    if (!trail.length || dist(hero.x, hero.y, trail[0].x, trail[0].y) > 1) {
      trail.unshift({ x: hero.x, y: hero.y });
      const maxLen = (followers.length + 1) * gap;
      let acc = 0;
      for (let i = 1; i < trail.length; i++) {
        acc += dist(trail[i].x, trail[i].y, trail[i - 1].x, trail[i - 1].y);
        if (acc > maxLen) { trail.length = i + 1; break; }
      }
    }
  }

  function stepFollowers({ dt, rawDt, bpm, minY }) {
    // A follower joins only once the head has descended past its slot, so the train
    // materializes into cleared space instead of stacking at spawn.
    let trailLen = 0;
    for (let t = 1; t < trail.length; t++) trailLen += dist(trail[t].x, trail[t].y, trail[t - 1].x, trail[t - 1].y);

    for (let i = 0; i < followers.length; i++) {
      const f = followers[i];
      if (f.pending) {
        if (trailLen >= (i + 1) * gap) {
          const p = trailPointBack((i + 1) * gap);
          if (p) { f.x = p.x; f.y = p.y; f.pending = false; f.fadeT = BALANCE.spawnFade; }
        }
        continue; // not in play yet — no move, fire, crush, collision, or render
      }
      f.cd = Math.max(0, f.cd - dt);
      f.sigCd = Math.max(0, f.sigCd - dt);
      f.iframes = Math.max(0, f.iframes - dt);
      f.fadeT = Math.max(0, f.fadeT - dt);
      f.rootT = Math.max(0, (f.rootT || 0) - dt); // a void tentacle's root pins a follower off its trail point
      regenMana(f, dt);
      combat.tickHeal(f, dt);
      combat.tickCharge(f, dt); // The Drop's baseline trickle, so a back-line follower still fires
      combat.tickWake(f, dt); // Dash's dust trail, emitted as he retraces the conga path
      const p = trailPointBack((i + 1) * gap);
      // Re-home at a capped speed (its own moveSpeed × the knob), so a shoved follower
      // closes the gap at a steady rate; bpm/rawDt tie its pace to the head's. A rooted
      // follower skips the re-home (it's held fast) but still fires + checks the crush line.
      if (p && !(f.rootT > 0)) {
        const dx = p.x - f.x, dy = p.y - f.y, d = Math.hypot(dx, dy);
        const step = f.derived.moveSpeed * BALANCE.followerReturnSpeedMult * bpm * rawDt;
        if (d <= step || d < 1e-3) { f.x = p.x; f.y = p.y; }
        else { const s = step / d; shift(f, dx * s, 0); shift(f, 0, dy * s); } // per-axis: slide along walls
      }
      // Riding the advancing edge is fine, but being pinned against a wall there is
      // fatal — that's "left behind".
      if (f.y < minY) { f.y = minY; if (boxBlocked(level, f)) { f.dead = true; continue; } }
      const near = combat.nearestEnemyTo(f.x, f.y);
      combat.fireSignature(f, near); // followers contribute only their passive signature, no weapon
    }
  }

  // Soft body: living enemies and corpses shove followers off their trail point.
  // Run after the enemy/hero separation pass so enemy positions are settled. A shove
  // past minY isn't fatal here — stepFollowers catches a genuine pin next frame. No
  // follower-vs-follower push: they're trail-spaced, and mutual separation can fling.
  function separateFollowers({ live, corpses }) {
    for (let i = 0; i < followers.length; i++) {
      const f = followers[i];
      if (f.dead || f.pending) continue;
      for (const e of live) separate(e, f, false);
      for (const c of corpses) separate(c, f, false);
    }
  }

  // Reap dead followers (HP gone or crushed) — permadeath, also off the shot-target list.
  function reapDead() {
    for (let i = followers.length - 1; i >= 0; i--) {
      if (!followers[i].dead) continue;
      deadThisRun.add(followers[i].id); // logged for the campaign's crew cull
      const ti = heroTargets.indexOf(followers[i]);
      if (ti >= 0) heroTargets.splice(ti, 1);
      followers.splice(i, 1);
    }
  }

  return { sampleTrail, stepFollowers, separateFollowers, reapDead };
}
