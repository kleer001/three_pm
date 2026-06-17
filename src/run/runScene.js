// Vertical-slice RUN scene: a forced southward descent. The camera window
// auto-scrolls down, holding Marvin inside it; home is the south band, four
// times the map away. Enemies use BFS pathfinding (ported from BrainMaze), take
// up space (soft body collision), and stop to attack. Marvin fights back with an
// auto-aiming weapon (chosen on the select screen) whose damage and mana cost run
// through the same combat resolver the enemies use.
import { generate, isWalkable, TILE } from "./levelgen.js";
import { moveAndCollide, boxBlocked } from "./collision.js";
import { makeRng, subSeed } from "../core/rng.js";
import { findPath } from "../ai/ai.js";
import { makeDirector, distanceFraction } from "./director.js";
import { recomputeDerived, weaponDamage, applyDamage, regenMana, canCast, spendMana } from "./combat.js";
import { POWERUPS, applyHeld, snapshotBase, cashForKill, rollDrop, makeLootBag, priceItem } from "./powerups.js";
import { applyHeroUpgrades } from "../meta/save.js";
import { hitRect } from "../input/input.js";
import { BALANCE, THEME } from "./balance.js";
import { createVoidRenderer } from "./voidBackgrounds.js";

const VIEW_W = 800, VIEW_H = 600;
const SCALE = 2;
const TS = 24 * SCALE; // 2x grid
const MARGIN = TS; // keep the hero this far inside the window edges
const VOID_CORNER = TS * 0.45; // rounding radius for exposed void-hole corners
const GLOW_BLUR = 14;          // rim glow width (≈50% wider than the prior 9px shadow)
const GLOW_COLOR = "rgba(165,205,255,1)"; // light-blue rim tint
const GLOW_GAIN = 1.5;         // rim glow strength (drawn over itself this many ×, ≈50% stronger)

