// Live action-preview for the party picker: a self-contained mini-sim that shows one
// highlighted character in its ROLE — the head auto-fires its active weapon, a follower
// auto-fires only its passive signature (matching the in-run split) — at dummy enemies
// marching up a tall arena. It exists so the player can SEE what a hero contributes
// before committing to a party.
//
// Isolation by design: this reuses the EXPORTED combat math from combat.js (so cadence,
// mana, and damage match the real game), but carries its own trimmed fire-dispatch,
// effect arrays, and draw helpers rather than touching the 1200-line run scene. The
// shared logic already lives in combat.js — that is the DRY seam; the run scene stays
// untouched. The fire/draw branches mirror runScene.js; if a NEW weapon shape is ever
// added there it must be added here too (a missing shape just doesn't fire — never throws).

import { BALANCE, THEME } from "./balance.js";
import { recomputeDerived, weaponDamage, applyDamage, regenMana, canCast, spendMana } from "./combat.js";

const FREEZE_DUR = BALANCE.freezeDur;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// Arena tuning — small bounded sim, far lighter than a real run.
const MARCH = 70;        // enemy upward march speed (px/s)
const TARGET = 5;        // live-enemy population the trickle maintains
const SPAWN_INT = 0.7;   // seconds between spawns while under target
const SWAY_RATE = 1.6;   // hero side-to-side angular rate
const SWAY_FRAC = 0.30;  // sway amplitude as a fraction of arena width
const HEAL_PULSE = 1.0;  // seconds between Good Vibes pulse visuals
const LANES = [0.25, 0.5, 0.75]; // enemy spawn columns across the arena width

