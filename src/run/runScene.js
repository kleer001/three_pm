// Vertical-slice RUN scene: a forced southward descent. The camera window
// auto-scrolls down, holding Marvin inside it; home is the south band, four
// times the map away. Enemies use BFS pathfinding (ported from BrainMaze), take
// up space (soft body collision), and stop to attack. Marvin fights back with an
// auto-aiming weapon (chosen on the select screen) whose damage and mana cost run
// through the same combat resolver the enemies use.
import { generate, isWalkable, TILE } from "./levelgen.js";
import { moveAndCollide, boxBlocked } from "./collision.js";
import { makeRng, subSeed } from "../core/rng.js";
import { makeDirector, distanceFraction } from "./director.js";
import { recomputeDerived, applyDamage, regenMana } from "./combat.js";
import { POWERUPS, applyHeld, snapshotBase, cashForKill, rollDrop, makeLootBag } from "./powerups.js";
import { applyHeroUpgrades } from "../meta/save.js";
import { BALANCE, THEME } from "./balance.js";
import { track, newRunId } from "./telemetry.js";
import { createVoidRenderer } from "./voidBackgrounds.js";
import { createCombat } from "./combatKit.js";
import { createSoftBody } from "./softBody.js";
import { createShop } from "./shop.js";
import { createEnemyAI } from "./enemyAI.js";
import { sfx } from "../audio/sfx.js";
import { disc, ring, bar, glyph, clamp, drawMember } from "./draw.js";

const VIEW_W = 800, VIEW_H = 600;
const SCALE = 2;
const TS = 24 * SCALE; // 2x grid
const MARGIN = TS; // keep the hero this far inside the window edges
const VOID_CORNER = TS * 0.45; // rounding radius for exposed void-hole corners
const GLOW_BLUR = 14;          // rim glow width (≈50% wider than the prior 9px shadow)
const GLOW_COLOR = "rgba(165,205,255,1)"; // light-blue rim tint
const GLOW_GAIN = 1.5;         // rim glow strength (drawn over itself this many ×, ≈50% stronger)

// Append one closed rounded-rect subpath with per-corner radii (0 = square corner).
// ctx.roundRect isn't safe across all targets the slice ships to, so build it from arcTo.
function addRoundTile(c, x, y, w, h, tl, tr, br, bl) {
  c.moveTo(x + tl, y);
  c.arcTo(x + w, y,     x + w, y + h, tr);
  c.arcTo(x + w, y + h, x,     y + h, br);
  c.arcTo(x,     y + h, x,     y,     bl);
  c.arcTo(x,     y,     x + w, y,     tl);
  c.closePath();
}

// Gameplay tuning lives in balance.js; alias the hot ones to keep the body terse.
const { hero: HERO, enemies: ENEMIES } = BALANCE;
const { scroll: SCROLL, mapH: MAP_H } = BALANCE;
const TILE_COLOR = THEME.tile; // indexed by tile id (see TILE in levelgen.js)

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// Optional textured ground (assets/tiles.png). The game renders flat THEME.tile
// fills until this dual-grid atlas loads, and keeps doing so if it never does —
// tiles are a droppable asset (CLAUDE.md "Art is isolated from game code"). The
// load error is swallowed by intent, not to hide a bug. Material mapping:
// WALL→hedge, FLOOR→brick, RUBBLE→crater, paved→road, yard→grass base.
const TILE_TO_MAT = [];
TILE_TO_MAT[TILE.STREET] = TILE_TO_MAT[TILE.SIDEWALK] = TILE_TO_MAT[TILE.ALLEY] = "road";
TILE_TO_MAT[TILE.FLOOR] = "brick";
TILE_TO_MAT[TILE.WALL] = "hedge";
TILE_TO_MAT[TILE.RUBBLE] = "crater";
TILE_TO_MAT[TILE.YARD] = null;

let tileAtlas = null; // { sheet, ground, mats:{name:[16 frames]}, order:[names] }
(function loadTileAtlas() {
  fetch(new URL("../../assets/tiles.json", import.meta.url))
    .then((r) => r.json())
    .then((desc) => new Promise((res) => {
      const img = new Image();
      img.onload = () => res({ desc, img });
      img.onerror = () => res(null); // missing png → stay on flat fills
      img.src = new URL("../../assets/" + desc.sheet, import.meta.url).href;
    }))
    .then((loaded) => {
      if (!loaded) return;
      const { desc, img } = loaded;
      const order = Object.keys(desc.materials); // priority order, last on top
      const mats = {};
      for (const m of order) {
        const arr = new Array(16);
        for (let c = 0; c < 16; c++) arr[c] = desc.frames[desc.materials[m][c]];
        mats[m] = arr;
      }
      tileAtlas = { sheet: img, ground: desc.frames[desc.ground], mats, order };
    })
    .catch(() => {}); // missing/bad json → stay on flat fills
})();

