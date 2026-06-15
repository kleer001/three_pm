// Closed-form balance report for the slice — the "spreadsheet layer" (industry
// tier 1: analytic DPS/TTK/TTD, no simulation, no bot). Reads the same BALANCE
// data and combat resolver the game runs, so the numbers are the game's numbers,
// not a re-derivation that can drift.
//
// Run: node tests/balance_model.mjs [heroId]   (default: marvin; any roster id)
// Meta upgrades are folded from the on-disk save via applyHeroUpgrades; in node
// (no localStorage) that's a fresh blob, so pass nothing to see the bare hero.
//
// What it CAN see: per-weapon kill speed (single-target AND a coarse multi-target
// estimate for AoE/pierce), mana sustain, per-enemy threat pricing, and the
// i-frame-capped survivability that decides whether a band is "tense but winnable".
// What it CANNOT see: spatial/emergent play — kiting, swarm geometry, freeze uptime
// under movement, the auto-scroll crush, follower-train offense. Those need the sim
// layer. Treat outlier flags here as "look at this", not "this is wrong".

import { BALANCE } from "../src/run/balance.js";
import { recomputeDerived, weaponDamage } from "../src/run/combat.js";
import { load, applyHeroUpgrades } from "../src/meta/save.js";

const C = BALANCE.derive;
const HERO_IFRAME = BALANCE.hero.iframeDur;       // 0.8s — the global hero-damage gate
const HERO_REGEN = BALANCE.hero.manaRegen;        // mana/s the hero recovers

// Run geometry → how long a descent lasts (context for "is this TTD survivable").
const TS = 24 * 2, VIEW_H = 600;
const RUN_LEN = (BALANCE.mapH * TS - VIEW_H) / BALANCE.scroll;

// --- actors ----------------------------------------------------------------
// The hero exactly as the run builds it: roster stats for the chosen head + any
// owned meta upgrades folded in via the same applyHeroUpgrades the run uses, so
// the actor here can't drift from the actor in play. Default Marvin-at-baseline is
// the floor the game must be balanced for; pass a heroId to model another pick.
const heroId = process.argv[2] || "marvin";
const heroDef = BALANCE.roster.find((c) => c.id === heroId);
if (!heroDef) {
  console.error(`unknown hero "${heroId}" — choose one of: ${BALANCE.roster.map((c) => c.id).join(", ")}`);
  process.exit(1);
}
const saveBlob = load();                          // node: fresh blob (no upgrades)
const hero = { stats: { ...heroDef.stats }, faction: "player" };
applyHeroUpgrades(hero, heroId, saveBlob, C);     // folds owned ranks, then recomputeDerived

// Each enemy def → the gameplay values the resolver actually uses.
const enemyProfile = (def) => {
  const e = { stats: def.stats };
  recomputeDerived(e, C);
  return {
    def, name: def.name,
    maxHp: e.derived.maxHp,
    resist: e.derived.dmgResist,
    ehp: e.derived.maxHp / (1 - e.derived.dmgResist), // effective HP a weapon must chew through
    derived: e.derived,
    freezesToKill: def.freezesToKill,
    threat: def.threatValue,
    band: def.distanceBand,
  };
};
const enemies = Object.values(BALANCE.enemies).map(enemyProfile);

// --- weapon model ----------------------------------------------------------
// Damage cadence: most weapons apply damage once per cooldown; a field applies
// once per tick while it's up, recast every cd (so it has a duty cycle < 1).
const cadence = (w) =>
  w.shape === "field"
    ? { hitInterval: w.tickInterval, duty: Math.min(1, w.lifespan / w.cd) }
    : { hitInterval: w.cd, duty: 1 };

// Mana sustain: a positive manaCost throttles fire rate once the pool drains to
// the regen line. Normal weapons stretch to manaCost/regen between shots; a field
// is recast-throttled (cost per cd vs regen). manaBound = the pool, not the cd, is
// the limiter — a flag worth seeing because it silently lowers real DPS.
const sustainInterval = (w, cad) => {
  if (!w.manaCost) return cad.hitInterval;
  if (w.shape === "field") {
    const perSec = w.manaCost / w.cd;
    return perSec > HERO_REGEN ? cad.hitInterval * (perSec / HERO_REGEN) : cad.hitInterval;
  }
  return Math.max(w.cd, w.manaCost / HERO_REGEN);
};
const isManaBound = (w) =>
  !!w.manaCost &&
  (w.shape === "field" ? w.manaCost / w.cd > HERO_REGEN : w.manaCost / HERO_REGEN > w.cd);

