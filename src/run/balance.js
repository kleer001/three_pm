// Designer-facing tuning data, isolated from game logic. Pure data, no imports —
// keeping the import graph acyclic (levelgen.js and runScene.js read from here;
// this module reads from nothing). Tweak balance and look here, not in code paths.
//
// Deliberately NOT externalized to TOML/JSON: the game ships with no build step
// and no dependencies, so a runtime parser + async fetch() would cost more than
// it buys. A plain ES module is import-time, synchronous, and node-testable.

// Gameplay tuning: pacing, hero, enemy archetypes, spawn counts, and the
// formerly-inline combat/movement constants.
export const BALANCE = {
  scroll: 55, // px/s the window descends — forces the player down
  mapH: 192, // map height in tiles (4x the descent length to get home)
  freezeDur: 2.5, // how long a slingshot hit immobilizes an enemy

  // Brown-wall-feature knobs (difficulty / level shape). Scale stretches feature
  // shape (X×Y); density scales how much obstacle there is overall.
  wall: { scaleX: 1, scaleY: 2, density: 0.5 },

  // Spec 03 stat→derived constants. Each actor carries four 1–10 base stats
  // (5 = baseline = Marvin); recomputeDerived (combat.js) maps them to gameplay
  // values via these. Chosen so Marvin lands near the old hand-tuned hero, then
  // re-tuned by playtest. moveSpeed = BASE_SPEED*(speedBase + speedPerLvl*speed).
  derive: {
    BASE_SPEED: 135, speedBase: 0.55, speedPerLvl: 0.09,
    BASE_HP: 10, HP_PER_CON: 8,             // maxHp     = BASE_HP + constitution*HP_PER_CON
    RESIST_PER_CON: 0.035, RESIST_CAP: 0.5, // dmgResist = min(cap, constitution*per)  → % incoming reduction
    KB_PER_STR: 4,                          // knockback = strength*KB_PER_STR  (× an attack's knockback size)
    BASE_MANA: 15, MANA_PER_MAG: 5,         // maxMana   = BASE_MANA + magic*MANA_PER_MAG
    BASE_AP: 0.5, AP_PER_MAG: 0.1,          // abilityPower = BASE_AP + magic*AP_PER_MAG  (magic dmg ×AP)
  },

  // Hero (Marvin): baseline 5/5/5/5. Movement, HP, mana, resist, knockback all
  // come from recomputeDerived; only authored extras (i-frame window, radius,
  // mana regen) and faction live here.
  hero: { stats: { speed: 5, constitution: 5, strength: 5, magic: 5 }, faction: "player", iframeDur: 0.8, r: 13, manaRegen: 8 },

  // Player arsenal — all are offered on the select screen each run; one is fired
  // on SPACE (auto-aimed). `shape` picks the delivery: `projectile` flies and hits
  // the first enemy (slingshot/hex) or pierces a line (`pierce`); `nova` bursts
  // around the hero; `bomb` lobs and detonates an area on impact; `field` drops a
  // lingering damage zone. `damage` is a spec-04 attack (base+stat*ratio ×AP for
  // magic, plus percent-HP terms) resolved against the hero's stats; `manaCost`
  // spends the hero pool; `freeze`/`knockback` are on-hit effects.
  weapons: {
    slingshot: { name: "Slingshot", shape: "projectile", cd: 0.5, speed: 360, range: 470, shotR: 6, life: 2, freeze: true,  manaCost: 0,  knockback: 0, damage: { scaling: "strength", base: 0, ratio: 1.0, pctMax: 0.5, pctCur: 0 },   desc: "50% max HP + str · freezes" },
    // 40% of current HP front-loads the chunk; the magic-scaled flat lets it finish
    // (a pure %-current weapon asymptotes and never kills).
    hex:       { name: "Hex",       shape: "projectile", cd: 1.2, speed: 300, range: 420, shotR: 6, life: 2, freeze: false, manaCost: 10, knockback: 0, damage: { scaling: "magic",    base: 2, ratio: 0.4, pctMax: 0, pctCur: 0.4 },  desc: "40% current HP + magic · costs mana" },
    // Beam: a piercing projectile — hits every enemy along its line, once each.
    beam:      { name: "Beam",       shape: "projectile", pierce: true, cd: 1.5, speed: 520, range: 520, shotR: 6, life: 1.2, freeze: false, manaCost: 12, knockback: 0, damage: { scaling: "strength", base: 4, ratio: 0.8, pctMax: 0.18, pctCur: 0 }, desc: "pierces a whole line" },
    // Nova: an instant burst centered on the hero — clears a closing swarm.
    nova:      { name: "Nova",       shape: "nova", cd: 4, radius: 130, freeze: false, manaCost: 16, knockback: 1.5, damage: { scaling: "strength", base: 6, ratio: 1.0, pctMax: 0.12, pctCur: 0 }, desc: "burst around you + knockback" },
    // Bomb: lobbed at the nearest enemy, detonates an area on impact/expiry.
    bomb:      { name: "Bomb",       shape: "bomb", cd: 2.5, speed: 320, range: 460, shotR: 7, life: 1.6, radius: 95, freeze: false, manaCost: 14, knockback: 1, damage: { scaling: "magic", base: 5, ratio: 0.8, pctMax: 0.15, pctCur: 0 }, desc: "lobbed area blast" },
    // Field: a lingering zone dropped on the hero — ticks damage, denies ground.
    field:     { name: "Hex Field",  shape: "field", cd: 5, range: 420, radius: 90, lifespan: 4, tickInterval: 0.4, freeze: false, manaCost: 20, knockback: 0, damage: { scaling: "magic", base: 2, ratio: 0.3, pctMax: 0.04, pctCur: 0 }, desc: "lingering damage zone" },
  },

  // Enemy roster — spec 06's four families × tiers, now on the spec-03 stat model:
  // each def carries 1–10 `stats` (levels from spec 06) that recomputeDerived turns
  // into moveSpeed/maxHp/dmgResist/knockback/maxMana. Tiers raise the stats (tankier,
  // hit harder, resist more), never the behavior. `contactDamage` is flat overlap
  // damage; shooters/chargers carry a spec-04 `attack` (base+stat*ratio) the brain
  // fires. `distanceBand` gates spawn depth; `threatValue` is the director's cost.
  enemies: {
    // Shamblers — chaser: steer straight at the hero, contact damage on overlap.
    shambler: { name: "Shambler", family: "shamblers", tier: 1, behavior: "chaser", stats: { speed: 3, constitution: 4, strength: 4, magic: 1 }, r: 15, color: "#d35400", contactDamage: 6,  repath: 0.4,  freezesToKill: 2, threatValue: 1, distanceBand: 0.0 },
    ghoul:    { name: "Ghoul",    family: "shamblers", tier: 2, behavior: "chaser", stats: { speed: 4, constitution: 6, strength: 5, magic: 1 }, r: 16, color: "#b34700", contactDamage: 9,  repath: 0.4,  freezesToKill: 3, threatValue: 2, distanceBand: 0.35 },
    revenant: { name: "Revenant", family: "shamblers", tier: 3, behavior: "chaser", stats: { speed: 4, constitution: 8, strength: 6, magic: 1 }, r: 17, color: "#8c3500", contactDamage: 12, repath: 0.35, freezesToKill: 4, threatValue: 4, distanceBand: 0.6 },

    // Imps — swarmer: faster chaser with heading jitter so packs spread, not stack.
    imp:     { name: "Imp",     family: "imps", tier: 1, behavior: "swarmer", stats: { speed: 7, constitution: 2, strength: 2, magic: 1 }, r: 11, color: "#8e44ad", contactDamage: 3, jitter: 0.5, repath: 0.5, freezesToKill: 1, threatValue: 1, distanceBand: 0.1 },
    hellpup: { name: "Hellpup", family: "imps", tier: 2, behavior: "swarmer", stats: { speed: 7, constitution: 4, strength: 3, magic: 1 }, r: 12, color: "#6c3483", contactDamage: 5, jitter: 0.5, repath: 0.5, freezesToKill: 2, threatValue: 2, distanceBand: 0.45 },

    // Cultists — shooter: hold range, aim, lob a magic bolt (base+magic*ratio ×AP,
    // costs mana), kite, cool down. Out of mana → hold and regen.
    acolyte:    { name: "Acolyte",    family: "cultists", tier: 1, behavior: "shooter", stats: { speed: 4, constitution: 3, strength: 2, magic: 6 }, r: 13, color: "#27ae60", contactDamage: 0, attack: { scaling: "magic", base: 5, ratio: 0.6, manaCost: 14 }, prefRange: 320, aim: 0.55, cooldown: 1.7, shot: 300, retreatFrac: 0.55, repath: 0.4, manaRegen: 6, freezesToKill: 2, threatValue: 3, distanceBand: 0.25 },
    zealot:     { name: "Zealot",     family: "cultists", tier: 2, behavior: "shooter", stats: { speed: 4, constitution: 5, strength: 2, magic: 7 }, r: 14, color: "#1e8449", contactDamage: 0, attack: { scaling: "magic", base: 6, ratio: 0.7, manaCost: 14 }, prefRange: 340, aim: 0.5,  cooldown: 1.4, shot: 320, retreatFrac: 0.55, repath: 0.4, manaRegen: 7, freezesToKill: 3, threatValue: 4, distanceBand: 0.5 },
    hierophant: { name: "Hierophant", family: "cultists", tier: 3, behavior: "shooter", stats: { speed: 4, constitution: 7, strength: 2, magic: 9 }, r: 15, color: "#145a32", contactDamage: 0, attack: { scaling: "magic", base: 7, ratio: 0.8, manaCost: 14 }, prefRange: 360, aim: 0.45, cooldown: 1.1, shot: 340, retreatFrac: 0.55, repath: 0.4, manaRegen: 8, freezesToKill: 4, threatValue: 6, distanceBand: 0.7 },

    // Brutes — charger: approach to lunge range, telegraph (the counterplay window),
    // then dash along a locked aim and slam (strength attack + large knockback).
    brute:    { name: "Brute",    family: "brutes", tier: 1, behavior: "charger", stats: { speed: 4, constitution: 7, strength: 7, magic: 1 }, r: 18, color: "#c0392b", contactDamage: 4, attack: { scaling: "strength", base: 12, ratio: 1.2, knockback: 2 }, lungeRange: 180, telegraph: 0.6,  lungeSpeed: 520, lungeDur: 0.35, cooldown: 2.5, repath: 0.4, freezesToKill: 3, threatValue: 4, distanceBand: 0.4 },
    behemoth: { name: "Behemoth", family: "brutes", tier: 2, behavior: "charger", stats: { speed: 4, constitution: 9, strength: 8, magic: 1 }, r: 20, color: "#922b21", contactDamage: 6, attack: { scaling: "strength", base: 14, ratio: 1.3, knockback: 2 }, lungeRange: 200, telegraph: 0.55, lungeSpeed: 560, lungeDur: 0.38, cooldown: 2.3, repath: 0.4, freezesToKill: 5, threatValue: 7, distanceBand: 0.65 },
  },

  // Director: spends a depth-scaled live-threat budget on off-screen spawns.
  // budget(f) = baseThreat + f*threatSlope, monotonic in distance fraction f, so
  // threat density rises toward home. maxLive caps concurrent enemies (perf).
  director: { baseThreat: 4, threatSlope: 16, tickInterval: 0.5, spawnBandTiles: 8, maxLive: 40 },

  spawnMinTileY: 9, // don't spawn enemies in the player's opening rows
  waypointArrive: 5, // px tolerance for "reached the path node"
  softBodyPush: 0.5, // share of overlap each of two living bodies yields when separating
  enemyShotLife: 2.5, // s an enemy projectile lives before fizzling
  enemyShotHitPad: 5, // px added to hero radius for enemy-projectile hits
};

