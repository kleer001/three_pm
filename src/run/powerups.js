// In-run powerups (spec 07), reconciled to the vertical slice. The slice gives the
// hero ONE chosen weapon rather than the spec's basic/signature pair, so a powerup
// carries `stat` deltas (mutate the hero's four base stats → recomputeDerived)
// and/or `weapon` mods (rewrite the chosen weapon's spec-04 attack descriptor) —
// every catalog item is a *deal*: a blessing paired with an equal-or-greater curse,
// so over-buying piles up downsides and greed regulates itself. Everything else is
// the frozen spec-07 contract: a held id list, an `applyHeld` rebuild-from-base so
// synergies see the whole set and attack mods stay order-independent, and
// declarative synergies that reuse `applyPowerup` verbatim.
//
// Acquisition is the spec's two channels: world drops (rolled on enemy death from
// the `loot` RNG sub-stream) and shops (spend `runState.cash`). Both draw from one
// shuffled, draw-without-replacement bag, so the same item is never offered or
// dropped twice in a run. Both end in the same `applyHeld` rebuild.
import { recomputeDerived, STAT_KEYS } from "./combat.js";

// Powerup registry. `stat` carries stat deltas (1–10 base stats); `weapon` carries
// partial weapon fields (numbers add, nested `damage` fields add, `mult` fields
// multiply, booleans override). `rarity` selects the shop price rate (see
// BALANCE.loot.priceRate) — there is no fixed cost; the reactive market quotes a
// fraction of the player's cash-on-hand. Every entry's curse is ≥1:1 with its
// blessing. `kind:"buff"` items are timed effects applied live by runScene and
// never enter applyHeld.
export const POWERUPS = {
  // Common — clean 1:1 stat swaps.
  pre_workout:  { name: "Pre-Workout",  blurb: "+2 strength, −2 speed",        rarity: "common", stat: { strength: 2, speed: -2 } },
  thick_hide:   { name: "Thick Hide",   blurb: "+2 toughness, −2 speed",       rarity: "common", stat: { constitution: 2, speed: -2 } },
  honor_roll:   { name: "Honor Roll",   blurb: "+2 magic, −2 strength",        rarity: "common", stat: { magic: 2, strength: -2 } },
  track_star:   { name: "Track Star",   blurb: "+2 speed, −2 toughness",       rarity: "common", stat: { speed: 2, constitution: -2 } },
  cliff_notes:  { name: "Cliff Notes",  blurb: "+2 magic, −2 toughness",       rarity: "common", stat: { magic: 2, constitution: -2 } },
  glass_jaw:    { name: "Glass Jaw",    blurb: "+2 strength, −2 toughness",    rarity: "common", stat: { strength: 2, constitution: -2 } },
  sugar_rush:   { name: "Sugar Rush",   blurb: "+2 speed, −2 magic",           rarity: "common", stat: { speed: 2, magic: -2 } },

  // Uncommon — bigger swings + weapon-feel curses.
  hair_trigger: { name: "Hair Trigger", blurb: "much faster, −6 damage",       rarity: "uncommon", weapon: { damage: { base: -6 }, mult: { cd: 0.60 } } },
  heavy_hands:  { name: "Heavy Hands",  blurb: "+9 damage & knockback, slow",  rarity: "uncommon", weapon: { damage: { base: 9 }, knockback: 1, mult: { cd: 1.40 } } },
  split_shot:   { name: "Split Shot",   blurb: "+1 projectile, −5 each",       rarity: "uncommon", weapon: { count: 1, damage: { base: -5 } } },
  mana_battery: { name: "Mana Battery", blurb: "+3 magic, −3 speed",           rarity: "uncommon", stat: { magic: 3, speed: -3 } },
  berserker:    { name: "Berserker",    blurb: "+3 strength, −3 toughness",    rarity: "uncommon", stat: { strength: 3, constitution: -3 } },
  lead_boots:   { name: "Lead Boots",   blurb: "+3 toughness, −3 speed",       rarity: "uncommon", stat: { constitution: 3, speed: -3 } },

  // Rare — sharp, build-defining gambles.
  needle_tip:   { name: "Needle Tip",   blurb: "pierces, no knockback, slower", rarity: "rare", weapon: { pierce: true, damage: { base: -5 }, mult: { cd: 1.20, knockback: 0 } } },
  cold_snap:    { name: "Cold Snap",    blurb: "hits freeze, much slower",      rarity: "rare", weapon: { freeze: true, mult: { cd: 1.45 } } },
  hand_cannon:  { name: "Hand Cannon",  blurb: "huge damage, short & slow",     rarity: "rare", weapon: { damage: { base: 14, pctMax: 0.12 }, range: -150, mult: { cd: 1.40 } } },
  redline:      { name: "Redline",      blurb: "+4 speed, −4 toughness",        rarity: "rare", stat: { speed: 4, constitution: -4 } },
  zealotry:     { name: "Zealotry",     blurb: "+4 magic, −4 toughness",        rarity: "rare", stat: { magic: 4, constitution: -4 } },

  // Timed buffs (docs/19) — a live, expiring effect the run applies directly (see
  // runScene `acquire`/`activeBuffs`), so they never enter applyHeld. `effect` picks
  // the channel: "speed" multiplies the head's move speed, "time" scales the whole
  // sim (bullet-time, the head stays fast). Each carries its own gamble: BPM Boost
  // leaves a hard slow tail when it ends; Slow Jam costs a heavy chunk of HP up front.
  bpm_boost:    { name: "BPM Boost", blurb: "speed burst, then a crash", rarity: "uncommon", kind: "buff", effect: "speed", mult: 1.7, duration: 6, tailMult: 0.5, tailDuration: 6 },
  slow_jam:     { name: "Slow Jam",  blurb: "bullet-time, costs HP",     rarity: "rare",     kind: "buff", effect: "time",  mult: 0.5, duration: 5, hpCostFrac: 0.35 },
};

