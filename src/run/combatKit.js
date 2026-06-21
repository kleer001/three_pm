// The weapon/signature fire-dispatch and the generic effect steppers (projectiles, fields,
// turrets), lifted out of the run scene so the party-select preview drives the EXACT same
// combat — same shapes, cadence, and signatures, no hand-kept second copy that drifts.
//
// The world-coupled bits are injected via `env`, so this module stays free of walls, camera,
// loot, and the dummy arena. A new weapon shape or projectile behavior is one change here,
// picked up by both the game and the preview.
//
// env: {
//   enemies, heroTargets,                                        // target lists: player-fire / enemy-fire
//   projectiles, blasts, fields, deployables, swings, floaters,  // effect sinks (live arrays)
//   knockback(t, dx, dy, mag),                                   // apply an impulse (queued+collide / instant shove)
//   projectileBlocked(x, y) -> bool,                             // wall (run) / arena bounds (preview)
//   onDeath(t, attacker),                                        // loot + run-loss (run) / no-op (preview)
//   cullDeployable(d) -> bool,                                   // left behind by the scroll (run) / never (preview)
//   sfx(name),                                                   // play a sound (run) / omitted → silent (preview)
//   shake(mag),                                                  // kick the camera (run) / omitted → no-op (preview)
// }
import { BALANCE, THEME } from "./balance.js";
import { weaponDamage, applyDamage, canCast, spendMana } from "./combat.js";

