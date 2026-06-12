// Durable meta tier (spec 08): the persistent save blob, its one localStorage
// key + version/migration, the end-of-run payout, and per-hero upgrade trees
// bought with banked `credits` (distinct from the volatile in-run `scrap`, spec
// 07 — the two never convert). The pure transforms (computePayout, recordRun,
// bankCurrency, purchaseUpgrade, applyHeroUpgrades, recompute/unlock helpers) are
// node-testable; only load/save touch storage, guarded for headless runs.
//
// Like balance.js and powerups.js, the tuning/content (PAYOUT coefficients, the
// UPGRADES trees, unlock gates) lives here as a synchronous ES module rather than
// a fetched JSON file — the slice ships no build step.
import { recomputeDerived, STAT_KEYS } from "../run/combat.js";

export const KEY = "threepm:save";
const VERSION = 1;

// Payout coefficients (spec 08) — tuning, not contract.
export const PAYOUT = { distance: 100, perKill: 2, win: 150 };

// Hero unlock gates: runCount ≥ value (spec 05). The slice ships only Marvin; the
// gate machinery is here for forward-compat with the rest of the roster.
export const HERO_UNLOCKS = { marvin: 0 };

// Per-hero permanent upgrade trees (spec 08 upgrades.json). `apply` mirrors the
// spec-07 stat payload: deltas on the hero's base stats, scaled by purchased rank,
// folded in at run start before recomputeDerived. costCurve[i] is rank i+1's price.
export const UPGRADES = {
  marvin: {
    track_legs:  { name: "Track Legs",    blurb: "+1 speed / rank",        maxRank: 3, costCurve: [40, 80, 140], apply: { speed: 1 } },
    iron_gut:    { name: "Iron Gut",      blurb: "+1 constitution / rank", maxRank: 3, costCurve: [40, 80, 140], apply: { constitution: 1 } },
    weight_room: { name: "Weight Room",   blurb: "+1 strength / rank",     maxRank: 3, costCurve: [50, 100, 175], apply: { strength: 1 } },
    honor_roll:  { name: "Honor Roll",    blurb: "+1 magic / rank",        maxRank: 3, costCurve: [50, 100, 175], apply: { magic: 1 } },
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
