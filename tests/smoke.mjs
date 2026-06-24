// Node smoke test for the pure (browser-free) slice logic.
// Run: node tests/smoke.mjs
import { generate, isWalkable, TILE } from "../src/run/levelgen.js";
import { moveAndCollide, boxBlocked } from "../src/run/collision.js";
import { findPath, localWalkableTile } from "../src/ai/ai.js";
import { makeRng } from "../src/core/rng.js";
import { distanceFraction, budget, eligible, makeDirector } from "../src/run/director.js";
import { recomputeDerived, weaponDamage, applyDamage, regenMana, canCast, spendMana } from "../src/run/combat.js";
import { POWERUPS, SYNERGIES, applyHeld, snapshotBase, cashForKill, rollDrop, makeLootBag, priceItem } from "../src/run/powerups.js";
import { PAYOUT, UPGRADES, computePayout, recordRun, bankCurrency, purchaseUpgrade, applyHeroUpgrades, isHeroUnlocked, startCampaign, upgradeRank, nextCost } from "../src/meta/save.js";
import { BALANCE, THEME } from "../src/run/balance.js";
import { createPartyPreview } from "../src/run/partyPreview.js";
import { createVoidPull } from "../src/run/voidPull.js";
import { createVoidTentacles } from "../src/run/voidTentacle.js";

