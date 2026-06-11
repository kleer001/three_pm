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

  hero: { speed: 135, maxHp: 50, iframeDur: 0.8, r: 13, shotCD: 3, shotSpeed: 360, shotRange: 470, shotR: 6, shotDmg: 10 },

  // Enemy roster — spec 06's four families × tiers. One `behavior` per family
  // (chaser | swarmer | shooter | charger); tiers differ only in numbers, never
  // behavior. The slice's lethal rule stays freeze-to-kill (`freezesToKill`
  // slingshot hits), so `maxHp` is a real-but-secondary pool: the pebble chips it
  // and it shows as a damage bar, but freeze still does the killing until other
  // damage sources land. Casters (shooter) carry `maxMana`/`manaRegen`; the bolt
  // costs `manaCost`, so a tapped-out Cultist must hold and regen (spec 06: mana
  // only when manaCost > 0). `distanceBand` gates spawn depth; `threatValue` is
  // the director's budget cost. Enemies are slower than the hero except mid-lunge.
  enemies: {
    // Shamblers — chaser: steer straight at the hero, contact damage on overlap.
    shambler: { name: "Shambler", family: "shamblers", tier: 1, behavior: "chaser", speed: 100, r: 15, color: "#d35400", maxHp: 24, contactDamage: 6, repath: 0.4, freezesToKill: 2, threatValue: 1, distanceBand: 0.0 },
    ghoul:    { name: "Ghoul",    family: "shamblers", tier: 2, behavior: "chaser", speed: 108, r: 16, color: "#b34700", maxHp: 36, contactDamage: 9, repath: 0.4, freezesToKill: 3, threatValue: 2, distanceBand: 0.35 },
    revenant: { name: "Revenant", family: "shamblers", tier: 3, behavior: "chaser", speed: 116, r: 17, color: "#8c3500", maxHp: 52, contactDamage: 12, repath: 0.35, freezesToKill: 4, threatValue: 4, distanceBand: 0.6 },

    // Imps — swarmer: faster chaser with heading jitter so packs spread, not stack.
    imp:     { name: "Imp",     family: "imps", tier: 1, behavior: "swarmer", speed: 150, r: 11, color: "#8e44ad", maxHp: 12, contactDamage: 3, jitter: 0.5, repath: 0.5, freezesToKill: 1, threatValue: 1, distanceBand: 0.1 },
    hellpup: { name: "Hellpup", family: "imps", tier: 2, behavior: "swarmer", speed: 165, r: 12, color: "#6c3483", maxHp: 22, contactDamage: 5, jitter: 0.5, repath: 0.5, freezesToKill: 2, threatValue: 2, distanceBand: 0.45 },

    // Cultists — shooter: hold a preferred range, aim, lob a bolt (costs mana),
    // kite, cool down. Out of mana → hold and regen until it can cast again.
    acolyte:    { name: "Acolyte",    family: "cultists", tier: 1, behavior: "shooter", speed: 95, r: 13, color: "#27ae60", maxHp: 22, dmg: 7,  prefRange: 320, aim: 0.55, cooldown: 1.7, shot: 300, retreatFrac: 0.55, repath: 0.4, maxMana: 16, manaCost: 8, manaRegen: 2.0, freezesToKill: 2, threatValue: 3, distanceBand: 0.25 },
    zealot:     { name: "Zealot",     family: "cultists", tier: 2, behavior: "shooter", speed: 98, r: 14, color: "#1e8449", maxHp: 34, dmg: 10, prefRange: 340, aim: 0.5,  cooldown: 1.4, shot: 320, retreatFrac: 0.55, repath: 0.4, maxMana: 24, manaCost: 8, manaRegen: 3.0, freezesToKill: 3, threatValue: 4, distanceBand: 0.5 },
    hierophant: { name: "Hierophant", family: "cultists", tier: 3, behavior: "shooter", speed: 100, r: 15, color: "#145a32", maxHp: 46, dmg: 13, prefRange: 360, aim: 0.45, cooldown: 1.1, shot: 340, retreatFrac: 0.55, repath: 0.4, maxMana: 32, manaCost: 8, manaRegen: 4.0, freezesToKill: 4, threatValue: 6, distanceBand: 0.7 },

    // Brutes — charger: approach to lunge range, telegraph (the counterplay
    // window), then dash along a locked aim; a sidestep during the wind-up dodges
    // it. Lunge costs no mana (spec), so brutes carry no mana pool.
    brute:    { name: "Brute",    family: "brutes", tier: 1, behavior: "charger", speed: 90, r: 18, color: "#c0392b", maxHp: 44, contactDamage: 4, lungeRange: 180, telegraph: 0.6,  lungeSpeed: 520, lungeDur: 0.35, lungeDmg: 16, cooldown: 2.5, repath: 0.4, freezesToKill: 3, threatValue: 4, distanceBand: 0.4 },
    behemoth: { name: "Behemoth", family: "brutes", tier: 2, behavior: "charger", speed: 95, r: 20, color: "#922b21", maxHp: 72, contactDamage: 6, lungeRange: 200, telegraph: 0.55, lungeSpeed: 560, lungeDur: 0.38, lungeDmg: 22, cooldown: 2.3, repath: 0.4, freezesToKill: 5, threatValue: 7, distanceBand: 0.65 },
  },

  // Director: spends a depth-scaled live-threat budget on off-screen spawns.
  // budget(f) = baseThreat + f*threatSlope, monotonic in distance fraction f, so
  // threat density rises toward home. maxLive caps concurrent enemies (perf).
  director: { baseThreat: 4, threatSlope: 16, tickInterval: 0.5, spawnBandTiles: 8, maxLive: 40 },

  spawnMinTileY: 9, // don't spawn enemies in the player's opening rows
  waypointArrive: 5, // px tolerance for "reached the path node"
  softBodyPush: 0.5, // share of overlap each of two living bodies yields when separating
  enemyShotLife: 2.5, // s an enemy projectile lives before fizzling
  heroShotLife: 2, // s a slingshot pebble lives before fizzling
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
  heroShot: "#d8d4c8",
  freeze: { fill: "rgba(150,205,255,0.55)", ring: "rgba(190,230,255,0.9)", ringPad: 2 },
  rangedTelegraph: { ring: "rgba(39,174,96,0.9)", line: "rgba(39,174,96,0.5)", ringPad: 5 },
  chargerTelegraph: { ring: "rgba(231,76,60,0.85)", line: "rgba(231,76,60,0.6)", lunge: "rgba(255,120,90,0.9)", ringPad: 6 },
  hero: { hit: "#7fb3ff", normal: "#2d6cdf" },
  bar: { back: "rgba(0,0,0,0.5)", hp: "#e74c3c", mana: "#3498db", tapped: "rgba(52,152,219,0.25)", w: 26, h: 3, gap: 2 },
  hud: { font: "14px system-ui, sans-serif", box: "rgba(255,255,255,0.75)", text: "#111" },
  overlay: { bg: "rgba(0,0,0,0.6)", fg: "#fff", titleFont: "32px system-ui, sans-serif", subFont: "16px system-ui, sans-serif" },
};
