// Vertical-slice RUN scene: a forced southward descent. The camera window
// auto-scrolls down, holding the head inside it; home is the south band. This is
// the orchestrator — setup, the frame sequencer (update), and the run-resolution
// payload. The subsystems live in their own modules (softBody, shop, enemyAI,
// followerTrain, runRender, combatKit) and receive the live world plus the
// coupling callbacks below via createX(env) injection.
import { generate, isWalkable, TILE } from "./levelgen.js";
import { moveAndCollide, boxBlocked } from "./collision.js";
import { makeRng, subSeed } from "../core/rng.js";
import { makeDirector, distanceFraction } from "./director.js";
import { recomputeDerived, applyDamage, regenMana } from "./combat.js";
import { POWERUPS, applyHeld, snapshotBase, cashForKill, rollDrop, makeLootBag } from "./powerups.js";
import { applyHeroUpgrades } from "../meta/save.js";
import { BALANCE, THEME } from "./balance.js";
import { track, newRunId } from "./telemetry.js";
import { createCombat } from "./combatKit.js";
import { createSoftBody } from "./softBody.js";
import { createShop } from "./shop.js";
import { createEnemyAI } from "./enemyAI.js";
import { createFollowerTrain } from "./followerTrain.js";
import { createRunRenderer } from "./runRender.js";
import { sfx } from "../audio/sfx.js";
import { clamp } from "./draw.js";
import { dist } from "../core/geom.js";

const VIEW_W = 800, VIEW_H = 600;
const SCALE = 2;
const TS = 24 * SCALE;
const MARGIN = TS;

const { hero: HERO, enemies: ENEMIES } = BALANCE;
const { scroll: SCROLL, mapH: MAP_H } = BALANCE;

