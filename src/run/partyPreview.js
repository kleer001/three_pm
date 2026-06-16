// Live action-preview for the party picker: a self-contained mini-sim that shows one
// highlighted character auto-firing its weapon AND signature at two dummy targets — one
// a couple body-lengths below (catches projectiles; sits in range of every weapon) and one
// off to the side (shows knockback). A downed dummy vanishes and respawns at its spot.
//
// Isolation by design: this reuses the EXPORTED combat math from combat.js (so cadence,
// mana, and damage match the real game), but carries its own trimmed fire-dispatch, effect
// arrays, and draw helpers rather than touching the 1200-line run scene. If a NEW weapon
// shape is ever added there it must be added here too (a missing shape just doesn't fire).

import { BALANCE, THEME } from "./balance.js";
import { recomputeDerived, weaponDamage, applyDamage, regenMana, canCast, spendMana } from "./combat.js";

const FREEZE_DUR = BALANCE.freezeDur;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// Arena tuning — a tiny static target range (no marching wave).
const HEAL_PULSE = 1.0;   // seconds between Good Vibes pulse visuals
const KB_SCALE = 7;       // px of shove per unit of weapon knockback (preview-only feel)
const RESPAWN = 0.7;      // seconds a downed dummy stays gone before reappearing at its spot
const RETURN = 0.05;      // per-frame drift of a shoved dummy back toward its anchor
const HERO_Y = 0.18;      // hero's vertical position as a fraction of arena height
const DOWN = 58;          // projectile target: this far straight below the hero (in melee range)
const SIDE_DX = 62, SIDE_DY = 30; // knockback target: offset to the side, slightly farther out
const DUMMY_HP = 80;      // punching-bag HP — survives a few hits so knockback is visible before it drops

