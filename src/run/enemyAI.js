// Enemy brains for the run scene: spec 06's four behavior archetypes
// (chaser/swarmer/shooter/charger) plus the BFS path-following, targeting, and
// knockback-aware speed helpers they share. The slice has no movement integrator,
// so brains steer along a BFS path toward their target rather than emitting a pure
// intent vector — same intent, slice mechanism. Built once per run via
// createEnemyAI(env); env injects the live world plus the coupling callbacks
// (hurtMember/knockback/onEnemyDeath) and the combat kit the brains fire through.
import { moveAndCollide } from "./collision.js";
import { findPath } from "../ai/ai.js";
import { weaponDamage, applyDamage, regenMana, canCast, spendMana } from "./combat.js";
import { BALANCE, THEME } from "./balance.js";
import { dist } from "../core/geom.js";

export function createEnemyAI({ level, enemies, hero, followers, rng, combat, hurtMember, knockback, onEnemyDeath, ts }) {
  const tileOf = (e) => [Math.floor(e.x / ts), Math.floor(e.y / ts)];

  function followPath(e, speed, dt) {
    if (!e.path || e.pi >= e.path.length) return true;
    const [tx, ty] = e.path[e.pi];
    const cx = tx * ts + ts / 2, cy = ty * ts + ts / 2;
    const dx = cx - e.x, dy = cy - e.y, d = Math.hypot(dx, dy) || 1;
    if (d < BALANCE.waypointArrive) { e.pi++; return e.pi >= e.path.length; }
    moveAndCollide(level, e, (dx / d) * speed * dt, (dy / d) * speed * dt);
    return false;
  }

  function repathTo(e, k, tx, ty) {
    e.path = findPath(level, ...tileOf(e), tx, ty) || [];
    e.pi = 0;
    e.repathT = k.repath;
  }

  // Full speed, except while recovering from a knockback: ramp from a near-stop back
  // to full over the stagger window. Chill Zone (slowT) multiplies on top.
  function moveSpeedOf(e) {
    if (e.pauseT > 0) return 0;
    const slow = e.slowT > 0 ? e.slowMult : 1;
    const base = e.staggerT > 0 ? e.derived.moveSpeed * (1 - e.staggerT / e.staggerMax) : e.derived.moveSpeed;
    return base * slow;
  }

  function nearestOtherEnemy(self) {
    let best = null, bd = Infinity;
    for (const e of enemies) {
      if (e.dead || e === self) continue;
      const d = dist(e.x, e.y, self.x, self.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // A confused enemy chases and contact-damages the nearest other enemy — the only
  // enemy-on-enemy damage path (Bad Trip).
  function stepConfused(e, dt) {
    const t = nearestOtherEnemy(e);
    if (!t) return;
    const dx = t.x - e.x, dy = t.y - e.y, d = Math.hypot(dx, dy) || 1;
    moveAndCollide(level, e, (dx / d) * moveSpeedOf(e) * dt, (dy / d) * moveSpeedOf(e) * dt);
    if (d < e.r + t.r && e.def.contactDamage) {
      const dealt = applyDamage(t, e.def.contactDamage);
      if (dealt > 0) { combat.spawnHitNumber(t, dealt); if (t.dead && !t.looted) onEnemyDeath(t); }
    }
  }

  // Each enemy locks onto a living party member at random (so trailing followers
  // draw fire — nearest would always resolve to the head) and keeps it until that
  // member dies, then re-rolls. This is what makes a big party costly to field.
  function targetFor(e) {
    if (e.target && !e.target.dead) return e.target;
    const party = hero.dead ? [] : [hero];
    for (const f of followers) if (!f.dead) party.push(f);
    e.target = party.length ? rng.pick(party) : hero;
    return e.target;
  }

  const BEHAVIORS = {
    chaser(e, dt, tgt, tgtTile) {
      const k = e.def, d = dist(e.x, e.y, tgt.x, tgt.y);
      if (!e.path || e.pi >= e.path.length || e.repathT <= 0) repathTo(e, k, tgtTile[0], tgtTile[1]);
      followPath(e, moveSpeedOf(e), dt);
      if (d < tgt.r + e.r) hurtMember(tgt, k.contactDamage, k.name);
    },

    swarmer(e, dt, tgt, tgtTile) {
      const k = e.def, d = dist(e.x, e.y, tgt.x, tgt.y);
      if (!e.path || e.pi >= e.path.length || e.repathT <= 0) repathTo(e, k, tgtTile[0], tgtTile[1]);
      followPath(e, moveSpeedOf(e), dt);
      const a = rng.next() * Math.PI * 2, j = k.jitter * moveSpeedOf(e) * dt;
      moveAndCollide(level, e, Math.cos(a) * j, Math.sin(a) * j);
      if (d < tgt.r + e.r) hurtMember(tgt, k.contactDamage, k.name);
    },

    // Hold a preferred range: approach, aim (telegraph), fire (costs mana), cool down
    // and kite if the target closes. A tapped-out caster can't start an aim, so it
    // holds and kites until the pool refills — positioning lets you wait one out.
    shooter(e, dt, tgt, tgtTile) {
      const k = e.def, d = dist(e.x, e.y, tgt.x, tgt.y);
      regenMana(e, dt);
      const kite = () => {
        if (d < k.prefRange * k.retreatFrac) {
          const dx = e.x - tgt.x, dy = e.y - tgt.y, m = Math.hypot(dx, dy) || 1;
          moveAndCollide(level, e, (dx / m) * moveSpeedOf(e) * dt, (dy / m) * moveSpeedOf(e) * dt);
        }
      };
      e.state = e.state || "approach";
      if (e.state === "approach") {
        if (d <= k.prefRange) {
          if (canCast(e, k.attack.manaCost)) { e.state = "aim"; e.timer = k.aim; return; }
          kite();
          return;
        }
        if (!e.path || e.pi >= e.path.length || e.repathT <= 0) repathTo(e, k, tgtTile[0], tgtTile[1]);
        followPath(e, moveSpeedOf(e), dt);
      } else if (e.state === "aim") {
        e.timer -= dt;
        if (e.timer <= 0) {
          const dx = tgt.x - e.x, dy = tgt.y - e.y, m = Math.hypot(dx, dy) || 1;
          combat.fireShot(e, (dx / m) * k.shot, (dy / m) * k.shot, {
            damage: k.attack, life: BALANCE.enemyShotLife, shotR: THEME.enemyShot.r,
            color: THEME.enemyShot.color, freeze: false, knockback: 0,
          });
          spendMana(e, k.attack.manaCost);
          e.state = "cooldown"; e.timer = k.cooldown;
        }
      } else {
        e.timer -= dt;
        kite();
        if (e.timer <= 0) e.state = "approach";
      }
    },

    // Approach to lunge range, telegraph (intent frozen — the counterplay window),
    // then dash along the aim captured at telegraph start. A sidestep during the
    // wind-up dodges the lunge because the aim is locked, not tracked.
    charger(e, dt, tgt, tgtTile) {
      const k = e.def, d = dist(e.x, e.y, tgt.x, tgt.y);
      e.state = e.state || "approach";
      if (e.state === "approach") {
        if (d <= k.lungeRange) {
          const dx = tgt.x - e.x, dy = tgt.y - e.y, m = Math.hypot(dx, dy) || 1;
          e.lockAim = { x: dx / m, y: dy / m };
          e.state = "telegraph"; e.timer = k.telegraph;
          return;
        }
        if (!e.path || e.pi >= e.path.length || e.repathT <= 0) repathTo(e, k, tgtTile[0], tgtTile[1]);
        followPath(e, moveSpeedOf(e), dt);
        if (d < tgt.r + e.r) hurtMember(tgt, k.contactDamage, k.name);
      } else if (e.state === "telegraph") {
        e.timer -= dt;
        if (e.timer <= 0) { e.state = "lunge"; e.timer = k.lungeDur; e.lunged = false; }
      } else if (e.state === "lunge") {
        e.timer -= dt;
        moveAndCollide(level, e, e.lockAim.x * k.lungeSpeed * dt, e.lockAim.y * k.lungeSpeed * dt);
        if (!e.lunged && d < tgt.r + e.r) {
          hurtMember(tgt, weaponDamage(k.attack, e, tgt.derived.maxHp, tgt.hp), k.name);
          knockback(tgt, tgt.x - e.x, tgt.y - e.y, e.derived.knockback * k.attack.knockback);
          e.lunged = true;
        }
        if (e.timer <= 0) { e.state = "cooldown"; e.timer = k.cooldown; }
      } else {
        e.timer -= dt;
        if (d < tgt.r + e.r) hurtMember(tgt, k.contactDamage, k.name);
        if (e.timer <= 0) e.state = "approach";
      }
    },
  };

  // repathT ticks here so every brain shares one repath clock; the target (head or a
  // follower) and its tile are resolved before dispatching by def.behavior.
  function stepEnemy(e, dt) {
    e.repathT -= dt;
    const tgt = targetFor(e);
    BEHAVIORS[e.def.behavior](e, dt, tgt, tileOf(tgt));
  }

  return { stepEnemy, stepConfused };
}