export function createRunScene(ctx, input, seed, party, saveBlob, bgId) {
  const level = generate(seed, {
    w: 48, h: MAP_H, bearing: (3 * Math.PI) / 2, tileSize: TS,
    wallScaleX: BALANCE.wall.scaleX, wallScaleY: BALANCE.wall.scaleY, wallDensity: BALANCE.wall.density,
  });
  const mapW = level.w * TS, mapH = level.h * TS;
  let voidClock = 0; // real-time seconds for the void animation (drawn by runRender)
  ctx.imageSmoothingEnabled = false;
  const homeSet = new Set(level.homeBand.map(([x, y]) => y * level.w + x));
  const rng = makeRng(subSeed(seed, "spawns"));
  // Loot has its own sub-seed so drops + shop stock stay reproducible and independent
  // of world-gen ("gen") and the director ("spawns").
  const lootRng = makeRng(subSeed(seed, "loot"));
  const LOOT = BALANCE.loot;
  // One shuffled bag both shops and drops draw from without replacement — no item is
  // ever offered or dropped twice in a run.
  const lootBag = makeLootBag(lootRng);

  const runState = { cash: 0, powerups: [], kills: 0 };

  const ROSTER = Object.fromEntries(BALANCE.roster.map((c) => [c.id, c]));
  const head = ROSTER[party[0]]; // party[0] is the controllable head, the rest trail
  const followerDefs = party.slice(1).map((id) => ROSTER[id]);

  // Deep-copy a signature's damage so per-entity mods / The Drop's charge math don't
  // mutate the shared BALANCE def.
  const resolveSig = (id) => {
    if (!id) return null;
    const s = BALANCE.signatures[id];
    return { id, ...s, damage: s.damage ? { ...s.damage } : undefined };
  };

  // Telemetry (droppable): one run = run_start → band_reached* → run_end, correlated
  // by runId; no-op whenever the page has no analytics.
  const runId = newRunId();
  const runStartedAt = Date.now();
  let deepestBand = 0, ended = false;
  track("run_start", { run_id: runId, hero_id: head.id, weapon: head.weaponId, party_size: party.length, seed });
  const emitRunEnd = (won) => {
    if (ended) return; ended = true;
    const frac = won ? 1 : distanceFraction(hero, level, TS);
    track("run_end", {
      run_id: runId, hero_id: head.id, seed, won, cause: deathCause,
      distance_frac: Math.round(frac * 100) / 100, band: Math.min(10, Math.floor(frac * 10) + 1),
      kills: runState.kills, duration_s: Math.round((Date.now() - runStartedAt) / 1000), party_size: party.length,
    });
  };

  const activeBuffs = []; // live timed buffs (BPM Boost / Slow Jam); tick on unscaled time
  const base = snapshotBase(head.stats || HERO.stats, { id: head.weaponId, ...BALANCE.weapons[head.weaponId] });
  const weapon = { ...base.weapon, damage: { ...base.weapon.damage } };

  // Hero shares the full spec-03 entity shape with every enemy (combat.js operates on
  // all of them). `stats` is a copy — powerups mutate it, the BALANCE def must stay base.
  const hero = {
    x: level.start.x * TS + TS / 2, y: level.start.y * TS + TS / 2,
    w: HERO.r * 2, h: HERO.r * 2, r: HERO.r,
    id: head.id,
    stats: { ...(head.stats || HERO.stats) }, faction: HERO.faction, color: head.color,
    iframes: 0, iframeDur: HERO.iframeDur, manaRegen: HERO.manaRegen, dead: false, cd: 0,
    sigCd: 0, signature: resolveSig(head.signatureId), charge: 0, damageTaken: 0, fadeT: BALANCE.spawnFade,
  };
  applyHeroUpgrades(hero, head.id, saveBlob, BALANCE.derive); // permanent meta boosts, once at run start
  hero.hp = hero.derived.maxHp;
  hero.mana = hero.derived.maxMana;

  const FOLLOWER = BALANCE.follower;
  const trail = []; // hero positions, newest first, with the head at trail[0]
  const gap = FOLLOWER.gapTiles * TS;
  const followers = followerDefs.map((def) => {
    const w = BALANCE.weapons[def.weaponId];
    const f = {
      x: hero.x, y: hero.y, w: HERO.r * 2, h: HERO.r * 2, r: HERO.r,
      id: def.id,
      stats: { ...(def.stats || HERO.stats) }, faction: "player", color: def.color,
      iframes: 0, iframeDur: FOLLOWER.iframeDur, manaRegen: FOLLOWER.manaRegen, dead: false, cd: 0,
      weapon: { id: def.weaponId, ...w, damage: { ...w.damage } },
      sigCd: 0, signature: resolveSig(def.signatureId), charge: 0, damageTaken: 0, fadeT: 0,
      pending: true, // materializes at its trail point once the head clears room (no spawn pile-up)
    };
    // Fold upgrades for trailing heroes too, not just the head — else a trailing hero's
    // tree (e.g. Dash's Grit feeding his dust) would silently do nothing.
    applyHeroUpgrades(f, def.id, saveBlob, BALANCE.derive);
    f.hp = f.derived.maxHp;
    f.mana = f.derived.maxMana;
    return f;
  });

  // Rebuild hero + weapon from base after every acquisition, and refresh the cached HUD
  // tally so render doesn't rebuild it every frame.
  let heldLine = "";
  function rebuild() {
    applyHeld(hero, weapon, base, runState.powerups, BALANCE.derive, LOOT);
    heldLine = runState.powerups.map((id) => POWERUPS[id].name).join(",  ");
  }

  // Route an acquired powerup: timed `buff` kinds start a live timer; everything else
  // joins the held set and rebuilds.
  function acquire(defId) {
    sfx.play("pickup");
    const def = POWERUPS[defId];
    if (def.kind === "buff") {
      activeBuffs.push({ id: defId, kind: def.effect, mult: def.mult, t: def.duration,
        tailMult: def.tailMult, tailDuration: def.tailDuration });
      if (def.hpCostFrac) hero.hp = Math.max(1, hero.hp - hero.derived.maxHp * def.hpCostFrac);
    } else {
      const before = hero.derived.maxHp;
      runState.powerups.push(defId); rebuild();
      if (hero.derived.maxHp > before) hero.hp += hero.derived.maxHp - before; // raised max HP heals by the gain
    }
  }

  const pickups = []; // powerup drops lying on the ground, awaiting hero overlap
  const shop = createShop({
    ctx, input, level, homeSet, lootRng, lootBag, runState, acquire,
    ts: TS, viewW: VIEW_W, viewH: VIEW_H,
  });

  const cam = { x: 0, y: 0 };
  let shake = 0; // px magnitude; decays each frame and jitters the render camera
  const SHAKE_MAX = 16, SHAKE_DECAY = 70;
  const addShake = (mag) => { shake = Math.min(SHAKE_MAX, Math.max(shake, mag)); };
  const enemies = [];
  const projectiles = []; // all in-flight shots, hero + enemy, tagged by faction
  const blasts = [];      // transient AoE rings (nova/bomb detonations), visual only
  const swings = [];      // transient melee swing wedges, visual only
  const fields = [];      // lingering damage zones (field weapon)
  const deployables = []; // placed turrets (Eugene's Drum Machine) — hold world position
  const floaters = [];    // rising damage numbers, one per landed hit, visual only
  const debris = [];      // spent slingshot pellets resting where they landed, visual only
  const dustPuffs = [];   // Dash's dust-trail puffs (slow + chip)
  const voidFalling = []; // enemies shoved into a reality break: drifting, shrinking, soon gone
  // True over a reality break (a RUBBLE hole) — distinct from a solid wall. The point form
  // backs the projectile void-fall (shots are points) + the combat env. The box form backs
  // the enemy void-fall: moveAndCollide keeps a body's AABB out of every non-walkable tile,
  // so a center-point test never lands inside the hole — instead ask whether the shoved box
  // would OVERLAP a hole (i.e. the void, not a wall, is what's stopping it).
  const inVoid = (x, y) => {
    const tx = Math.floor(x / TS), ty = Math.floor(y / TS);
    return tx >= 0 && ty >= 0 && tx < level.w && ty < level.h && level.tiles[ty * level.w + tx] === TILE.RUBBLE;
  };
  const boxOverlapsVoid = (cx, cy, w, h) => {
    const hw = w / 2, hh = h / 2;
    const x0 = Math.floor((cx - hw) / TS), x1 = Math.floor((cx + hw - 1e-6) / TS);
    const y0 = Math.floor((cy - hh) / TS), y1 = Math.floor((cy + hh - 1e-6) / TS);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (tx >= 0 && ty >= 0 && tx < level.w && ty < level.h && level.tiles[ty * level.w + tx] === TILE.RUBBLE) return true;
    return false;
  };
  const heroTargets = [hero, ...followers]; // player-faction targets enemy shots resolve against
  const { shift, separate, separateHero, heroMove } = createSoftBody({ level, hero, enemies });
  let outcome = null;
  let paused = false, pEsc = false; // Esc toggles a full freeze during free descent
  let deathCause = null;
  const deadThisRun = new Set(); // ids that personally died this run; the campaign culls them
  // The one place a run ends as a loss — every lethal path routes here.
  const loseRun = (cause) => { outcome = "lose"; deathCause = cause; deadThisRun.add(head.id); sfx.play("scream"); sfx.play("lose"); emitRunEnd(false); };

  // Build a live enemy from its def at a tile. Mutable state lives on the entity;
  // immutable config stays on `def` and is read through `e.def.*` (one source of truth).
  function spawnEnemy(def, tx, ty) {
    if (ty < BALANCE.spawnMinTileY) return; // never in the player's opening rows
    const e = {
      def, stats: def.stats, faction: "enemy",
      x: tx * TS + TS / 2, y: ty * TS + TS / 2, w: def.r * 2, h: def.r * 2, r: def.r,
      manaRegen: def.manaRegen || 0, freezeCount: 0, frozenT: 0, pauseT: 0, staggerT: 0, dead: false,
      slowT: 0, slowMult: 1, confuseT: 0, confuseTarget: null,
      path: null, pi: 0, repathT: 0, state: null, timer: 0, lockAim: null,
    };
    recomputeDerived(e, BALANCE.derive);
    e.hp = e.derived.maxHp;
    e.mana = e.derived.maxMana;
    enemies.push(e);
  }

  // Adaptive difficulty: the director scales threat by the party's current aggregate HP
  // relative to the head's max.
  const partyStrength = () => {
    let now = hero.dead ? 0 : hero.hp;
    for (const f of followers) if (!f.dead) now += f.hp;
    return now / hero.derived.maxHp;
  };
  const director = makeDirector({
    level, rng, defs: Object.values(ENEMIES), cam, viewH: VIEW_H,
    cfg: BALANCE.director, ts: TS, partyStrength,
  });

  const tileOf = (e) => [Math.floor(e.x / TS), Math.floor(e.y / TS)];

  // Knockback queues an impulse (px along dx,dy) to ride out over a few frames — heavier
  // targets carry it longer; a fresh hit overwrites any in-flight shove. Enemies are also
  // stunned after a shove (pauseT stop, then a ramp back over staggerT); the hero isn't.
  function knockback(t, dx, dy, mag) {
    const m = Math.hypot(dx, dy) || 1;
    const K = BALANCE.knockback;
    const hpFrac = Math.min(1, t.derived.maxHp / K.hpAtMax);
    const frames = Math.max(1, Math.round(K.min + hpFrac * (K.max - K.min)));
    t.kb = { vx: (dx / m) * mag / frames, vy: (dy / m) * mag / frames, frames };
    if (t === hero) addShake(7);
    if (t.def) {
      t.pauseT = Math.round(K.pauseMin + hpFrac * (K.pauseMax - K.pauseMin));
      const s = Math.round(K.staggerMin + hpFrac * (K.staggerMax - K.staggerMin));
      t.staggerT = s; t.staggerMax = s;
    }
  }
  function applyKb(t) {
    if (!t.kb || t.kb.frames <= 0) return;
    moveAndCollide(level, t, t.kb.vx, t.kb.vy);
    t.kb.frames--;
  }
  // An enemy died: pay cash and roll a unique world drop. `looted` is the one-shot guard
  // — corpses linger, so we'd otherwise re-pay.
  function onEnemyDeath(e) {
    e.looted = true;
    sfx.play("death");
    runState.kills++;
    runState.cash += cashForKill(e.def, LOOT);
    if (lootBag.length && rollDrop(lootRng, e.def, LOOT)) {
      const id = lootBag.shift();
      pickups.push({ x: e.x, y: e.y, defId: id, r: LOOT.pickupR, t: 0, dead: false });
    }
  }

  // combatKit owns weapon/signature dispatch + the effect steppers (the preview drives it
  // verbatim). Inject the world-coupled bits: wall-collided knockback, the wall/expiry
  // test, the crush-line deployable cull, and the loot/loss-on-death hook.
  const combat = createCombat({
    enemies, heroTargets, projectiles, blasts, fields, deployables, swings, floaters, debris, dustPuffs,
    knockback,
    projectileBlocked: (x, y) => !isWalkable(level, Math.floor(x / TS), Math.floor(y / TS)),
    inVoid,
    cullDeployable: (d) => d.y < cam.y + MARGIN, // left behind once the crush line passes it
    sfx: sfx.play,
    shake: addShake,
    onDeath: (t, attacker) =>
      t === hero ? loseRun(attacker.def ? attacker.def.name : null)
                 : (t.def && !t.looted && onEnemyDeath(t)),
  });
  const nearestEnemy = () => combat.nearestEnemyTo(hero.x, hero.y);

  // Party-member damage flows through the shared resolver; only the head's death ends the
  // run — a follower just permadies and is reaped.
  function hurtMember(m, amount, srcName) {
    if (m.fadeT > 0) return; // intangible while materializing in
    const dealt = applyDamage(m, amount);
    if (dealt > 0) { combat.spawnHitNumber(m, dealt); combat.creditCharge(m, dealt, true); sfx.play("hurt"); }
    if (m.dead && m !== hero) sfx.play("scream"); // head death screams via loseRun instead
    if (m === hero && hero.dead) loseRun(srcName);
  }

  const { stepEnemy, stepConfused } = createEnemyAI({
    level, enemies, hero, followers, rng, combat,
    hurtMember, knockback, onEnemyDeath, ts: TS,
  });
  const followerTrain = createFollowerTrain({
    hero, followers, trail, gap, level, deadThisRun, heroTargets, combat, shift, separate,
  });

  function update(dt) {
    voidClock += dt; // void animates on real time, regardless of pause/outcome
    if (outcome) return;
    // Track Esc every frame (even in the shop, which owns Esc to leave) so closing a stall
    // with Esc can't bleed into the same press toggling pause.
    const esc = input.down("Escape"), escEdge = esc && !pEsc;
    pEsc = esc;
    if (shop.isOpen()) { shop.step(); return; } // paused at a stall — only the modal runs
    if (escEdge) paused = !paused;
    if (paused) return;
    while (input.consumeTap()) { /* drain: gameplay has no tap actions, so taps don't back
      up and flush all at once when a shop opens (touch drives movement, not taps) */ }
    // Timed buffs tick on UNSCALED time: Slow Jam scales the whole sim (bullet-time), BPM
    // Boost speeds the head. The head moves on rawDt so bullet-time makes it nimble.
    const rawDt = dt;
    shake = Math.max(0, shake - SHAKE_DECAY * rawDt);
    let timeScale = 1, bpm = 1;
    for (const b of activeBuffs) { b.t -= rawDt; if (b.kind === "time") timeScale = Math.min(timeScale, b.mult); else if (b.kind === "speed") bpm *= b.mult; }
    for (let i = activeBuffs.length - 1; i >= 0; i--) {
      const b = activeBuffs[i];
      if (b.t > 0) continue;
      if (b.kind === "speed" && b.tailMult && !b.tail) { b.tail = true; b.mult = b.tailMult; b.t = b.tailDuration; } // crash tail
      else activeBuffs.splice(i, 1);
    }
    dt *= timeScale;
    hero.cd = Math.max(0, hero.cd - dt);
    hero.sigCd = Math.max(0, hero.sigCd - dt);
    hero.iframes = Math.max(0, hero.iframes - dt);
    hero.fadeT = Math.max(0, hero.fadeT - dt);
    regenMana(hero, dt);

    cam.y = clamp(cam.y + SCROLL * dt, 0, mapH - VIEW_H);
    const minY = cam.y + MARGIN; // the advancing crush line; fatal to whoever crosses it

    director.update(dt, hero, enemies, spawnEnemy);

    const intent = input.intent();
    heroMove(intent.x * hero.derived.moveSpeed * bpm * rawDt, intent.y * hero.derived.moveSpeed * bpm * rawDt);

    followerTrain.sampleTrail(); // breadcrumb the head's path right after it moves

    // The head contributes ONLY its weapon (no signature); each follower contributes ONLY
    // its passive signature (no weapon). Adding a hero trades firepower for a passive.
    if (input.down("Space") || input.touchActive()) combat.fireWeapon(hero, weapon, nearestEnemy());

    const activeY = cam.y + VIEW_H / 2; // enemy brains: skip dead/frozen, cull far on the long map
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.slowT > 0) e.slowT -= dt; // Chill Zone fades; slow never skips the brain
      if (e.frozenT > 0) { e.frozenT -= dt; continue; }
      if (Math.abs(e.y - activeY) >= VIEW_H) continue;
      if (e.confuseT > 0) { e.confuseT -= dt; stepConfused(e, dt); } // Bad Trip: turn on its own kind
      else stepEnemy(e, dt);
    }

    // Knockback rides out after brains so a killing blow still flings the body, and the
    // post-shove stun ticks down (pause first, then the speed ramp). A shove whose next step
    // lands in a reality break pulls the enemy out of play into the void-fall list (iterate
    // backwards so the splice is safe), where it drifts in and shrinks away — no body to loot.
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.kb && e.kb.frames > 0 && boxOverlapsVoid(e.x + e.kb.vx, e.y + e.kb.vy, e.w, e.h)) {
        voidFalling.push({ x: e.x, y: e.y, r: e.r, color: e.def.color, vfx: e.kb.vx, vfy: e.kb.vy });
        enemies.splice(i, 1);
        continue;
      }
      applyKb(e);
      if (e.pauseT > 0) e.pauseT--;
      else if (e.staggerT > 0) e.staggerT--;
    }
    applyKb(hero);

    // Bodies (and the spent balls) sinking into a reality break: drift on their shove, decelerate
    // and shrink to a pixel, then they're swallowed. Same feel/knobs as the projectile void-fall.
    {
      const vf = BALANCE.voidFall, drag = Math.exp(-vf.drag * dt), shrink = Math.exp(-vf.shrink * dt);
      for (let i = voidFalling.length - 1; i >= 0; i--) {
        const b = voidFalling[i];
        b.x += b.vfx; b.y += b.vfy; b.vfx *= drag; b.vfy *= drag; b.r *= shrink;
        if (b.r <= vf.minR) voidFalling.splice(i, 1);
      }
    }

    // Follower train re-homes after enemy brains + knockback so it chases settled positions;
    // its soft-body shove against enemies/corpses runs after that pass below.
    followerTrain.stepFollowers({ dt, rawDt, bpm, minY });

    combat.stepProjectiles(dt);
    combat.stepFields(dt);
    combat.stepDeployables(dt);
    combat.stepDustPuffs(dt);
    for (const b of blasts) b.t += dt;
    for (const s of swings) s.t += dt;
    for (const f of floaters) f.t += dt;

    // Bodies take up space: push living enemies out of one another, the hero, and corpses.
    // Single pass into two buckets avoids two filter allocations per frame.
    const live = [], corpses = [];
    for (const e of enemies) (e.dead ? corpses : live).push(e);
    for (let i = 0; i < live.length; i++) {
      separateHero(hero, live[i], BALANCE.heroCrowdYield); // crowd slows the head (never south-pins)
      for (const c of corpses) separate(c, live[i], false);
      for (let j = i + 1; j < live.length; j++) separate(live[i], live[j], true);
    }
    for (const c of corpses) separate(hero, c, false);

    followerTrain.separateFollowers({ live, corpses });

    for (const p of pickups) {
      if (p.dead) continue;
      p.t += dt;
      if (dist(p.x, p.y, hero.x, hero.y) < hero.r + p.r) {
        acquire(p.defId);
        p.dead = true;
      }
    }

    shop.detect(hero); // stepping onto a stall with stock opens the paused pick modal

    for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].dead) projectiles.splice(i, 1);
    for (let i = pickups.length - 1; i >= 0; i--) if (pickups[i].dead) pickups.splice(i, 1);
    for (let i = fields.length - 1; i >= 0; i--) if (fields[i].life <= 0) fields.splice(i, 1);
    for (let i = deployables.length - 1; i >= 0; i--) if (deployables[i].dead) deployables.splice(i, 1);
    for (let i = blasts.length - 1; i >= 0; i--) if (blasts[i].t >= THEME.blast.dur) blasts.splice(i, 1);
    for (let i = swings.length - 1; i >= 0; i--) if (swings[i].t >= THEME.melee.dur) swings.splice(i, 1);
    for (let i = floaters.length - 1; i >= 0; i--) if (floaters[i].t >= THEME.hitNumber.dur) floaters.splice(i, 1);
    // The descent only moves down, so anything scrolled above the camera can never return — cull to bound the arrays.
    for (let i = debris.length - 1; i >= 0; i--) if (debris[i].y < cam.y) debris.splice(i, 1);
    for (let i = dustPuffs.length - 1; i >= 0; i--) if (dustPuffs[i].t >= dustPuffs[i].life || dustPuffs[i].y < cam.y) dustPuffs.splice(i, 1);
    followerTrain.reapDead(); // permadeath: drop dead followers + their shot-target slot

    // Stay inside the moving window; being pinned against a wall at the crush line is fatal.
    if (hero.y < minY) {
      hero.y = minY;
      if (boxBlocked(level, hero)) loseRun("left behind by the dark");
    }
    hero.y = clamp(hero.y, minY, cam.y + VIEW_H - MARGIN);
    cam.x = clamp(hero.x - VIEW_W / 2, 0, mapW - VIEW_W);

    // Descent funnel: fire band_reached once per newly-entered tenth of the way home.
    const band = Math.min(10, Math.floor(distanceFraction(hero, level, TS) * 10) + 1);
    if (band > deepestBand) { deepestBand = band; track("band_reached", { run_id: runId, hero_id: head.id, band, t_s: Math.round((Date.now() - runStartedAt) / 1000) }); }

    const [tx, ty] = tileOf(hero);
    if (homeSet.has(ty * level.w + tx)) { outcome = "win"; sfx.play("win"); emitRunEnd(true); }
  }

  // All drawing lives in runRender; inject the live world plus getters for the reassigned
  // scalars it reads (shake/paused/voidClock/heldLine).
  const { render } = createRunRenderer({
    ctx, input, level, cam, hero, weapon, followers, enemies, shop,
    pickups, projectiles, blasts, swings, fields, deployables, floaters, debris, dustPuffs, voidFalling,
    runState, bgId,
    getShake: () => shake, getPaused: () => paused, getVoidClock: () => voidClock, getHeldLine: () => heldLine,
    ts: TS, viewW: VIEW_W, viewH: VIEW_H,
  });

  // RunResult (spec 15): the resolution payload, built at the instant the run ends. Only
  // distanceFraction/kills/won reach the save; the rest are display-only.
  return {
    update, render, runState, nextSeed: seed + 1, bgId,
    get _probe() { return { hero, level, enemies, cam, followers }; }, // read-only handle for tests/gauntlet.mjs
    get finished() { return outcome !== null; },
    get result() {
      return {
        distanceFraction: outcome === "win" ? 1 : distanceFraction(hero, level, TS),
        kills: runState.kills, won: outcome === "win",
        cause: deathCause, heroId: head.id, seed, cashDiscarded: runState.cash,
        died: [...deadThisRun],
        survived: party.filter((id) => !deadThisRun.has(id)),
      };
    },
  };
}
