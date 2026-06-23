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
    KB_PER_STR: 3.3,                        // knockback = strength*KB_PER_STR  (× an attack's knockback size)
    BASE_MANA: 15, MANA_PER_MAG: 5,         // maxMana   = BASE_MANA + magic*MANA_PER_MAG
    BASE_AP: 0.5, AP_PER_MAG: 0.1,          // abilityPower = BASE_AP + magic*AP_PER_MAG  (magic dmg ×AP)
  },

  // Hero (Marvin): baseline 5/5/5/5. Movement, HP, mana, resist, knockback all
  // come from recomputeDerived; only authored extras (i-frame window, radius,
  // mana regen) and faction live here.
  hero: { stats: { speed: 5, constitution: 5, strength: 5, magic: 5 }, faction: "player", iframeDur: 0.8, r: 13, manaRegen: 8 },

  // Follower-train physics (spec-18 party, slice stand-in): hero clones that trail one
  // tile back, auto-fire their own weapon, and permadie (HP gone or crushed by the dark).
  // `iframeDur` is shorter than the hero's 0.8s so they chip faster — but non-zero,
  // because enemy contact damage applies every frame on overlap and would otherwise
  // instakill. `gapTiles` is the center-to-center spacing along the trail. (The party
  // itself is chosen from `roster` below — these are just the trailing knobs.)
  follower: { iframeDur: 0.4, gapTiles: 1, manaRegen: 8 },

  // The nine (docs/19): one hero per electronic genre, the merged cast. `weaponId`
  // is the basic (auto-fired); `signatureId` keys the genre signature (own cooldown,
  // fired from the hero/segment). `stats` are 1–10 (5 = Marvin baseline); `color` is
  // the body disc until sprites land (matches the look-bible portrait field). The five
  // carried-over heroes unlock at 0; the four new ones gate by run count. The party-
  // select reads this generically; the chosen party is the in-run head (party[0]) + train.
  partyMax: 5,
  // Global throttle on every player-side fire rate (head, followers, deployed turrets):
  // each weapon/signature `cd` is multiplied by this when it fires. >1 slows the party's
  // collective DPS so a big auto-firing train doesn't trivially out-pace the director.
  heroFireCooldownMult: 1.2,
  roster: [
    { id: "marvin",    name: "Marvin",    genre: "House",      color: "#f5c518", weaponId: "slingshot", signatureId: "good_vibes",   stats: { speed: 5, constitution: 5, strength: 5, magic: 5 }, unlockAtRuns: 0 },
    { id: "chad",      name: "Chad",      genre: "Industrial", color: "#e8743b", weaponId: "cleave",    signatureId: "mosh_pit",     stats: { speed: 5, constitution: 8, strength: 8, magic: 2 }, unlockAtRuns: 1 },
    { id: "dash",      name: "Dash",      genre: "Psytrance",  color: "#d6336c", weaponId: "redline",   signatureId: "dust_devil",   stats: { speed: 9, constitution: 3, strength: 5, magic: 3 }, unlockAtRuns: 2 },
    { id: "wendolyn",  name: "Wendolyn",  genre: "Dubtechno",  color: "#0b7285", weaponId: "hex",       signatureId: "deep_freeze",  stats: { speed: 5, constitution: 3, strength: 2, magic: 9 }, unlockAtRuns: 3 },
    { id: "eugene",    name: "Eugene",    genre: "Techno",     color: "#4dabf7", weaponId: "bomb",      signatureId: "drum_machine", stats: { speed: 4, constitution: 5, strength: 3, magic: 7 }, unlockAtRuns: 4 },
    { id: "jess",      name: "Jess",      genre: "Trance",     color: "#e64980", weaponId: "nova",      signatureId: "the_drop",     stats: { speed: 5, constitution: 5, strength: 4, magic: 7 }, unlockAtRuns: 5 },
    { id: "zigzag",    name: "ZigZag",    genre: "Acid",       color: "#82c91e", weaponId: "beam",      signatureId: "bad_trip",     stats: { speed: 6, constitution: 4, strength: 3, magic: 7 }, unlockAtRuns: 6 },
    { id: "jasper",    name: "Jasper",    genre: "Ambient",    color: "#b197fc", weaponId: "switchblade", signatureId: "dead_air",   stats: { speed: 4, constitution: 6, strength: 3, magic: 6 }, unlockAtRuns: 7 },
    { id: "valentine", name: "Valentine", genre: "Synthwave",  color: "#cc5de8", weaponId: "whirl",     signatureId: "flashback",    stats: { speed: 6, constitution: 5, strength: 4, magic: 6 }, unlockAtRuns: 8 },
  ],

  // Hero signatures (docs/19): one genre kit each, auto-fired from the hero/segment on
  // its own cooldown (`sigCd`), separate from the basic weapon. Same spec-04 attack
  // schema as `weapons` plus net-new shapes: `heal` (passive HP regen, no fire),
  // `deploy` (drop a persistent turret), `confuse` (turn enemies on each other),
  // `charge` (build a meter from damage, release a nova). `slow`/`slowDur` add the
  // enemy move-speed debuff; `fuse` delays a bomb's detonation.
  signatures: {
    mosh_pit:     { name: "Mosh Pit",     shape: "nova", cd: 3.5, radius: 120, freeze: false, manaCost: 0,  knockback: 3, damage: { scaling: "strength", base: 7, ratio: 0.8, pctMax: 0.08, pctCur: 0 } },
    deep_freeze:  { name: "Deep Freeze",  shape: "nova", cd: 6, radius: 130, freeze: true, manaCost: 12, knockback: 1, damage: { scaling: "magic", base: 3, ratio: 0.3, pctMax: 0, pctCur: 0 } },
    flashback:    { name: "Flashback",    shape: "bomb", cd: 2.2, speed: 300, range: 440, shotR: 6, life: 1.4, radius: 150, fuse: 1.6, freeze: false, manaCost: 6, knockback: 1, impact: { scaling: "magic", base: 2, ratio: 0.2 }, damage: { scaling: "magic", base: 6, ratio: 0.7, pctMax: 0.12, pctCur: 0 } },
    // Jasper's trailing passive (Ambient): a lingering damage zone he leaves behind. Named for
    // the genre (not "Hex Field" — that's the occult arsenal weapon, Wendolyn's lane).
    dead_air:     { name: "Dead Air",     shape: "field", cd: 6, range: 420, radius: 90, lifespan: 4, tickInterval: 0.4, freeze: false, manaCost: 20, knockback: 0, damage: { scaling: "magic", base: 2, ratio: 0.3, pctMax: 0.04, pctCur: 0 } },
    // Dash's trailing passive (Psytrance): a movement-emitted dust trail — expanding/fading puffs
    // that slow enemies in them ("eat my dust"). `wake` is emission-based (no cd/mana): tickWake
    // drops a puff every `emitDist` px travelled; stepDustPuffs ages them, refreshes the slow, and
    // chips magic-scaled damage on `tickInterval` (negligible at base magic, grows with the Grit
    // upgrade — control that can be invested into damage).
    dust_devil:   { name: "Dust Devil",   shape: "wake", slow: 0.55, slowDur: 0.4, puffR: 26, emitDist: 18, life: 0.6, tickInterval: 0.3, damage: { scaling: "magic", base: 0, ratio: 0.15, pctMax: 0.01, pctCur: 0 } },
    good_vibes:   { name: "Good Vibes",   shape: "heal", hpPerSec: 1.6 },
    drum_machine: { name: "Drum Machine", shape: "deploy", cd: 4, manaCost: 16, maxActive: 2, life: 8, turretId: "slingshot" },
    bad_trip:     { name: "Bad Trip",     shape: "confuse", cd: 6, radius: 150, confuseDur: 2.5, manaCost: 14 },
    the_drop:     { name: "The Drop",     shape: "charge", radius: 150, threshold: 28, freeze: false, manaCost: 0, knockback: 4, takenScale: 0.35, trickle: 8, damage: { scaling: "magic", base: 7, ratio: 0.4, pctMax: 0.06, pctCur: 0 } },
  },

  // Player arsenal — all are offered on the select screen each run; one is fired
  // on SPACE (auto-aimed). `shape` picks the delivery: `projectile` flies and hits
  // the first enemy (slingshot/hex) or pierces a line (`pierce`); `nova` bursts
  // around the hero; `bomb` lobs and detonates an area on impact; `field` drops a
  // lingering damage zone. `damage` is a spec-04 attack (base+stat*ratio ×AP for
  // magic, plus percent-HP terms) resolved against the hero's stats; `manaCost`
  // spends the hero pool; `freeze`/`knockback` are on-hit effects.
  weapons: {
    // Strength-scaled damage, but now mana-fuelled. At the real fire rate (~1.67/s after the
    // 1.2× heroFireCooldownMult) manaCost 6 drains ~10/s against the hero's 8/s regen, so a
    // full 40 pool gives ~20s of continuous freeze before it eases to a regen-limited ~1.3/s
    // (vs the ~1.67/s cd cap) — a gentle throttle, never a hard lockout. Bump toward 8 if it
    // needs to bite sooner. This finally puts Marvin's magic stat (maxMana) — and his
    // `honor_roll` track — to work; keep damage on strength so all four of his stats stay live.
    slingshot: { name: "Slingshot", shape: "projectile", cd: 0.5, speed: 360, range: 470, shotR: 3, life: 2, freeze: true,  manaCost: 6,  knockback: 1, persist: true, damage: { scaling: "strength", base: 0, ratio: 1.0, pctMax: 1 / 3, pctCur: 0 },   desc: "⅓ max HP + str · freezes · costs mana" },
    // 40% of current HP front-loads the chunk; the magic-scaled flat lets it finish
    // (a pure %-current weapon asymptotes and never kills).
    hex:       { name: "Hex",       shape: "projectile", cd: 1.2, speed: 300, range: 420, shotR: 6, life: 2, freeze: false, manaCost: 10, knockback: 0, damage: { scaling: "magic",    base: 2, ratio: 0.4, pctMax: 0, pctCur: 0.4 },  desc: "40% current HP + magic · costs mana" },
    // Beam: a piercing projectile — hits every enemy along its line, once each. Magic-scaled
    // (ZigZag's stat): base/ratio trimmed from the old strength values because magic damage
    // runs through abilityPower (~1.2 at magic 7).
    beam:      { name: "Beam",       shape: "projectile", pierce: true, cd: 1.5, speed: 520, range: 520, shotR: 6, life: 1.2, freeze: false, manaCost: 12, knockback: 0, damage: { scaling: "magic", base: 2, ratio: 0.5, pctMax: 0.18, pctCur: 0 }, desc: "pierces a whole line" },
    // Nova: an instant burst centered on the hero — clears a closing swarm. Magic-scaled
    // (Jess's stat); base/ratio trimmed for the abilityPower multiplier.
    nova:      { name: "Nova",       shape: "nova", cd: 4, radius: 130, freeze: false, manaCost: 16, knockback: 4.5, damage: { scaling: "magic", base: 3, ratio: 0.6, pctMax: 0.12, pctCur: 0 }, desc: "burst around you + big knockback" },
    // Bomb: lobbed at the nearest enemy, detonates an area on impact/expiry.
    bomb:      { name: "Bomb",       shape: "bomb", cd: 2.5, speed: 320, range: 460, shotR: 7, life: 1.6, radius: 190, freeze: false, manaCost: 14, knockback: 1, damage: { scaling: "magic", base: 5, ratio: 0.8, pctMax: 0.15, pctCur: 0 }, desc: "lobbed area blast" },
    // Field: a lingering zone dropped on the hero — ticks damage, denies ground.
    field:     { name: "Hex Field",  shape: "field", cd: 5, range: 420, radius: 90, lifespan: 4, tickInterval: 0.4, freeze: false, manaCost: 20, knockback: 0, damage: { scaling: "magic", base: 2, ratio: 0.3, pctMax: 0.04, pctCur: 0 }, desc: "lingering damage zone" },
    // Redline: Dash's rapid-fire head weapon (Psytrance). Kept light per his control identity —
    // a fast peashooter, with a tiny %-max term so it isn't useless against tanks.
    redline: { name: "Redline", shape: "projectile", cd: 0.20, speed: 540, range: 360, shotR: 4, life: 0.8, freeze: false, manaCost: 0, knockback: 0, damage: { scaling: "strength", base: 1, ratio: 0.4, pctMax: 0.04, pctCur: 0 }, desc: "rapid-fire spray" },
    // Switchblade: Jasper's short, tight melee (Ambient). MAGIC-scaled so his magic stat drives
    // it (a strength clone would ride his dump stat); small %-max keeps it honest vs tanks.
    switchblade: { name: "Switchblade", shape: "melee-arc", cd: 0.5, radius: 70, arc: 50, freeze: false, manaCost: 4, knockback: 1, damage: { scaling: "magic", base: 3, ratio: 0.7, pctMax: 0.08, pctCur: 0 }, desc: "quick magic shank" },
    // Melee — `arc` degrees of swing at short `radius` reach, auto-aimed at the
    // nearest enemy (360 = full circle). Free, strength-scaled, knockback-heavy:
    // you trade reach (into contact range) for raw burst. Reuse the AoE blast path.
    bat:    { name: "Bat",    shape: "melee-arc", cd: 0.8,  radius: 67, arc: 110, freeze: false, manaCost: 0, knockback: 1,   damage: { scaling: "strength", base: 6.8, ratio: 1.19, pctMax: 0.068, pctCur: 0 }, desc: "wide swing" },
    cleave: { name: "Cleave", shape: "melee-arc", cd: 0.9,  radius: 64, arc: 130, freeze: false, manaCost: 0, knockback: 2.5, damage: { scaling: "strength", base: 14, ratio: 1.8, pctMax: 0.10, pctCur: 0 }, desc: "heavy hit + big knockback" },
    spear:  { name: "Spear",  shape: "melee-arc", cd: 0.45, radius: 84, arc: 45,  freeze: false, manaCost: 0, knockback: 1,   damage: { scaling: "strength", base: 7,  ratio: 1.2, pctMax: 0.06, pctCur: 0 }, desc: "long narrow thrust" },
    // `autofire: "cooldown"` (default is "range", i.e. only fire when a target is
    // in reach/range) — Whirl is free, aimless, and centered on you, so it spins
    // every cooldown as constant area denial rather than waiting for contact.
    whirl:  { name: "Whirl",  shape: "melee-arc", cd: 0.8,  radius: 60, arc: 360, freeze: false, manaCost: 0, knockback: 1.5, autofire: "cooldown", damage: { scaling: "strength", base: 9,  ratio: 1.3, pctMax: 0.09, pctCur: 0 }, desc: "360° spin around you" },
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
  // partyThreatScale: adaptive-difficulty sensitivity — how hard the budget leans on
  // the party's aggregate-HP strength (see director.threatMult). 0 = ignore party
  // state (flat baseline); higher = steeper ramp up when healthy / off when hurt.
  // partyThreatFloor caps how far a battered party can drop the threat.
  director: { baseThreat: 4, threatSlope: 16, tickInterval: 0.5, spawnBandTiles: 8, maxLive: 40, partyThreatScale: 1.0, partyThreatFloor: 0.6 },

  // In-run powerups (spec 07): kills pay cash and may drop a powerup pickup; cash
  // is spent at shop spots. Drops/stock draw from one shuffled bag on the `loot` RNG
  // sub-stream, so they're reproducible per seed, independent of gen/spawns, and
  // never repeat an item within a run.
  loot: {
    cashPerKill: 2, cashPerThreat: 1,          // cash = base + threatValue*per (sets the displayed scale, not balance)
    dropChanceBase: 0.05, dropChancePerThreat: 0.02, // powerup-drop chance scales with threat
    // Reactive market: a shop quotes each item as a fraction of the player's
    // cash-on-hand, locked in when they reach the stall (see runScene). Rates by
    // rarity; one-of-each-tier sums to >1 so a 3-item stall can't be fully cleared.
    priceRate: { common: 0.20, uncommon: 0.35, rare: 0.55 },
    priceFloor: 8,                              // a broke wallet still pays something real
    pickupR: 13, pickupBob: 3, pickupBobRate: 4, // pickup radius + idle bob (px / rad·s)
    splitSpread: 0.16,                          // radians between split-shot projectiles
    minCd: 0.1,                                 // floor on weapon cooldown after stacks
  },
  // Shops: N spots scattered down the descent (one per depth band), each offering a
  // single rolled powerup at its `cost`. minTileY keeps the first shop past the
  // opening rows; bandMargin insets each band so spots don't crowd the edges.
  shop: { count: 4, minTileY: 16, r: 18, stock: 3 }, // items offered per shop (player picks at a paused stall)

  // Knockback rides out over a few frames instead of teleporting: the impulse is
  // split across `min`..`max` frames, more frames for a higher-maxHp target (heavier
  // bodies carry the shove longer). `hpAtMax` is the maxHp that earns the full count.
  // After a shove an enemy is fully stopped for `pause{Min..Max}` frames, then ramps
  // from a near-stop back to full locomotion over `stagger{Min..Max}` frames (bigger
  // bodies pause and recover longer).
  knockback: { min: 6, max: 9, hpAtMax: 80, pauseMin: 8, pauseMax: 11.2, staggerMin: 6, staggerMax: 10 },

  spawnMinTileY: 9, // don't spawn enemies in the player's opening rows
  waypointArrive: 5, // px tolerance for "reached the path node"
  softBodyPush: 0.5, // share of overlap each of two living bodies yields when separating
  // Multiplier on a stray follower's OWN derived.moveSpeed when re-homing to its
  // trail point: the cap on how fast it closes a gap opened by a shove (or by a
  // faster head out-running it). >1 lets an equal-speed follower keep formation
  // and recover from small shoves; a genuinely slower follower still lags.
  followerReturnSpeedMult: 1.2,
  heroCrowdYield: 0.15, // hero's share of overlap when an enemy pushes it (a crowd slows it)
  spawnFade: 0.25, // seconds a hero takes to fade in (in its own color) when it materializes;
                   // it's intangible (can't be hit) while fading
  enemyShotLife: 2.5, // s an enemy projectile lives before fizzling
  enemyShotHitPad: 5, // px added to hero radius for enemy-projectile hits
  // A ball shot that flies into a reality break (void/RUBBLE) doesn't die at the edge —
  // it drifts in, decelerating (drag) and shrinking (shrink, both per-second e-fold rates)
  // until it's a single pixel (minR), then it's swallowed. Walls still block normally.
  voidFall: { drag: 4, shrink: 3.2, minR: 0.5 },
  // A reality break tugs nearby corpses in: a dead body within rangeTiles of a hole
  // accelerates toward the nearest one (accel px/s²), then is swallowed into the void-fall.
  // accel ≈ 2·(rangeTiles·tile)/t² for a ~t-second pull from the far edge.
  voidVacuum: { rangeTiles: 2, accel: 60 },
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
  pellet: "#d8d4c8", // spent slingshot pellet: identical to the in-flight shot color (weaponShot.slingshot)
  dust: "rgba(196,182,150,0.5)", // Dash's dust-trail puff (expands + fades; see dust_devil)
  enemyShot: { r: 5, color: "#145a32" },
  weaponShot: { slingshot: "#d8d4c8", hex: "#9b59b6", beam: "#1abc9c", bomb: "#e67e22", nova: "#f5d76e", field: "#8e44ad",
    bat: "#bdc3c7", cleave: "#e74c3c", spear: "#95a5a6", whirl: "#f39c12", switchblade: "#b197fc",
    redline: "#ff6b6b", flashback: "#cc5de8" }, // weapon color (shot + select swatch), keyed by id
  blast: { ring: "rgba(255,240,200,0.85)", dur: 0.28 }, // expanding ring for nova/bomb detonations
  beam: { width: 16 }, // max stroke width of a piercing shot drawn as a beam (thin→thick→fade over its life)
  melee: { swing: "rgba(255,255,255,0.7)", dur: 0.15 }, // quick wedge flash for melee swings
  field: { fill: "rgba(155,89,182,0.16)", ring: "rgba(155,89,182,0.45)" }, // lingering zone disc
  freeze: { fill: "rgba(150,205,255,0.55)", ring: "rgba(190,230,255,0.9)", ringPad: 2 },
  slow: { fill: "rgba(140,150,255,0.20)" },                                    // Chill Zone debuff tint
  confuse: { fill: "rgba(190,120,255,0.45)", ring: "rgba(215,160,255,0.9)" },  // Bad Trip tint
  deploy: { fill: "#34506e", ring: "#6aa9ff" },                               // Drum Machine turret
  charge: { fill: "#f5d76e" },                                                 // The Drop meter fill
  rangedTelegraph: { ring: "rgba(39,174,96,0.9)", line: "rgba(39,174,96,0.5)", ringPad: 5 },
  chargerTelegraph: { ring: "rgba(231,76,60,0.85)", line: "rgba(231,76,60,0.6)", lunge: "rgba(255,120,90,0.9)", ringPad: 6 },
  hero: { hit: "#7fb3ff", normal: "#2d6cdf" },
  follower: { hit: "#ffffff" }, // i-frame flash; each follower's body color comes from BALANCE.follower.roster
  pickup: { fill: "#f1c40f", ring: "rgba(255,255,255,0.85)", glyph: "#3a2e00", glyphFont: "bold 13px system-ui, sans-serif" }, // powerup drop on the ground
  shop: { fill: "#1f6f4a", ring: "#3ddc97", roof: "#13452f", glyph: "#eafff5", glyphFont: "bold 16px system-ui, sans-serif", // shop marker
    label: "rgba(0,0,0,0.7)", labelText: "#fff", labelFont: "13px system-ui, sans-serif", afford: "#3ddc97", broke: "#e57373" },
  bar: { back: "rgba(0,0,0,0.5)", hp: "#e74c3c", mana: "#3498db", tapped: "rgba(52,152,219,0.25)", w: 26, h: 3, gap: 2 },
  hud: { font: "14px system-ui, sans-serif", box: "rgba(255,255,255,0.75)", text: "#111" },
  // Floating touch joystick: a faint ring at the press origin + a dot at the finger,
  // drawn only while a drag is live. Minimal, non-skeuomorphic.
  joystick: { ring: "rgba(255,255,255,0.25)", knob: "rgba(255,255,255,0.55)", knobR: 16 },
  // Floating damage numbers: rise `rise` px/s, live `dur` s, fade out. `alpha` caps
  // opacity so they read as ghosted, not solid. White for every hit, for legibility.
  hitNumber: { font: "bold 15px system-ui, sans-serif", color: "#fff", rise: 36, dur: 0.7, alpha: 0.8 },
  overlay: { bg: "rgba(0,0,0,0.6)", fg: "#fff", titleFont: "32px system-ui, sans-serif", subFont: "16px system-ui, sans-serif" },
  select: { bg: "#161616", title: "#fff", card: "#262626", cardActive: "#3a3a3a", border: "#6aa9ff", name: "#fff", desc: "#bbb", hint: "#999",
    titleFont: "28px system-ui, sans-serif", nameFont: "20px system-ui, sans-serif", descFont: "14px system-ui, sans-serif", hintFont: "14px system-ui, sans-serif" },
  // Run-summary (DEATH/VICTORY) + META scenes (specs 15/08). Monospace for the
  // payout/cost columns so the +credits align.
  summary: { bg: "#0f0f12", win: "#f5d76e", lose: "#c97b6a", sub: "#cfcfcf", label: "#9a9a9a", value: "#fff", plus: "#7ed6a5", lost: "#c97b6a", rule: "#3a3a3a", unlock: "#7ed6a5", cta: "#fff",
    titleFont: "34px system-ui, sans-serif", subFont: "16px system-ui, sans-serif", rowFont: "16px ui-monospace, monospace", ctaFont: "16px system-ui, sans-serif" },
  meta: { bg: "#121417", title: "#fff", credits: "#f5d76e", row: "#222630", rowActive: "#313947", border: "#6aa9ff", name: "#fff", blurb: "#9aa3af", rank: "#cfd6df", cost: "#7ed6a5", broke: "#c97b6a", maxed: "#6f7782", cont: "#7ed6a5", hint: "#7a818c",
    titleFont: "28px system-ui, sans-serif", creditsFont: "18px system-ui, sans-serif", nameFont: "18px system-ui, sans-serif", blurbFont: "13px system-ui, sans-serif", costFont: "15px ui-monospace, monospace", hintFont: "14px system-ui, sans-serif" },
  // Party-select grid (the cast picker). Cards carry the placeholder portrait + weapon;
  // `badge` is the selection-order chip, `lockTint` veils a still-gated character.
  party: { bg: "#161616", title: "#fff", card: "#242424", cardActive: "#3a3a3a", border: "#6aa9ff", name: "#fff", weapon: "#bbb", hint: "#999",
    badge: "#6aa9ff", badgeText: "#0c0c0c", lockTint: "rgba(20,20,20,0.66)", lockText: "#888", start: "#7ed6a5", startOff: "#5b6b60",
    titleFont: "28px system-ui, sans-serif", nameFont: "16px system-ui, sans-serif", weaponFont: "13px system-ui, sans-serif", badgeFont: "bold 15px system-ui, sans-serif", lockFont: "13px system-ui, sans-serif", hintFont: "14px system-ui, sans-serif" },
};