// Suburb generator tuning (consumed by levelgen.js). Algorithm structure (BFS,
// blur kernel, tile enum, API param defaults) stays in code; only the knobs live here.
export const LEVELGEN = {
  streetPeriod: 10, // tiles between grid streets
  streetJitter: 2, // ± tiles each street wanders from the grid line
  houseMargin: 2, // skip this many tiles in from each edge when dropping houses
  houseChanceBase: 0.012, // per-cell house-seed probability at density 1
  houseSize: { min: 4, max: 6 }, // house footprint range (rng.range is inclusive-ish)
  decayPasses: 3, // box-blur passes that coalesce noise into rubble blobs
  coverBase: 0.42, // obstacle coverage at density 1
  coverCap: 0.95, // hard ceiling on obstacle coverage
  clearLaneLen: 6, // tiles of guaranteed clear lane forward from the start
  clearLaneHalfWidth: 1, // lane half-width (1 => 3-wide)
};

// Presentation. THEME.tile is indexed by tile id (order matches TILE in
// levelgen.js: STREET, SIDEWALK, YARD, ALLEY, FLOOR, WALL, RUBBLE) — an array
// rather than a TILE-keyed map so this module imports nothing.
export const THEME = {
  tile: ["#5a5a5a", "#9a9a9a", "#6f9a55", "#4a4a4a", "#caa37a", "#2e2e2e", "#7c6a55"],
  obstacleDarken: "rgba(0,0,0,0.4)", // darken obstacles so collision is legible
  homeBand: "rgba(255,215,0,0.35)",
  corpse: "#2b2622",
  enemyShot: { r: 5, color: "#145a32" },
  weaponShot: { slingshot: "#d8d4c8", hex: "#9b59b6", beam: "#1abc9c", bomb: "#e67e22", nova: "#f5d76e", field: "#8e44ad" }, // weapon color (shot + select swatch), keyed by id
  blast: { ring: "rgba(255,240,200,0.85)", dur: 0.28 }, // expanding ring for nova/bomb detonations
  field: { fill: "rgba(155,89,182,0.16)", ring: "rgba(155,89,182,0.45)" }, // lingering zone disc
  freeze: { fill: "rgba(150,205,255,0.55)", ring: "rgba(190,230,255,0.9)", ringPad: 2 },
  rangedTelegraph: { ring: "rgba(39,174,96,0.9)", line: "rgba(39,174,96,0.5)", ringPad: 5 },
  chargerTelegraph: { ring: "rgba(231,76,60,0.85)", line: "rgba(231,76,60,0.6)", lunge: "rgba(255,120,90,0.9)", ringPad: 6 },
  hero: { hit: "#7fb3ff", normal: "#2d6cdf" },
  bar: { back: "rgba(0,0,0,0.5)", hp: "#e74c3c", mana: "#3498db", tapped: "rgba(52,152,219,0.25)", w: 26, h: 3, gap: 2 },
  hud: { font: "14px system-ui, sans-serif", box: "rgba(255,255,255,0.75)", text: "#111" },
  overlay: { bg: "rgba(0,0,0,0.6)", fg: "#fff", titleFont: "32px system-ui, sans-serif", subFont: "16px system-ui, sans-serif" },
  select: { bg: "#161616", title: "#fff", card: "#262626", cardActive: "#3a3a3a", border: "#6aa9ff", name: "#fff", desc: "#bbb", hint: "#999",
    titleFont: "28px system-ui, sans-serif", nameFont: "20px system-ui, sans-serif", descFont: "14px system-ui, sans-serif", hintFont: "14px system-ui, sans-serif" },
};
