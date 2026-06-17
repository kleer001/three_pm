// Durable meta tier (spec 08): the persistent save blob, its one localStorage
// key + version/migration, the end-of-run payout, and per-hero upgrade trees
// bought with banked `credits` (distinct from the volatile in-run `cash`, spec
// 07 — the two never convert). The pure transforms (computePayout, recordRun,
// bankCurrency, purchaseUpgrade, applyHeroUpgrades, recompute/unlock helpers) are
// node-testable; only load/save touch storage, guarded for headless runs.
//
// Like balance.js and powerups.js, the tuning/content (PAYOUT coefficients, the
// UPGRADES trees, unlock gates) lives here as a synchronous ES module rather than
// a fetched JSON file — the slice ships no build step.
import { recomputeDerived, STAT_KEYS } from "../run/combat.js";
import { BALANCE } from "../run/balance.js";

export const KEY = "threepm:save";
const VERSION = 1;

// Payout coefficients (spec 08) — tuning, not contract.
export const PAYOUT = { distance: 100, perKill: 2, win: 150 };

// Hero unlock gates: runCount ≥ value (spec 05), read straight off the cast roster
// (balance.js) so the data has one home. Adding/regating a character is a roster edit.
export const HERO_UNLOCKS = Object.fromEntries(BALANCE.roster.map((c) => [c.id, c.unlockAtRuns]));