export function createPartyPreview(ctx, rect) {
  // Effect/entity state — all in arena-LOCAL coords (origin at the rect's top-left).
  let hero = null;
  const enemies = [], projectiles = [], blasts = [], swings = [], fields = [], deployables = [], floaters = [];

  const resolveSig = (id) => {
    if (!id) return null;
    const s = BALANCE.signatures[id];
    return { id, ...s, damage: s.damage ? { ...s.damage } : undefined };
  };

  function buildHero(def) {
    const wdef = BALANCE.weapons[def.weaponId];
    const h = {
      x: rect.w / 2, y: rect.h * HERO_Y, r: BALANCE.hero.r,
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

  // A dummy target anchored at a fixed spot (ax,ay): it holds position (drifting home after a
  // shove) and respawns there a beat after going down — it never marches.
  function makeDummy(ax, ay) {
    const def = BALANCE.enemies.shambler; // baseline marcher — visible chip, honest TTK
    const e = {
      def, faction: "enemy", stats: def.stats, r: def.r, color: def.color,
      x: ax, y: ay, ax, ay, respawnT: 0, down: false,
      iframes: 0, dead: false, frozenT: 0, freezeCount: 0, confuseT: 0,
    };
    recomputeDerived(e, BALANCE.derive);
    e.derived.maxHp = DUMMY_HP; e.hp = DUMMY_HP; // tanky bag so hits land repeatedly + knockback shows
    return e;
  }
  function reviveDummy(e) {
    e.x = e.ax; e.y = e.ay; e.hp = e.derived.maxHp;
    e.dead = false; e.down = false; e.respawnT = 0; e.frozenT = 0; e.freezeCount = 0; e.confuseT = 0;
  }

  // (Re)build the sim for a highlighted character. null clears the arena.
  function setHero(def) {
    hero = def ? buildHero(def) : null;
    enemies.length = projectiles.length = blasts.length = swings.length = 0;
    fields.length = deployables.length = floaters.length = 0;
    if (hero) {
      enemies.push(makeDummy(rect.w / 2, hero.y + DOWN));               // below — catches projectiles
      enemies.push(makeDummy(rect.w / 2 + SIDE_DX, hero.y + SIDE_DY));  // to the side — shows knockback
    }
  }

  // --- fire path (trimmed copy of runScene's; adds a simple knockback shove) ---------
  const nearestEnemyTo = (px, py) => {
    let best = null, bd = Infinity;
    for (const e of enemies) { if (e.dead) continue; const d = dist(e.x, e.y, px, py); if (d < bd) { bd = d; best = e; } }
    return best && { e: best, d: bd };
  };

  function creditCharge(e, amount) {
    if (e && e.signature && e.signature.shape === "charge") e.charge += amount;
  }
  function spawnFloater(x, y, value, color) { floaters.push({ x, y, value, t: 0, color }); }

  // `kb` shoves `t` away from the source (sx,sy) — defaults to the attacker's position.
  function applyHit(attacker, t, damage, freeze, kb, sx, sy) {
    const dealt = applyDamage(t, weaponDamage(damage, attacker, t.derived.maxHp, t.hp));
    if (dealt > 0) { spawnFloater(t.x, t.y, Math.round(dealt)); creditCharge(attacker, dealt); }
    if (freeze && t.def) { t.freezeCount++; t.frozenT = FREEZE_DUR; if (t.freezeCount >= t.def.freezesToKill) t.dead = true; }
    if (kb) {
      const ox = sx != null ? sx : attacker.x, oy = sy != null ? sy : attacker.y;
      const dx = t.x - ox, dy = t.y - oy, m = Math.hypot(dx, dy) || 1;
      t.x += (dx / m) * kb * KB_SCALE; t.y += (dy / m) * kb * KB_SCALE;
    }
  }

  function blast(cx, cy, radius, attacker, damage, freeze, aim, kb) {
    for (const e of enemies) {
      if (e.dead) continue;
      const dx = e.x - cx, dy = e.y - cy, d = Math.hypot(dx, dy);
      if (d > radius + e.r) continue;
      if (aim && (dx * aim.x + dy * aim.y) / (d || 1) < aim.cosHalf) continue; // outside the swing arc
      applyHit(attacker, e, damage, freeze, kb, cx, cy);
    }
  }

  function detonate(p) { blast(p.x, p.y, p.radius, p.attacker, p.damage, p.freeze, null, p.knockback); blasts.push({ x: p.x, y: p.y, r: p.radius, t: 0 }); }

  function fireShot(attacker, vx, vy, o) {
    projectiles.push({
      x: attacker.x, y: attacker.y, ox: attacker.x, oy: attacker.y, vx, vy, life: o.life, life0: o.life, dead: false,
      attacker, damage: o.damage, freeze: o.freeze, knockback: o.knockback || 0, shotR: o.shotR, color: o.color || "#ddd",
      shape: o.shape || "projectile", radius: o.radius, pierce: o.pierce, hits: o.pierce ? new Set() : null,
      fuse: o.fuse != null ? o.fuse : null, impact: o.impact, planted: false,
    });
  }

  function meleeSwing(attacker, w, near) {
    const inReach = near && near.d <= w.radius + near.e.r;
    if (!inReach && w.autofire !== "cooldown") return false;
    const dx = near ? near.e.x - attacker.x : 0, dy = near ? near.e.y - attacker.y : 0, m = Math.hypot(dx, dy) || 1;
    const aim = w.arc >= 360 ? null : { x: dx / m, y: dy / m, cosHalf: Math.cos((w.arc * Math.PI) / 360) };
    blast(attacker.x, attacker.y, w.radius, attacker, w.damage, w.freeze, aim, w.knockback);
    swings.push({ x: attacker.x, y: attacker.y, r: w.radius, ax: dx / m, ay: dy / m, arc: w.arc, t: 0 });
    return true;
  }

  function fireWeapon(attacker, w, near, cdKey = "cd") {
    if (attacker[cdKey] > 0 || !canCast(attacker, w.manaCost || 0)) return false;
    let fired = false;
    if (w.shape === "nova") {
      if (near && near.d <= w.radius) { blast(attacker.x, attacker.y, w.radius, attacker, w.damage, w.freeze, null, w.knockback); blasts.push({ x: attacker.x, y: attacker.y, r: w.radius, t: 0 }); fired = true; }
    } else if (w.shape === "field") {
      if (near && near.d <= w.range) { fields.push({ x: attacker.x, y: attacker.y, r: w.radius, life: w.lifespan, tick: 0, weapon: w, attacker }); fired = true; }
    } else if (w.shape === "melee-arc") {
      fired = meleeSwing(attacker, w, near);
    } else if (near && near.d <= w.range) { // projectile / beam / bomb — aimed
      const ang = Math.atan2(near.e.y - attacker.y, near.e.x - attacker.x);
      fireShot(attacker, Math.cos(ang) * w.speed, Math.sin(ang) * w.speed, {
        damage: w.damage, life: w.life, shotR: w.shotR, color: THEME.weaponShot[w.id],
        freeze: w.freeze, knockback: w.knockback, shape: w.shape, radius: w.radius, pierce: w.pierce, fuse: w.fuse, impact: w.impact,
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
    blast(attacker.x, attacker.y, sig.radius, attacker, dmg, sig.freeze, null, sig.knockback);
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
  }

  function update(dt) {
    if (!hero) return;
    hero.cd = Math.max(0, hero.cd - dt);
    hero.sigCd = Math.max(0, hero.sigCd - dt);
    hero.iframes = Math.max(0, hero.iframes - dt);
    regenMana(hero, dt);
    tickHeal(hero, dt);

    const near = nearestEnemyTo(hero.x, hero.y);
    fireWeapon(hero, hero.weapon, near);
    fireSignature(hero, near);

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
          if (p.fuse != null) { applyHit(p.attacker, t, p.impact || p.damage, false, 0); p.planted = true; p.vx = 0; p.vy = 0; break; }
          if (p.shape === "bomb") { detonate(p); p.dead = true; break; }
          if (p.pierce) { if (!p.hits.has(t)) { applyHit(p.attacker, t, p.damage, p.freeze, p.knockback); p.hits.add(t); } continue; }
          applyHit(p.attacker, t, p.damage, p.freeze, p.knockback); p.dead = true; break;
        }
      }
    }

    for (const f of fields) {
      f.life -= dt; f.tick -= dt;
      if (f.tick <= 0) { blast(f.x, f.y, f.r, f.attacker || hero, f.weapon.damage, f.weapon.freeze, null, f.weapon.knockback); f.tick = f.weapon.tickInterval; }
    }

    // Dummies hold their spot: drift home after a shove, tick freeze/confuse, and respawn a
    // beat after going down (any cause — hp or freeze). They never march.
    for (const e of enemies) {
      if (e.dead || e.hp <= 0) {
        if (!e.down) { e.dead = true; e.down = true; e.respawnT = RESPAWN; } // the frame it drops
        else { e.respawnT -= dt; if (e.respawnT <= 0) reviveDummy(e); }
        continue;
      }
      if (e.frozenT > 0) e.frozenT -= dt;
      if (e.confuseT > 0) e.confuseT -= dt;
      e.x += (e.ax - e.x) * RETURN; e.y += (e.ay - e.y) * RETURN; // ease back so it can be shoved again
    }

    for (const b of blasts) b.t += dt;
    for (const s of swings) s.t += dt;
    for (const f of floaters) f.t += dt;
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
      if (hero.weapon.manaCost > 0) { by -= B.h + 1; bar(hero.x, by, hero.mana / hero.derived.maxMana, hero.mana >= hero.weapon.manaCost ? B.mana : B.tapped); }
      if (hero.signature && hero.signature.shape === "charge") { by -= B.h + 1; bar(hero.x, by, hero.charge / hero.signature.threshold, THEME.charge.fill); }
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
