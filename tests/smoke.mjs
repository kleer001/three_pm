// Node smoke test for the pure (browser-free) slice logic.
// Run: node tests/smoke.mjs
import { generate, isWalkable, TILE } from "../src/run/levelgen.js";
import { moveAndCollide, boxBlocked } from "../src/run/collision.js";
import { findPath, localWalkableTile } from "../src/ai/ai.js";
import { makeRng } from "../src/core/rng.js";
import { distanceFraction, budget, eligible, makeDirector } from "../src/run/director.js";
import { recomputeDerived, weaponDamage, applyDamage, regenMana, canCast, spendMana } from "../src/run/combat.js";
import { POWERUPS, SYNERGIES, applyHeld, snapshotBase, scrapForKill, rollPowerupDrop, weightedPick } from "../src/run/powerups.js";
import { PAYOUT, UPGRADES, computePayout, recordRun, bankCurrency, purchaseUpgrade, applyHeroUpgrades, recomputeUnlocks, isHeroUnlocked, upgradeRank, nextCost } from "../src/meta/save.js";
import { BALANCE, THEME } from "../src/run/balance.js";

const freshBlob = () => ({
  version: 1, credits: 0, runCount: 0, unlockedHeroes: ["marvin"], heroUpgrades: {},
  stats: { wins: 0, bestDistance: 0, totalKills: 0 },
});

let failures = 0;
const ok = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); failures++; }
};

function reachable(level) {
  const { w, h, start, homeBand } = level;
  const id = (x, y) => y * w + x;
  const home = new Set(homeBand.map(([x, y]) => id(x, y)));
  const seen = new Set([id(start.x, start.y)]);
  const q = [start];
  while (q.length) {
    const { x, y } = q.pop();
    if (home.has(id(x, y))) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (isWalkable(level, nx, ny) && !seen.has(id(nx, ny))) {
        seen.add(id(nx, ny));
        q.push({ x: nx, y: ny });
      }
    }
  }
  return false;
}

// Generation + connectivity across many seeds and bearings.
let walkRatioMin = 1;
for (let seed = 1; seed <= 200; seed++) {
  const bearing = (seed / 200) * Math.PI * 2;
  const level = generate(seed, { w: 48, h: 48, bearing });
  ok(level.w === 48 && level.h === 48, `seed ${seed}: dimensions`);
  ok(isWalkable(level, level.start.x, level.start.y), `seed ${seed}: start walkable`);
  ok(level.homeBand.length > 0, `seed ${seed}: home band non-empty`);
  ok(reachable(level), `seed ${seed}: start reaches home band`);
  const walk = level.walkable.reduce((a, v) => a + v, 0) / level.walkable.length;
  walkRatioMin = Math.min(walkRatioMin, walk);
}

// Determinism: same seed -> identical tiles.
const a = generate(42, { bearing: 1 }), b = generate(42, { bearing: 1 });
ok(a.tiles.every((v, i) => v === b.tiles[i]), "same seed reproduces map");

// AI: BFS path from start to a home-band tile is contiguous and walkable.
{
  const level = generate(9, { w: 48, h: 48, bearing: (3 * Math.PI) / 2 });
  const [hx, hy] = level.homeBand[level.homeBand.length >> 1];
  const path = findPath(level, level.start.x, level.start.y, hx, hy);
  ok(path && path.length > 0, "findPath returns a path to home");
  if (path) {
    let prev = [level.start.x, level.start.y], contiguous = true, allWalk = true;
    for (const [x, y] of path) {
      if (Math.abs(x - prev[0]) + Math.abs(y - prev[1]) !== 1) contiguous = false;
      if (!isWalkable(level, x, y)) allWalk = false;
      prev = [x, y];
    }
    ok(contiguous, "path steps are 4-connected");
    ok(allWalk, "path tiles are all walkable");
    ok(prev[0] === hx && prev[1] === hy, "path ends at the target");
  }
  ok(findPath(level, 5, 5, 5, 5).length === 0, "findPath same-tile returns empty");
}

