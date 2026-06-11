// Vertical-slice RUN scene: a forced southward descent. The camera window
// auto-scrolls down, holding Marvin inside it; home is the south band, four
// times the map away. Enemies use BFS pathfinding (ported from BrainMaze), take
// up space (soft body collision), and stop to attack. Marvin fights back with an
// auto-aiming weapon (chosen on the select screen) whose damage and mana cost run
// through the same combat resolver the enemies use.
import { generate, isWalkable } from "./levelgen.js";
import { moveAndCollide, boxBlocked } from "./collision.js";
import { makeRng, subSeed } from "../core/rng.js";
import { findPath } from "../ai/ai.js";
import { makeDirector } from "./director.js";
import { recomputeDerived, weaponDamage, applyDamage, regenMana, canCast, spendMana } from "./combat.js";
import { BALANCE, THEME } from "./balance.js";

const VIEW_W = 800, VIEW_H = 600;
const SCALE = 2;
const TS = 24 * SCALE; // 2x grid
const MARGIN = TS; // keep the hero this far inside the window edges

// Gameplay tuning lives in balance.js; alias the hot ones to keep the body terse.
const { hero: HERO, enemies: ENEMIES } = BALANCE;
const { scroll: SCROLL, mapH: MAP_H, freezeDur: FREEZE_DUR } = BALANCE;
const TILE_COLOR = THEME.tile; // indexed by tile id (see TILE in levelgen.js)

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export function createRunScene(ctx, input, seed, weaponId) {
  const level = generate(seed, {
    w: 48, h: MAP_H, bearing: (3 * Math.PI) / 2, tileSize: TS,
    wallScaleX: BALANCE.wall.scaleX, wallScaleY: BALANCE.wall.scaleY, wallDensity: BALANCE.wall.density,
  });
  const mapW = level.w * TS, mapH = level.h * TS;
  const homeSet = new Set(level.homeBand.map(([x, y]) => y * level.w + x));
  const rng = makeRng(subSeed(seed, "spawns"));
  const weapon = { id: weaponId, ...BALANCE.weapons[weaponId] };

  // Hero shares the full spec-03 entity shape (stats + derived + faction + the
  // health/mana component) with every enemy; combat.js operates on all of them.
  const hero = {
    x: level.start.x * TS + TS / 2, y: level.start.y * TS + TS / 2,
    w: HERO.r * 2, h: HERO.r * 2, r: HERO.r,
    stats: HERO.stats, faction: HERO.faction,
    iframes: 0, iframeDur: HERO.iframeDur, manaRegen: HERO.manaRegen, dead: false, cd: 0,
  };
  recomputeDerived(hero, BALANCE.derive);
  hero.hp = hero.derived.maxHp;
  hero.mana = hero.derived.maxMana;

  const cam = { x: 0, y: 0 };
  const enemies = [];
  const projectiles = []; // all in-flight shots, hero + enemy, tagged by faction
  const blasts = [];      // transient AoE rings (nova/bomb detonations), visual only
  const swings = [];      // transient melee swing wedges, visual only
  const fields = [];      // lingering damage zones (field weapon)
  const heroTargets = [hero]; // the player-faction target list enemy shots resolve against
  let outcome = null;
  const state = { restart: false };

  // Build an enemy from its def at a tile and push it live. The entity holds live
  // state + the spec-03 component shape (stats/derived/faction/health/mana) the
  // shared resolver operates on; immutable config stays on `def` and is read
  // through `e.def.*` (behavior, freezesToKill, attack), so there's one source of truth.
  function spawnEnemy(def, tx, ty) {
    if (ty < BALANCE.spawnMinTileY) return; // never in the player's opening rows
    const e = {
      def, stats: def.stats, faction: "enemy",
      x: tx * TS + TS / 2, y: ty * TS + TS / 2, w: def.r * 2, h: def.r * 2, r: def.r,
      manaRegen: def.manaRegen || 0, freezeCount: 0, frozenT: 0, dead: false,
      path: null, pi: 0, repathT: 0, state: null, timer: 0, lockAim: null,
    };
    recomputeDerived(e, BALANCE.derive);
    e.hp = e.derived.maxHp;
    e.mana = e.derived.maxMana;
    enemies.push(e);
  }

  const director = makeDirector({
    level, rng, defs: Object.values(ENEMIES), cam, viewH: VIEW_H,
    cfg: BALANCE.director, ts: TS,
  });

  const tileOf = (e) => [Math.floor(e.x / TS), Math.floor(e.y / TS)];

  function followPath(e, speed, dt) {
    if (!e.path || e.pi >= e.path.length) return true;
    const [tx, ty] = e.path[e.pi];
    const cx = tx * TS + TS / 2, cy = ty * TS + TS / 2;
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

  // Spawn a projectile owned by `attacker`; its faction (which side it can hit)
  // comes from the attacker. `shape` defaults to a single-hit projectile; a `bomb`
  // detonates an area on contact, a `pierce` projectile (beam) hits each enemy once.
  function fireShot(attacker, vx, vy, o) {
    projectiles.push({
      x: attacker.x, y: attacker.y, vx, vy, life: o.life, dead: false,
      faction: attacker.faction, attacker, damage: o.damage,
      freeze: o.freeze, knockback: o.knockback, shotR: o.shotR, color: o.color,
      shape: o.shape || "projectile", radius: o.radius, pierce: o.pierce, hits: o.pierce ? new Set() : null,
    });
  }

  // Shove a target `mag` px along (dx,dy), stopping at walls (spec 04 knockback).
  function knockback(t, dx, dy, mag) {
    const m = Math.hypot(dx, dy) || 1;
    moveAndCollide(level, t, (dx / m) * mag, (dy / m) * mag);
  }

  // Resolve a single hit: percent-HP/stat-scaled damage through dmgResist, optional
  // knockback along (kdx,kdy), optional freeze (player→enemy CC). Every damage
  // source — projectiles, beams, AoE blasts — funnels through here so they agree.
  function applyHit(attacker, t, damage, kbMult, kdx, kdy, freeze) {
    applyDamage(t, weaponDamage(damage, attacker, t.derived.maxHp, t.hp));
    if (kbMult) knockback(t, kdx, kdy, attacker.derived.knockback * kbMult);
    if (freeze && t.def) { t.freezeCount++; t.frozenT = FREEZE_DUR; if (t.freezeCount >= t.def.freezesToKill) t.dead = true; }
    if (t === hero && hero.dead) outcome = "lose";
  }

  // Area blast at (cx,cy): hit every enemy overlapping the radius, knocked outward
  // from the center. Shared by nova, bomb detonation, field ticks, and melee. An
  // optional `aim` ({x,y,cosHalf}) restricts hits to an arc (melee swings); omit it
  // for a full circle.
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
  }

  // Nearest living enemy to the hero, with its distance — the shared auto-aim pick.
  function nearestEnemy() {
    let best = null, bd = Infinity;
    for (const e of enemies) {
      if (e.dead) continue;
      const d = dist(e.x, e.y, hero.x, hero.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best && { e: best, d: bd };
  }

  // Hero damage flows through the shared resolver (i-frames + death) like any
  // entity; the run-loss is the hero-specific consequence layered on top.
  function hurtHero(amount) {
    applyDamage(hero, amount);
    if (hero.dead) outcome = "lose";
  }

  // Spec 06's four behavior archetypes, one function per family — the frozen
  // `brainFor(def.behavior)` registry. The slice steers along a BFS path (it has
  // no movement integrator), so brains repath toward the hero rather than writing
  // a pure intent vector; the spec's intent is preserved, the mechanism is the
  // slice's. Only chargers carry scratch state beyond the shared state machine.
  const BEHAVIORS = {
    // Shamblers — chase straight in, contact damage on overlap. No telegraph.
    chaser(e, dt, heroTile) {
      const k = e.def, d = dist(e.x, e.y, hero.x, hero.y);
      if (!e.path || e.pi >= e.path.length || e.repathT <= 0) repathTo(e, k, heroTile[0], heroTile[1]);
      followPath(e, e.derived.moveSpeed, dt);
      if (d < hero.r + e.r) hurtHero(k.contactDamage);
    },

    // Imps — chaser, but faster with a random per-step drift so packs fan out
    // instead of stacking on a single pixel. Only a threat in numbers.
    swarmer(e, dt, heroTile) {
      const k = e.def, d = dist(e.x, e.y, hero.x, hero.y);
      if (!e.path || e.pi >= e.path.length || e.repathT <= 0) repathTo(e, k, heroTile[0], heroTile[1]);
      followPath(e, e.derived.moveSpeed, dt);
      const a = rng.next() * Math.PI * 2, j = k.jitter * e.derived.moveSpeed * dt;
      moveAndCollide(level, e, Math.cos(a) * j, Math.sin(a) * j);
      if (d < hero.r + e.r) hurtHero(k.contactDamage);
    },

    // Cultists — hold a preferred range: approach, aim (telegraph), fire a bolt
    // (costs mana), then cool down and kite if the hero closes. Mana regenerates
    // every tick; a tapped-out caster can't start an aim, so it holds and kites
    // until the pool refills — positioning lets you wait one out.
    shooter(e, dt, heroTile) {
      const k = e.def, d = dist(e.x, e.y, hero.x, hero.y);
      regenMana(e, dt); // same mana code the hero's weapons use
      const kite = () => {
        if (d < k.prefRange * k.retreatFrac) {
          const dx = e.x - hero.x, dy = e.y - hero.y, m = Math.hypot(dx, dy) || 1;
          moveAndCollide(level, e, (dx / m) * e.derived.moveSpeed * dt, (dy / m) * e.derived.moveSpeed * dt);
        }
      };
      e.state = e.state || "approach";
      if (e.state === "approach") {
        if (d <= k.prefRange) {
          if (canCast(e, k.attack.manaCost)) { e.state = "aim"; e.timer = k.aim; return; }
          kite(); // in range but dry — hold and regen
          return;
        }
        if (!e.path || e.pi >= e.path.length || e.repathT <= 0) repathTo(e, k, heroTile[0], heroTile[1]);
        followPath(e, e.derived.moveSpeed, dt);
      } else if (e.state === "aim") {
        e.timer -= dt;
        if (e.timer <= 0) {
          const dx = hero.x - e.x, dy = hero.y - e.y, m = Math.hypot(dx, dy) || 1;
          fireShot(e, (dx / m) * k.shot, (dy / m) * k.shot, {
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

    // Brutes — approach to lunge range, telegraph (intent frozen, the counterplay
    // window), then dash along the aim captured at telegraph start. A sidestep
    // during the wind-up dodges the lunge because the aim is locked, not tracked.
    charger(e, dt, heroTile) {
      const k = e.def, d = dist(e.x, e.y, hero.x, hero.y);
      e.state = e.state || "approach";
      if (e.state === "approach") {
        if (d <= k.lungeRange) {
          const dx = hero.x - e.x, dy = hero.y - e.y, m = Math.hypot(dx, dy) || 1;
          e.lockAim = { x: dx / m, y: dy / m };
          e.state = "telegraph"; e.timer = k.telegraph;
          return;
        }
        if (!e.path || e.pi >= e.path.length || e.repathT <= 0) repathTo(e, k, heroTile[0], heroTile[1]);
        followPath(e, e.derived.moveSpeed, dt);
        if (d < hero.r + e.r) hurtHero(k.contactDamage);
      } else if (e.state === "telegraph") {
        e.timer -= dt; // hold still and tell the lunge
        if (e.timer <= 0) { e.state = "lunge"; e.timer = k.lungeDur; e.lunged = false; }
      } else if (e.state === "lunge") {
        e.timer -= dt;
        moveAndCollide(level, e, e.lockAim.x * k.lungeSpeed * dt, e.lockAim.y * k.lungeSpeed * dt);
        if (!e.lunged && d < hero.r + e.r) { // strength-scaled slam + heavy knockback
          hurtHero(weaponDamage(k.attack, e, hero.derived.maxHp, hero.hp));
          knockback(hero, hero.x - e.x, hero.y - e.y, e.derived.knockback * k.attack.knockback);
          e.lunged = true;
        }
        if (e.timer <= 0) { e.state = "cooldown"; e.timer = k.cooldown; }
      } else {
        e.timer -= dt;
        if (d < hero.r + e.r) hurtHero(k.contactDamage);
        if (e.timer <= 0) e.state = "approach";
      }
    },
  };

  // brainFor: pick the def's behavior. repathT ticks here so every brain shares
  // one repath clock (spec 06: behavior is selected by def.behavior).
  function stepEnemy(e, dt, heroTile) {
    e.repathT -= dt;
    BEHAVIORS[e.def.behavior](e, dt, heroTile);
  }

  // Soft body collision: shift `e` (and optionally `o`) so circles stop overlapping,
  // never into a wall.
  function shift(e, dx, dy) {
    e.x += dx; e.y += dy;
    if (boxBlocked(level, e)) { e.x -= dx; e.y -= dy; }
  }
  function separate(a, b, moveA) {
    const dx = b.x - a.x, dy = b.y - a.y;
    let d = Math.hypot(dx, dy) || 0.001;
    const min = a.r + b.r;
    if (d >= min) return;
    const o = min - d, nx = dx / d, ny = dy / d;
    if (moveA) { const p = BALANCE.softBodyPush; shift(a, -nx * o * p, -ny * o * p); shift(b, nx * o * p, ny * o * p); }
    else shift(b, nx * o, ny * o); // push only b (b out of an immovable a)
  }

  // Hard block: the hero cannot move deeper into any body (living enemy or corpse),
  // but may always move away from one (so it never gets permanently stuck).
  function bodyDeeper(px, py) {
    for (const e of enemies) {
      if (e.dead) continue; // corpses are pushable, only living enemies hard-block
      const min = hero.r + e.r;
      const nd = dist(hero.x, hero.y, e.x, e.y);
      if (nd < min && nd < dist(px, py, e.x, e.y)) return true;
    }
    return false;
  }
  function heroMove(dx, dy) {
    const ox = hero.x;
    hero.x += dx;
    if (boxBlocked(level, hero) || bodyDeeper(ox, hero.y)) hero.x = ox;
    const oy = hero.y;
    hero.y += dy;
    if (boxBlocked(level, hero) || bodyDeeper(hero.x, oy)) hero.y = oy;
  }

  function update(dt) {
    if (outcome) {
      if (input.down("Space") || input.down("Enter")) state.restart = true;
      return;
    }
    hero.cd = Math.max(0, hero.cd - dt);
    hero.iframes = Math.max(0, hero.iframes - dt);
    regenMana(hero, dt); // same mana code the enemy casters use

    cam.y = clamp(cam.y + SCROLL * dt, 0, mapH - VIEW_H);

    // Director spends its depth-scaled budget on fresh off-screen threat.
    director.update(dt, hero, enemies, spawnEnemy);

    const intent = input.intent();
    heroMove(intent.x * hero.derived.moveSpeed * dt, intent.y * hero.derived.moveSpeed * dt);

    // Selected weapon: SPACE fires when there's a target and the cooldown + mana
    // allow it. Delivery depends on `shape`: nova bursts on the hero, field drops a
    // zone, the rest auto-aim a projectile at the nearest enemy.
    if (hero.cd <= 0 && canCast(hero, weapon.manaCost) && input.down("Space")) {
      const near = nearestEnemy();
      let fired = false;
      if (weapon.shape === "nova") {
        if (near && near.d <= weapon.radius) {
          blast(hero.x, hero.y, weapon.radius, hero, weapon.damage, weapon.knockback, weapon.freeze);
          blasts.push({ x: hero.x, y: hero.y, r: weapon.radius, t: 0 });
          fired = true;
        }
      } else if (weapon.shape === "field") {
        if (near && near.d <= weapon.range) {
          fields.push({ x: hero.x, y: hero.y, r: weapon.radius, life: weapon.lifespan, tick: 0, weapon });
          fired = true;
        }
      } else if (weapon.shape === "melee-arc") {
        if (near && near.d <= weapon.radius + near.e.r) { // in reach
          const dx = near.e.x - hero.x, dy = near.e.y - hero.y, m = Math.hypot(dx, dy) || 1;
          const aim = weapon.arc >= 360 ? null : { x: dx / m, y: dy / m, cosHalf: Math.cos(weapon.arc * Math.PI / 360) };
          blast(hero.x, hero.y, weapon.radius, hero, weapon.damage, weapon.knockback, weapon.freeze, aim);
          swings.push({ x: hero.x, y: hero.y, r: weapon.radius, ax: dx / m, ay: dy / m, arc: weapon.arc, t: 0 });
          fired = true;
        }
      } else if (near && near.d <= weapon.range) { // projectile / beam / bomb — aimed
        const dx = near.e.x - hero.x, dy = near.e.y - hero.y, m = Math.hypot(dx, dy) || 1;
        fireShot(hero, (dx / m) * weapon.speed, (dy / m) * weapon.speed, {
          damage: weapon.damage, life: weapon.life, shotR: weapon.shotR,
          color: THEME.weaponShot[weapon.id], freeze: weapon.freeze, knockback: weapon.knockback,
          shape: weapon.shape, radius: weapon.radius, pierce: weapon.pierce,
        });
        fired = true;
      }
      if (fired) { hero.cd = weapon.cd; spendMana(hero, weapon.manaCost); }
    }

    // Enemy brains (skip dead/frozen; cull far enemies on the long map)
    const heroTile = tileOf(hero);
    const activeY = cam.y + VIEW_H / 2;
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.frozenT > 0) { e.frozenT -= dt; continue; }
      if (Math.abs(e.y - activeY) < VIEW_H) stepEnemy(e, dt, heroTile);
    }

    // Projectiles (hero + enemy): resolve each against the opposite faction via the
    // shared hit path. Bombs detonate an area on contact/expiry; beams pierce and
    // hit each enemy once; the rest hit the first enemy and die.
    for (const p of projectiles) {
      if (p.dead) continue;
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0 || !isWalkable(level, Math.floor(p.x / TS), Math.floor(p.y / TS))) {
        if (p.shape === "bomb") detonate(p); // lob that fizzles still bursts where it lands
        p.dead = true; continue;
      }
      const pad = p.faction === "enemy" ? BALANCE.enemyShotHitPad : 0;
      for (const t of (p.faction === "player" ? enemies : heroTargets)) {
        if (t.dead) continue;
        if (dist(p.x, p.y, t.x, t.y) < p.shotR + t.r + pad) {
          if (p.shape === "bomb") { detonate(p); p.dead = true; break; }
          if (p.pierce) { // beam: hit each enemy once, keep flying
            if (!p.hits.has(t)) { applyHit(p.attacker, t, p.damage, p.knockback, p.vx, p.vy, p.freeze); p.hits.add(t); }
            continue;
          }
          applyHit(p.attacker, t, p.damage, p.knockback, p.vx, p.vy, p.freeze);
          p.dead = true; break;
        }
      }
    }

    // Lingering fields tick area damage to enemies inside them, then expire.
    for (const f of fields) {
      f.life -= dt; f.tick -= dt;
      if (f.tick <= 0) { blast(f.x, f.y, f.r, hero, f.weapon.damage, f.weapon.knockback, f.weapon.freeze); f.tick = f.weapon.tickInterval; }
    }
    for (const b of blasts) b.t += dt; // visual rings expand then expire
    for (const s of swings) s.t += dt; // melee wedges flash then expire

    // Bodies take up space. The hero hard-blocks against bodies in heroMove;
    // here push living enemies out of one another, the hero, and solid corpses.
    // Single pass into the two buckets — avoids two filter allocations per frame.
    const live = [], corpses = [];
    for (const e of enemies) (e.dead ? corpses : live).push(e);
    for (let i = 0; i < live.length; i++) {
      separate(hero, live[i], false);
      for (const c of corpses) separate(c, live[i], false);
      for (let j = i + 1; j < live.length; j++) separate(live[i], live[j], true);
    }
    for (const c of corpses) separate(hero, c, false); // the hero shoves (heavy) corpses aside

    for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].dead) projectiles.splice(i, 1);
    for (let i = fields.length - 1; i >= 0; i--) if (fields[i].life <= 0) fields.splice(i, 1);
    for (let i = blasts.length - 1; i >= 0; i--) if (blasts[i].t >= THEME.blast.dur) blasts.splice(i, 1);
    for (let i = swings.length - 1; i >= 0; i--) if (swings[i].t >= THEME.melee.dur) swings.splice(i, 1);

    // Stay inside the moving window; being crushed against a wall is fatal.
    // (heroMove already keeps x within the map and out of walls — no x clamp.)
    const minY = cam.y + MARGIN;
    if (hero.y < minY) {
      hero.y = minY;
      if (boxBlocked(level, hero)) outcome = "lose";
    }
    hero.y = clamp(hero.y, minY, cam.y + VIEW_H - MARGIN);
    cam.x = clamp(hero.x - VIEW_W / 2, 0, mapW - VIEW_W);

    const [tx, ty] = tileOf(hero);
    if (homeSet.has(ty * level.w + tx)) outcome = "win";
  }

  function render() {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    const x0 = Math.max(0, Math.floor(cam.x / TS)), x1 = Math.min(level.w - 1, Math.ceil((cam.x + VIEW_W) / TS));
    const y0 = Math.max(0, Math.floor(cam.y / TS)), y1 = Math.min(level.h - 1, Math.ceil((cam.y + VIEW_H) / TS));
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const i = ty * level.w + tx;
        // Floor + 1px overscan so fractional camera scroll leaves no seams.
        const sx = Math.floor(tx * TS - cam.x), sy = Math.floor(ty * TS - cam.y);
        ctx.fillStyle = TILE_COLOR[level.tiles[i]];
        ctx.fillRect(sx, sy, TS + 1, TS + 1);
        if (!level.walkable[i]) { // darken obstacles so collision is legible
          ctx.fillStyle = THEME.obstacleDarken;
          ctx.fillRect(sx, sy, TS + 1, TS + 1);
        }
      }
    ctx.fillStyle = THEME.homeBand;
    for (const [hx, hy] of level.homeBand)
      if (hx >= x0 && hx <= x1 && hy >= y0 && hy <= y1)
        ctx.fillRect(Math.floor(hx * TS - cam.x), Math.floor(hy * TS - cam.y), TS + 1, TS + 1);

    // Lingering fields sit on the ground, under the bodies.
    for (const f of fields) {
      disc(ctx, f.x - cam.x, f.y - cam.y, f.r, THEME.field.fill);
      ring(ctx, f.x - cam.x, f.y - cam.y, f.r, THEME.field.ring);
    }

    // Corpses (drawn under everything live)
    for (const e of enemies)
      if (e.dead) disc(ctx, e.x - cam.x, e.y - cam.y, e.r, THEME.corpse);

    for (const p of projectiles) disc(ctx, p.x - cam.x, p.y - cam.y, p.shotR, p.color);

    for (const e of enemies) {
      if (e.dead) continue;
      const sx = e.x - cam.x, sy = e.y - cam.y, k = e.def;
      disc(ctx, sx, sy, e.r, k.color);
      if (e.frozenT > 0) {
        disc(ctx, sx, sy, e.r, THEME.freeze.fill);
        ring(ctx, sx, sy, e.r + THEME.freeze.ringPad, THEME.freeze.ring);
      } else { // telegraphs only when an attack is winding up
        if (e.def.behavior === "shooter" && e.state === "aim") {
          ring(ctx, sx, sy, e.r + THEME.rangedTelegraph.ringPad, THEME.rangedTelegraph.ring);
          ctx.strokeStyle = THEME.rangedTelegraph.line;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(hero.x - cam.x, hero.y - cam.y);
          ctx.stroke();
        }
        if (e.def.behavior === "charger" && (e.state === "telegraph" || e.state === "lunge")) {
          const tg = THEME.chargerTelegraph;
          ring(ctx, sx, sy, e.r + tg.ringPad, e.state === "lunge" ? tg.lunge : tg.ring);
          ctx.strokeStyle = e.state === "lunge" ? tg.lunge : tg.line; // line points along the locked aim
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + e.lockAim.x * k.lungeRange, sy + e.lockAim.y * k.lungeRange);
          ctx.stroke();
        }
      }
      // Status bars above the body: HP (only once chipped) and, for casters, a
      // mana pip that dims when too dry to cast — the visible "wait it out" tell.
      const B = THEME.bar, cast = k.attack && k.attack.manaCost;
      let by = sy - e.r - B.gap - B.h;
      if (e.hp < e.derived.maxHp) { bar(ctx, sx, by, e.hp / e.derived.maxHp, B.hp); by -= B.h + 1; }
      if (cast) bar(ctx, sx, by, e.mana / e.derived.maxMana, e.mana >= k.attack.manaCost ? B.mana : B.tapped);
    }

    // Nova/bomb detonation rings: a quick expanding flash to the blast radius.
    for (const b of blasts)
      ring(ctx, b.x - cam.x, b.y - cam.y, b.r * (0.4 + 0.6 * b.t / THEME.blast.dur), THEME.blast.ring);

    // Melee swing wedges: a quick filled arc toward the struck enemy (full disc for whirl).
    for (const s of swings) {
      const a = Math.atan2(s.ay, s.ax), half = s.arc * Math.PI / 360;
      ctx.globalAlpha = 1 - s.t / THEME.melee.dur;
      ctx.fillStyle = THEME.melee.swing;
      ctx.beginPath();
      ctx.moveTo(s.x - cam.x, s.y - cam.y);
      ctx.arc(s.x - cam.x, s.y - cam.y, s.r, a - half, a + half);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    disc(ctx, hero.x - cam.x, hero.y - cam.y, hero.r, hero.iframes > 0 ? THEME.hero.hit : THEME.hero.normal);

    ctx.font = THEME.hud.font;
    const depth = Math.round((cam.y / (mapH - VIEW_H)) * 100);
    const ready = hero.cd <= 0 ? "ready" : `${hero.cd.toFixed(1)}s`;
    const mana = weapon.manaCost > 0 ? `   MP ${Math.round(hero.mana)}/${hero.derived.maxMana}` : "";
    const hud = `HP ${Math.max(0, Math.round(hero.hp))}/${hero.derived.maxHp}${mana}   home in ${100 - depth}%   ${weapon.name} ${ready} [SPACE]`;
    ctx.fillStyle = THEME.hud.box; // backing box for legibility over any tile
    ctx.fillRect(6, 6, ctx.measureText(hud).width + 12, 22);
    ctx.fillStyle = THEME.hud.text;
    ctx.fillText(hud, 12, 21);
    if (outcome) {
      ctx.fillStyle = THEME.overlay.bg;
      ctx.fillRect(0, VIEW_H / 2 - 50, VIEW_W, 100);
      ctx.fillStyle = THEME.overlay.fg;
      ctx.textAlign = "center";
      ctx.font = THEME.overlay.titleFont;
      ctx.fillText(outcome === "win" ? "MADE IT HOME" : "ANOTHER 3PM…", VIEW_W / 2, VIEW_H / 2 - 4);
      ctx.font = THEME.overlay.subFont;
      ctx.fillText("press SPACE to try another day", VIEW_W / 2, VIEW_H / 2 + 26);
      ctx.textAlign = "left";
    }
  }

  return { update, render, get restart() { return state.restart; }, nextSeed: seed + 1 };
}

function disc(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
function ring(ctx, x, y, r, color) {
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}
// A centered status bar (HP/mana): dark backing + a `frac`-wide fill.
function bar(ctx, cx, y, frac, fill) {
  const B = THEME.bar, x = cx - B.w / 2;
  ctx.fillStyle = B.back;
  ctx.fillRect(x, y, B.w, B.h);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, B.w * clamp(frac, 0, 1), B.h);
}