const freshBlob = () => ({
  version: 2, credits: 0, runCount: 0, heroUpgrades: {},
  stats: { wins: 0, bestDistance: 0, totalKills: 0 },
  campaign: startCampaign(),
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

// In-run powerups (spec 07): hybrid stat/weapon mods with ≥1:1 curses,
// rebuild-from-base, synergies, the unique loot bag, and the cash roll. All pure.
{
  const derive = BALANCE.derive, L = BALANCE.loot;
  const baseStats = { speed: 5, constitution: 5, strength: 5, magic: 5 };
  const mkHero = () => { const h = { stats: { ...baseStats } }; recomputeDerived(h, derive); h.hp = h.derived.maxHp; h.mana = h.derived.maxMana; return h; };
  const base = snapshotBase(baseStats, { id: "slingshot", ...BALANCE.weapons.slingshot });
  const mkWeapon = (b) => ({ ...b.weapon, damage: { ...b.weapon.damage } });
  ok(base.weapon.count === 1 && base.weapon.pierce === false, "snapshotBase normalizes count/pierce");

  // Every registry entry is well-formed: a price-rate tier and a real payload.
  for (const [id, d] of Object.entries(POWERUPS)) {
    ok(L.priceRate[d.rarity] !== undefined, `powerup ${id}: rarity has a price rate`);
    ok(d.kind === "buff" || d.stat || d.weapon, `powerup ${id}: carries a stat/weapon mod or is a buff`);
  }
  for (const [id, s] of Object.entries(SYNERGIES))
    ok(s.requires.every((r) => POWERUPS[r]), `synergy ${id}: requires known powerups`);

  // A stat item applies both its blessing and its (≥1:1) curse, then re-derives.
  const h1 = mkHero(), w1 = mkWeapon(base);
  applyHeld(h1, w1, base, ["track_star"], derive, L); // +2 speed, -2 constitution
  ok(h1.stats.speed === 7 && h1.stats.constitution === 3, "stat item applies blessing + curse");
  ok(h1.derived.moveSpeed > mkHero().derived.moveSpeed && h1.derived.maxHp < mkHero().derived.maxHp, "tradeoff re-derives both ways");

  // Curses can't drive a stat past the 1–10 rails even when overshot.
  const hC = mkHero(), wC = mkWeapon(base);
  applyHeld(hC, wC, base, ["redline", "redline"], derive, L); // +4 speed/-4 con, doubled
  ok(hC.stats.speed === 10 && hC.stats.constitution === 1, "stats clamp to [1,10] under heavy curse");

  // Weapon mods: additive count/damage, plus a `mult` curse that multiplies cd.
  const h2 = mkHero(), w2 = mkWeapon(base);
  applyHeld(h2, w2, base, ["split_shot"], derive, L); // +1 count, -5 base
  ok(w2.count === 2, "split_shot adds a projectile");
  ok(w2.damage.base === base.weapon.damage.base - 5, "weapon damage curse subtracts");
  const h6 = mkHero(), w6 = mkWeapon(base);
  applyHeld(h6, w6, base, ["heavy_hands"], derive, L); // +9 base, cd *1.40
  ok(Math.abs(w6.cd - base.weapon.cd * 1.40) < 1e-9, "mult curse multiplies cooldown");
  ok(w6.damage.base === base.weapon.damage.base + 9, "additive applies before the mult");

  // Needle Tip pierces but its `mult: { knockback: 0 }` zeroes knockback (curse).
  const h3 = mkHero(), w3 = mkWeapon(base);
  applyHeld(h3, w3, base, ["needle_tip"], derive, L);
  ok(w3.pierce === true && w3.knockback === 0, "needle_tip pierces but kills knockback");
  applyHeld(h3, w3, base, [], derive, L);
  ok(w3.pierce === false && w3.count === 1 && w3.damage.base === base.weapon.damage.base, "rebuild from base clears prior mods");

  // Synergy applies on top of the held set when its requires are all present —
  // checked as the absolute sum, since needle_tip carries its own damage curse.
  const hexBase = snapshotBase(baseStats, { id: "hex", ...BALANCE.weapons.hex });
  const hA = mkHero(), wA = mkWeapon(hexBase); applyHeld(hA, wA, hexBase, ["split_shot", "needle_tip"], derive, L);
  const expectBase = hexBase.weapon.damage.base + POWERUPS.split_shot.weapon.damage.base
    + POWERUPS.needle_tip.weapon.damage.base + SYNERGIES.skewer_volley.weapon.damage.base;
  ok(wA.damage.base === expectBase, "synergy adds on top of its held set's mods");

  // Cooldown floor holds under heavy stacking of a fast-fire curse.
  const h5 = mkHero(), w5 = mkWeapon(base);
  applyHeld(h5, w5, base, Array(20).fill("hair_trigger"), derive, L);
  ok(w5.cd === L.minCd, "weapon cooldown floored at minCd");

  // Cash payout formula.
  ok(cashForKill(BALANCE.enemies.shambler, L) === L.cashPerKill + 1 * L.cashPerThreat, "cashForKill formula");

  // The loot bag holds every catalog id exactly once and reproduces per seed.
  const bagA = makeLootBag(makeRng(11)), bagB = makeLootBag(makeRng(11));
  ok(bagA.length === Object.keys(POWERUPS).length, "bag holds the whole catalog");
  ok(new Set(bagA).size === bagA.length, "bag has no duplicate ids (uniqueness)");
  ok(bagA.every((id) => POWERUPS[id]) , "bag ids are all registered");
  ok(bagA.every((v, i) => v === bagB[i]), "bag shuffle reproduces on the same seed");
  ok(bagA.length >= 12, "catalog covers the 12 shop slots without repeats");

  // Drop roll is a deterministic boolean that fires sometimes for high threat.
  const r1 = makeRng(7), r2 = makeRng(7), a1 = [], a2 = [];
  for (let i = 0; i < 200; i++) { a1.push(rollDrop(r1, BALANCE.enemies.brute, L)); a2.push(rollDrop(r2, BALANCE.enemies.brute, L)); }
  ok(a1.every((v) => typeof v === "boolean"), "rollDrop returns a boolean");
  ok(a1.every((v, i) => v === a2[i]), "drop rolls reproduce on the same seed");
  ok(a1.some((v) => v === true), "a high-threat enemy drops sometimes");

  // Reactive price: a fraction of cash-on-hand, floored; a stall can't be cleared
  // from one snapshot (one-of-each-tier rates sum to >1).
  ok(priceItem("rare", 4, L) === L.priceFloor, "broke wallet still pays the floor");
  ok(priceItem("common", 200, L) === Math.ceil(200 * L.priceRate.common), "price scales with cash-on-hand");
  ok(L.priceRate.common + L.priceRate.uncommon + L.priceRate.rare > 1, "one-of-each-tier exceeds a single snapshot");
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

  // Unlock gate is CAMPAIGN-scoped: a hero opens once the crew has survived its
  // unlockAtRuns'th run this campaign (runsSurvived = campaign.day - 1).
  const day0 = BALANCE.roster.find((c) => c.unlockAtRuns === 0).id;
  const gated = BALANCE.roster.find((c) => c.unlockAtRuns > 0);
  const blobAtDay = (day) => ({ ...freshBlob(), campaign: { day, crew: ["marvin"], dead: [] } });
  ok(isHeroUnlocked(blobAtDay(1), day0), "run-0 character available on day 1");
  ok(!isHeroUnlocked(blobAtDay(gated.unlockAtRuns), gated.id), "gated character locked before surviving enough runs");
  ok(isHeroUnlocked(blobAtDay(gated.unlockAtRuns + 1), gated.id), "gated character unlocks the day after its run count");
  // Regression: availability is campaign-scoped, NOT lifetime. A veteran (high runCount)
  // starting a fresh campaign (day 1) still only sees the run-0 hero.
  const veteran = { ...freshBlob(), runCount: 99, campaign: startCampaign() };
  ok(isHeroUnlocked(veteran, day0), "veteran: run-0 hero available on a fresh campaign");
  ok(!isHeroUnlocked(veteran, gated.id), "veteran: lifetime runCount does NOT unlock heroes on a fresh campaign");
}

// Reality-break (voidPull): knock-into-void, corpse vacuum range, and fall-to-gone — the logic
// the void-sandbox drives, pinned here so the boundary cases don't regress.
{
  const TS = 48, W = 10, H = 6;
  const mkLevel = () => { const tiles = new Array(W * H).fill(0); tiles[2 * W + 5] = 6 /*RUBBLE*/; return { w: W, h: H, tileSize: TS, tiles }; };
  const mkPull = (enemies, voidFalling) => createVoidPull({ level: mkLevel(), ts: TS, enemies, voidFalling, balance: BALANCE, corpseColor: "#000" });
  const body = (tx, dead, kb) => ({ x: tx * TS + TS / 2, y: 2 * TS + TS / 2, w: 30, h: 30, r: 15, def: { color: "#fff" }, dead, kb: kb || null });

  // (a) a shove that carries the box into the hole pulls the enemy out of play into voidFalling.
  { const enemies = [body(4, false, { vx: 6, vy: 0, frames: 12 })], vfl = [], vp = mkPull(enemies, vfl);
    for (let f = 0; f < 12 && enemies.length; f++) { vp.convertKnocked(); if (enemies.length) { enemies[0].x += enemies[0].kb.vx; enemies[0].kb.frames--; } }
    ok(enemies.length === 0 && vfl.length === 1, "voidPull: shove into the void removes the enemy and adds a falling body"); }

  // (b) corpse vacuum reaches rangeTiles (2) but no further.
  const swallowed = (tx) => { const enemies = [body(tx, true, null)], vfl = [], vp = mkPull(enemies, vfl);
    for (let f = 0; f < 300 && enemies.length; f++) { vp.vacuumCorpses(1 / 60); vp.stepFall(1 / 60); } return enemies.length === 0; };
  ok(swallowed(4), "voidPull: corpse 1 tile from a hole is vacuumed in");
  ok(swallowed(3), "voidPull: corpse 2 tiles from a hole is vacuumed in (boundary)");
  ok(!swallowed(2), "voidPull: corpse 3 tiles from a hole is NOT vacuumed");

  // (c) anything in the void shrinks to nothing and is removed.
  { const vfl = [{ x: 0, y: 0, r: 15, color: "#fff", vfx: 0, vfy: 0 }], vp = mkPull([], vfl);
    for (let f = 0; f < 300 && vfl.length; f++) vp.stepFall(1 / 60);
    ok(vfl.length === 0, "voidPull: a body in the void shrinks away and is removed"); }
}

// Void tentacles: rim detection, FSM transitions, the aim-lock dodge guarantee, strike-once,
// the color-keyed deterministic action, and the void-death swallow — all browser-free, driven
// on fixed dt exactly like voidPull. One RUBBLE tile at (5,2); members sit to its west.
{
  const TS = 48, W = 10, H = 6, DT = 1 / 60;
  // Build an isolated world; `walkable` is required (rimToward uses isWalkable). Members
  // default to ample hp so a single strike doesn't kill them (the swallow cases override).
  const mk = (hx, hy, extra = []) => {
    const tiles = new Array(W * H).fill(0); tiles[2 * W + 5] = 6 /*RUBBLE*/;
    const walkable = tiles.map((t) => (t === 5 || t === 6) ? 0 : 1);
    const level = { w: W, h: H, tileSize: TS, tiles, walkable };
    const hero = { x: hx, y: hy, r: 14, dead: false, hp: 100 };
    const hits = [], kbs = [], voidFalling = [], enemies = [];
    const vt = createVoidTentacles({
      level, ts: TS, heroTargets: [hero, ...extra], balance: BALANCE,
      hurtMember: (m, a) => { hits.push({ m, a }); m.hp = (m.hp ?? 1) - a; if (m.hp <= 0) m.dead = true; },
      knockback: (t, dx, dy, mag) => kbs.push({ dx, dy, mag }),
      voidFalling, corpseColor: "#000", hero,
      removeMember: (m) => { const i = enemies.indexOf(m); if (i >= 0) enemies.splice(i, 1); },
      rng: makeRng(1),
    });
    return { vt, hero, hits, kbs, voidFalling, enemies, level };
  };
  const HX = 4 * TS + TS / 2, HY = 2 * TS + TS / 2; // one tile WEST of the hole

  // (table) the color->action registry exists and its first row is the purple drag type.
  { const { vt } = mk(HX, HY);
    ok(vt.TENTACLE_TYPES.length >= 1 && typeof vt.TENTACLE_TYPES[0].onHit === "function", "tentacle: color->action table populated");
    ok(vt.TENTACLE_TYPES[0].color === THEME.voidTentacle.colors.drag, "tentacle: first type is the purple drag (color-keyed action)"); }

  // (a) rim detection: the facing rim is the WEST face; its base sits on the hero side.
  { const { vt, hero } = mk(HX, HY);
    const rim = vt.rimToward(hero);
    ok(rim && rim.tx === 5 && rim.ty === 2, "tentacle: finds the hole tile in range");
    ok(rim && rim.baseX < 5 * TS + TS / 2, "tentacle: rim base is on the hero-facing (west) side"); }

  // (b) out of range: a hero 5 tiles from the hole offers no rim and never wakes one.
  { const far = mk(0 * TS + TS / 2, HY);
    ok(far.vt.rimToward(far.hero) === null, "tentacle: no rim when the hero is out of range");
    for (let f = 0; f < 400; f++) far.vt.update(DT);
    ok(far.vt.tentacles.length === 0, "tentacle: an out-of-range hole never spawns"); }

  // (c) spawn gate + maxActive invariant: a hole near a hero spawns, and the live count
  //     never exceeds the cap across a long run (spawn + complete + respawn churn).
  { const sg = mk(HX, HY);
    let spawned = false, capOk = true;
    for (let f = 0; f < 2000; f++) {
      sg.vt.update(DT);
      if (sg.vt.tentacles.length > 0) spawned = true;
      if (sg.vt.tentacles.length > BALANCE.voidTentacle.maxActive) { capOk = false; break; }
    }
    ok(spawned, "tentacle: a hole near a hero spawns one");
    ok(capOk, "tentacle: never exceeds maxActive concurrent tentacles"); }

  // (d) FSM + aim lock: drive one tentacle by hand to telegraph, then sidestep — the aim,
  //     captured at the lock, must NOT follow, so the strike whiffs (the dodge guarantee).
  { const fl = mk(HX, HY);
    const t = fl.vt._spawnAt(fl.vt.rimToward(fl.hero));
    ok(t.state === "bud", "tentacle: starts in the bud state");
    const seen = new Set();
    for (let f = 0; f < 200 && t.state !== "telegraph"; f++) { fl.vt._step(t, DT); seen.add(t.state); }
    ok(seen.has("bud") && seen.has("rise"), "tentacle: passes through bud + rise");
    ok(t.state === "telegraph", "tentacle: reaches the telegraph window");
    const lockX = t.aimX, lockY = t.aimY;
    fl.hero.y -= 3 * TS; // sidestep north during the locked window
    for (let f = 0; f < 5; f++) fl.vt._step(t, DT);
    ok(t.aimX === lockX && t.aimY === lockY, "tentacle: aim stays locked after telegraph (sidestep dodges)");
    for (let f = 0; f < 400 && t.state !== "retract" && !t.done; f++) fl.vt._step(t, DT);
    ok(fl.hits.length === 0, "tentacle: a sidestep during telegraph makes the strike whiff"); }

  // (e) strike-once + drag-into-hole (purple): the strike injures once, then the grab reels the
  //     member PAST the lip toward the hole interior and KILLS it there — dragged under and gone,
  //     never deposited back at the lip.
  { const st = mk(HX, HY);
    const rim = st.vt.rimToward(st.hero);
    const t = st.vt._spawnAt(rim, "drag");
    for (let f = 0; f < 120 && t.state !== "strike"; f++) st.vt._step(t, DT);
    const startX = st.hero.x;
    for (let f = 0; f < 30 && t.state === "strike"; f++) st.vt._step(t, DT);
    ok(st.hits.length === 1, "tentacle: a clean strike injures exactly once");
    ok(t.grabbed === st.hero || t.state === "grab", "tentacle: the purple type grabs the member");
    let crossed = false;
    for (let f = 0; f < 60 && t.state === "grab"; f++) { st.vt._step(t, DT); if (st.hero.x > rim.baseX) crossed = true; }
    ok(startX < rim.baseX && crossed, "tentacle: the grab reels the member past the lip into the hole");
    ok(st.hero.dead, "tentacle: a grabbed hero is dragged into the void and killed (never deposited back)"); }

  // (e1) the killed victim is swallowed: a grabbed FOLLOWER is reeled in, killed, and pushed
  //      into voidFalling (the visible sink) — not deposited at the lip, not left as a corpse.
  { const fol = { x: HX, y: HY, r: 14, dead: false, hp: 100, color: "#abc" };
    const dv = mk(HX, 5 * TS + TS / 2, [fol]); // hero off the line (south); follower on it
    const t = dv.vt._spawnAt(dv.vt.rimToward(fol), "drag");
    for (let f = 0; f < 300 && !fol.dead; f++) dv.vt._step(t, DT);
    ok(fol.dead, "tentacle: a grabbed follower is dragged into the void and killed");
    ok(dv.voidFalling.length === 1, "tentacle: the killed follower is swallowed into the hole");
    ok(dv.voidFalling[0].vfx !== 0 || dv.voidFalling[0].vfy !== 0, "tentacle: the swallow body carries inward velocity");
    ok(!dv.hero.dead, "tentacle: dragging a follower in leaves the hero untouched"); }

  // (e2) knock (magenta): injure + shove the survivor away from the hole; no grab.
  { const kn = mk(HX, HY);
    const t = kn.vt._spawnAt(kn.vt.rimToward(kn.hero), "knock");
    for (let f = 0; f < 200 && kn.hits.length === 0; f++) kn.vt._step(t, DT);
    ok(kn.hits.length === 1, "tentacle: the magenta type injures once");
    ok(kn.kbs.length === 1 && kn.kbs[0].dx < 0, "tentacle: the magenta type knocks the member away from the hole");
    ok(t.grabbed === null, "tentacle: the magenta type does not grab"); }

  // (e3) root (teal): injure + pin the member in place for a beat; no grab.
  { const rt = mk(HX, HY);
    const t = rt.vt._spawnAt(rt.vt.rimToward(rt.hero), "root");
    for (let f = 0; f < 200 && rt.hits.length === 0; f++) rt.vt._step(t, DT);
    ok(rt.hits.length === 1, "tentacle: the teal type injures once");
    ok(rt.hero.rootT > 0, "tentacle: the teal type roots the member in place");
    ok(t.grabbed === null, "tentacle: the teal type does not grab"); }

  // (f) void-death swallow: a member that dies on the strike is pushed into voidFalling with
  //     inward velocity (reusing voidPull's swallow), not left as a corpse. Hero stays clear.
  { const weak = { x: HX, y: HY, r: 14, dead: false, hp: 5, color: "#abc" };
    const sw = mk(HX, 5 * TS + TS / 2, [weak]); // hero off the line (south); weak on it
    const t = sw.vt._spawnAt(sw.vt.rimToward(weak));
    for (let f = 0; f < 120 && !weak.dead; f++) sw.vt._step(t, DT);
    ok(weak.dead, "void-death: a lethal strike kills the struck member");
    ok(sw.voidFalling.length === 1, "void-death: the killed member is swallowed into the hole");
    ok(sw.voidFalling[0].vfx !== 0 || sw.voidFalling[0].vfy !== 0, "void-death: the swallow body carries inward velocity");
    ok(!sw.hero.dead, "void-death: swallowing a non-hero leaves the hero untouched"); }

  // (g) the hero is never swallowed: a lethal strike still kills the head (loss routes via
  //     hurtMember/loseRun in the real game) but never pushes a voidFalling body for it.
  { const hg = mk(HX, HY); hg.hero.hp = 5;
    const t = hg.vt._spawnAt(hg.vt.rimToward(hg.hero));
    for (let f = 0; f < 120 && !hg.hero.dead; f++) hg.vt._step(t, DT);
    ok(hg.hero.dead, "void-death: a lethal strike still kills the hero");
    ok(hg.voidFalling.length === 0, "void-death: the hero is never pushed into voidFalling"); }

  // (h) determinism: a fresh factory on the same seed grows the same color (no per-strike RNG).
  { const a = mk(HX, HY), b = mk(HX, HY);
    const ta = a.vt._spawnAt(a.vt.rimToward(a.hero));
    const tb = b.vt._spawnAt(b.vt.rimToward(b.hero));
    ok(ta.type.id === tb.type.id, "tentacle: same seed picks the same color-keyed type"); }
}

// Party-select live preview: the self-contained mini-sim must run every roster hero —
// covering every weapon AND signature shape — without throwing, and must actually draw.
// A no-op/counting ctx stub stands in for the canvas (the sim is decoupled from drawing).
{
  const DRAWS = new Set(["fillRect", "arc", "fillText", "stroke", "fill"]);
  const rect = { x: 510, y: 70, w: 274, h: 500 };
  for (const def of BALANCE.roster) {
    let draws = 0;
    const ctx = new Proxy({}, { get: (_t, p) => (DRAWS.has(p) ? () => { draws++; } : () => {}), set: () => true });
    const pv = createPartyPreview(ctx, rect);
    let threw = null;
    try {
      pv.setHero(def);
      for (let f = 0; f < 600; f++) { pv.update(1 / 60); pv.render(); } // 10s sim
    } catch (e) { threw = e.message; }
    ok(!threw, `preview runs hero ${def.id} (${def.weaponId}/${def.signatureId}) without throwing — ${threw}`);
    ok(draws > 0, `preview renders non-blank for hero ${def.id}`);
  }
  // setHero(null) clears to an idle panel without throwing.
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
  const pv = createPartyPreview(ctx, rect);
  let idleThrew = null;
  try { pv.setHero(null); pv.update(1 / 60); pv.render(); } catch (e) { idleThrew = e.message; }
  ok(!idleThrew, `preview idle (no hero) runs without throwing — ${idleThrew}`);
}

console.log(failures === 0
  ? `PASS — 200 maps generated, all connected; min walkable ratio ${walkRatioMin.toFixed(2)}`
  : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