// Clear start approach: the first 6 tiles forward (south) from start are walkable.
for (let seed = 1; seed <= 50; seed++) {
  const level = generate(seed, { w: 48, h: 64, bearing: (3 * Math.PI) / 2 });
  let clear = true;
  for (let i = 0; i <= 6; i++) if (!isWalkable(level, level.start.x, level.start.y + i)) clear = false;
  ok(clear, `seed ${seed}: 6-tile forward lane is clear`);
}

// localWalkableTile stays within radius and returns a walkable tile.
{
  const level = generate(3, { w: 48, h: 64, bearing: (3 * Math.PI) / 2 });
  const rng = makeRng(123);
  const [sx, sy] = [level.start.x, level.start.y + 3];
  const [lx, ly] = localWalkableTile(level, rng, sx, sy, 10);
  ok(isWalkable(level, lx, ly), "localWalkableTile returns walkable");
  ok(Math.abs(lx - sx) <= 10 && Math.abs(ly - sy) <= 10, "localWalkableTile within radius");
}

// Wall-density knob scales obstacle coverage roughly linearly (no percolation collapse).
{
  const obst = (d) => {
    let o = 0;
    for (let s = 1; s <= 15; s++) {
      const l = generate(s, { w: 48, h: 96, bearing: (3 * Math.PI) / 2, wallDensity: d });
      o += l.walkable.reduce((a, v) => a + (v === 0 ? 1 : 0), 0);
    }
    return o / 15;
  };
  const half = obst(0.5), full = obst(1.0);
  ok(half < full * 0.7 && half > full * 0.3, `density 0.5 ~= half of 1.0 obstacles (${half | 0} vs ${full | 0})`);
}

// Collision: box (x,y) is its CENTER (must match how entities are drawn).
const lvl = { w: 3, h: 1, tileSize: 24, walkable: Uint8Array.from([1, 0, 1]) };
const box = { x: 12, y: 12, w: 8, h: 8 };
moveAndCollide(lvl, box, 20, 0); // would push the center into the wall tile (24..47)
ok(box.x < 24, `collision blocks entry into wall (x=${box.x})`);
const box2 = { x: 12, y: 12, w: 8, h: 8 };
moveAndCollide(lvl, box2, 6, 0); // stays within open tile 0
ok(box2.x === 18, `collision allows free movement (x=${box2.x})`);

// Regression: a box centered on a walkable tile is NOT blocked, even with a wall
// adjacent — collision must sample symmetrically around the center, not offset.
ok(!boxBlocked(lvl, { x: 12, y: 12, w: 20, h: 20 }), "centered on walkable tile: clear");
ok(boxBlocked(lvl, { x: 36, y: 12, w: 20, h: 20 }), "centered on wall tile: blocked");
ok(boxBlocked(lvl, { x: 12, y: 12, w: 34, h: 20 }), "box overlapping into wall: blocked");

// Director: depth-scaled budget, distanceBand eligibility, and a spawn run.
{
  const cfg = BALANCE.director;
  ok(budget(1, cfg) > budget(0, cfg), "budget rises with distance");
  ok(budget(0, cfg) === cfg.baseThreat, "budget at the start is baseThreat");

  const defs = Object.values(BALANCE.enemies);
  ok(eligible(defs, 0).every((d) => d.distanceBand === 0), "f=0 unlocks only band-0 defs");
  ok(eligible(defs, 0).length >= 1, "at least one def spawns from the start");
  ok(eligible(defs, 1).length === defs.length, "f=1 unlocks the full roster");

  const ts = 96;
  const level = generate(7, { w: 48, h: 192, bearing: (3 * Math.PI) / 2, tileSize: ts });
  ok(distanceFraction({ y: -1e9 }, level, ts) === 0, "distanceFraction clamps below 0");
  ok(distanceFraction({ y: 1e9 }, level, ts) === 1, "distanceFraction clamps above 1");

  const cam = { x: 0, y: 0 }, viewH = 600;
  const hero = { x: level.start.x * ts + ts / 2, y: level.start.y * ts + ts / 2 };
  const enemies = [];
  const spawnEnemy = (def, tx, ty) => enemies.push({ def, tx, ty, dead: false });
  const dir = makeDirector({ level, rng: makeRng(7), defs, cam, viewH, cfg, ts });

  dir.update(cfg.tickInterval, hero, enemies, spawnEnemy); // one tick at f≈0
  ok(enemies.length > 0, "director spawns under budget at the start");
  ok(enemies.length <= cfg.maxLive, "director respects maxLive");
  ok(enemies.every((e) => e.def.distanceBand <= 0), "start spawns are band-0 eligible");
  ok(enemies.every((e) => isWalkable(level, e.tx, e.ty)), "spawn tiles are walkable");
  const bandTop = Math.floor((cam.y + viewH) / ts);
  ok(enemies.every((e) => e.ty >= bandTop), "spawns land in the off-screen south band");
  ok(enemies.reduce((a, e) => a + e.def.threatValue, 0) <= budget(0, cfg), "spend stays within budget");

  const before = enemies.length;
  dir.update(cfg.tickInterval, hero, enemies, spawnEnemy);
  ok(enemies.length === before, "no spawns while live threat already meets budget");
}

