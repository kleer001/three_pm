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

  hero: { speed: 135, maxHp: 50, iframeDur: 0.8, r: 13, shotCD: 3, shotSpeed: 360, shotRange: 470, shotR: 6 },

  // Enemies are slower than the hero (dodgeable) and stop to attack.
  kind: {
    // Stops and hits with a stick: chase, then windup -> strike -> recover.
    melee:    { speed: 110, maxHp: 30, r: 15, color: "#d35400", dmg: 10, range: 64, windup: 0.45, recover: 0.6, repath: 0.4 },
    // Stops to take potshots: approach to range, aim, fire a projectile, cool down.
    ranged:   { speed: 95,  maxHp: 18, r: 13, color: "#27ae60", dmg: 7, prefRange: 320, aim: 0.55, cooldown: 1.7, shot: 300, repath: 0.4 },
    // Ambient roamer; light contact damage.
    wanderer: { speed: 120, maxHp: 12, r: 11, color: "#8e44ad", contact: 4 },
  },
  spawn: { melee: 10, ranged: 7, wanderer: 8 },

  spawnMinTileY: 9, // don't spawn enemies in the player's opening rows
  waypointArrive: 5, // px tolerance for "reached the path node"
  wandererRoam: 12, // tile radius a wanderer picks its next idle target within
  meleeHitPad: 14, // px added to melee range when resolving a connecting strike
  rangedRetreatFrac: 0.55, // ranged enemy backs off when within this fraction of prefRange
  softBodyPush: 0.5, // share of overlap each of two living bodies yields when separating
  enemyShotLife: 2.5, // s an enemy projectile lives before fizzling
  heroShotLife: 2, // s a slingshot pebble lives before fizzling
  freezesToKill: 2, // freezes needed to finish an enemy
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
  meleeTelegraph: "rgba(231,76,60,0.7)",
  rangedTelegraph: { ring: "rgba(39,174,96,0.9)", line: "rgba(39,174,96,0.5)", ringPad: 5 },
  hero: { hit: "#7fb3ff", normal: "#2d6cdf" },
  hud: { font: "14px system-ui, sans-serif", box: "rgba(255,255,255,0.75)", text: "#111" },
  overlay: { bg: "rgba(0,0,0,0.6)", fg: "#fff", titleFont: "32px system-ui, sans-serif", subFont: "16px system-ui, sans-serif" },
};
