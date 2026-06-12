// In-run powerups (spec 07), reconciled to the vertical slice. The slice gives the
// hero ONE chosen weapon rather than the spec's basic/signature pair, so a powerup
// is either `stat` (mutate the hero's four base stats → recomputeDerived) or
// `weapon` (rewrite the chosen weapon's spec-04 attack descriptor). Everything else
// is the frozen spec-07 contract: a held id list (repeats = stacks), an
// `applyHeld` rebuild-from-base so synergies see the whole set and attack mods stay
// order-independent, and declarative synergies that reuse `applyPowerup` verbatim.
//
// Acquisition is the spec's two channels: world drops (rolled on enemy death from
// the `loot` RNG sub-stream, kept independent of gen/spawns) and shops (spend
// `runState.scrap`). Both end in the same `applyHeld` rebuild.
import { recomputeDerived, STAT_KEYS } from "./combat.js";

// Powerup registry (spec-07 `powerups.json`, as a synchronous ES module — the
// slice ships no build step or fetch(), same call balance.js makes). `kind: stat`
// carries stat deltas; `kind: weapon` carries partial weapon fields (numbers add,
// nested `damage` fields add, booleans override). `cost` is the shop price.
export const POWERUPS = {
  espresso_shot: { name: "Espresso Shot", blurb: "+move speed", rarity: "common", kind: "stat", mods: { speed: 1 }, cost: 12 },
  thick_skin:    { name: "Thick Skin",    blurb: "+HP & resist",  rarity: "common", kind: "stat", mods: { constitution: 1 }, cost: 12 },
  gym_rat:       { name: "Gym Rat",       blurb: "+strength dmg",  rarity: "common", kind: "stat", mods: { strength: 1 }, cost: 12 },
  cram_session:  { name: "Cram Session",  blurb: "+magic dmg & mana", rarity: "common", kind: "stat", mods: { magic: 1 }, cost: 12 },

  hair_trigger:  { name: "Hair Trigger",  blurb: "faster attack", rarity: "uncommon", kind: "weapon", mods: { cd: -0.12 }, cost: 28 },
  heavy_hands:   { name: "Heavy Hands",   blurb: "+flat dmg & knockback", rarity: "uncommon", kind: "weapon", mods: { damage: { base: 3 }, knockback: 0.5 }, cost: 28 },
  split_shot:    { name: "Split Shot",    blurb: "+1 projectile", rarity: "uncommon", kind: "weapon", mods: { count: 1 }, cost: 30 },

  needle_tip:    { name: "Needle Tip",    blurb: "shots pierce the line", rarity: "rare", kind: "weapon", mods: { pierce: true }, cost: 44 },
  cold_snap:     { name: "Cold Snap",     blurb: "hits freeze", rarity: "rare", kind: "weapon", mods: { freeze: true }, cost: 48 },
};

// Synergies (spec-07 `synergies.json`): a combo gated on a held-set. `requires` ids
// must all be held (stacks count). The mod payload is a powerup payload — a synergy
// IS an `applyPowerup` mod, applied through the same function, no code-path branch.
export const SYNERGIES = {
  skewer_volley: { name: "Skewer Volley", blurb: "piercing spread shots hit harder", requires: ["split_shot", "needle_tip"], kind: "weapon", mods: { damage: { base: 4 } } },
  overcharge:    { name: "Overcharge",    blurb: "rapid heavy hits stagger more",     requires: ["hair_trigger", "heavy_hands"], kind: "weapon", mods: { knockback: 1, damage: { base: 3 } } },
};

// Merge a partial weapon mod into a weapon's attack descriptor: nested `damage`
// fields add, top-level numbers add, everything else (booleans/strings) overrides.
// The single rule weapon powerups and synergies both go through (spec-07 applyAttackMod).
function applyWeaponMod(weapon, mods) {
  for (const k in mods) {
    const v = mods[k];
    if (k === "damage") for (const dk in v) weapon.damage[dk] = (weapon.damage[dk] || 0) + v[dk];
    else if (typeof v === "number") weapon[k] = (weapon[k] || 0) + v;
    else weapon[k] = v;
  }
}