// Roster stat invariants: every enemy carries four 1–10 base stats and a kill
// counter; casters (and only casters) carry a mana-costing attack.
for (const [id, d] of Object.entries(BALANCE.enemies)) {
  const s = d.stats, levels = s && [s.speed, s.constitution, s.strength, s.magic];
  ok(s && levels.every((v) => v >= 1 && v <= 10), `${id}: four stats in 1..10`);
  ok(d.freezesToKill >= 1, `${id}: freezesToKill >= 1`);
  const casts = d.behavior === "shooter";
  ok(casts === !!(d.attack && d.attack.manaCost), `${id}: mana-costing attack iff caster`);
  if (casts) ok(d.manaRegen > 0, `${id}: caster regenerates mana`);
  if (d.behavior === "charger") ok(d.attack && !d.attack.manaCost, `${id}: charger lunge is a free attack`);
}

// Weapon roster: every weapon has a known shape, the fields that shape needs, a
// stat-scaled damage descriptor, and a select-screen swatch color.
for (const [id, w] of Object.entries(BALANCE.weapons)) {
  ok(["projectile", "nova", "bomb", "field", "melee-arc"].includes(w.shape), `${id}: known shape`);
  ok(w.damage && (w.damage.scaling === "strength" || w.damage.scaling === "magic"), `${id}: stat-scaled damage`);
  ok(THEME.weaponShot[id], `${id}: has a swatch color`);
  if (w.shape === "projectile") ok(w.speed > 0 && w.range > 0, `${id}: projectile has speed+range`);
  if (["nova", "bomb", "field", "melee-arc"].includes(w.shape)) ok(w.radius > 0, `${id}: area shape has radius`);
  if (w.shape === "field") ok(w.lifespan > 0 && w.tickInterval > 0, `${id}: field lingers and ticks`);
  if (w.shape === "melee-arc") ok(w.arc > 0, `${id}: melee has an arc`);
  if (w.pierce) ok(w.shape === "projectile", `${id}: pierce only on projectiles`);
}

// Stat → derived model: recomputeDerived maps base stats to gameplay values.
{
  const C = BALANCE.derive;
  const e = { stats: { speed: 5, constitution: 5, strength: 5, magic: 5 } };
  recomputeDerived(e, C);
  ok(e.derived.maxHp === C.BASE_HP + 5 * C.HP_PER_CON, "maxHp from constitution");
  ok(e.derived.maxMana === C.BASE_MANA + 5 * C.MANA_PER_MAG, "maxMana from magic");
  ok(e.derived.abilityPower === C.BASE_AP + 5 * C.AP_PER_MAG, "abilityPower from magic");
  ok(e.derived.knockback === 5 * C.KB_PER_STR, "knockback from strength");
  ok(e.derived.moveSpeed > 0, "moveSpeed from speed");
  const tank = { stats: { speed: 1, constitution: 10, strength: 1, magic: 1 } };
  recomputeDerived(tank, C);
  ok(tank.derived.dmgResist === Math.min(C.RESIST_CAP, 10 * C.RESIST_PER_CON), "dmgResist from constitution");
  ok(tank.derived.dmgResist > e.derived.dmgResist, "more constitution → more resist");
  const over = { stats: { speed: 1, constitution: 99, strength: 1, magic: 1 } };
  recomputeDerived(over, C);
  ok(over.derived.dmgResist === C.RESIST_CAP, "dmgResist clamps to the cap");
  // Every caster's full pool affords its bolt (derived maxMana vs attack manaCost).
  for (const d of Object.values(BALANCE.enemies)) {
    if (d.behavior !== "shooter") continue;
    const c = { stats: d.stats }; recomputeDerived(c, C);
    ok(c.derived.maxMana >= d.attack.manaCost, `${d.name}: pool affords a cast`);
  }
}