export function createRunScene(ctx, input, seed, party, saveBlob, bgId) {
  const level = generate(seed, {
    w: 48, h: MAP_H, bearing: (3 * Math.PI) / 2, tileSize: TS,
    wallScaleX: BALANCE.wall.scaleX, wallScaleY: BALANCE.wall.scaleY, wallDensity: BALANCE.wall.density,
  });
  const mapW = level.w * TS, mapH = level.h * TS;
  // The blocking RUBBLE tiles render as "holes in reality" — the chosen void effect,
  // masked to the crater's exact shape and given a glowing rim. Null bgId falls back to
  // the flat darkened crater look. The void is drawn into an offscreen buffer so it can
  // be masked (destination-in) to the crater silhouette before compositing with a glow.
  const voidRenderer = bgId ? createVoidRenderer(bgId, VIEW_W, VIEW_H) : null;
  const mkBuf = () => { const c = document.createElement("canvas"); c.width = VIEW_W; c.height = VIEW_H; return c; };
  const voidBuf = voidRenderer ? mkBuf() : null;       // the rendered void
  const maskBuf = voidRenderer ? mkBuf() : null;       // accumulated crater silhouette (one destination-in source)
  const glowBuf = voidRenderer ? mkBuf() : null;       // pre-blurred blue rim (blurred once per frame)
  const voidBufCtx = voidBuf ? voidBuf.getContext("2d") : null;
  const maskBufCtx = maskBuf ? maskBuf.getContext("2d") : null;
  const glowBufCtx = glowBuf ? glowBuf.getContext("2d") : null;
  let voidClock = 0; // real-time seconds for the void animation
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

  // Dual-grid textured ground: a static grass base, then one offset pass per
  // material. Each display tile sits half a cell up-left of the logic grid and
  // samples its 4 corner cells (TL=1,TR=2,BR=4,BL=8) to pick an autotile, so an
  // island's outline closes correctly. +1px overscan matches the flat path's
  // seam guard. (x0..y1 are the visible cell bounds from render().)
  function drawTiles(x0, x1, y0, y1) {
    const A = tileAtlas, g = A.ground;
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        ctx.drawImage(A.sheet, g.x, g.y, g.w, g.h, Math.floor(tx * TS - cam.x), Math.floor(ty * TS - cam.y), TS + 1, TS + 1);
    const matCell = (x, y) => (x < 0 || y < 0 || x >= level.w || y >= level.h) ? null : TILE_TO_MAT[level.tiles[y * level.w + x]];
    const dx0 = Math.floor((cam.x - TS / 2) / TS), dx1 = Math.ceil((cam.x + VIEW_W) / TS);
    const dy0 = Math.floor((cam.y - TS / 2) / TS), dy1 = Math.ceil((cam.y + VIEW_H) / TS);
    for (const m of A.order) {
      const frames = A.mats[m];
      for (let y = dy0; y <= dy1; y++)
        for (let x = dx0; x <= dx1; x++) {
          const c = (matCell(x, y) === m ? 1 : 0) | (matCell(x + 1, y) === m ? 2 : 0) | (matCell(x + 1, y + 1) === m ? 4 : 0) | (matCell(x, y + 1) === m ? 8 : 0);
          if (!c) continue;
          const f = frames[c];
          ctx.drawImage(A.sheet, f.x, f.y, f.w, f.h, Math.floor(x * TS + TS / 2 - cam.x), Math.floor(y * TS + TS / 2 - cam.y), TS + 1, TS + 1);
        }
    }
  }

  // Draw the crater material's dual-grid silhouette into `dst` (same shape drawTiles
  // renders), used as a destination-in mask so the void exactly fills the crater holes.
  function drawCraterMask(dst, dx0, dx1, dy0, dy1) {
    const A = tileAtlas, frames = A.mats.crater;
    const isC = (x, y) => x >= 0 && y >= 0 && x < level.w && y < level.h && TILE_TO_MAT[level.tiles[y * level.w + x]] === "crater";
    for (let y = dy0; y <= dy1; y++)
      for (let x = dx0; x <= dx1; x++) {
        const c = (isC(x, y) ? 1 : 0) | (isC(x + 1, y) ? 2 : 0) | (isC(x + 1, y + 1) ? 4 : 0) | (isC(x, y + 1) ? 8 : 0);
        if (!c) continue;
        const f = frames[c];
        dst.drawImage(A.sheet, f.x, f.y, f.w, f.h, Math.floor(x * TS + TS / 2 - cam.x), Math.floor(y * TS + TS / 2 - cam.y), TS + 1, TS + 1);
      }
  }

  function render() {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    // Screen shake: bias the camera by a random jitter for the world draw, undone before the
    // HUD (below) so only the world shakes. Everything world-space reads cam.x/cam.y, so one
    // offset jolts tiles, void, entities, and damage numbers together.
    const shx = shake > 0 ? (Math.random() * 2 - 1) * shake : 0;
    const shy = shake > 0 ? (Math.random() * 2 - 1) * shake : 0;
    cam.x += shx; cam.y += shy;
    const x0 = Math.max(0, Math.floor(cam.x / TS)), x1 = Math.min(level.w - 1, Math.ceil((cam.x + VIEW_W) / TS));
    const y0 = Math.max(0, Math.floor(cam.y / TS)), y1 = Math.min(level.h - 1, Math.ceil((cam.y + VIEW_H) / TS));
    if (tileAtlas) drawTiles(x0, x1, y0, y1);
    else for (let ty = y0; ty <= y1; ty++)
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

    // Holes in reality: render the void into its buffer, mask it to the crater's exact
    // silhouette (convex/concave curves and all), then composite over the scene with a
    // glowing blue rim. Without the atlas, fall back to rounded-rect hole shapes.
    if (voidRenderer) {
      const rub = (tx, ty) => tx >= 0 && ty >= 0 && tx < level.w && ty < level.h && level.tiles[ty * level.w + tx] === TILE.RUBBLE;
      const vb = voidBufCtx;
      vb.clearRect(0, 0, VIEW_W, VIEW_H);
      voidRenderer.draw(vb, voidClock, cam.y);
      if (tileAtlas && tileAtlas.mats.crater) {
        // Build the full crater silhouette in maskBuf (source-over), then intersect once.
        const dx0 = Math.floor((cam.x - TS / 2) / TS), dx1 = Math.ceil((cam.x + VIEW_W) / TS);
        const dy0 = Math.floor((cam.y - TS / 2) / TS), dy1 = Math.ceil((cam.y + VIEW_H) / TS);
        maskBufCtx.clearRect(0, 0, VIEW_W, VIEW_H);
        drawCraterMask(maskBufCtx, dx0, dx1, dy0, dy1);
        vb.save();
        vb.globalCompositeOperation = "destination-in";
        vb.drawImage(maskBuf, 0, 0);
        vb.restore();
      } else {
        // Flat fallback: a single fill of rounded-rect hole shapes is one destination-in op.
        vb.save();
        vb.globalCompositeOperation = "destination-in";
        vb.fillStyle = "#fff";
        vb.beginPath();
        for (let ty = y0; ty <= y1; ty++)
          for (let tx = x0; tx <= x1; tx++) {
            if (level.tiles[ty * level.w + tx] !== TILE.RUBBLE) continue;
            const sx = Math.floor(tx * TS - cam.x), sy = Math.floor(ty * TS - cam.y);
            const up = rub(tx, ty - 1), dn = rub(tx, ty + 1), lf = rub(tx - 1, ty), rt = rub(tx + 1, ty);
            addRoundTile(vb, sx, sy, TS + 1, TS + 1,
              (!up && !lf) ? VOID_CORNER : 0, (!up && !rt) ? VOID_CORNER : 0,
              (!dn && !rt) ? VOID_CORNER : 0, (!dn && !lf) ? VOID_CORNER : 0);
          }
        vb.fill();
        vb.restore();
      }
      // Pre-blur the rim once: blur the (already hole-shaped) void silhouette into glowBuf
      // and tint it blue. Then composite glow (haloing the edges) + the sharp void on top.
      const gc = glowBufCtx;
      gc.globalCompositeOperation = "source-over";
      gc.clearRect(0, 0, VIEW_W, VIEW_H);
      gc.filter = `blur(${GLOW_BLUR}px)`;
      gc.drawImage(voidBuf, 0, 0);
      gc.filter = "none";
      gc.globalCompositeOperation = "source-in"; // recolor the blurred silhouette to the rim tint
      gc.fillStyle = GLOW_COLOR;
      gc.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.save();
      ctx.globalAlpha = Math.min(1, GLOW_GAIN);
      ctx.drawImage(glowBuf, 0, 0);
      if (GLOW_GAIN > 1) { ctx.globalAlpha = GLOW_GAIN - 1; ctx.drawImage(glowBuf, 0, 0); } // extra pass for >100% strength
      ctx.restore();
      ctx.drawImage(voidBuf, 0, 0); // the sharp void fills the hole over the rim

    }

    ctx.fillStyle = THEME.homeBand;
    for (const [hx, hy] of level.homeBand)
      if (hx >= x0 && hx <= x1 && hy >= y0 && hy <= y1)
        ctx.fillRect(Math.floor(hx * TS - cam.x), Math.floor(hy * TS - cam.y), TS + 1, TS + 1);

    // Shop spots are structures — draw on the ground, under everything live.
    for (const s of shop.shops) {
      if (s.items.every((it) => it.bought)) continue;
      const sx = s.x - cam.x, sy = s.y - cam.y;
      ctx.fillStyle = THEME.shop.roof; // a little awning so the spot reads as a stall
      ctx.fillRect(sx - s.r, sy - s.r - 4, s.r * 2, 6);
      disc(ctx, sx, sy, s.r, THEME.shop.fill);
      ring(ctx, sx, sy, s.r, THEME.shop.ring);
      glyph(ctx, "$", sx, sy + 5, THEME.shop.glyph, THEME.shop.glyphFont);
    }

    // Lingering fields sit on the ground, under the bodies.
    for (const f of fields) {
      disc(ctx, f.x - cam.x, f.y - cam.y, f.r, THEME.field.fill);
      ring(ctx, f.x - cam.x, f.y - cam.y, f.r, THEME.field.ring);
    }

    // Deployed turrets (Drum Machine) hold position as the train moves on.
    for (const d of deployables) {
      if (d.dead) continue;
      disc(ctx, d.x - cam.x, d.y - cam.y, d.r, THEME.deploy.fill);
      ring(ctx, d.x - cam.x, d.y - cam.y, d.r + 2, THEME.deploy.ring);
    }

    // Spent slingshot pellets resting on the ground (drawn under corpses and everything live).
    for (const d of debris) disc(ctx, d.x - cam.x, d.y - cam.y, d.r, THEME.pellet);

    // Dash's dust puffs: expand and fade over their life (drawn on the ground, under live bodies).
    for (const p of dustPuffs) {
      const k = p.t / p.life;
      ctx.globalAlpha = 1 - k;
      disc(ctx, p.x - cam.x, p.y - cam.y, p.r * (0.5 + k), THEME.dust);
      ctx.globalAlpha = 1;
    }

    // Corpses (drawn under everything live)
    for (const e of enemies)
      if (e.dead) disc(ctx, e.x - cam.x, e.y - cam.y, e.r, THEME.corpse);

    // Powerup drops: bob in place so they catch the eye over the rubble.
    for (const p of pickups) {
      if (p.dead) continue;
      const px = p.x - cam.x, py = p.y - cam.y + Math.sin(p.t * LOOT.pickupBobRate) * LOOT.pickupBob;
      disc(ctx, px, py, p.r, THEME.pickup.fill);
      ring(ctx, px, py, p.r, THEME.pickup.ring);
      glyph(ctx, "+", px, py + 4, THEME.pickup.glyph, THEME.pickup.glyphFont);
    }

    // Piercing shots (beam, or any shot made to pierce) draw as a beam lancing from
    // launch origin to the live tip; the rest are dots. A sin envelope over the shot's
    // life thins it at fire, swells it mid-flight, then fades it out.
    for (const p of projectiles) {
      if (p.pierce) {
        const env = Math.sin(Math.PI * (1 - p.life / p.life0));
        ctx.globalAlpha = Math.max(0, env);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = THEME.beam.width * env + 1;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.ox - cam.x, p.oy - cam.y);
        ctx.lineTo(p.x - cam.x, p.y - cam.y);
        ctx.stroke();
        ctx.globalAlpha = 1; ctx.lineWidth = 1;
      } else disc(ctx, p.x - cam.x, p.y - cam.y, p.shotR, p.color);
    }

    for (const e of enemies) {
      if (e.dead) continue;
      const sx = e.x - cam.x, sy = e.y - cam.y, k = e.def;
      disc(ctx, sx, sy, e.r, k.color);
      if (e.confuseT > 0) { disc(ctx, sx, sy, e.r, THEME.confuse.fill); ring(ctx, sx, sy, e.r + 2, THEME.confuse.ring); }
      else if (e.slowT > 0) disc(ctx, sx, sy, e.r, THEME.slow.fill);
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

    // Follower train + head: each drawn by the shared drawMember (body, cooldown dot, status
    // bars) so the run scene and the party-select preview present a hero identically. A
    // follower shows its signature's recharge; the head shows its weapon's recharge + mana.
    for (const f of followers) {
      if (f.pending) continue; // not joined yet — nothing to draw
      drawMember(ctx, f, f.x - cam.x, f.y - cam.y, "follower");
    }
    drawMember(ctx, hero, hero.x - cam.x, hero.y - cam.y, "head", weapon);

    // Floating damage numbers: rise and fade, ghosted so they don't bury the action.
    const HN = THEME.hitNumber;
    ctx.font = HN.font;
    ctx.fillStyle = HN.color; // white for every hit, dealt or taken
    ctx.textAlign = "center";
    for (const f of floaters) {
      ctx.globalAlpha = (1 - f.t / HN.dur) * HN.alpha;
      ctx.fillText(f.value, f.x - cam.x, f.y - cam.y - f.t * HN.rise);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";

    cam.x -= shx; cam.y -= shy; // end screen shake: HUD draws in untouched screen space

    ctx.font = THEME.hud.font;
    const depth = Math.round((cam.y / (mapH - VIEW_H)) * 100);
    const ready = hero.cd <= 0 ? "ready" : `${hero.cd.toFixed(1)}s`;
    const mana = weapon.manaCost > 0 ? `   MP ${Math.round(hero.mana)}/${hero.derived.maxMana}` : "";
    const hud = `HP ${Math.max(0, Math.round(hero.hp))}/${hero.derived.maxHp}${mana}   cash ${runState.cash}   home in ${100 - depth}%   ${weapon.name} ${ready} [SPACE]`;
    ctx.fillStyle = THEME.hud.box; // backing box for legibility over any tile
    ctx.fillRect(6, 6, ctx.measureText(hud).width + 12, 22);
    ctx.fillStyle = THEME.hud.text;
    ctx.fillText(hud, 12, 21);

    // Player stats (current, so powerups/upgrades show live) under the main line.
    const s = hero.stats;
    const statLine = `SPD ${Math.round(s.speed)}   CON ${Math.round(s.constitution)}   STR ${Math.round(s.strength)}   MAG ${Math.round(s.magic)}`;
    ctx.fillStyle = THEME.hud.box;
    ctx.fillRect(6, 32, ctx.measureText(statLine).width + 12, 20);
    ctx.fillStyle = THEME.hud.text;
    ctx.fillText(statLine, 12, 46);

    // Held powerups, tallied (stacks shown ×N) — the run's accumulating build. The
    // string is cached in rebuild(); render only draws it.
    if (heldLine) {
      ctx.fillStyle = THEME.hud.box;
      ctx.fillRect(6, 58, ctx.measureText(heldLine).width + 12, 20);
      ctx.fillStyle = THEME.hud.text;
      ctx.fillText(heldLine, 12, 72);
    }

    // Floating touch joystick: faint ring at the press origin + a dot at the finger,
    // only while a drag is live. Coords are already logical canvas px. Under the shop.
    const joy = input.joystick();
    if (joy) {
      ring(ctx, joy.origin.x, joy.origin.y, joy.radius, THEME.joystick.ring);
      disc(ctx, joy.cur.x, joy.cur.y, THEME.joystick.knobR, THEME.joystick.knob);
    }

    // Paused shop modal: the frozen world shows behind a dimmed panel listing the
    // stall's stock; the player picks one to buy. Drawn last so it sits over everything.
    if (shop.isOpen()) shop.render();
    if (paused) {
      const O = THEME.overlay;
      ctx.fillStyle = O.bg; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = O.fg; ctx.textAlign = "center";
      ctx.font = O.titleFont; ctx.fillText("PAUSED", VIEW_W / 2, VIEW_H / 2 - 8);
      ctx.font = O.subFont; ctx.fillText("Esc to resume", VIEW_W / 2, VIEW_H / 2 + 24);
      ctx.textAlign = "left";
    }
    // No end overlay here — when a run resolves, main hands off to the dedicated
    // DEATH/VICTORY summary scene (spec 15), which owns the end-of-run screen.
  }

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

