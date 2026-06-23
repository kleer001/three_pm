// Vertical-slice RUN scene: a forced southward descent. The camera window
// auto-scrolls down, holding Marvin inside it; home is the south band, four
// times the map away. Enemies use BFS pathfinding (ported from BrainMaze), take
// up space (soft body collision), and stop to attack. Marvin fights back with an
// auto-aiming weapon (chosen on the select screen) whose damage and mana cost run
// through the same combat resolver the enemies use.
import { generate, isWalkable } from "./levelgen.js";
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
import { createRunRenderer } from "./runRender.js";
import { sfx } from "../audio/sfx.js";
import { clamp } from "./draw.js";

const VIEW_W = 800, VIEW_H = 600;
const SCALE = 2;
const TS = 24 * SCALE; // 2x grid
const MARGIN = TS; // keep the hero this far inside the window edges

// Gameplay tuning lives in balance.js; alias the hot ones to keep the body terse.
const { hero: HERO, enemies: ENEMIES } = BALANCE;
const { scroll: SCROLL, mapH: MAP_H } = BALANCE;

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export function createRunScene(ctx, input, seed, party, saveBlob, bgId) {
  const level = generate(seed, {
    w: 48, h: MAP_H, bearing: (3 * Math.PI) / 2, tileSize: TS,
    wallScaleX: BALANCE.wall.scaleX, wallScaleY: BALANCE.wall.scaleY, wallDensity: BALANCE.wall.density,
  });
  const mapW = level.w * TS, mapH = level.h * TS;
  let voidClock = 0; // real-time seconds for the void animation (drawn by runRender)
  ctx.imageSmoothingEnabled = false; // crisp 1:1 tile blits, no scaling blur
  const homeSet = new Set(level.homeBand.map(([x, y]) => y * level.w + x));
  const rng = makeRng(subSeed(seed, "spawns"));
  // Loot stream is its own sub-seed (spec 07): drops + shop stock stay reproducible
  // and independent of world-gen ("gen") and the director ("spawns").
  const lootRng = makeRng(subSeed(seed, "loot"));
  const LOOT = BALANCE.loot;
  // One shuffled bag both shops and drops draw from without replacement, so the same
  // item is never offered or dropped twice in a run (uniqueness, not weighted re-rolls).
  const lootBag = makeLootBag(lootRng);

  // Run-scoped progression (spec 07 runState): held powerup ids (unique — the bag
  // never repeats one) and the single in-run currency (cash). `base` is the
  // normalized rebuild snapshot the hero + weapon are replayed from on every
  // acquisition.
  // The chosen party (ids, head first): party[0] is the controllable head, the rest
  // trail as the follower train. Resolve to roster defs (slice stub: baseline stats +
  // one weapon + a color per character; real per-hero data lands later).
  const ROSTER = Object.fromEntries(BALANCE.roster.map((c) => [c.id, c]));
  const head = ROSTER[party[0]];
  const followerDefs = party.slice(1).map((id) => ROSTER[id]);

  // Resolve a signature id (docs/19) to a live per-entity copy; deep-copy its damage so
  // per-entity mods / The Drop's charge math don't mutate the shared def.
  const resolveSig = (id) => {
    if (!id) return null;
    const s = BALANCE.signatures[id];
    return { id, ...s, damage: s.damage ? { ...s.damage } : undefined };
  };

  const runState = { cash: 0, powerups: [], kills: 0 };

  // Telemetry (droppable; see telemetry.js). One run = run_start → band_reached* →
  // run_end, correlated by runId. deepestBand drives the descent funnel (how far
  // south players actually get) and run_end keys the death "heatmap" off the same
  // fraction the save uses. No-op locally and whenever the page has no analytics.
  const runId = newRunId();
  const runStartedAt = Date.now();
  let deepestBand = 0, ended = false;
  track("run_start", { run_id: runId, hero_id: head.id, weapon: head.weaponId, party_size: party.length, seed });
  // Emit run_end exactly once, whatever lethal/victory path got here. distanceFraction
  // is the same 0..1 progress the RunResult banks; band is its 1..10 bucket.
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

  // Hero shares the full spec-03 entity shape (stats + derived + faction + the
  // health/mana component) with every enemy; combat.js operates on all of them.
  // `stats` is a copy of the def (powerups mutate it; the BALANCE def must stay base).
  const hero = {
    x: level.start.x * TS + TS / 2, y: level.start.y * TS + TS / 2,
    w: HERO.r * 2, h: HERO.r * 2, r: HERO.r,
    id: head.id,
    stats: { ...(head.stats || HERO.stats) }, faction: HERO.faction, color: head.color,
    iframes: 0, iframeDur: HERO.iframeDur, manaRegen: HERO.manaRegen, dead: false, cd: 0,
    sigCd: 0, signature: resolveSig(head.signatureId), charge: 0, damageTaken: 0, fadeT: BALANCE.spawnFade,
  };
  // Meta upgrades (spec 08) fold into base stats before derive — permanent boosts
  // bought between runs, applied once at run start (vs. powerups, applied mid-run).
  applyHeroUpgrades(hero, head.id, saveBlob, BALANCE.derive);
  hero.hp = hero.derived.maxHp;
  hero.mana = hero.derived.maxMana;

  // Follower train (spec-18 party, slice stand-in): hero clones that trail one tile
  // back, auto-fire their own weapon, take full combat damage, and permadie. Built from
  // the chosen party (party[1..]); `trail` is the hero's breadcrumb polyline they retrace.
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
      // Pending until the head has descended far enough to leave room for this slot — then
      // it materializes at its trail point (no stacked-at-the-cramped-spawn pile-up).
      pending: true,
    };
    // A hero carries their permanent upgrades whether they lead or trail — fold them here too,
    // not just on the head (otherwise a trailing hero's tree, e.g. Dash's Grit feeding his dust,
    // would silently do nothing). applyHeroUpgrades folds owned ranks into stats, then derives.
    applyHeroUpgrades(f, def.id, saveBlob, BALANCE.derive);
    f.hp = f.derived.maxHp;
    f.mana = f.derived.maxMana;
    return f;
  });

  // Rebuild hero + weapon from base after every acquisition (spec 07 applyHeld), and
  // refresh the cached HUD tally so render doesn't rebuild it every frame.
  let heldLine = "";
  function rebuild() {
    applyHeld(hero, weapon, base, runState.powerups, BALANCE.derive, LOOT);
    // Held ids are unique (bag draw), so a flat name list — no ×N stacks to tally.
    heldLine = runState.powerups.map((id) => POWERUPS[id].name).join(",  ");
  }

  // Route an acquired powerup id: timed `buff` kinds (BPM Boost / Slow Jam) start a live
  // timer; everything else joins the held set and rebuilds hero+weapon from base.
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
      // A blessing that raised max HP heals by the gain (one-time items, no abuse).
      if (hero.derived.maxHp > before) hero.hp += hero.derived.maxHp - before;
    }
  }

  const pickups = []; // powerup drops lying on the ground, awaiting hero overlap
  const shop = createShop({
    ctx, input, level, homeSet, lootRng, lootBag, runState, acquire,
    ts: TS, viewW: VIEW_W, viewH: VIEW_H,
  });

  const cam = { x: 0, y: 0 };
  // Screen shake: a magnitude (px) that decays each frame and perturbs the render camera.
  // Big AoE pulses and a hero getting shoved raise it; render jitters the world, not the HUD.
  let shake = 0;
  const SHAKE_MAX = 16, SHAKE_DECAY = 70; // cap, and px/sec linear falloff
  const addShake = (mag) => { shake = Math.min(SHAKE_MAX, Math.max(shake, mag)); };
  const enemies = [];
  const projectiles = []; // all in-flight shots, hero + enemy, tagged by faction
  const blasts = [];      // transient AoE rings (nova/bomb detonations), visual only
  const swings = [];      // transient melee swing wedges, visual only
  const fields = [];      // lingering damage zones (field weapon)
  const deployables = []; // placed turrets (Eugene's Drum Machine) — hold world position
  const floaters = [];    // rising damage numbers, one per landed hit, visual only
  const debris = [];      // spent slingshot pellets resting where they landed (persist), visual only
  const dustPuffs = [];   // Dash's dust-trail puffs (slow + chip), emitted along his path while trailing
  const heroTargets = [hero, ...followers]; // player-faction targets enemy shots resolve against
  const { shift, separate, separateHero, heroMove } = createSoftBody({ level, hero, enemies });
  let outcome = null;
  let paused = false, pEsc = false; // Esc toggles a full freeze during free descent
  let deathCause = null; // short label of what killed the hero (spec 15 RunResult.cause)
  // Crew-wide permadeath bookkeeping: every hero id that personally died this run (head
  // via loseRun, followers as they're reaped). The campaign removes these from the crew.
  const deadThisRun = new Set();
  // One place to end the run as a loss with its cause — every lethal path routes here.
  const loseRun = (cause) => { outcome = "lose"; deathCause = cause; deadThisRun.add(head.id); sfx.play("scream"); sfx.play("lose"); emitRunEnd(false); };
  // Build an enemy from its def at a tile and push it live. The entity holds live
  // state + the spec-03 component shape (stats/derived/faction/health/mana) the
  // shared resolver operates on; immutable config stays on `def` and is read
  // through `e.def.*` (behavior, freezesToKill, attack), so there's one source of truth.
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

  // Adaptive difficulty: the director scales its threat budget by the party's current
  // aggregate HP relative to the head's max — bigger/healthier party → more threat,
  // injured/dwindling → less (see director.threatMult).
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

  // Spawn a projectile owned by `attacker`; its faction (which side it can hit)
  // comes from the attacker. `shape` defaults to a single-hit projectile; a `bomb`
  // detonates an area on contact, a `pierce` projectile (beam) hits each enemy once.
  // Knockback no longer teleports: it queues an impulse of `mag` px along (dx,dy)
  // to ride out over a few frames (heavier targets carry it longer), consumed by
  // applyKb each tick. A fresh hit overwrites any in-flight shove.
  function knockback(t, dx, dy, mag) {
    const m = Math.hypot(dx, dy) || 1;
    const K = BALANCE.knockback;
    const hpFrac = Math.min(1, t.derived.maxHp / K.hpAtMax);
    const frames = Math.max(1, Math.round(K.min + hpFrac * (K.max - K.min)));
    t.kb = { vx: (dx / m) * mag / frames, vy: (dy / m) * mag / frames, frames };
    if (t === hero) addShake(7); // the head getting shoved jolts the view
    // Enemies are stunned after a shove (bigger bodies take longer to recover): a full
    // stop for pauseT frames, then a ramp back to speed over staggerT. The hero keeps
    // full control, so it gets neither.
    if (t.def) {
      t.pauseT = Math.round(K.pauseMin + hpFrac * (K.pauseMax - K.pauseMin));
      const s = Math.round(K.staggerMin + hpFrac * (K.staggerMax - K.staggerMin));
      t.staggerT = s; t.staggerMax = s;
    }
  }
  // Spend one frame of a queued knockback, stopping at walls (spec 04 knockback).
  function applyKb(t) {
    if (!t.kb || t.kb.frames <= 0) return;
    moveAndCollide(level, t, t.kb.vx, t.kb.vy);
    t.kb.frames--;
  }
  // An enemy just died (the slice's stand-in for spec 04's `death` event, funneled
  // through the single hit path below). Pay cash and roll a world drop on the loot
  // stream. `looted` guards the one-shot — corpses linger, so we'd otherwise re-pay.
  function onEnemyDeath(e) {
    e.looted = true;
    sfx.play("death");
    runState.kills++;
    runState.cash += cashForKill(e.def, LOOT);
    // On a drop, take the next id from the shared bag so drops stay unique run-wide
    // (and don't dupe what a shop already offered). Empty bag → no drop.
    if (lootBag.length && rollDrop(lootRng, e.def, LOOT)) {
      const id = lootBag.shift();
      pickups.push({ x: e.x, y: e.y, defId: id, r: LOOT.pickupR, t: 0, dead: false });
    }
  }

  // Player weapon/signature dispatch + the generic effect steppers live in combatKit, driven
  // verbatim by the party-select preview too. Inject the world-coupled bits: the queued,
  // wall-collided knockback; the wall/expiry test; the crush-line deployable cull; and the
  // loot/loss-on-death hook (a hero death ends the run, an enemy death rolls loot once).
  const combat = createCombat({
    enemies, heroTargets, projectiles, blasts, fields, deployables, swings, floaters, debris, dustPuffs,
    knockback,
    projectileBlocked: (x, y) => !isWalkable(level, Math.floor(x / TS), Math.floor(y / TS)),
    cullDeployable: (d) => d.y < cam.y + MARGIN, // left behind once the crush line passes it
    sfx: sfx.play,
    shake: addShake,
    onDeath: (t, attacker) =>
      t === hero ? loseRun(attacker.def ? attacker.def.name : null)
                 : (t.def && !t.looted && onEnemyDeath(t)),
  });
  const nearestEnemy = () => combat.nearestEnemyTo(hero.x, hero.y);

  // Point on the hero's breadcrumb trail `back` world-units behind the head, walking
  // the polyline and interpolating. Null only before the trail has any points.
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

  // Party-member damage flows through the shared resolver (i-frames + death) like any
  // entity; only the head's death ends the run — a follower just permadies and is reaped.
  function hurtMember(m, amount, srcName) {
    if (m.fadeT > 0) return; // intangible while materializing in
    const dealt = applyDamage(m, amount);
    if (dealt > 0) { combat.spawnHitNumber(m, dealt); combat.creditCharge(m, dealt, true); sfx.play("hurt"); }
    if (m.dead && m !== hero) sfx.play("scream"); // a follower permadies (head death screams via loseRun)
    if (m === hero && hero.dead) loseRun(srcName);
  }

  const { stepEnemy, stepConfused } = createEnemyAI({
    level, enemies, hero, followers, rng, combat,
    hurtMember, knockback, onEnemyDeath, ts: TS,
  });

  function update(dt) {
    voidClock += dt; // void background animates on real time, regardless of pause/outcome
    if (outcome) return; // run is over; main hands off to the summary scene (spec 15)
    // Track Esc every frame (even in the shop, which owns Esc to leave) so closing a
    // stall with Esc can't bleed into the same press toggling pause.
    const esc = input.down("Escape"), escEdge = esc && !pEsc;
    pEsc = esc;
    if (shop.isOpen()) { shop.step(); return; } // paused at a stall — only the modal runs
    if (escEdge) paused = !paused;
    if (paused) return; // frozen; render() draws the PAUSED overlay, Esc resumes
    while (input.consumeTap()) { /* gameplay has no tap actions — drain so taps don't
      back up and flush all at once when a shop opens (touch drives movement, not taps) */ }
    // Timed buffs tick on UNSCALED time: Slow Jam scales the whole sim (bullet-time),
    // BPM Boost speeds the head. The head keeps real-time movement (rawDt below) so
    // bullet-time makes it nimble rather than sluggish.
    const rawDt = dt;
    shake = Math.max(0, shake - SHAKE_DECAY * rawDt); // decays in real time, even under bullet-time
    let timeScale = 1, bpm = 1;
    for (const b of activeBuffs) { b.t -= rawDt; if (b.kind === "time") timeScale = Math.min(timeScale, b.mult); else if (b.kind === "speed") bpm *= b.mult; }
    for (let i = activeBuffs.length - 1; i >= 0; i--) {
      const b = activeBuffs[i];
      if (b.t > 0) continue;
      // A speed burst with a crash tail flips into its slow phase instead of ending.
      if (b.kind === "speed" && b.tailMult && !b.tail) { b.tail = true; b.mult = b.tailMult; b.t = b.tailDuration; }
      else activeBuffs.splice(i, 1);
    }
    dt *= timeScale;
    hero.cd = Math.max(0, hero.cd - dt);
    hero.sigCd = Math.max(0, hero.sigCd - dt);
    hero.iframes = Math.max(0, hero.iframes - dt);
    hero.fadeT = Math.max(0, hero.fadeT - dt);
    regenMana(hero, dt); // same mana code the enemy casters use

    cam.y = clamp(cam.y + SCROLL * dt, 0, mapH - VIEW_H);
    const minY = cam.y + MARGIN; // the advancing crush line; fatal to whoever crosses it

    // Director spends its depth-scaled budget on fresh off-screen threat.
    director.update(dt, hero, enemies, spawnEnemy);

    const intent = input.intent();
    heroMove(intent.x * hero.derived.moveSpeed * bpm * rawDt, intent.y * hero.derived.moveSpeed * bpm * rawDt);

    // Breadcrumb the hero's path (newest first) for the follower train to retrace,
    // sampling only on real movement and keeping just enough length for the whole train.
    if (!trail.length || dist(hero.x, hero.y, trail[0].x, trail[0].y) > 1) {
      trail.unshift({ x: hero.x, y: hero.y });
      const maxLen = (followers.length + 1) * gap;
      let acc = 0;
      for (let i = 1; i < trail.length; i++) {
        acc += dist(trail[i].x, trail[i].y, trail[i - 1].x, trail[i - 1].y);
        if (acc > maxLen) { trail.length = i + 1; break; }
      }
    }

    // Selected weapon: SPACE (or auto-fire on touch) fires through the shared resolver
    // (cooldown + mana + reach/range gated inside, per the weapon's own `autofire`),
    // auto-aimed at the nearest enemy. The follower train fires the same way.
    // Per-hero tradeoff: the head contributes ONLY its active weapon (no signature, no
    // passive). Every follower contributes ONLY its passive signature (no weapon — below).
    // So adding a hero trades their weapon away for their passive: a real choice, not a
    // free firepower stack.
    if (input.down("Space") || input.touchActive()) combat.fireWeapon(hero, weapon, nearestEnemy());

    // Enemy brains (skip dead/frozen; cull far enemies on the long map)
    const activeY = cam.y + VIEW_H / 2;
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.slowT > 0) e.slowT -= dt; // Chill Zone debuff fades; slow never skips the brain
      if (e.frozenT > 0) { e.frozenT -= dt; continue; }
      if (Math.abs(e.y - activeY) >= VIEW_H) continue;
      if (e.confuseT > 0) { e.confuseT -= dt; stepConfused(e, dt); } // Bad Trip: turn on its own kind
      else stepEnemy(e, dt);
    }

    // Queued knockback rides out here, after brains — a frozen or mid-attack enemy
    // still slides, and so does a corpse, so a killing blow still flings the body. The
    // post-shove stun ticks down too: pause first, then the ramp back to full speed.
    for (const e of enemies) {
      applyKb(e);
      if (e.pauseT > 0) e.pauseT--;
      else if (e.staggerT > 0) e.staggerT--;
    }
    applyKb(hero);

    // Follower train: snap each to its breadcrumb a fixed arc-length back, auto-swing
    // its bat, and permadie when crushed against the advancing edge. Contact damage to
    // a follower is dealt by the enemies that target it (BEHAVIORS, via hurtMember);
    // enemy projectiles already hit followers through the shared heroTargets faction.
    // Total trail length so far — a follower joins only once the head has descended past
    // its slot, so the train materializes into cleared space instead of stacking at spawn.
    let trailLen = 0;
    for (let t = 1; t < trail.length; t++) trailLen += dist(trail[t].x, trail[t].y, trail[t - 1].x, trail[t - 1].y);

    for (let i = 0; i < followers.length; i++) {
      const f = followers[i];
      if (f.pending) {
        if (trailLen >= (i + 1) * gap) { // room opened: materialize at the trail point
          const p = trailPointBack((i + 1) * gap);
          if (p) { f.x = p.x; f.y = p.y; f.pending = false; f.fadeT = BALANCE.spawnFade; }
        }
        continue; // not in play yet — no move, fire, crush, collision, or render
      }
      f.cd = Math.max(0, f.cd - dt);
      f.sigCd = Math.max(0, f.sigCd - dt);
      f.iframes = Math.max(0, f.iframes - dt);
      f.fadeT = Math.max(0, f.fadeT - dt);
      regenMana(f, dt);
      combat.tickHeal(f, dt);
      combat.tickCharge(f, dt); // The Drop's baseline trickle, so a back-line follower still fires
      combat.tickWake(f, dt); // Dash's dust trail, emitted as he retraces the conga path
      const p = trailPointBack((i + 1) * gap);
      // Re-home to the trail point at a capped speed (its own moveSpeed × the knob),
      // not a fixed fraction: a shoved follower closes the gap at a steady rate, so
      // out-running the train strands it — slow down to let the line re-form. bpm/rawDt
      // tie its pace to the head's (BPM-boost / Slow-Jam). In normal following the trail
      // point only advances a head-step each frame, so d <= step and it snaps on-point.
      if (p) {
        const dx = p.x - f.x, dy = p.y - f.y, d = Math.hypot(dx, dy);
        const step = f.derived.moveSpeed * BALANCE.followerReturnSpeedMult * bpm * rawDt;
        if (d <= step || d < 1e-3) { f.x = p.x; f.y = p.y; }
        // Per-axis shift mirrors heroMove: a returning follower slides along a wall
        // instead of clipping a corner (shift reverts a blocked axis).
        else { const s = step / d; shift(f, dx * s, 0); shift(f, 0, dy * s); }
      }
      // Mirror the hero's crush rule (below): riding the advancing edge is fine,
      // but being pinned against a wall there is fatal — that's "left behind".
      if (f.y < minY) { f.y = minY; if (boxBlocked(level, f)) { f.dead = true; continue; } }
      const near = combat.nearestEnemyTo(f.x, f.y);
      combat.fireSignature(f, near); // followers contribute only their passive signature, no weapon
    }

    // Projectiles, lingering fields, and turrets all advance through the shared combat kit
    // (same hit/detonate/pierce/fuse path the preview uses); the world-coupled wall test and
    // crush-line cull were injected when `combat` was built.
    combat.stepProjectiles(dt);
    combat.stepFields(dt);
    combat.stepDeployables(dt);
    combat.stepDustPuffs(dt);
    for (const b of blasts) b.t += dt; // visual rings expand then expire
    for (const s of swings) s.t += dt; // melee wedges flash then expire
    for (const f of floaters) f.t += dt; // damage numbers rise and fade

    // Bodies take up space. The hero hard-blocks against bodies in heroMove;
    // here push living enemies out of one another, the hero, and solid corpses.
    // Single pass into the two buckets — avoids two filter allocations per frame.
    const live = [], corpses = [];
    for (const e of enemies) (e.dead ? corpses : live).push(e);
    for (let i = 0; i < live.length; i++) {
      separateHero(hero, live[i], BALANCE.heroCrowdYield); // crowd slows the head (never south-pins)
      for (const c of corpses) separate(c, live[i], false);
      for (let j = i + 1; j < live.length; j++) separate(live[i], live[j], true);
    }
    for (const c of corpses) separate(hero, c, false); // the hero shoves (heavy) corpses aside

    // Followers are soft bodies too: living enemies and corpses shove them off their
    // trail point (they re-home at a capped speed via followerReturnSpeedMult). shift()'s wall-revert keeps
    // them from clipping into walls. Runs after the enemy/hero pass so enemy positions are
    // settled. Crush leniency: a shove past minY isn't fatal here — the check at the top of
    // the follower loop catches a genuine pin next frame.
    for (let i = 0; i < followers.length; i++) {
      const f = followers[i];
      if (f.dead || f.pending) continue;
      for (const e of live) separate(e, f, false);
      for (const c of corpses) separate(c, f, false);
      // No follower-vs-follower push: they're spaced by the trail, and mutual separation
      // can fling briefly-coincident bodies. Letting them overlap on a tight turn is calmer.
    }

    // Powerup pickups: collect on hero overlap → append to held + rebuild from base.
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
    // Pellets persist where they land, but the descent only moves down — once one is above
    // the viewport it can never return, so cull it to bound the array over a run.
    for (let i = debris.length - 1; i >= 0; i--) if (debris[i].y < cam.y) debris.splice(i, 1);
    // Dust puffs are short-lived; reap them once faded out or scrolled above the crush line.
    for (let i = dustPuffs.length - 1; i >= 0; i--) if (dustPuffs[i].t >= dustPuffs[i].life || dustPuffs[i].y < cam.y) dustPuffs.splice(i, 1);
    // Reap dead followers (HP gone or crushed) — permadeath, also off the shot-target list.
    for (let i = followers.length - 1; i >= 0; i--) {
      if (!followers[i].dead) continue;
      deadThisRun.add(followers[i].id); // logged for the campaign's crew cull
      const ti = heroTargets.indexOf(followers[i]);
      if (ti >= 0) heroTargets.splice(ti, 1);
      followers.splice(i, 1);
    }

    // Stay inside the moving window; being crushed against a wall is fatal.
    // (heroMove already keeps x within the map and out of walls — no x clamp.)
    if (hero.y < minY) {
      hero.y = minY;
      if (boxBlocked(level, hero)) loseRun("left behind by the dark");
    }
    hero.y = clamp(hero.y, minY, cam.y + VIEW_H - MARGIN);
    cam.x = clamp(hero.x - VIEW_W / 2, 0, mapW - VIEW_W);

    // Descent funnel: fire band_reached once per newly-entered tenth of the way home,
    // so analytics shows where runs thin out (telemetry.js no-ops if analytics is off).
    const band = Math.min(10, Math.floor(distanceFraction(hero, level, TS) * 10) + 1);
    if (band > deepestBand) { deepestBand = band; track("band_reached", { run_id: runId, hero_id: head.id, band, t_s: Math.round((Date.now() - runStartedAt) / 1000) }); }

    const [tx, ty] = tileOf(hero);
    if (homeSet.has(ty * level.w + tx)) { outcome = "win"; sfx.play("win"); emitRunEnd(true); }
  }

  // All drawing lives in runRender; inject the live world plus getters for the
  // reassigned scalars it reads (shake/paused/voidClock/heldLine).
  const { render } = createRunRenderer({
    ctx, input, level, cam, hero, weapon, followers, enemies, shop,
    pickups, projectiles, blasts, swings, fields, deployables, floaters, debris, dustPuffs,
    runState, bgId,
    getShake: () => shake, getPaused: () => paused, getVoidClock: () => voidClock, getHeldLine: () => heldLine,
    ts: TS, viewW: VIEW_W, viewH: VIEW_H,
  });

  // RunResult (spec 15): the Run→resolution payload, built from the live run state
  // at the instant it ends. Only distanceFraction/kills/won reach the save; the rest
  // are display-only. `finished` flips once and tells main to hand off to the summary.
  return {
    update, render, runState, nextSeed: seed + 1, bgId, // bgId rides through to the between-days screen
    // Read-only live-state handle for the headless gauntlet harness (tests/gauntlet.mjs):
    // lets a bot read the hero position + map to steer, and taps run metrics. Not used
    // by the game itself.
    get _probe() { return { hero, level, enemies, cam, followers }; },
    get finished() { return outcome !== null; },
    get result() {
      return {
        distanceFraction: outcome === "win" ? 1 : distanceFraction(hero, level, TS),
        kills: runState.kills, won: outcome === "win",
        cause: deathCause, heroId: head.id, seed, cashDiscarded: runState.cash,
        // Crew-wide permadeath: ids that died this run vs. those who walked away. The
        // campaign culls `died` from the crew; `survived` carries to the next day.
        died: [...deadThisRun],
        survived: party.filter((id) => !deadThisRun.has(id)),
      };
    },
  };
}