// Combat core: the one resolver shared by hero and enemies.
{
  const atkS = { stats: { strength: 5, magic: 5 }, derived: { abilityPower: 1 } };
  // weaponDamage = (base + stat*ratio)[*AP if magic] + maxHp*pctMax + curHp*pctCur.
  ok(weaponDamage({ scaling: "strength", base: 0, ratio: 0, pctMax: 0.5, pctCur: 0 }, atkS, 52, 52) === 26, "50% of max HP");
  ok(weaponDamage({ scaling: "strength", base: 2, ratio: 1, pctMax: 0, pctCur: 0 }, atkS, 1, 1) === 7, "strength-scaled flat (base + str*ratio)");
  const atkM = { stats: { strength: 5, magic: 5 }, derived: { abilityPower: 1.2 } };
  ok(weaponDamage({ scaling: "magic", base: 2, ratio: 0.4, pctMax: 0, pctCur: 0 }, atkM, 1, 1) === (2 + 5 * 0.4) * 1.2, "magic flat × abilityPower");
  ok(weaponDamage({ scaling: "strength", base: 0, ratio: 0, pctMax: 0.1, pctCur: 0.25 }, atkS, 40, 20) === 4 + 5, "blended max+current");
  let hp = 100; // pure %-current asymptotes (why Hex needs a flat floor)
  for (let n = 0; n < 50; n++) hp -= weaponDamage({ scaling: "strength", base: 0, ratio: 0, pctMax: 0, pctCur: 0.4 }, atkS, 100, hp);
  ok(hp > 0, "pure %-current damage asymptotes, never kills");

  // applyDamage: i-frame gate, dmgResist, death flag, and no-iframe entities take every hit.
  const hero = { hp: 20, iframes: 0, iframeDur: 0.8, dead: false, derived: { dmgResist: 0 } };
  applyDamage(hero, 5); ok(hero.hp === 15 && hero.iframes === 0.8, "hero takes a hit, gains i-frames");
  applyDamage(hero, 5); ok(hero.hp === 15, "i-frame window blocks the next hit");
  const armored = { hp: 100, dead: false, derived: { dmgResist: 0.5 } };
  applyDamage(armored, 10); ok(armored.hp === 95, "dmgResist halves incoming damage");
  const foe = { hp: 8, dead: false, derived: { dmgResist: 0 } };
  applyDamage(foe, 5); applyDamage(foe, 5); ok(foe.hp === 0 && foe.dead, "no-iframe entity takes every hit and dies");

  // Mana: regen clamps to the derived pool, canCast gates, spend deducts. No-op without regen.
  const caster = { mana: 6, manaRegen: 10, derived: { maxMana: 16 } };
  regenMana(caster, 1); ok(caster.mana === 16, "regenMana clamps to derived maxMana");
  ok(canCast(caster, 16) && !canCast(caster, 17), "canCast boundary");
  spendMana(caster, 10); ok(caster.mana === 6, "spendMana deducts");
  const noRegen = { mana: 5, derived: { maxMana: 20 } }; regenMana(noRegen, 1); ok(noRegen.mana === 5, "regenMana no-op without a regen rate");
}