// Synergies (spec-07 `synergies.json`): a combo gated on a held-set. `requires` ids
// must all be held. The mod payload is a powerup payload — a synergy IS an
// `applyPowerup` mod, applied through the same function, no code-path branch. These
// are pure upside: the reward for committing to two cursed items that pair.
export const SYNERGIES = {
  skewer_volley: { name: "Skewer Volley", blurb: "piercing spread shots hit harder", requires: ["split_shot", "needle_tip"], weapon: { damage: { base: 8 } } },
  overcharge:    { name: "Overcharge",    blurb: "rapid heavy hits stagger more",     requires: ["hair_trigger", "heavy_hands"], weapon: { knockback: 1, damage: { base: 6 } } },
};

// Merge a partial weapon mod into a weapon's attack descriptor: nested `damage`
// fields add, a `mult` block multiplies top-level numeric fields (percentage
// curses like "+45% cooldown"), other top-level numbers add, everything else
// (booleans/strings) overrides. Additive fields are applied before `mult` so a
// multiplier scales the post-add value within the same item.
function applyWeaponMod(weapon, mods) {
  let mult = null;
  for (const k in mods) {
    const v = mods[k];
    if (k === "mult") mult = v;
    else if (k === "damage") for (const dk in v) weapon.damage[dk] = (weapon.damage[dk] || 0) + v[dk];
    else if (typeof v === "number") weapon[k] = (weapon[k] || 0) + v;
    else weapon[k] = v;
  }
  if (mult) for (const k in mult) weapon[k] = (weapon[k] || 0) * mult[k];
}

// Apply one powerup/synergy def to the hero (spec-07 applyPowerup). A def may carry
// `stat` deltas and/or `weapon` mods — both run if present. Stats are re-derived by
// applyHeld after the whole set is applied, not here, so a run of stat items derives
// once.
export function applyPowerup(hero, weapon, def) {
  if (def.stat) for (const k of STAT_KEYS) if (def.stat[k]) hero.stats[k] += def.stat[k];
  if (def.weapon) applyWeaponMod(weapon, def.weapon);
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
  // Curses can drive a stat past either rail; keep the 1–10 model intact before deriving.
  for (const k of STAT_KEYS) hero.stats[k] = Math.max(1, Math.min(10, hero.stats[k]));
  weapon.cd = Math.max(clamp.minCd, weapon.cd);
  weapon.count = Math.max(1, Math.round(weapon.count));
  weapon.manaCost = Math.max(0, weapon.manaCost);
  weapon.knockback = Math.max(0, weapon.knockback);
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

// Cash awarded for a kill: a flat base + a slice of the enemy's threat (elites pay
// more). Tuning lives in BALANCE.loot. The reactive market scales to the wallet, so
// these only set the *scale* of the displayed number, not balance.
export function cashForKill(def, cfg) {
  return cfg.cashPerKill + def.threatValue * cfg.cashPerThreat;
}

// One shuffled bag of every catalog id, drawn from without replacement by both the
// shops and world drops (Fisher-Yates on the `loot` sub-stream, so it's reproducible
// per seed and independent of gen/spawns). Shifting from this guarantees the same
// item is never offered or dropped twice in a single run.
export function makeLootBag(rng) {
  const ids = Object.keys(POWERUPS);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

// Roll whether a kill drops a powerup at all (chance scales with threat). The actual
// item is drawn by the caller from the shared bag, so drops stay unique run-wide.
export function rollDrop(rng, def, cfg) {
  return rng.chance(cfg.dropChanceBase + def.threatValue * cfg.dropChancePerThreat);
}