// Gameplay tuning lives in balance.js; alias the hot ones to keep the body terse.
const { hero: HERO, enemies: ENEMIES } = BALANCE;
const { scroll: SCROLL, mapH: MAP_H, freezeDur: FREEZE_DUR } = BALANCE;
const TILE_COLOR = THEME.tile; // indexed by tile id (see TILE in levelgen.js)

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
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
  const activeBuffs = []; // live timed buffs (BPM Boost / Slow Jam); tick on unscaled time
  const base = snapshotBase(head.stats || HERO.stats, { id: head.weaponId, ...BALANCE.weapons[head.weaponId] });
  const weapon = { ...base.weapon, damage: { ...base.weapon.damage } };

  // Hero shares the full spec-03 entity shape (stats + derived + faction + the
  // health/mana component) with every enemy; combat.js operates on all of them.
  // `stats` is a copy of the def (powerups mutate it; the BALANCE def must stay base).
  const hero = {
    x: level.start.x * TS + TS / 2, y: level.start.y * TS + TS / 2,
    w: HERO.r * 2, h: HERO.r * 2, r: HERO.r,
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
      stats: { ...(def.stats || HERO.stats) }, faction: "player", color: def.color,
      iframes: 0, iframeDur: FOLLOWER.iframeDur, manaRegen: FOLLOWER.manaRegen, dead: false, cd: 0,
      weapon: { id: def.weaponId, ...w, damage: { ...w.damage } },
      sigCd: 0, signature: resolveSig(def.signatureId), charge: 0, damageTaken: 0, fadeT: 0,
      // Pending until the head has descended far enough to leave room for this slot — then
      // it materializes at its trail point (no stacked-at-the-cramped-spawn pile-up).
      pending: true,
    };
    recomputeDerived(f, BALANCE.derive);
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
  const shops = placeShops();

  const cam = { x: 0, y: 0 };
  const enemies = [];
  const projectiles = []; // all in-flight shots, hero + enemy, tagged by faction
  const blasts = [];      // transient AoE rings (nova/bomb detonations), visual only
  const swings = [];      // transient melee swing wedges, visual only
  const fields = [];      // lingering damage zones (field weapon)
  const deployables = []; // placed turrets (Eugene's Drum Machine) — hold world position
  const floaters = [];    // rising damage numbers, one per landed hit, visual only
  const heroTargets = [hero, ...followers]; // player-faction targets enemy shots resolve against
  let outcome = null;
  let paused = false, pEsc = false; // Esc toggles a full freeze during free descent
  let deathCause = null; // short label of what killed the hero (spec 15 RunResult.cause)
  // One place to end the run as a loss with its cause — every lethal path routes here.
  const loseRun = (cause) => { outcome = "lose"; deathCause = cause; };
  let nearShop = null;  // shop the hero is standing on this frame
  // Stepping onto a shop pauses the run and opens a pick-one-item modal. shopLatch
  // keeps it from instantly reopening while the hero still overlaps after leaving;
  // it clears once they step off. prev* edge-trigger the modal's discrete keys.
  let shopOpen = false, shopLatch = false, shopSel = 0;
  let prevBuy = false, prevUp = false, prevDown = false, prevLeave = false;

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

  // Scatter shop spots down the descent — one per even depth band so they appear
  // through the run. Each stall draws its stock from the shared bag (so no item is
  // offered twice run-wide); prices are quoted later, at the moment the player
  // reaches the stall (reactive market). Placed here, not in levelgen, which
  // "emits geometry only".
  function placeShops() {
    const { count, minTileY, r, stock } = BALANCE.shop;
    const lo = Math.max(minTileY, BALANCE.spawnMinTileY), hi = level.h - 3;
    const bandH = (hi - lo) / count;
    const out = [];
    for (let b = 0; b < count; b++) {
      const y0 = Math.floor(lo + b * bandH), y1 = Math.floor(lo + (b + 1) * bandH);
      const cells = [];
      for (let ty = y0; ty < y1; ty++)
        for (let tx = 1; tx < level.w - 1; tx++)
          if (isWalkable(level, tx, ty) && !homeSet.has(ty * level.w + tx)) cells.push([tx, ty]);
      if (!cells.length) continue;
      const [tx, ty] = lootRng.pick(cells);
      const items = [];
      for (let k = 0; k < stock && lootBag.length; k++)
        items.push({ defId: lootBag.shift(), bought: false });
      if (!items.length) continue; // bag exhausted — no stall here
      out.push({ tx, ty, x: tx * TS + TS / 2, y: ty * TS + TS / 2, r, items });
    }
    return out;
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
      x: attacker.x, y: attacker.y, ox: attacker.x, oy: attacker.y, vx, vy, life: o.life, life0: o.life, dead: false,
      faction: attacker.faction, attacker, damage: o.damage,
      freeze: o.freeze, knockback: o.knockback, shotR: o.shotR, color: o.color,
      shape: o.shape || "projectile", radius: o.radius, pierce: o.pierce, hits: o.pierce ? new Set() : null,
      fuse: o.fuse != null ? o.fuse : null, impact: o.impact, planted: false,
    });
  }

  // Knockback no longer teleports: it queues an impulse of `mag` px along (dx,dy)
  // to ride out over a few frames (heavier targets carry it longer), consumed by
  // applyKb each tick. A fresh hit overwrites any in-flight shove.
  function knockback(t, dx, dy, mag) {
    const m = Math.hypot(dx, dy) || 1;
    const K = BALANCE.knockback;
    const hpFrac = Math.min(1, t.derived.maxHp / K.hpAtMax);
    const frames = Math.max(1, Math.round(K.min + hpFrac * (K.max - K.min)));
    t.kb = { vx: (dx / m) * mag / frames, vy: (dy / m) * mag / frames, frames };
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
  // An enemy's current locomotion speed: full, except while recovering from a knockback,
  // when it ramps from a near-stop back to full over its stagger window.
  function moveSpeedOf(e) {
    if (e.pauseT > 0) return 0; // dead stop right after a shove, before the ramp
    const slow = e.slowT > 0 ? e.slowMult : 1; // Chill Zone debuff
    const base = e.staggerT > 0 ? e.derived.moveSpeed * (1 - e.staggerT / e.staggerMax) : e.derived.moveSpeed;
    return base * slow;
  }
  // A landed hit's HP loss, surfaced as a rising number at the target (spec: honest hits).
  function spawnHitNumber(t, dealt) {
    floaters.push({ x: t.x, y: t.y, value: Math.round(dealt), t: 0 });
  }

  // An enemy just died (the slice's stand-in for spec 04's `death` event, funneled
  // through the single hit path below). Pay cash and roll a world drop on the loot
  // stream. `looted` guards the one-shot — corpses linger, so we'd otherwise re-pay.
  function onEnemyDeath(e) {
    e.looted = true;
    runState.kills++;
    runState.cash += cashForKill(e.def, LOOT);
    // On a drop, take the next id from the shared bag so drops stay unique run-wide
    // (and don't dupe what a shop already offered). Empty bag → no drop.
    if (lootBag.length && rollDrop(lootRng, e.def, LOOT)) {
      const id = lootBag.shift();
      pickups.push({ x: e.x, y: e.y, defId: id, r: LOOT.pickupR, t: 0, dead: false });
    }
  }

  // Resolve a single hit: percent-HP/stat-scaled damage through dmgResist, optional
  // knockback along (kdx,kdy), optional freeze (player→enemy CC). Every damage
  // source — projectiles, beams, AoE blasts — funnels through here so they agree
  // (and so every enemy death routes through one loot roll).
  function applyHit(attacker, t, damage, kbMult, kdx, kdy, freeze) {
    const dealt = applyDamage(t, weaponDamage(damage, attacker, t.derived.maxHp, t.hp));
    if (dealt > 0) { spawnHitNumber(t, dealt); creditCharge(attacker, dealt, false); if (t.signature) creditCharge(t, dealt, true); }
    if (kbMult) knockback(t, kdx, kdy, attacker.derived.knockback * kbMult);
    if (freeze && t.def) { t.freezeCount++; t.frozenT = FREEZE_DUR; if (t.freezeCount >= t.def.freezesToKill) t.dead = true; }
    if (t === hero && hero.dead) loseRun(attacker.def ? attacker.def.name : null);
    else if (t.def && t.dead && !t.looted) onEnemyDeath(t);
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

  // Nearest living enemy to a point, with its distance — the shared auto-aim pick,
  // used by the hero (SPACE) and every follower (auto-swing).
  function nearestEnemyTo(px, py) {
    let best = null, bd = Infinity;
    for (const e of enemies) {
      if (e.dead) continue;
      const d = dist(e.x, e.y, px, py);
      if (d < bd) { bd = d; best = e; }
    }
    return best && { e: best, d: bd };
  }
  const nearestEnemy = () => nearestEnemyTo(hero.x, hero.y);

  // A melee-arc swing from `attacker` at the nearest enemy `near` ({e,d}): a wedge
  // blast in reach plus its visual. Returns whether it connected. Shared by the
  // hero's SPACE fire and the follower train.
  function meleeSwing(attacker, w, near) {
    // `autofire: "cooldown"` weapons (Whirl) spin every cooldown even with nothing
    // in reach — free, aimless area denial. The default still gates on reach.
    const inReach = near && near.d <= w.radius + near.e.r;
    if (!inReach && w.autofire !== "cooldown") return false;
    const dx = near ? near.e.x - attacker.x : 0, dy = near ? near.e.y - attacker.y : 0, m = Math.hypot(dx, dy) || 1;
    const aim = w.arc >= 360 ? null : { x: dx / m, y: dy / m, cosHalf: Math.cos((w.arc * Math.PI) / 360) };
    blast(attacker.x, attacker.y, w.radius, attacker, w.damage, w.knockback, w.freeze, aim);
    swings.push({ x: attacker.x, y: attacker.y, r: w.radius, ax: dx / m, ay: dy / m, arc: w.arc, t: 0 });
    return true;
  }

  // Fire `attacker`'s weapon `w` at the nearest enemy `near` ({e,d}) when its cooldown
  // and mana allow, branching on `w.shape` for delivery. One fire path for the hero
  // (gated by SPACE) and every follower (auto). Sets cooldown + spends mana on a fire.
  function fireWeapon(attacker, w, near, cdKey = "cd") {
    if (attacker[cdKey] > 0 || !canCast(attacker, w.manaCost || 0)) return false;
    let fired = false;
    if (w.shape === "nova") {
      if (near && near.d <= w.radius) {
        blast(attacker.x, attacker.y, w.radius, attacker, w.damage, w.knockback, w.freeze);
        blasts.push({ x: attacker.x, y: attacker.y, r: w.radius, t: 0 });
        fired = true;
      }
    } else if (w.shape === "field") {
      if (near && near.d <= w.range) {
        fields.push({ x: attacker.x, y: attacker.y, r: w.radius, life: w.lifespan, tick: 0, weapon: w, attacker });
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
          shape: w.shape, radius: w.radius, pierce: w.pierce, fuse: w.fuse, impact: w.impact,
        });
      }
      fired = true;
    }
    if (fired) { attacker[cdKey] = w.cd * BALANCE.heroFireCooldownMult; spendMana(attacker, w.manaCost || 0); }
    return fired;
  }

  // --- Signatures (docs/19) -------------------------------------------------
  // Credit a charge-signature bearer (The Drop) for damage dealt or taken; only
  // `taken` damage scales the eventual release.
  function creditCharge(e, amount, taken) {
    if (!e || !e.signature || e.signature.shape !== "charge") return;
    e.charge += amount;
    if (taken) e.damageTaken += amount;
  }

  // Deploy a turret at the bearer's spot: a stationary player-faction entity that
  // auto-fires `turretId` and holds world position as the camera scrolls past, expiring
  // after `life`. Capped per owner (oldest culled). Reuses the whole fireWeapon path.
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

  // Confuse every enemy in radius for confuseDur — it then chases and contact-damages
  // the nearest OTHER enemy instead of the party (handled in the enemy step).
  function confuseBurst(attacker, sig) {
    let any = false;
    for (const e of enemies) {
      if (e.dead || dist(e.x, e.y, attacker.x, attacker.y) > sig.radius + e.r) continue;
      e.confuseT = sig.confuseDur; e.confuseTarget = null; any = true;
    }
    blasts.push({ x: attacker.x, y: attacker.y, r: sig.radius, t: 0 });
    return any;
  }

  // Release a charge signature (The Drop) once its meter fills: a nova whose flat damage
  // is bumped by the damage taken while charging, then reset.
  function releaseCharge(attacker, sig) {
    if (attacker.charge < sig.threshold) return;
    const dmg = { ...sig.damage, base: sig.damage.base + attacker.damageTaken * sig.takenScale };
    blast(attacker.x, attacker.y, sig.radius, attacker, dmg, sig.knockback, sig.freeze);
    blasts.push({ x: attacker.x, y: attacker.y, r: sig.radius, t: 0 });
    attacker.charge = 0; attacker.damageTaken = 0;
  }

  // Resolve a bearer's signature each tick. `heal` is passive (ticked in the entity
  // loop); `charge` releases on its meter; the rest reuse fireWeapon on their own
  // `sigCd`, or the net-new deploy/confuse helpers.
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

  // Nearest living enemy to `self`, excluding itself — confused-enemy targeting.
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
      if (dealt > 0) { spawnHitNumber(t, dealt); if (t.dead && !t.looted) onEnemyDeath(t); }
    }
  }

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
    if (dealt > 0) { spawnHitNumber(m, dealt); creditCharge(m, dealt, true); }
    if (m === hero && hero.dead) loseRun(srcName);
  }

  // Enemies spread their aggro across the whole train, not just the head. Each enemy
  // locks onto a living party member (random, so the followers trailing north actually
  // draw fire — nearest would always resolve to the head leading the descent south) and
  // keeps it until that member dies, then re-rolls. This is what makes a big party
  // costly to field: every extra hero is another body the enemies will hunt.
  function targetFor(e) {
    if (e.target && !e.target.dead) return e.target;
    const party = hero.dead ? [] : [hero];
    for (const f of followers) if (!f.dead) party.push(f);
    e.target = party.length ? rng.pick(party) : hero;
    return e.target;
  }

  // Spec 06's four behavior archetypes, one function per family — the frozen
  // `brainFor(def.behavior)` registry. The slice steers along a BFS path (it has
  // no movement integrator), so brains repath toward the hero rather than writing
  // a pure intent vector; the spec's intent is preserved, the mechanism is the
  // slice's. Only chargers carry scratch state beyond the shared state machine.
  const BEHAVIORS = {
    // Shamblers — chase straight in, contact damage on overlap. No telegraph.
    chaser(e, dt, tgt, tgtTile) {
      const k = e.def, d = dist(e.x, e.y, tgt.x, tgt.y);
      if (!e.path || e.pi >= e.path.length || e.repathT <= 0) repathTo(e, k, tgtTile[0], tgtTile[1]);
      followPath(e, moveSpeedOf(e), dt);
      if (d < tgt.r + e.r) hurtMember(tgt, k.contactDamage, k.name);
    },

    // Imps — chaser, but faster with a random per-step drift so packs fan out
    // instead of stacking on a single pixel. Only a threat in numbers.
    swarmer(e, dt, tgt, tgtTile) {
      const k = e.def, d = dist(e.x, e.y, tgt.x, tgt.y);
      if (!e.path || e.pi >= e.path.length || e.repathT <= 0) repathTo(e, k, tgtTile[0], tgtTile[1]);
      followPath(e, moveSpeedOf(e), dt);
      const a = rng.next() * Math.PI * 2, j = k.jitter * moveSpeedOf(e) * dt;
      moveAndCollide(level, e, Math.cos(a) * j, Math.sin(a) * j);
      if (d < tgt.r + e.r) hurtMember(tgt, k.contactDamage, k.name);
    },

    // Cultists — hold a preferred range: approach, aim (telegraph), fire a bolt
    // (costs mana), then cool down and kite if the target closes. Mana regenerates
    // every tick; a tapped-out caster can't start an aim, so it holds and kites
    // until the pool refills — positioning lets you wait one out.
    shooter(e, dt, tgt, tgtTile) {
      const k = e.def, d = dist(e.x, e.y, tgt.x, tgt.y);
      regenMana(e, dt); // same mana code the hero's weapons use
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
          kite(); // in range but dry — hold and regen
          return;
        }
        if (!e.path || e.pi >= e.path.length || e.repathT <= 0) repathTo(e, k, tgtTile[0], tgtTile[1]);
        followPath(e, moveSpeedOf(e), dt);
      } else if (e.state === "aim") {
        e.timer -= dt;
        if (e.timer <= 0) {
          const dx = tgt.x - e.x, dy = tgt.y - e.y, m = Math.hypot(dx, dy) || 1;
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
        e.timer -= dt; // hold still and tell the lunge
        if (e.timer <= 0) { e.state = "lunge"; e.timer = k.lungeDur; e.lunged = false; }
      } else if (e.state === "lunge") {
        e.timer -= dt;
        moveAndCollide(level, e, e.lockAim.x * k.lungeSpeed * dt, e.lockAim.y * k.lungeSpeed * dt);
        if (!e.lunged && d < tgt.r + e.r) { // strength-scaled slam + heavy knockback
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

  // brainFor: pick the def's behavior. repathT ticks here so every brain shares
  // one repath clock (spec 06: behavior is selected by def.behavior). The enemy's
  // chosen party member (head or a follower) and its tile are resolved here.
  function stepEnemy(e, dt) {
    e.repathT -= dt;
    const tgt = targetFor(e);
    BEHAVIORS[e.def.behavior](e, dt, tgt, tileOf(tgt));
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
  // Hero vs an enemy: asymmetric split — the hero `a` yields only `aYield` of the overlap,
  // the enemy `b` takes the rest, so a dense crowd's stacked nudges slow the head instead of
  // parting like water. Crucially the hero's push never goes NORTH (toward the crush line at
  // minY): `min(ny,0)` keeps the hero's y-shift >= 0 (southward or none), so no swarm can
  // press the head back into the advancing edge — only the camera/input move it there.
  function separateHero(a, b, aYield) {
    const dx = b.x - a.x, dy = b.y - a.y;
    let d = Math.hypot(dx, dy) || 0.001;
    const min = a.r + b.r;
    if (d >= min) return;
    const o = min - d, nx = dx / d, ny = dy / d, ay = Math.min(ny, 0);
    shift(a, -nx * o * aYield, -ay * o * aYield);
    shift(b, nx * o * (1 - aYield), ny * o * (1 - aYield));
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

  // Standing on a shop freezes the world: the player browses the stall's stock and
  // buys what they want without the descent crushing them. World sim is skipped while
  // this returns true (update() returns early), so only the modal's keys are read.
  // Shop panel/row geometry in logical canvas px — one source of truth for the
  // renderer (draw) and stepShop (tap hit-testing). Rows carry their item index.
  function shopLayout() {
    const items = nearShop.items;
    const panelW = 520, rowH = 56, gap = 8;
    const panelH = 132 + items.length * (rowH + gap);
    const px = (VIEW_W - panelW) / 2, py = (VIEW_H - panelH) / 2;
    const rows = [];
    let y = py + 92;
    for (let n = 0; n < items.length; n++) {
      rows.push({ x: px + 20, y, w: panelW - 40, h: rowH, index: n });
      y += rowH + gap;
    }
    return { items, px, py, panelW, panelH, rowH, gap, rows };
  }

  // Reactive market: quote every unbought item as a fraction of the player's
  // cash-on-hand, locked in the instant they reach the stall (not recomputed as
  // they buy). With the rate tiers, one-of-each-tier sums to >1, so a stall can't
  // be fully cleared from a single snapshot — and over-buying just stacks curses.
  function priceShop(shop) {
    const snapshot = runState.cash;
    for (const it of shop.items)
      if (!it.bought) it.price = priceItem(POWERUPS[it.defId].rarity, snapshot, LOOT);
  }

  function buyItem(n) {
    const it = nearShop.items[n];
    if (it.bought || runState.cash < it.price) return;
    runState.cash -= it.price;
    acquire(it.defId);
    it.bought = true;
  }

  function leaveShop() {
    shopOpen = false; shopLatch = true; nearShop = null;
  }

  function stepShop() {
    const items = nearShop.items;
    const up = input.down("ArrowUp") || input.down("KeyW") || input.down("KeyK");
    const down = input.down("ArrowDown") || input.down("KeyS") || input.down("KeyJ");
    if (up && !prevUp) shopSel = (shopSel - 1 + items.length) % items.length;
    if (down && !prevDown) shopSel = (shopSel + 1) % items.length;
    prevUp = up; prevDown = down;

    const buy = input.down("KeyE") || input.down("Enter");
    if (buy && !prevBuy) buyItem(shopSel);
    prevBuy = buy;

    // Touch: tap a row to select + buy it; tap outside the panel to leave.
    const lay = shopLayout();
    const panel = { x: lay.px, y: lay.py, w: lay.panelW, h: lay.panelH };
    for (let tap; (tap = input.consumeTap()); ) {
      const hit = lay.rows.find((r) => hitRect(tap, r));
      if (hit) { shopSel = hit.index; buyItem(hit.index); }
      else if (!hitRect(tap, panel)) { leaveShop(); break; }
    }
    if (!shopOpen) return; // a tap already left the stall

    const leave = input.down("KeyQ") || input.down("Escape");
    // Close on leave, or once the stall is cleared out. Latch so the still-overlapping
    // hero doesn't reopen it; the latch clears when they step off (in update()).
    if ((leave && !prevLeave) || items.every((it) => it.bought)) leaveShop();
    prevLeave = leave;
  }

  function update(dt) {
    voidClock += dt; // void background animates on real time, regardless of pause/outcome
    if (outcome) return; // run is over; main hands off to the summary scene (spec 15)
    // Track Esc every frame (even in the shop, which owns Esc to leave) so closing a
    // stall with Esc can't bleed into the same press toggling pause.
    const esc = input.down("Escape"), escEdge = esc && !pEsc;
    pEsc = esc;
    if (shopOpen) { stepShop(); return; } // paused at a stall — only the modal runs
    if (escEdge) paused = !paused;
    if (paused) return; // frozen; render() draws the PAUSED overlay, Esc resumes
    while (input.consumeTap()) { /* gameplay has no tap actions — drain so taps don't
      back up and flush all at once when a shop opens (touch drives movement, not taps) */ }
    // Timed buffs tick on UNSCALED time: Slow Jam scales the whole sim (bullet-time),
    // BPM Boost speeds the head. The head keeps real-time movement (rawDt below) so
    // bullet-time makes it nimble rather than sluggish.
    const rawDt = dt;
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
    if (input.down("Space") || input.touchActive()) fireWeapon(hero, weapon, nearestEnemy());

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
      tickHeal(f, dt);
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
      const near = nearestEnemyTo(f.x, f.y);
      fireSignature(f, near); // followers contribute only their passive signature, no weapon
    }

    // Projectiles (hero + enemy): resolve each against the opposite faction via the
    // shared hit path. Bombs detonate an area on contact/expiry; beams pierce and
    // hit each enemy once; the rest hit the first enemy and die.
    for (const p of projectiles) {
      if (p.dead) continue;
      if (p.planted) { // Flashback: stuck where it hit, counting down to its area blast
        p.fuse -= dt;
        if (p.fuse <= 0) { detonate(p); p.dead = true; }
        continue;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0 || !isWalkable(level, Math.floor(p.x / TS), Math.floor(p.y / TS))) {
        if (p.fuse != null) { p.planted = true; p.vx = 0; p.vy = 0; continue; } // plant, then fuse
        if (p.shape === "bomb") detonate(p); // lob that fizzles still bursts where it lands
        p.dead = true; continue;
      }
      const pad = p.faction === "enemy" ? BALANCE.enemyShotHitPad : 0;
      for (const t of (p.faction === "player" ? enemies : heroTargets)) {
        if (t.dead || t.pending || t.fadeT > 0) continue; // not-yet-joined or still fading in: can't be hit
        if (dist(p.x, p.y, t.x, t.y) < p.shotR + t.r + pad) {
          if (p.fuse != null) { // Flashback: small impact hit, then plant + fuse to the big blast
            applyHit(p.attacker, t, p.impact || p.damage, 0, p.vx, p.vy, false);
            p.planted = true; p.vx = 0; p.vy = 0; break;
          }
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
      // Field ticks never knock back — a lingering zone that flung enemies out (once
      // a knockback powerup folds into the weapon) would just cycle them in and out for
      // repeat ticks. Pass 0 regardless of the weapon's knockback.
      if (f.tick <= 0) {
        blast(f.x, f.y, f.r, f.attacker || hero, f.weapon.damage, 0, f.weapon.freeze);
        if (f.weapon.slow) for (const e of enemies) // Chill Zone also slows everything inside
          if (!e.dead && dist(e.x, e.y, f.x, f.y) <= f.r + e.r) { e.slowT = f.weapon.slowDur; e.slowMult = f.weapon.slow; }
        f.tick = f.weapon.tickInterval;
      }
    }

    // Turrets (Drum Machine): hold world position, auto-fire, expire — the descent
    // leaves them behind, which is the intended trade.
    for (const d of deployables) {
      if (d.dead) continue;
      d.life -= dt; d.cd = Math.max(0, d.cd - dt);
      if (d.life <= 0 || d.y < minY) { d.dead = true; continue; }
      fireWeapon(d, d.weapon, nearestEnemyTo(d.x, d.y));
    }
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

    // Shops: stepping onto a stall with stock left opens the paused pick modal
    // (handled by stepShop next frame). Leaving the pad re-arms the latch.
    nearShop = null;
    for (const s of shops)
      if (dist(s.x, s.y, hero.x, hero.y) < hero.r + s.r) { nearShop = s; break; }
    if (!nearShop) shopLatch = false;
    else if (!shopLatch && nearShop.items.some((it) => !it.bought)) { priceShop(nearShop); shopOpen = true; shopSel = 0; }

    for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].dead) projectiles.splice(i, 1);
    for (let i = pickups.length - 1; i >= 0; i--) if (pickups[i].dead) pickups.splice(i, 1);
    for (let i = fields.length - 1; i >= 0; i--) if (fields[i].life <= 0) fields.splice(i, 1);
    for (let i = deployables.length - 1; i >= 0; i--) if (deployables[i].dead) deployables.splice(i, 1);
    for (let i = blasts.length - 1; i >= 0; i--) if (blasts[i].t >= THEME.blast.dur) blasts.splice(i, 1);
    for (let i = swings.length - 1; i >= 0; i--) if (swings[i].t >= THEME.melee.dur) swings.splice(i, 1);
    for (let i = floaters.length - 1; i >= 0; i--) if (floaters[i].t >= THEME.hitNumber.dur) floaters.splice(i, 1);
    // Reap dead followers (HP gone or crushed) — permadeath, also off the shot-target list.
    for (let i = followers.length - 1; i >= 0; i--) {
      if (!followers[i].dead) continue;
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

    const [tx, ty] = tileOf(hero);
    if (homeSet.has(ty * level.w + tx)) outcome = "win";
  }

  // The paused stall: a centered card list of the shop's stock. Reuses the
  // select-screen palette; cost is colored by affordability (dimmed once sold).
  function renderShop() {
    const S = THEME.select;
    const { items, px, py, panelW, panelH, rows, rowH } = shopLayout();
    ctx.fillStyle = THEME.overlay.bg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = S.bg;
    ctx.fillRect(px, py, panelW, panelH);

    ctx.textAlign = "center";
    ctx.fillStyle = S.title; ctx.font = S.titleFont;
    ctx.fillText("Shop", VIEW_W / 2, py + 46);
    ctx.fillStyle = S.hint; ctx.font = S.hintFont;
    ctx.fillText(`cash ${runState.cash}`, VIEW_W / 2, py + 70);

    for (let n = 0; n < items.length; n++) {
      const it = items[n], def = POWERUPS[it.defId], active = n === shopSel, y = rows[n].y;
      const can = runState.cash >= it.price;
      ctx.fillStyle = active ? S.cardActive : S.card;
      ctx.fillRect(px + 20, y, panelW - 40, rowH);
      if (active) { ctx.strokeStyle = S.border; ctx.lineWidth = 2; ctx.strokeRect(px + 21, y + 1, panelW - 42, rowH - 2); }
      ctx.textAlign = "left";
      ctx.fillStyle = it.bought ? S.hint : S.name; ctx.font = S.nameFont;
      ctx.fillText(it.bought ? `${def.name}  (sold)` : def.name, px + 40, y + 24);
      ctx.fillStyle = S.desc; ctx.font = S.descFont;
      ctx.fillText(def.blurb, px + 40, y + 44);
      ctx.textAlign = "right";
      ctx.fillStyle = it.bought ? S.hint : can ? THEME.shop.afford : THEME.shop.broke;
      ctx.font = S.nameFont;
      ctx.fillText(it.bought ? "—" : `${it.price}`, px + panelW - 40, y + 34);
    }

    ctx.textAlign = "center";
    ctx.fillStyle = S.hint; ctx.font = S.hintFont;
    ctx.fillText("↑/↓ or tap to pick    E buy    Q / tap outside to leave", VIEW_W / 2, py + panelH - 18);
    ctx.textAlign = "left";
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
            vb.roundRect(sx, sy, TS + 1, TS + 1, [
              (!up && !lf) ? VOID_CORNER : 0, (!up && !rt) ? VOID_CORNER : 0,
              (!dn && !rt) ? VOID_CORNER : 0, (!dn && !lf) ? VOID_CORNER : 0,
            ]);
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
    for (const s of shops) {
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

    // Follower train: hero-clone discs under the hero in each follower's roster color
    // (white flash on i-frames), each with an HP bar — shown always, like the hero.
    for (const f of followers) {
      if (f.pending) continue; // not joined yet — nothing to draw
      const fx = f.x - cam.x, fy = f.y - cam.y, B = THEME.bar;
      ctx.globalAlpha = f.fadeT > 0 ? 1 - f.fadeT / BALANCE.spawnFade : 1; // quick fade-in on join
      disc(ctx, fx, fy, f.r, f.iframes > 0 ? THEME.follower.hit : f.color);
      ctx.globalAlpha = 1;
      // Followers fire only their signature; show its recharge (heal/charge have no cd).
      if (f.signature && f.signature.cd) cdDot(ctx, fx, fy, f.r, f.sigCd / (f.signature.cd * BALANCE.heroFireCooldownMult));
      let by = fy - f.r - B.gap - B.h;
      bar(ctx, fx, by, f.hp / f.derived.maxHp, B.hp);
      if (f.signature && f.signature.shape === "charge") { by -= B.h + 1; bar(ctx, fx, by, f.charge / f.signature.threshold, THEME.charge.fill); }
    }

    ctx.globalAlpha = hero.fadeT > 0 ? 1 - hero.fadeT / BALANCE.spawnFade : 1; // quick fade-in at spawn
    disc(ctx, hero.x - cam.x, hero.y - cam.y, hero.r, hero.iframes > 0 ? THEME.hero.hit : hero.color);
    ctx.globalAlpha = 1;
    // The head fires only its active weapon; show its recharge on the body.
    if (weapon.cd) cdDot(ctx, hero.x - cam.x, hero.y - cam.y, hero.r, hero.cd / (weapon.cd * BALANCE.heroFireCooldownMult));

    // Status bars above the hero, mirroring the enemies: HP always, plus a mana bar
    // when the chosen weapon spends mana (dim when too dry to fire).
    {
      const B = THEME.bar, hx = hero.x - cam.x;
      let by = hero.y - cam.y - hero.r - B.gap - B.h;
      bar(ctx, hx, by, hero.hp / hero.derived.maxHp, B.hp);
      if (weapon.manaCost > 0) {
        by -= B.h + 1;
        bar(ctx, hx, by, hero.mana / hero.derived.maxMana, hero.mana >= weapon.manaCost ? B.mana : B.tapped);
      }
      if (hero.signature && hero.signature.shape === "charge") {
        by -= B.h + 1;
        bar(ctx, hx, by, hero.charge / hero.signature.threshold, THEME.charge.fill);
      }
    }

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
    if (shopOpen && nearShop) renderShop();
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
    update, render, runState, nextSeed: seed + 1,
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
      };
    },
  };
}

function disc(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
// Cooldown readout drawn ON the body: a dark dot whose radius tracks the remaining
// cooldown fraction (1 = just fired → big dot, 0 = ready → gone). Universal across heroes
// and reads cleanly under a sprite later. `remain` is the 0..1 remaining-cooldown fraction.
function cdDot(ctx, x, y, r, remain) {
  const ir = remain * r * 0.72;
  if (ir < 0.6) return; // ready (or nearly): draw nothing
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  ctx.arc(x, y, ir, 0, Math.PI * 2);
  ctx.fill();
}
function ring(ctx, x, y, r, color) {
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}
// A centered single-character icon (pickup/shop markers).
function glyph(ctx, ch, x, y, color, font) {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.fillText(ch, x, y);
  ctx.textAlign = "left";
}
// A centered status bar (HP/mana): dark backing + a `frac`-wide fill.
function bar(ctx, cx, y, frac, fill) {
  const B = THEME.bar, x = cx - B.w / 2;
  ctx.fillStyle = B.back;
  ctx.fillRect(x, y, B.w, B.h);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, B.w * clamp(frac, 0, 1), B.h);
}