const isAoe = (w) => ["nova", "bomb", "field"].includes(w.shape) || (w.shape === "melee-arc" && w.arc >= 180);

// A weapon that lands on more than one enemy per activation — area shapes plus the
// piercing line. The single-target DPS/TTK below understates these: in a swarm one
// cast clears a cluster. CLUSTER_N is a flat, coarse "typical enemies caught per hit"
// stand-in (the real number is spatial — sim-layer territory); it exists only so
// area/pierce weapons aren't mis-flagged "weak" against single-target peers.
const CLUSTER_N = 3;
const isCluster = (w) => isAoe(w) || !!w.pierce;
const clusterHits = (w) => (isCluster(w) ? CLUSTER_N : 1);

// First-hit damage vs a neutral 50-HP / 0-resist dummy — a single comparable
// scalar across weapons (percent-of-HP terms resolve against the dummy's 50).
const DUMMY_HP = 50;
const firstHit = (w) => weaponDamage(w.damage, hero, DUMMY_HP, DUMMY_HP);

// Sustained, mana- and duty-aware DPS against that dummy. Note: %-current weapons
// (Hex) read higher here than in practice — they weaken as the target drops.
const sustainedDps = (w) => {
  const cad = cadence(w);
  return (firstHit(w) / sustainInterval(w, cad)) * cad.duty;
};

// Burst hits-to-kill a real enemy (HP path, through its resist; freeze path caps
// the slingshot). Returns Infinity if the weapon can't finish (pure %-current
// asymptote) — itself an outlier worth flagging.
const ttkHits = (w, enemy) => {
  let hp = enemy.maxHp, hits = 0;
  const freezeCap = w.freeze ? enemy.freezesToKill : Infinity;
  while (hp > 0 && hits < 1000) {
    const dmg = weaponDamage(w.damage, hero, enemy.maxHp, hp) * (1 - enemy.resist);
    if (dmg <= 0) break;
    hp -= dmg; hits++;
    if (hits >= freezeCap) return hits; // frozen to death before HP ran out
  }
  return hp <= 0 ? hits : Infinity;
};
const ttkSeconds = (w, enemy) => {
  const hits = ttkHits(w, enemy);
  return hits === Infinity ? Infinity : hits * cadence(w).hitInterval;
};

// --- enemy threat model -----------------------------------------------------
// What one enemy does to the hero per second. Every path routes through
// applyDamage, so it's reduced by hero dmgResist; contact is additionally gated
// to one hit per i-frame window (its natural rate). Shooter/charger rates are
// damage-per-cooldown (their cooldowns dwarf the i-frame window).
const RESIST_MULT = 1 - hero.derived.dmgResist;

const biggestHit = (p) => {
  const d = p.def;
  if (d.behavior === "shooter") return weaponDamage(d.attack, profileActor(d), hero.derived.maxHp, hero.derived.maxHp) * RESIST_MULT;
  if (d.behavior === "charger") return weaponDamage(d.attack, profileActor(d), hero.derived.maxHp, hero.derived.maxHp) * RESIST_MULT;
  return d.contactDamage * RESIST_MULT;
};
// A bare actor with derived stats, for resolving an enemy's own magic/strength attack.
function profileActor(def) { const e = { stats: def.stats }; recomputeDerived(e, C); return e; }

const incomingDps = (p) => {
  const d = p.def;
  if (d.behavior === "shooter") {
    const dmg = weaponDamage(d.attack, profileActor(d), hero.derived.maxHp, hero.derived.maxHp) * RESIST_MULT;
    const manaInterval = d.attack.manaCost / (d.manaRegen || 1); // refire is mana-throttled too
    return dmg / Math.max(d.cooldown, manaInterval);
  }
  if (d.behavior === "charger") {
    const dmg = weaponDamage(d.attack, profileActor(d), hero.derived.maxHp, hero.derived.maxHp) * RESIST_MULT;
    return dmg / (d.cooldown + d.telegraph + d.lungeDur); // one slam per full lunge cycle
  }
  return (d.contactDamage * RESIST_MULT) / HERO_IFRAME; // contact: one bite per i-frame window
};