// Per-hero permanent upgrade trees (spec 08 upgrades.json). `apply` mirrors the
// spec-07 stat payload: deltas on the hero's base stats, scaled by purchased rank,
// folded in at run start before recomputeDerived. costCurve[i] is rank i+1's price.
//
// Each tree is themed to its hero's kit (genre + basic weapon + signature) rather
// than copied verbatim: a hero leans cheapest into the stat its weapon/signature
// scales on, and pays a premium to shore up a defining weakness. The four base
// stats are the only payload the run folds (applyHeroUpgrades) — differentiation
// comes from WHICH stats a tree offers, its rank caps, and its cost curves:
//   speed → moveSpeed · constitution → maxHp + dmgResist · strength → knockback +
//   strength-scaled weapon/signature damage · magic → maxMana + abilityPower +
//   magic-scaled weapon/signature damage.
export const UPGRADES = {
  // House · Slingshot (str + ⅓-maxHP, freezes) · Good Vibes (passive heal). The
  // baseline all-rounder: every stat, evenly priced — no specialism, no weakness.
  marvin: {
    track_legs:  { name: "Track Legs",    blurb: "+1 speed / rank",        maxRank: 3, costCurve: [40, 80, 140], apply: { speed: 1 } },
    iron_gut:    { name: "Iron Gut",      blurb: "+1 constitution / rank", maxRank: 3, costCurve: [40, 80, 140], apply: { constitution: 1 } },
    weight_room: { name: "Weight Room",   blurb: "+1 strength / rank",     maxRank: 3, costCurve: [50, 100, 175], apply: { strength: 1 } },
    honor_roll:  { name: "Honor Roll",    blurb: "+1 magic / rank",        maxRank: 3, costCurve: [50, 100, 175], apply: { magic: 1 } },
  },

  // Industrial · Cleave (heavy str melee) · Mosh Pit (str nova). The varsity
  // bruiser: cheap strength + constitution, a premium combined "mosh" track, and a
  // little speed to close his gap. No magic — his kit doesn't touch it.
  chad: {
    pit_boss:      { name: "Pit Boss",      blurb: "+1 strength / rank",      maxRank: 3, costCurve: [45, 90, 160],  apply: { strength: 1 } },
    letterman:     { name: "Letterman",     blurb: "+1 constitution / rank",  maxRank: 3, costCurve: [40, 80, 140],  apply: { constitution: 1 } },
    wall_of_death: { name: "Wall of Death", blurb: "+1 str & con / rank",     maxRank: 2, costCurve: [130, 240],     apply: { strength: 1, constitution: 1 } },
    warmup_laps:   { name: "Warm-Up Laps",  blurb: "+1 speed / rank",         maxRank: 2, costCurve: [55, 120],      apply: { speed: 1 } },
  },

  // Psytrance · Spear (fast str melee) · Redline (rapid str shots). The track star
  // glass cannon: cheap speed + strength to lean into the build, and a costly
  // constitution track to patch his paper-thin survivability.
  dash: {
    sprinters_high: { name: "Sprinter's High", blurb: "+1 speed / rank",       maxRank: 3, costCurve: [40, 80, 140],   apply: { speed: 1 } },
    adrenaline:     { name: "Adrenaline",      blurb: "+1 strength / rank",    maxRank: 3, costCurve: [45, 90, 160],   apply: { strength: 1 } },
    second_wind:    { name: "Second Wind",     blurb: "+1 constitution / rank",maxRank: 3, costCurve: [60, 130, 230],  apply: { constitution: 1 } },
  },

  // Dubtechno · Hex (magic %-HP, costs mana) · Deep Freeze (magic freeze nova).
  // The occultist: cheap magic (damage + the mana both casts burn), a pricey
  // constitution track for her fragility, and some speed to kite.
  wendolyn: {
    sub_bass:     { name: "Sub-Bass",     blurb: "+1 magic / rank",        maxRank: 3, costCurve: [40, 80, 140],   apply: { magic: 1 } },
    ritual_scars: { name: "Ritual Scars", blurb: "+1 constitution / rank", maxRank: 3, costCurve: [55, 120, 210],  apply: { constitution: 1 } },
    echo_chamber: { name: "Echo Chamber", blurb: "+1 speed / rank",        maxRank: 2, costCurve: [50, 110],       apply: { speed: 1 } },
  },

  // Techno · Bomb (magic area) · Drum Machine (deploy turret, costs mana). The
  // robotics nerd: cheap magic for blast damage + the mana that fields turrets,
  // armor for his chassis, and servos to fix his slow feet.
  eugene: {
    overclock:          { name: "Overclock",          blurb: "+1 magic / rank",        maxRank: 3, costCurve: [40, 80, 140],  apply: { magic: 1 } },
    reinforced_chassis: { name: "Reinforced Chassis",  blurb: "+1 constitution / rank", maxRank: 3, costCurve: [45, 90, 160],  apply: { constitution: 1 } },
    servo_motors:       { name: "Servo Motors",        blurb: "+1 speed / rank",        maxRank: 2, costCurve: [55, 120],      apply: { speed: 1 } },
  },

  // Trance · Nova (str burst) · The Drop (magic charge nova). The hybrid raver:
  // her two casts pull opposite stats, so magic and strength are both first-class
  // and evenly priced, with constitution to ride out the charge-up.
  jess: {
    build_up:  { name: "Build-Up",  blurb: "+1 magic / rank",        maxRank: 3, costCurve: [40, 80, 140],  apply: { magic: 1 } },
    hands_up:  { name: "Hands Up",  blurb: "+1 strength / rank",     maxRank: 3, costCurve: [45, 90, 160],  apply: { strength: 1 } },
    afterglow: { name: "Afterglow", blurb: "+1 constitution / rank", maxRank: 3, costCurve: [50, 110, 190], apply: { constitution: 1 } },
  },

  // Acid · Beam (STRENGTH-scaled pierce, costs mana) · Bad Trip (confuse, costs
  // mana). The oddball: his pierce scales on strength while both casts burn mana,
  // so strength AND magic both pay off — plus quick feet for repositioning.
  zigzag: {
    squelch_303: { name: "303 Squelch", blurb: "+1 strength / rank", maxRank: 3, costCurve: [45, 90, 160], apply: { strength: 1 } },
    acid_bath:   { name: "Acid Bath",   blurb: "+1 magic / rank",    maxRank: 3, costCurve: [40, 80, 140], apply: { magic: 1 } },
    quick_feet:  { name: "Quick Feet",  blurb: "+1 speed / rank",    maxRank: 2, costCurve: [50, 110],     apply: { speed: 1 } },
  },

  // Ambient · Hex Field (magic zone) · Chill Zone (magic slow field). The zone
  // controller: cheap magic for zone damage + the heavy mana both fields demand,
  // matching cheap constitution since he holds ground, and a dash of speed.
  jasper: {
    drone:     { name: "Drone",     blurb: "+1 magic / rank",        maxRank: 3, costCurve: [40, 80, 140], apply: { magic: 1 } },
    deep_calm: { name: "Deep Calm", blurb: "+1 constitution / rank", maxRank: 3, costCurve: [40, 80, 140], apply: { constitution: 1 } },
    slow_fade: { name: "Slow Fade", blurb: "+1 speed / rank",        maxRank: 2, costCurve: [55, 120],     apply: { speed: 1 } },
  },

  // Synthwave · Whirl (str 360° spin, always firing) · Flashback (magic planted
  // bomb). The true hybrid: mobility feeds his constant spin, strength powers it,
  // magic powers his bomb — all three on offer, with a small armor track.
  valentine: {
    neon_drive: { name: "Neon Drive", blurb: "+1 speed / rank",        maxRank: 3, costCurve: [40, 80, 140],  apply: { speed: 1 } },
    power_chord:{ name: "Power Chord", blurb: "+1 strength / rank",     maxRank: 3, costCurve: [45, 90, 160],  apply: { strength: 1 } },
    retrowave:  { name: "Retrowave",  blurb: "+1 magic / rank",        maxRank: 3, costCurve: [50, 110, 190], apply: { magic: 1 } },
    hairspray:  { name: "Hairspray",  blurb: "+1 constitution / rank", maxRank: 2, costCurve: [55, 120],      apply: { constitution: 1 } },
  },
};

