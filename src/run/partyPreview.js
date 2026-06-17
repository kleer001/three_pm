// Live action-preview for the party picker: a self-contained mini-sim that shows one
// highlighted character acting in its party role at two dummy targets — one a couple
// body-lengths below (catches projectiles; sits in range of every weapon) and one off to
// the side (shows knockback). A downed dummy vanishes and respawns at its spot.
//
// Role-accurate (matches runScene): a "head" fires ONLY its active weapon (no signature,
// no passive); a "follower" contributes ONLY its passive signature (no weapon). setHero's
// `role` arg picks which — so the preview never shows a hero doing both at once.
//
// The combat itself is the shared combatKit, driven with the SAME shapes, cadence, and
// signatures as the run scene — no second hand-kept dispatch to drift out of sync. Only the
// arena is preview-local: two stationary dummies, a tiny shove for knockback feel, and
// rect-clipped, rect-local rendering. The body + readouts are drawn by the shared drawMember.

import { BALANCE, THEME } from "./balance.js";
import { recomputeDerived, regenMana } from "./combat.js";
import { createCombat } from "./combatKit.js";
import { disc, ring, bar, drawMember } from "./draw.js";

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// Arena tuning — a tiny static target range (no marching wave).
const KB_SHOVE = 1.2;     // px of shove per unit of resolved knockback (preview-only feel)
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

  // Shared combat, wired to the arena: hits land on the dummies, knockback is a cosmetic
  // shove, shots die at the rect edge, and nothing rolls loot or ends a run (the dummies
  // respawn themselves below). No enemy-faction shots exist here, so heroTargets is empty.
  const combat = createCombat({
    enemies, heroTargets: [], projectiles, blasts, fields, deployables, swings, floaters,
    knockback: (t, dx, dy, mag) => { const m = Math.hypot(dx, dy) || 1; t.x += (dx / m) * mag * KB_SHOVE; t.y += (dy / m) * mag * KB_SHOVE; },
    projectileBlocked: (x, y) => x < 0 || x > rect.w || y < 0 || y > rect.h,
    cullDeployable: () => false,
    onDeath: () => {},
  });

  const resolveSig = (id) => {
    if (!id) return null;
    const s = BALANCE.signatures[id];
    return { id, ...s, damage: s.damage ? { ...s.damage } : undefined };
  };

  function buildHero(def, role) {
    const wdef = BALANCE.weapons[def.weaponId];
    const h = {
      x: rect.w / 2, y: rect.h * HERO_Y, r: BALANCE.hero.r, role,
      faction: "player", color: def.color, stats: { ...(def.stats || BALANCE.hero.stats) },
      iframes: 0, iframeDur: BALANCE.hero.iframeDur, manaRegen: BALANCE.hero.manaRegen, dead: false,
      cd: 0, sigCd: 0, charge: 0, damageTaken: 0,
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

  // (Re)build the sim for a highlighted character in its party role ("head" | "follower").
  // null clears the arena.
  function setHero(def, role = "head") {
    hero = def ? buildHero(def, role) : null;
    enemies.length = projectiles.length = blasts.length = swings.length = 0;
    fields.length = deployables.length = floaters.length = 0;
    if (hero) {
      enemies.push(makeDummy(rect.w / 2, hero.y + DOWN));               // below — catches projectiles
      enemies.push(makeDummy(rect.w / 2 + SIDE_DX, hero.y + SIDE_DY));  // to the side — shows knockback
    }
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

    const near = combat.nearestEnemyTo(hero.x, hero.y);
    // Role split mirrors runScene: a head fires only its weapon; a follower contributes
    // only its passive signature (heal ticks silently, the rest dispatch through fireSignature).
    if (hero.role === "follower") { combat.tickHeal(hero, dt); combat.fireSignature(hero, near); }
    else combat.fireWeapon(hero, hero.weapon, near);

    combat.stepDeployables(dt);
    combat.stepProjectiles(dt);
    combat.stepFields(dt);

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

    for (const f of fields) { disc(ctx, f.x, f.y, f.r, THEME.field.fill); ring(ctx, f.x, f.y, f.r, THEME.field.ring); }
    for (const d of deployables) { if (d.dead) continue; disc(ctx, d.x, d.y, d.r, THEME.deploy.fill); ring(ctx, d.x, d.y, d.r + 2, THEME.deploy.ring); }

    for (const p of projectiles) {
      if (p.pierce) {
        const env = Math.sin(Math.PI * (1 - p.life / p.life0));
        ctx.globalAlpha = Math.max(0, env); ctx.strokeStyle = p.color; ctx.lineWidth = THEME.beam.width * env + 1; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(p.ox, p.oy); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.globalAlpha = 1; ctx.lineWidth = 1;
      } else disc(ctx, p.x, p.y, p.shotR, p.color);
    }

    for (const e of enemies) {
      if (e.dead) continue;
      disc(ctx, e.x, e.y, e.r, e.color);
      if (e.confuseT > 0) { disc(ctx, e.x, e.y, e.r, THEME.confuse.fill); ring(ctx, e.x, e.y, e.r + 2, THEME.confuse.ring); }
      if (e.frozenT > 0) { disc(ctx, e.x, e.y, e.r, THEME.freeze.fill); ring(ctx, e.x, e.y, e.r + THEME.freeze.ringPad, THEME.freeze.ring); }
      if (e.hp < e.derived.maxHp) bar(ctx, e.x, e.y - e.r - THEME.bar.gap - THEME.bar.h, e.hp / e.derived.maxHp, THEME.bar.hp);
    }

    for (const b of blasts) ring(ctx, b.x, b.y, b.r * (0.4 + 0.6 * b.t / THEME.blast.dur), THEME.blast.ring);

    for (const s of swings) {
      const a = Math.atan2(s.ay, s.ax), half = s.arc * Math.PI / 360;
      ctx.globalAlpha = 1 - s.t / THEME.melee.dur; ctx.fillStyle = THEME.melee.swing;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.arc(s.x, s.y, s.r, a - half, a + half); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // The hero's body + readouts (incl. the cooldown dot) via the shared drawMember, so it
    // looks identical to the run scene. The head's weapon is passed explicitly (heads keep
    // their weapon outside the entity in the run scene; here it lives on hero.weapon).
    drawMember(ctx, hero, hero.x, hero.y, hero.role, hero.weapon);

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