// --- tension model ----------------------------------------------------------
// Per distance band: the director fields a threat budget; estimate the hero's
// time-to-die under it. The crux is the i-frame ceiling — the hero can be hit at
// most once per window, so total incoming is capped at (biggest single hit)/iframe
// no matter how many enemies pile on. Sustained = min(sum of per-enemy rates,
// that ceiling). TTD = maxHp / sustained. Assumes a stand-and-fight; real play
// dodges, so this is the pessimistic floor.
const band = (f) => {
  const elig = enemies.filter((p) => p.band <= f);
  const budget = BALANCE.director.baseThreat + f * BALANCE.director.threatSlope;
  const meanThreat = elig.reduce((a, p) => a + p.threat, 0) / elig.length;
  const count = budget / meanThreat;                              // ~enemies the budget buys
  const meanRate = elig.reduce((a, p) => a + incomingDps(p), 0) / elig.length;
  const rawSum = count * meanRate;
  const ceiling = Math.max(...elig.map(biggestHit)) / HERO_IFRAME; // the i-frame cap
  const sustained = Math.min(rawSum, ceiling);
  return { f, budget, count, rawSum, ceiling, sustained, ttd: hero.derived.maxHp / sustained, capped: rawSum > ceiling };
};

// --- formatting -------------------------------------------------------------
const pad = (s, n) => String(s).padStart(n);
const padr = (s, n) => String(s).padEnd(n);
const f1 = (x) => (x === Infinity ? "∞" : x.toFixed(1));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const LO = 0.6, HI = 1.6; // outlier band: flag anything outside [0.6, 1.6]× the median

console.log(`\n=== three_pm balance model (closed-form) ===`);
console.log(`actor: ${heroDef.name} (${heroDef.genre})  stats ${JSON.stringify(hero.stats)}`);
console.log(`hero: maxHp ${hero.derived.maxHp}  resist ${(hero.derived.dmgResist * 100).toFixed(0)}%  mana ${hero.derived.maxMana}/+${HERO_REGEN}  AP ${hero.derived.abilityPower}  i-frame ${HERO_IFRAME}s`);
console.log(`run length: ~${RUN_LEN.toFixed(0)}s descent (${BALANCE.mapH} tiles @ ${BALANCE.scroll}px/s)\n`);

// Weapons. effDPS = single-target DPS × cluster hits — the number outliers flag off,
// so a Nova that catches a swarm isn't penalised against a single-target peer.
console.log(`--- WEAPONS  (DPS vs 50hp/0-resist dummy; effDPS = ×${CLUSTER_N} for cluster; * = mana-bound, A = AoE, P = pierce) ---`);
console.log(`${padr("weapon", 10)} ${pad("cd", 5)} ${pad("mana", 5)} ${pad("hit", 6)} ${pad("DPS", 7)} ${pad("effDPS", 7)}  flags`);
const wRows = Object.entries(BALANCE.weapons).map(([id, w]) => ({ id, w, dps: sustainedDps(w), effDps: sustainedDps(w) * clusterHits(w) }));
for (const { id, w, dps, effDps } of wRows) {
  const flags = [w.freeze ? "freeze" : "", isAoe(w) ? "A" : "", w.pierce ? "P" : "", isManaBound(w) ? "*mana" : ""].filter(Boolean).join(" ");
  console.log(`${padr(w.name, 10)} ${pad(w.cd, 5)} ${pad(w.manaCost, 5)} ${pad(firstHit(w).toFixed(1), 6)} ${pad(dps.toFixed(1), 7)} ${pad(effDps.toFixed(1), 7)}  ${flags}`);
}
const wMed = median(wRows.map((r) => r.effDps));
console.log(`median effDPS ${wMed.toFixed(1)} — outliers (<${LO}× or >${HI}×):`);
for (const { w, effDps } of wRows) {
  const r = effDps / wMed;
  if (r < LO || r > HI) console.log(`  ${padr(w.name, 10)} ${effDps.toFixed(1)} effDPS = ${r.toFixed(2)}× median  ${r > HI ? "↑ strong" : "↓ weak"}`);
}