// Apply one powerup/synergy def to the hero (spec-07 applyPowerup). `stat` adds to
// the four base stats; `weapon` rewrites the chosen weapon's descriptor. Stats are
// re-derived by applyHeld after the whole set is applied, not here, so a stack of
// stat powerups derives once.
export function applyPowerup(hero, weapon, def) {
  if (def.kind === "stat") {
    for (const k of STAT_KEYS) if (def.mods[k]) hero.stats[k] += def.mods[k];
  } else {
    applyWeaponMod(weapon, def.mods);
  }
}

// Detect every satisfied synergy (all `requires` held) and apply its mod. Stable
// iteration order over the registry keeps the rebuild deterministic.
function applySynergies(hero, weapon, held) {
  const set = new Set(held);
  for (const id in SYNERGIES) {
    const s = SYNERGIES[id];
    if (s.requires.every((r) => set.has(r))) applyPowerup(hero, weapon, s);
  }
}

// Rebuild the hero + weapon from base, then replay the whole held list and the
// synergies it satisfies (spec-07 applyHeld). Rebuild-from-base — not incremental
// mutation — because synergies depend on the whole set and weapon geometry
// overrides aren't commutative; one source of truth, order-independent.
// `base = { stats, weapon }`; both are normalized snapshots (see snapshotBase).
export function applyHeld(hero, weapon, base, held, derive, clamp) {
  for (const k of STAT_KEYS) hero.stats[k] = base.stats[k];
  Object.assign(weapon, base.weapon, { damage: { ...base.weapon.damage } });
  for (const id of held) applyPowerup(hero, weapon, POWERUPS[id]);
  applySynergies(hero, weapon, held);
  weapon.cd = Math.max(clamp.minCd, weapon.cd);
  weapon.count = Math.max(1, Math.round(weapon.count));
  weapon.manaCost = Math.max(0, weapon.manaCost);
  recomputeDerived(hero, derive);
  hero.hp = Math.min(hero.hp, hero.derived.maxHp);
  hero.mana = Math.min(hero.mana, hero.derived.maxMana);
}

// Normalize a weapon def into a rebuild base: deep-copy `damage` and force the
// powerup-touched optional fields (`count`/`pierce`) to exist, so applyHeld's
// Object.assign fully resets them every rebuild (a stale `pierce:true` can't linger).
export function snapshotBase(heroStats, weaponDef) {
  return {
    stats: { ...heroStats },
    weapon: { ...weaponDef, damage: { ...weaponDef.damage }, count: weaponDef.count || 1, pierce: weaponDef.pierce || false },
  };
}

// Scrap awarded for a kill: a flat base + a slice of the enemy's threat (elites pay
// more). Tuning lives in BALANCE.loot.
export function scrapForKill(def, cfg) {
  return cfg.scrapPerKill + def.threatValue * cfg.scrapPerThreat;
}

// Roll a world drop on an enemy death using the `loot` sub-stream. Returns a
// powerup id or null. Drop chance scales with threat; the pick is rarity-weighted
// toward commons.
export function rollPowerupDrop(rng, def, cfg) {
  const chance = cfg.dropChanceBase + def.threatValue * cfg.dropChancePerThreat;
  if (!rng.chance(chance)) return null;
  return weightedPick(rng, cfg.rarityWeight);
}

// Pick a powerup id weighted by its rarity (common > uncommon > rare). Pure on the
// passed rng so shop stock and drops are reproducible per seed.
export function weightedPick(rng, rarityWeight) {
  const ids = Object.keys(POWERUPS);
  let total = 0;
  for (const id of ids) total += rarityWeight[POWERUPS[id].rarity];
  let r = rng.next() * total;
  for (const id of ids) { r -= rarityWeight[POWERUPS[id].rarity]; if (r < 0) return id; }
  return ids[ids.length - 1];
}