export function createPartyPreview(ctx, rect) {
  // Effect/entity state — all in arena-LOCAL coords (origin at the rect's top-left).
  let hero = null;
  let role = "head"; // "head" → fire active weapon only; "follower" → passive signature only
  const enemies = [], projectiles = [], blasts = [], swings = [], fields = [], deployables = [], floaters = [];
  let swayT = 0, spawnT = 0, lane = 0;

  const resolveSig = (id) => {
    if (!id) return null;
    const s = BALANCE.signatures[id];
    return { id, ...s, damage: s.damage ? { ...s.damage } : undefined };
  };

  function buildHero(def) {
    const wdef = BALANCE.weapons[def.weaponId];
    const h = {
      x: rect.w / 2, y: rect.h * 0.18, baseX: rect.w / 2, r: BALANCE.hero.r,
      faction: "player", color: def.color, stats: { ...(def.stats || BALANCE.hero.stats) },
      iframes: 0, iframeDur: BALANCE.hero.iframeDur, manaRegen: BALANCE.hero.manaRegen, dead: false,
      cd: 0, sigCd: 0, charge: 0, damageTaken: 0, healPulseT: 0,
      weapon: { id: def.weaponId, ...wdef, damage: { ...wdef.damage } },
      signature: resolveSig(def.signatureId),
    };
    recomputeDerived(h, BALANCE.derive);
    h.hp = h.derived.maxHp; h.mana = h.derived.maxMana;
    return h;
  }

  // Spawn a marcher at the given y (defaults to just below the arena, the live trickle).
  function spawnEnemy(y) {
    const def = BALANCE.enemies.shambler; // baseline marcher — visible chip, honest TTK
    const e = {
      def, faction: "enemy", stats: def.stats, r: def.r, color: def.color,
      x: LANES[lane] * rect.w, y: y != null ? y : rect.h + def.r + 4,
      iframes: 0, dead: false, frozenT: 0, freezeCount: 0, confuseT: 0,
    };
    recomputeDerived(e, BALANCE.derive);
    e.hp = e.derived.maxHp;
    enemies.push(e);
    lane = (lane + 1) % LANES.length;
  }

  // (Re)build the sim for a highlighted character in a given role ("head" fires its weapon,
  // "follower" fires its signature). null clears the arena.
  function setHero(def, r = "head") {
    hero = def ? buildHero(def) : null;
    role = r;
    enemies.length = projectiles.length = blasts.length = swings.length = 0;
    fields.length = deployables.length = floaters.length = 0;
    swayT = 0; spawnT = 0; lane = 0;
    // Seed enemies spread up the arena so there's instant action and a melee/nova hero
    // gets a target near the top within a second or two (not a long empty march-in).
    if (hero) for (const fy of [0.45, 0.68, 0.9]) spawnEnemy(rect.h * fy);
  }

  // --- fire path (trimmed copy of runScene's; no knockback/loot/collision) ----------
  const nearestEnemyTo = (px, py) => {
    let best = null, bd = Infinity;
    for (const e of enemies) { if (e.dead) continue; const d = dist(e.x, e.y, px, py); if (d < bd) { bd = d; best = e; } }
    return best && { e: best, d: bd };
  };

  function creditCharge(e, amount) {
    if (e && e.signature && e.signature.shape === "charge") e.charge += amount;
  }
  function spawnFloater(x, y, value, color) { floaters.push({ x, y, value, t: 0, color }); }

  function applyHit(attacker, t, damage, freeze) {
    const dealt = applyDamage(t, weaponDamage(damage, attacker, t.derived.maxHp, t.hp));
    if (dealt > 0) { spawnFloater(t.x, t.y, Math.round(dealt)); creditCharge(attacker, dealt); }
    if (freeze && t.def) { t.freezeCount++; t.frozenT = FREEZE_DUR; if (t.freezeCount >= t.def.freezesToKill) t.dead = true; }
  }

  function blast(cx, cy, radius, attacker, damage, freeze, aim) {
    for (const e of enemies) {
      if (e.dead) continue;
      const dx = e.x - cx, dy = e.y - cy, d = Math.hypot(dx, dy);
      if (d > radius + e.r) continue;
      if (aim && (dx * aim.x + dy * aim.y) / (d || 1) < aim.cosHalf) continue; // outside the swing arc
      applyHit(attacker, e, damage, freeze);
    }
  }

  function detonate(p) { blast(p.x, p.y, p.radius, p.attacker, p.damage, p.freeze); blasts.push({ x: p.x, y: p.y, r: p.radius, t: 0 }); }

  function fireShot(attacker, vx, vy, o) {
    projectiles.push({
      x: attacker.x, y: attacker.y, ox: attacker.x, oy: attacker.y, vx, vy, life: o.life, life0: o.life, dead: false,
      attacker, damage: o.damage, freeze: o.freeze, shotR: o.shotR, color: o.color || "#ddd",
      shape: o.shape || "projectile", radius: o.radius, pierce: o.pierce, hits: o.pierce ? new Set() : null,
      fuse: o.fuse != null ? o.fuse : null, impact: o.impact, planted: false,
    });
  }

  function meleeSwing(attacker, w, near) {
    const inReach = near && near.d <= w.radius + near.e.r;
    if (!inReach && w.autofire !== "cooldown") return false;
    const dx = near ? near.e.x - attacker.x : 0, dy = near ? near.e.y - attacker.y : 0, m = Math.hypot(dx, dy) || 1;
    const aim = w.arc >= 360 ? null : { x: dx / m, y: dy / m, cosHalf: Math.cos((w.arc * Math.PI) / 360) };
    blast(attacker.x, attacker.y, w.radius, attacker, w.damage, w.freeze, aim);
    swings.push({ x: attacker.x, y: attacker.y, r: w.radius, ax: dx / m, ay: dy / m, arc: w.arc, t: 0 });
    return true;
  }

  function fireWeapon(attacker, w, near, cdKey = "cd") {
    if (attacker[cdKey] > 0 || !canCast(attacker, w.manaCost || 0)) return false;
    let fired = false;
    if (w.shape === "nova") {
      if (near && near.d <= w.radius) { blast(attacker.x, attacker.y, w.radius, attacker, w.damage, w.freeze); blasts.push({ x: attacker.x, y: attacker.y, r: w.radius, t: 0 }); fired = true; }
    } else if (w.shape === "field") {
      if (near && near.d <= w.range) { fields.push({ x: attacker.x, y: attacker.y, r: w.radius, life: w.lifespan, tick: 0, weapon: w, attacker }); fired = true; }
    } else if (w.shape === "melee-arc") {
      fired = meleeSwing(attacker, w, near);
    } else if (near && near.d <= w.range) { // projectile / beam / bomb — aimed
      const ang = Math.atan2(near.e.y - attacker.y, near.e.x - attacker.x);
      fireShot(attacker, Math.cos(ang) * w.speed, Math.sin(ang) * w.speed, {
        damage: w.damage, life: w.life, shotR: w.shotR, color: THEME.weaponShot[w.id],
        freeze: w.freeze, shape: w.shape, radius: w.radius, pierce: w.pierce, fuse: w.fuse, impact: w.impact,
      });
      fired = true;
    }
    if (fired) { attacker[cdKey] = w.cd; spendMana(attacker, w.manaCost || 0); }
    return fired;
  }

  // --- signatures (trimmed; honest reps for the non-damage shapes) ------------------
  function deployTurret(owner, sig) {
    const mine = deployables.filter((d) => d.owner === owner && !d.dead);
    while (mine.length >= sig.maxActive) mine.shift().dead = true;
    const w = BALANCE.weapons[sig.turretId];
    deployables.push({
      x: owner.x, y: owner.y, r: 10, owner, faction: "player",
      stats: owner.stats, derived: owner.derived, mana: Infinity, manaRegen: 0,
      cd: 0, life: sig.life, dead: false, weapon: { id: sig.turretId, ...w, manaCost: 0, damage: { ...w.damage } },
    });
    return true;
  }
  function confuseBurst(attacker, sig) {
    let any = false;
    for (const e of enemies) { if (e.dead || dist(e.x, e.y, attacker.x, attacker.y) > sig.radius + e.r) continue; e.confuseT = sig.confuseDur; any = true; }
    blasts.push({ x: attacker.x, y: attacker.y, r: sig.radius, t: 0 });
    return any;
  }
  function releaseCharge(attacker, sig) {
    if (attacker.charge < sig.threshold) return;
    const dmg = { ...sig.damage, base: sig.damage.base + attacker.damageTaken * sig.takenScale };
    blast(attacker.x, attacker.y, sig.radius, attacker, dmg, sig.freeze);
    blasts.push({ x: attacker.x, y: attacker.y, r: sig.radius, t: 0 });
    attacker.charge = 0; attacker.damageTaken = 0;
  }
  function tickHeal(h, dt) {
    const sig = h.signature;
    if (!sig || sig.shape !== "heal") return;
    h.hp = Math.min(h.derived.maxHp, h.hp + sig.hpPerSec * dt);
    h.healPulseT -= dt;
    if (h.healPulseT <= 0) { blasts.push({ x: h.x, y: h.y, r: h.r * 2.4, t: 0, heal: true }); spawnFloater(h.x, h.y, "+", THEME.party.start); h.healPulseT = HEAL_PULSE; }
  }
  function fireSignature(attacker, near) {
    const sig = attacker.signature;
    if (!sig || sig.shape === "heal") return; // passive — tickHeal handles it
    if (sig.shape === "charge") { releaseCharge(attacker, sig); return; }
    if (attacker.sigCd > 0 || !canCast(attacker, sig.manaCost || 0)) return;
    let fired = false;
    if (sig.shape === "deploy") fired = deployTurret(attacker, sig);
    else if (sig.shape === "confuse") fired = confuseBurst(attacker, sig);
    else { fireWeapon(attacker, sig, near, "sigCd"); return; }
    if (fired) { attacker.sigCd = sig.cd; spendMana(attacker, sig.manaCost || 0); }
  }

  // --- per-frame sim ---------------------------------------------------------------
  function reap() {
    for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].dead) projectiles.splice(i, 1);
    for (let i = fields.length - 1; i >= 0; i--) if (fields[i].life <= 0) fields.splice(i, 1);
    for (let i = deployables.length - 1; i >= 0; i--) if (deployables[i].dead) deployables.splice(i, 1);
    for (let i = blasts.length - 1; i >= 0; i--) if (blasts[i].t >= THEME.blast.dur) blasts.splice(i, 1);
    for (let i = swings.length - 1; i >= 0; i--) if (swings[i].t >= THEME.melee.dur) swings.splice(i, 1);
    for (let i = floaters.length - 1; i >= 0; i--) if (floaters[i].t >= THEME.hitNumber.dur) floaters.splice(i, 1);
    for (let i = enemies.length - 1; i >= 0; i--) { const e = enemies[i]; if (e.dead || e.y < -e.r) enemies.splice(i, 1); }
  }

  function update(dt) {
    if (!hero) return;
    swayT += dt;
    hero.x = clamp(hero.baseX + Math.sin(swayT * SWAY_RATE) * rect.w * SWAY_FRAC, hero.r, rect.w - hero.r);
    hero.cd = Math.max(0, hero.cd - dt);
    hero.sigCd = Math.max(0, hero.sigCd - dt);
    hero.iframes = Math.max(0, hero.iframes - dt);
    regenMana(hero, dt);

    const near = nearestEnemyTo(hero.x, hero.y);
    if (role === "head") {
      fireWeapon(hero, hero.weapon, near); // head: active weapon only, no signature
    } else {
      tickHeal(hero, dt);                  // follower: passive signature only (heal ticks here)
      fireSignature(hero, near);
    }

    for (const d of deployables) {
      if (d.dead) continue;
      d.life -= dt; d.cd = Math.max(0, d.cd - dt);
      if (d.life <= 0) { d.dead = true; continue; }
      fireWeapon(d, d.weapon, nearestEnemyTo(d.x, d.y));
    }

    for (const p of projectiles) {
      if (p.dead) continue;
      if (p.planted) { p.fuse -= dt; if (p.fuse <= 0) { detonate(p); p.dead = true; } continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0 || p.x < 0 || p.x > rect.w || p.y < 0 || p.y > rect.h) {
        if (p.fuse != null) { p.planted = true; p.vx = 0; p.vy = 0; continue; }
        if (p.shape === "bomb") detonate(p);
        p.dead = true; continue;
      }
      for (const t of enemies) {
        if (t.dead) continue;
        if (dist(p.x, p.y, t.x, t.y) < p.shotR + t.r) {
          if (p.fuse != null) { applyHit(p.attacker, t, p.impact || p.damage, false); p.planted = true; p.vx = 0; p.vy = 0; break; }
          if (p.shape === "bomb") { detonate(p); p.dead = true; break; }
          if (p.pierce) { if (!p.hits.has(t)) { applyHit(p.attacker, t, p.damage, p.freeze); p.hits.add(t); } continue; }
          applyHit(p.attacker, t, p.damage, p.freeze); p.dead = true; break;
        }
      }
    }

    for (const f of fields) {
      f.life -= dt; f.tick -= dt;
      if (f.tick <= 0) { blast(f.x, f.y, f.r, f.attacker || hero, f.weapon.damage, f.weapon.freeze); f.tick = f.weapon.tickInterval; }
    }

    for (const e of enemies) {
      if (e.dead) continue;
      if (e.frozenT > 0) { e.frozenT -= dt; continue; }       // frozen: no march
      if (e.confuseT > 0) { e.confuseT -= dt; continue; }     // Bad Trip: halt while turned
      e.y -= MARCH * dt;
    }

    for (const b of blasts) b.t += dt;
    for (const s of swings) s.t += dt;
    for (const f of floaters) f.t += dt;

    spawnT -= dt;
    if (enemies.filter((e) => !e.dead).length < TARGET && spawnT <= 0) { spawnEnemy(); spawnT = SPAWN_INT; }
    reap();
  }

  // --- render (clipped to the rect; arena-local coords via translate) ---------------
  function disc(x, y, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  function ring(x, y, r, color) { ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); }
  function bar(cx, y, frac, fill) {
    const B = THEME.bar, x = cx - B.w / 2;
    ctx.fillStyle = B.back; ctx.fillRect(x, y, B.w, B.h);
    ctx.fillStyle = fill; ctx.fillRect(x, y, B.w * clamp(frac, 0, 1), B.h);
  }

  function render() {
    const P = THEME.party;
    ctx.fillStyle = P.card; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = P.border; ctx.lineWidth = 1; ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    ctx.translate(rect.x, rect.y);

    if (!hero) {
      ctx.fillStyle = P.hint; ctx.font = P.hintFont; ctx.textAlign = "center";
      ctx.fillText("(no one selected)", rect.w / 2, rect.h / 2);
      ctx.textAlign = "left"; ctx.restore(); return;
    }

    for (const f of fields) { disc(f.x, f.y, f.r, THEME.field.fill); ring(f.x, f.y, f.r, THEME.field.ring); }
    for (const d of deployables) { if (d.dead) continue; disc(d.x, d.y, d.r, THEME.deploy.fill); ring(d.x, d.y, d.r + 2, THEME.deploy.ring); }

    for (const p of projectiles) {
      if (p.pierce) {
        const env = Math.sin(Math.PI * (1 - p.life / p.life0));
        ctx.globalAlpha = Math.max(0, env); ctx.strokeStyle = p.color; ctx.lineWidth = THEME.beam.width * env + 1; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(p.ox, p.oy); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.globalAlpha = 1; ctx.lineWidth = 1;
      } else disc(p.x, p.y, p.shotR, p.color);
    }

    for (const e of enemies) {
      if (e.dead) continue;
      disc(e.x, e.y, e.r, e.color);
      if (e.confuseT > 0) { disc(e.x, e.y, e.r, THEME.confuse.fill); ring(e.x, e.y, e.r + 2, THEME.confuse.ring); }
      if (e.frozenT > 0) { disc(e.x, e.y, e.r, THEME.freeze.fill); ring(e.x, e.y, e.r + THEME.freeze.ringPad, THEME.freeze.ring); }
      if (e.hp < e.derived.maxHp) bar(e.x, e.y - e.r - THEME.bar.gap - THEME.bar.h, e.hp / e.derived.maxHp, THEME.bar.hp);
    }

    for (const b of blasts) ring(b.x, b.y, b.r * (0.4 + 0.6 * b.t / THEME.blast.dur), b.heal ? P.start : THEME.blast.ring);

    for (const s of swings) {
      const a = Math.atan2(s.ay, s.ax), half = s.arc * Math.PI / 360;
      ctx.globalAlpha = 1 - s.t / THEME.melee.dur; ctx.fillStyle = THEME.melee.swing;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.arc(s.x, s.y, s.r, a - half, a + half); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }

    disc(hero.x, hero.y, hero.r, hero.color);
    {
      const B = THEME.bar;
      let by = hero.y - hero.r - B.gap - B.h;
      bar(hero.x, by, hero.hp / hero.derived.maxHp, B.hp);
      // Mana/charge reflect the role's active ability: the head's weapon, or the follower's signature.
      const sig = hero.signature;
      const manaCost = role === "head" ? hero.weapon.manaCost : (sig ? sig.manaCost || 0 : 0);
      if (manaCost > 0) { by -= B.h + 1; bar(hero.x, by, hero.mana / hero.derived.maxMana, hero.mana >= manaCost ? B.mana : B.tapped); }
      if (role !== "head" && sig && sig.shape === "charge") { by -= B.h + 1; bar(hero.x, by, hero.charge / sig.threshold, THEME.charge.fill); }
    }

    const HN = THEME.hitNumber;
    ctx.font = HN.font; ctx.textAlign = "center";
    for (const f of floaters) {
      ctx.globalAlpha = (1 - f.t / HN.dur) * HN.alpha; ctx.fillStyle = f.color || HN.color;
      ctx.fillText(f.value, f.x, f.y - f.t * HN.rise);
    }
    ctx.globalAlpha = 1; ctx.textAlign = "left";
    ctx.restore();
  }

  return { setHero, update, render };
}