const clone = (blob) => JSON.parse(JSON.stringify(blob));

function defaultBlob() {
  return {
    version: VERSION, credits: 0, runCount: 0,
    unlockedHeroes: recomputeUnlocks(0), heroUpgrades: {},
    stats: { wins: 0, bestDistance: 0, totalKills: 0 },
  };
}

// Ordered v→v+1 migration steps. None yet (VERSION 1); a future field-add lands a
// step here and bumps VERSION. A missing/unparsable blob yields a fresh default.
const MIGRATIONS = {};
function migrate(blob) {
  while (blob.version < VERSION) {
    const step = MIGRATIONS[blob.version];
    if (!step) return defaultBlob(); // unknown gap — start fresh rather than guess
    blob = step(blob);
  }
  return blob;
}

const storage = typeof localStorage !== "undefined" ? localStorage : null;

// load(): parse KEY, migrate to CURRENT, or default. The single read path.
export function load() {
  if (!storage) return defaultBlob();
  try {
    const raw = storage.getItem(KEY);
    return raw ? migrate(JSON.parse(raw)) : defaultBlob();
  } catch {
    return defaultBlob(); // corrupt blob → fresh save, never crash the boot
  }
}

// save(blob): serialize + write KEY. The ONLY writer (spec 08). Returns the blob.
export function save(blob) {
  if (storage) storage.setItem(KEY, JSON.stringify(blob));
  return blob;
}

// Heroes whose unlock gate the given runCount satisfies (the source of truth; the
// blob's unlockedHeroes is just a cache recordRun rewrites).
export function recomputeUnlocks(runCount) {
  return Object.keys(HERO_UNLOCKS).filter((id) => runCount >= HERO_UNLOCKS[id]);
}
export const isHeroUnlocked = (blob, id) => blob.runCount >= HERO_UNLOCKS[id];

// Credits earned this run (spec 08 formula): distance + kills + a flat win bonus.
export function computePayout(result) {
  return Math.round(
    result.distanceFraction * PAYOUT.distance +
    result.kills * PAYOUT.perKill +
    (result.won ? PAYOUT.win : 0),
  );
}

export function bankCurrency(blob, n) {
  blob = clone(blob);
  blob.credits += n;
  return blob;
}

// Fold one completed run into the save (spec 08): bank the payout, bump runCount
// and the lifetime stats, refresh the unlock cache. Pure — caller persists.
export function recordRun(blob, result) {
  blob = clone(blob);
  blob.credits += computePayout(result);
  blob.runCount += 1;
  blob.stats.wins += result.won ? 1 : 0;
  blob.stats.totalKills += result.kills;
  blob.stats.bestDistance = Math.max(blob.stats.bestDistance, result.distanceFraction);
  blob.unlockedHeroes = recomputeUnlocks(blob.runCount);
  return blob;
}

// Buy the next rank of a hero upgrade if affordable and not maxed (spec 08). Pure;
// a no-op (returns the same blob unchanged) when maxed or too few credits.
export function purchaseUpgrade(blob, heroId, upgradeId) {
  const def = UPGRADES[heroId] && UPGRADES[heroId][upgradeId];
  if (!def) return blob;
  const rank = upgradeRank(blob, heroId, upgradeId);
  if (rank >= def.maxRank) return blob;
  const cost = def.costCurve[rank];
  if (blob.credits < cost) return blob;
  blob = clone(blob);
  (blob.heroUpgrades[heroId] || (blob.heroUpgrades[heroId] = {}))[upgradeId] = rank + 1;
  blob.credits -= cost;
  return blob;
}

// Current purchased rank of an upgrade (0 = unbought) — the one lookup the helpers
// and the META screen share.
export function upgradeRank(blob, heroId, upgradeId) {
  return (blob.heroUpgrades[heroId] && blob.heroUpgrades[heroId][upgradeId]) || 0;
}
// The cost to advance an upgrade one rank, or null if maxed — for the price column.
export function nextCost(blob, heroId, upgradeId) {
  const def = UPGRADES[heroId][upgradeId];
  const rank = upgradeRank(blob, heroId, upgradeId);
  return rank >= def.maxRank ? null : def.costCurve[rank];
}

// Fold a hero's purchased upgrades into its run-start stats, then derive (spec 08).
// Stat deltas go in BEFORE recomputeDerived so maxHp/mana/etc. reflect them — the
// same derive path spec 03 freezes, with meta upgrades as just another stat source.
export function applyHeroUpgrades(hero, heroId, blob, derive) {
  const tree = UPGRADES[heroId] || {};
  const owned = blob.heroUpgrades[heroId] || {};
  for (const upId in owned) {
    const def = tree[upId];
    if (!def) continue;
    for (const k of STAT_KEYS) if (def.apply[k]) hero.stats[k] += def.apply[k] * owned[upId];
  }
  recomputeDerived(hero, derive);
}