const FREEZE_DUR = BALANCE.freezeDur;
const LOOT = BALANCE.loot;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export function createCombat(env) {
  const { enemies, projectiles, blasts, fields, deployables, swings, floaters } = env;
  // Sound hook: real in the run, omitted in the party-select preview (a null object so the
  // shared combat code stays one path — no `?.` at every fire/hit site).
  const sfx = env.sfx || (() => {});
  const shake = env.shake || (() => {}); // camera kick on big pulses; same preview null-object

  // A landed hit's HP loss, surfaced as a rising number at the target (spec: honest hits).
  function spawnHitNumber(t, dealt) { floaters.push({ x: t.x, y: t.y, value: Math.round(dealt), t: 0 }); }

  // Credit a charge-signature bearer (The Drop) for damage dealt or taken; only `taken`
  // damage scales the eventual release.
  function creditCharge(e, amount, taken) {
    if (!e || !e.signature || e.signature.shape !== "charge") return;
    e.charge += amount;
    if (taken) e.damageTaken += amount;
  }

  // Resolve a single hit: percent-HP/stat-scaled damage through dmgResist, optional
  // knockback along (kdx,kdy), optional freeze. Every damage source funnels through here so
  // they agree, and so every death routes through the one env.onDeath hook.
  function applyHit(attacker, t, damage, kbMult, kdx, kdy, freeze) {
    const dealt = applyDamage(t, weaponDamage(damage, attacker, t.derived.maxHp, t.hp));
    if (dealt > 0) { spawnHitNumber(t, dealt); creditCharge(attacker, dealt, false); if (t.signature) creditCharge(t, dealt, true); sfx(t.faction === "player" ? "hurt" : "hit"); }
    if (kbMult) env.knockback(t, kdx, kdy, attacker.derived.knockback * kbMult);
    if (freeze && t.def) { t.freezeCount++; t.frozenT = FREEZE_DUR; sfx("freeze"); if (t.freezeCount >= t.def.freezesToKill) t.dead = true; }
    if (t.dead) env.onDeath(t, attacker);
  }

  // Area blast at (cx,cy): hit every enemy overlapping the radius, knocked outward from the
  // center. Shared by nova, bomb detonation, field ticks, and melee. An optional `aim`
  // ({x,y,cosHalf}) restricts hits to an arc (melee swings); omit it for a full circle.
  function blast(cx, cy, radius, attacker, damage, kbMult, freeze, aim) {
    for (const e of enemies) {
      if (e.dead) continue;
      const dx = e.x - cx, dy = e.y - cy, d = Math.hypot(dx, dy);
      if (d > radius + e.r) continue;
      if (aim && (dx * aim.x + dy * aim.y) / (d || 1) < aim.cosHalf) continue; // outside the swing arc
      applyHit(attacker, e, damage, kbMult, dx, dy, freeze);
    }
  }

  // Detonate a bomb projectile: area damage + a visual ring at its position.
  function detonate(p) {
    blast(p.x, p.y, p.radius, p.attacker, p.damage, p.knockback, p.freeze);
    blasts.push({ x: p.x, y: p.y, r: p.radius, t: 0 });
    sfx("explode"); shake(10);
  }

  // Nearest living enemy to a point, with its distance — the shared auto-aim pick.
  function nearestEnemyTo(px, py) {
    let best = null, bd = Infinity;
    for (const e of enemies) {
      if (e.dead) continue;
      const d = dist(e.x, e.y, px, py);
      if (d < bd) { bd = d; best = e; }
    }
    return best && { e: best, d: bd };
  }

  // A melee-arc swing from `attacker` at the nearest enemy `near` ({e,d}): a wedge blast in
  // reach plus its visual. Returns whether it connected. `autofire: "cooldown"` (Whirl)
  // spins every cooldown even with nothing in reach; the default gates on reach.
  function meleeSwing(attacker, w, near) {
    const inReach = near && near.d <= w.radius + near.e.r;
    if (!inReach && w.autofire !== "cooldown") return false;
    const dx = near ? near.e.x - attacker.x : 0, dy = near ? near.e.y - attacker.y : 0, m = Math.hypot(dx, dy) || 1;
    const aim = w.arc >= 360 ? null : { x: dx / m, y: dy / m, cosHalf: Math.cos((w.arc * Math.PI) / 360) };
    blast(attacker.x, attacker.y, w.radius, attacker, w.damage, w.knockback, w.freeze, aim);
    swings.push({ x: attacker.x, y: attacker.y, r: w.radius, ax: dx / m, ay: dy / m, arc: w.arc, t: 0 });
    sfx("swing");
    return true;
  }

  function fireShot(attacker, vx, vy, o) {
    sfx(attacker.faction === "enemy" ? "enemyShoot" : "shoot");
    projectiles.push({
      x: attacker.x, y: attacker.y, ox: attacker.x, oy: attacker.y, vx, vy, life: o.life, life0: o.life, dead: false,
      faction: attacker.faction, attacker, damage: o.damage,
      freeze: o.freeze, knockback: o.knockback, shotR: o.shotR, color: o.color,
      shape: o.shape || "projectile", radius: o.radius, pierce: o.pierce, hits: o.pierce ? new Set() : null,
      fuse: o.fuse != null ? o.fuse : null, impact: o.impact, planted: false, persist: o.persist,
    });
  }

  // Fire `attacker`'s weapon `w` at the nearest enemy `near` ({e,d}) when its cooldown and
  // mana allow, branching on `w.shape` for delivery. One fire path for the hero (gated by
  // SPACE), every follower, and turrets. Sets cooldown + spends mana on a fire.
  function fireWeapon(attacker, w, near, cdKey = "cd") {
    if (attacker[cdKey] > 0 || !canCast(attacker, w.manaCost || 0)) return false;
    let fired = false;
    if (w.shape === "nova") {
      if (near && near.d <= w.radius) {
        blast(attacker.x, attacker.y, w.radius, attacker, w.damage, w.knockback, w.freeze);
        blasts.push({ x: attacker.x, y: attacker.y, r: w.radius, t: 0 });
        sfx("nova"); shake(6);
        fired = true;
      }
    } else if (w.shape === "field") {
      if (near && near.d <= w.range) {
        fields.push({ x: attacker.x, y: attacker.y, r: w.radius, life: w.lifespan, tick: 0, weapon: w, attacker });
        sfx("field");
        fired = true;
      }
    } else if (w.shape === "melee-arc") {
      fired = meleeSwing(attacker, w, near);
    } else if (near && near.d <= w.range) { // projectile / beam / bomb — aimed
      const dx = near.e.x - attacker.x, dy = near.e.y - attacker.y;
      const ang = Math.atan2(dy, dx), n = w.count || 1, spread = n > 1 ? LOOT.splitSpread : 0;
      for (let s = 0; s < n; s++) { // count>1 fans the shots (Split Shot powerup)
        const a = ang + (s - (n - 1) / 2) * spread;
        fireShot(attacker, Math.cos(a) * w.speed, Math.sin(a) * w.speed, {
          damage: w.damage, life: w.life, shotR: w.shotR,
          color: THEME.weaponShot[w.id], freeze: w.freeze, knockback: w.knockback,
          shape: w.shape, radius: w.radius, pierce: w.pierce, fuse: w.fuse, impact: w.impact, persist: w.persist,
        });
      }
      fired = true;
    }
    if (fired) { attacker[cdKey] = w.cd * BALANCE.heroFireCooldownMult; spendMana(attacker, w.manaCost || 0); }
    return fired;
  }

  // --- Signatures (docs/19) ---------------------------------------------------------
  // Deploy a turret at the bearer's spot: a stationary player-faction entity that auto-fires
  // `turretId` and holds world position. Capped per owner (oldest culled).
  function deployTurret(owner, sig) {
    const mine = deployables.filter((d) => d.owner === owner && !d.dead);
    while (mine.length >= sig.maxActive) { mine.shift().dead = true; }
    const w = BALANCE.weapons[sig.turretId];
    deployables.push({
      x: owner.x, y: owner.y, r: 10, owner, faction: "player",
      stats: owner.stats, derived: owner.derived, mana: Infinity, manaRegen: 0,
      cd: 0, life: sig.life, dead: false,
      weapon: { id: sig.turretId, ...w, manaCost: 0, damage: { ...w.damage } },
    });
    return true;
  }

  // Confuse every enemy in radius for confuseDur — handled in the enemy step.
  function confuseBurst(attacker, sig) {
    let any = false;
    for (const e of enemies) {
      if (e.dead || dist(e.x, e.y, attacker.x, attacker.y) > sig.radius + e.r) continue;
      e.confuseT = sig.confuseDur; e.confuseTarget = null; any = true;
    }
    blasts.push({ x: attacker.x, y: attacker.y, r: sig.radius, t: 0 });
    return any;
  }

  // Release a charge signature (The Drop) once its meter fills: a nova whose flat damage is
  // bumped by the damage taken while charging, then reset.
  function releaseCharge(attacker, sig) {
    if (attacker.charge < sig.threshold) return;
    const dmg = { ...sig.damage, base: sig.damage.base + attacker.damageTaken * sig.takenScale };
    blast(attacker.x, attacker.y, sig.radius, attacker, dmg, sig.knockback, sig.freeze);
    blasts.push({ x: attacker.x, y: attacker.y, r: sig.radius, t: 0 });
    sfx("explode"); shake(12);
    attacker.charge = 0; attacker.damageTaken = 0;
  }

  // Resolve a bearer's signature each tick. `heal` is passive (tickHeal); `charge` releases
  // on its meter; the rest reuse fireWeapon on their own `sigCd`, or deploy/confuse.
  function fireSignature(attacker, near) {
    const sig = attacker.signature;
    if (!sig || sig.shape === "heal") return;
    if (sig.shape === "charge") { releaseCharge(attacker, sig); return; }
    if (attacker.sigCd > 0 || !canCast(attacker, sig.manaCost || 0)) return;
    let fired = false;
    if (sig.shape === "deploy") fired = deployTurret(attacker, sig);
    else if (sig.shape === "confuse") fired = confuseBurst(attacker, sig);
    else { fireWeapon(attacker, sig, near, "sigCd"); return; } // sets sigCd + mana itself
    if (fired) { attacker.sigCd = sig.cd * BALANCE.heroFireCooldownMult; spendMana(attacker, sig.manaCost || 0); }
  }

  // Passive HP regen for a `heal` signature (Good Vibes).
  function tickHeal(e, dt) {
    if (e.signature && e.signature.shape === "heal" && !e.dead)
      e.hp = Math.min(e.derived.maxHp, e.hp + e.signature.hpPerSec * dt);
  }

  // Baseline charge for a `charge` signature (The Drop's `trickle`): a follower contributes
  // even when it isn't being hit, so the passive never sits dead. Damage taken still adds on
  // top (creditCharge in applyHit), so tanking ramps it up — only the floor is new.
  function tickCharge(e, dt) {
    if (e.signature && e.signature.shape === "charge" && e.signature.trickle && !e.dead)
      e.charge += e.signature.trickle * dt;
  }

  // --- per-frame steppers -----------------------------------------------------------
  // Projectiles (hero + enemy): resolve each against the opposite faction. Bombs detonate
  // an area on contact/expiry; beams pierce and hit each target once; fuses plant then blast;
  // the rest hit the first target and die.
  // A `persist` shot leaves a spent pellet where it dies (hit or expiry), pushed into the
  // optional `env.debris` sink — purely decorative, omitted in the preview (no sink).
  function dropDebris(p) { if (p.persist && env.debris) env.debris.push({ x: p.x, y: p.y, r: p.shotR }); }

  function stepProjectiles(dt) {
    for (const p of projectiles) {
      if (p.dead) continue;
      if (p.planted) { p.fuse -= dt; if (p.fuse <= 0) { detonate(p); p.dead = true; } continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0 || env.projectileBlocked(p.x, p.y)) {
        if (p.fuse != null) { p.planted = true; p.vx = 0; p.vy = 0; continue; } // plant, then fuse
        if (p.shape === "bomb") detonate(p); // a lob that fizzles still bursts where it lands
        dropDebris(p); p.dead = true; continue;
      }
      const pad = p.faction === "enemy" ? BALANCE.enemyShotHitPad : 0;
      for (const t of (p.faction === "player" ? enemies : env.heroTargets)) {
        if (t.dead || t.pending || t.fadeT > 0) continue; // not-yet-joined or still fading in: can't be hit
        if (dist(p.x, p.y, t.x, t.y) < p.shotR + t.r + pad) {
          if (p.fuse != null) { applyHit(p.attacker, t, p.impact || p.damage, 0, p.vx, p.vy, false); p.planted = true; p.vx = 0; p.vy = 0; break; }
          if (p.shape === "bomb") { detonate(p); p.dead = true; break; }
          if (p.pierce) { if (!p.hits.has(t)) { applyHit(p.attacker, t, p.damage, p.knockback, p.vx, p.vy, p.freeze); p.hits.add(t); } continue; }
          applyHit(p.attacker, t, p.damage, p.knockback, p.vx, p.vy, p.freeze);
          dropDebris(p); p.dead = true; break;
        }
      }
    }
  }

  // Lingering fields tick area damage to enemies inside them, then expire. Field ticks never
  // knock back (a zone that flung enemies out would cycle them for repeat ticks).
  function stepFields(dt) {
    for (const f of fields) {
      f.life -= dt; f.tick -= dt;
      if (f.tick <= 0) {
        blast(f.x, f.y, f.r, f.attacker, f.weapon.damage, 0, f.weapon.freeze);
        if (f.weapon.slow) for (const e of enemies) // Chill Zone also slows everything inside
          if (!e.dead && dist(e.x, e.y, f.x, f.y) <= f.r + e.r) { e.slowT = f.weapon.slowDur; e.slowMult = f.weapon.slow; }
        f.tick = f.weapon.tickInterval;
      }
    }
  }

  // Turrets (Drum Machine): hold world position, auto-fire, expire. `env.cullDeployable`
  // removes one left behind by the descent.
  function stepDeployables(dt) {
    for (const d of deployables) {
      if (d.dead) continue;
      d.life -= dt; d.cd = Math.max(0, d.cd - dt);
      if (d.life <= 0 || env.cullDeployable(d)) { d.dead = true; continue; }
      fireWeapon(d, d.weapon, nearestEnemyTo(d.x, d.y));
    }
  }

  return {
    applyHit, blast, detonate, nearestEnemyTo, meleeSwing, fireShot, fireWeapon,
    creditCharge, spawnHitNumber, deployTurret, confuseBurst, releaseCharge, fireSignature, tickHeal, tickCharge,
    stepProjectiles, stepFields, stepDeployables,
  };
}