// In-run powerups (spec 07): stat/weapon mods, rebuild-from-base stacking,
// synergies, the loot/scrap roll. All pure — no canvas, no input.
{
  const derive = BALANCE.derive, L = BALANCE.loot;
  const baseStats = { speed: 5, constitution: 5, strength: 5, magic: 5 };
  const mkHero = () => { const h = { stats: { ...baseStats } }; recomputeDerived(h, derive); h.hp = h.derived.maxHp; h.mana = h.derived.maxMana; return h; };
  const base = snapshotBase(baseStats, { id: "slingshot", ...BALANCE.weapons.slingshot });
  const mkWeapon = (b) => ({ ...b.weapon, damage: { ...b.weapon.damage } });
  ok(base.weapon.count === 1 && base.weapon.pierce === false, "snapshotBase normalizes count/pierce");

  // Every registry entry is well-formed (the loader contract, validated up front).
  for (const [id, d] of Object.entries(POWERUPS)) {
    ok(d.kind === "stat" || d.kind === "weapon", `powerup ${id}: known kind`);
    ok(typeof d.cost === "number" && d.cost > 0, `powerup ${id}: has a shop cost`);
    ok(L.rarityWeight[d.rarity], `powerup ${id}: rarity has a drop weight`);
  }
  for (const [id, s] of Object.entries(SYNERGIES))
    ok(s.requires.every((r) => POWERUPS[r]), `synergy ${id}: requires known powerups`);

  // Stat powerups stack and re-derive.
  const h1 = mkHero(), w1 = mkWeapon(base);
  applyHeld(h1, w1, base, ["espresso_shot", "espresso_shot"], derive, L);
  ok(h1.stats.speed === 7, "stat powerup stacks (+2 speed)");
  ok(h1.derived.moveSpeed > mkHero().derived.moveSpeed, "stat stack re-derives moveSpeed");

  // Weapon mods add (count, flat damage).
  const h2 = mkHero(), w2 = mkWeapon(base);
  applyHeld(h2, w2, base, ["split_shot", "split_shot", "heavy_hands"], derive, L);
  ok(w2.count === 3, "split_shot stacks projectile count");
  ok(w2.damage.base === base.weapon.damage.base + 3, "weapon damage mod adds");

  // Rebuild-from-base clears prior mods (a dropped pierce must not linger).
  const h3 = mkHero(), w3 = mkWeapon(base);
  applyHeld(h3, w3, base, ["needle_tip"], derive, L);
  ok(w3.pierce === true, "needle_tip sets pierce");
  applyHeld(h3, w3, base, [], derive, L);
  ok(w3.pierce === false && w3.count === 1 && w3.damage.base === base.weapon.damage.base, "rebuild from base clears prior mods");

  // Synergy applies on top of the held set when its requires are all present.
  const hexBase = snapshotBase(baseStats, { id: "hex", ...BALANCE.weapons.hex });
  const hA = mkHero(), wA = mkWeapon(hexBase); applyHeld(hA, wA, hexBase, ["split_shot", "needle_tip"], derive, L);
  const hB = mkHero(), wB = mkWeapon(hexBase); applyHeld(hB, wB, hexBase, ["split_shot"], derive, L);
  ok(wA.damage.base === wB.damage.base + SYNERGIES.skewer_volley.mods.damage.base, "synergy adds when its set is held");

  // Cooldown floor holds under heavy stacking.
  const h5 = mkHero(), w5 = mkWeapon(base);
  applyHeld(h5, w5, base, Array(20).fill("hair_trigger"), derive, L);
  ok(w5.cd === L.minCd, "weapon cooldown floored at minCd");

  // Scrap + loot rolls: formula, determinism, well-formed output.
  ok(scrapForKill(BALANCE.enemies.shambler, L) === L.scrapPerKill + 1 * L.scrapPerThreat, "scrapForKill formula");
  const r1 = makeRng(7), r2 = makeRng(7), a1 = [], a2 = [];
  for (let i = 0; i < 200; i++) { a1.push(rollPowerupDrop(r1, BALANCE.enemies.brute, L)); a2.push(rollPowerupDrop(r2, BALANCE.enemies.brute, L)); }
  ok(a1.every((v, i) => v === a2[i]), "loot rolls reproduce on the same seed");
  ok(a1.every((v) => v === null || POWERUPS[v]), "drops are null or a valid powerup id");
  ok(a1.some((v) => v !== null), "a high-threat enemy drops sometimes");

  // weightedPick only ever returns a registered id.
  const wp = makeRng(5); let allValid = true;
  for (let i = 0; i < 100; i++) if (!POWERUPS[weightedPick(wp, L.rarityWeight)]) allValid = false;
  ok(allValid, "weightedPick returns a registered id");
}