// TTK matrix. Cells are time to kill the targeted enemy; a cluster weapon (A/P)
// kills CLUSTER_N at once, so its effective per-enemy clear time is roughly cell ÷ CLUSTER_N.
console.log(`\n--- TTK (seconds to kill, burst, hero baseline; A/P clear ~${CLUSTER_N}× at once) ---`);
const eShort = enemies.map((p) => p.name.slice(0, 4));
console.log(`${padr("weapon", 10)} ${eShort.map((s) => pad(s, 5)).join("")}`);
for (const { w } of wRows) {
  const cells = enemies.map((p) => pad(f1(ttkSeconds(w, p)), 5)).join("");
  console.log(`${padr(w.name, 10)} ${cells}`);
}

// Enemies.
console.log(`\n--- ENEMIES  (incoming DPS to hero, i-frame & resist applied) ---`);
console.log(`${padr("enemy", 11)} ${pad("hp", 4)} ${pad("ehp", 5)} ${pad("inDPS", 6)} ${pad("thrt", 5)} ${pad("DPS/t", 6)} ${pad("ehp/t", 6)} band`);
const enRows = enemies.map((p) => ({ p, inDps: incomingDps(p), dpsPerThreat: incomingDps(p) / p.threat, ehpPerThreat: p.ehp / p.threat }));
for (const { p, inDps, dpsPerThreat, ehpPerThreat } of enRows) {
  console.log(`${padr(p.name, 11)} ${pad(p.maxHp, 4)} ${pad(p.ehp.toFixed(0), 5)} ${pad(inDps.toFixed(1), 6)} ${pad(p.threat, 5)} ${pad(dpsPerThreat.toFixed(2), 6)} ${pad(ehpPerThreat.toFixed(1), 6)} ${p.band}`);
}
const dptMed = median(enRows.map((r) => r.dpsPerThreat));
const eptMed = median(enRows.map((r) => r.ehpPerThreat));
console.log(`median DPS/threat ${dptMed.toFixed(2)}, ehp/threat ${eptMed.toFixed(1)} — director-pricing outliers:`);
for (const { p, dpsPerThreat, ehpPerThreat } of enRows) {
  const rd = dpsPerThreat / dptMed, re = ehpPerThreat / eptMed;
  const notes = [];
  if (rd < LO || rd > HI) notes.push(`offense ${rd.toFixed(2)}×`);
  if (re < LO || re > HI) notes.push(`durability ${re.toFixed(2)}×`);
  if (notes.length) console.log(`  ${padr(p.name, 11)} ${notes.join(", ")} vs threat ${p.threat}`);
}

// Tension.
console.log(`\n--- TENSION  (hero TTD per depth band; target: tense but winnable) ---`);
console.log(`${pad("depth", 5)} ${pad("budget", 7)} ${pad("~foes", 6)} ${pad("rawDPS", 7)} ${pad("cap", 6)} ${pad("inDPS", 6)} ${pad("TTD", 6)}  note`);
for (const f of [0, 0.25, 0.5, 0.75, 1]) {
  const b = band(f);
  const note = b.capped ? "i-frame capped" : "uncapped";
  console.log(`${pad(f.toFixed(2), 5)} ${pad(b.budget.toFixed(0), 7)} ${pad(b.count.toFixed(1), 6)} ${pad(b.rawSum.toFixed(1), 7)} ${pad(b.ceiling.toFixed(1), 6)} ${pad(b.sustained.toFixed(1), 6)} ${pad(b.ttd.toFixed(1), 6)}  ${note}`);
}
console.log(`\n("tense but winnable" reads as: TTD in the tens of seconds at every band — not <5s (unfair`);
console.log(` burst death) and not >>run length ${RUN_LEN.toFixed(0)}s (trivial). TTD is a stand-and-fight floor; dodging raises it.)`);
console.log(``);