// Meta-progression + save (spec 08): payout, recordRun fold, upgrade purchase +
// run-start application, unlock gate. All pure transforms — no localStorage.
{
  // Payout: distance + kills + win bonus, rounded.
  ok(computePayout({ distanceFraction: 1, kills: 0, won: false }) === PAYOUT.distance, "payout: full distance");
  ok(computePayout({ distanceFraction: 0, kills: 10, won: false }) === 10 * PAYOUT.perKill, "payout: per-kill");
  ok(computePayout({ distanceFraction: 0.5, kills: 3, won: true }) === Math.round(0.5 * PAYOUT.distance + 3 * PAYOUT.perKill + PAYOUT.win), "payout: blended + win bonus");

  // recordRun folds one run and is pure (input blob untouched).
  const b0 = freshBlob();
  const b1 = recordRun(b0, { distanceFraction: 0.5, kills: 4, won: false });
  ok(b0.runCount === 0 && b0.credits === 0, "recordRun does not mutate its input");
  ok(b1.runCount === 1, "recordRun bumps runCount");
  ok(b1.credits === computePayout({ distanceFraction: 0.5, kills: 4, won: false }), "recordRun banks the payout");
  ok(b1.stats.totalKills === 4 && b1.stats.wins === 0, "recordRun folds lifetime stats");
  ok(b1.stats.bestDistance === 0.5, "recordRun tracks best distance");
  const b2 = recordRun(b1, { distanceFraction: 0.3, kills: 1, won: true });
  ok(b2.stats.bestDistance === 0.5, "best distance only rises");
  ok(b2.stats.wins === 1, "win counts");
  ok(bankCurrency(b2, 10).credits === b2.credits + 10, "bankCurrency adds");

  // Upgrades: buy gates on affordability + maxRank, and is pure.
  const upId = Object.keys(UPGRADES.marvin)[0], def = UPGRADES.marvin[upId];
  const broke = freshBlob();
  ok(purchaseUpgrade(broke, "marvin", upId) === broke, "purchase no-op when broke (returns same blob)");
  const rich = { ...freshBlob(), credits: 1000 };
  let r = purchaseUpgrade(rich, "marvin", upId);
  ok(upgradeRank(r, "marvin", upId) === 1, "purchase advances rank");
  ok(r.credits === 1000 - def.costCurve[0], "purchase deducts the rank cost");
  ok(rich.credits === 1000, "purchase does not mutate its input");
  for (let n = 0; n < def.maxRank + 2; n++) r = purchaseUpgrade(r, "marvin", upId); // spam past max
  ok(upgradeRank(r, "marvin", upId) === def.maxRank, "purchase stops at maxRank");
  ok(nextCost(r, "marvin", upId) === null, "nextCost null when maxed");

  // applyHeroUpgrades folds owned ranks into base stats before derive.
  const hero = { stats: { speed: 5, constitution: 5, strength: 5, magic: 5 } };
  const blob = { ...freshBlob(), heroUpgrades: { marvin: { [upId]: 2 } } };
  applyHeroUpgrades(hero, "marvin", blob, BALANCE.derive);
  const k = Object.keys(def.apply)[0];
  ok(hero.stats[k] === 5 + def.apply[k] * 2, "applyHeroUpgrades scales stat delta by rank");
  ok(hero.derived && hero.derived.maxHp > 0, "applyHeroUpgrades derives after folding stats");

  // Unlock gate: runCount >= unlockAtRuns; Marvin always unlocked.
  ok(recomputeUnlocks(0).includes("marvin"), "marvin unlocked from the first load");
  ok(isHeroUnlocked(freshBlob(), "marvin"), "isHeroUnlocked: marvin");
}

console.log(failures === 0
  ? `PASS — 200 maps generated, all connected; min walkable ratio ${walkRatioMin.toFixed(2)}`
  : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
