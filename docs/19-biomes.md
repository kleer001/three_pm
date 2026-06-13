# Spec 19 — Biomes: per-day looks, FX, and enemy rosters

Each day's seed dresses the one suburban map (spec 02) in a **biome**: a coherent
look, **one** dominant screen-effect, and a four-family enemy roster. Biomes
change *feel*, never the frozen contracts — they dress the world (spec 02), the
director's family selection (spec 06), and presentation (spec 09). This spec adds
no new combat machinery and no new AI: every enemy is still one of the four spec
06 behaviors (`chaser` / `shooter` / `charger` / `swarmer`).

## Conventions in force

- **A biome = looks + one FX + four enemy families.** Nothing more. The four
  families fill one behavior each (a natural chaser, shooter, swarmer, charger).
- **The FX ramps with `f`** — the director's distance fraction (0 at the north
  start, 1 at the south home band, spec 06). The effect is weakest up top and
  peaks on the home stretch, so difficulty rises *diegetically* as you descend.
- **Enemies are dumb mobs.** A short looping sprite, a behavior, and at most one
  weapon (contact, ranged, or a melee lunge). They emit nothing and gain nothing.
- **One sprite, 4 frames, flip-only.** Every enemy is a 4-frame looping sprite,
  oriented solely by horizontal flip to face the player — no sprite rotation. A
  roll/tumble reads as a 4-frame spin *loop*, never a transform; nothing tips,
  topples, or pivots.
- **Ambulatory vs static.** Each family is either **ambulatory** (moves per its
  behavior) or **static** (rooted — never repositions, only aims and fires).
  Static is a movement modifier on the `shooter` behavior, not a new behavior: a
  static shooter pins its move-intent to 0 and zones a fixed spot (e.g. a downed
  Power Line). `chaser` / `swarmer` / `charger` are always ambulatory. Each table
  marks the family's **Move** state.
- **Tiers are numbers, not new art** (spec 06: tiers never change behavior). One
  global rule for every family:
  - **Tier 1** — 80% size, base palette. Spawns from the top.
  - **Tier 2** — 100% size, palette swap. More HP/damage, eligible deeper.
  - **Tier 3** — 120% size, palette swap. Deepest `distanceBand`.
  A shooter family may additionally upgrade its **attack shape** at a higher tier
  (e.g. tier 3 gains a spread) — attack data, still no behavior change.
- **Modifiers** (spec 06) layer onto any roster: **`exploder`** (a charger that
  detonates an all-faction blast — hits the hero *and* nearby enemies), **spread**
  and **grenade** (shooter attack variants), and **escort** spawn-formations. Each
  biome lists its own under **Twists**.
- **Enemies are inhuman.** Undead, beasts, or animated objects only — never a
  plain human — so destroying them stays guilt-free and on-tone (spec 14).
- **No rhythm.** Nothing in any biome syncs to music or a beat. FX pulses, if
  any, are pure visuals with no timing role.

---

## Biome 01 — Suburbia After Dark *(baseline)*

The default dusk; every other biome is a variation of its light-ramp.

**Looks:** empty cul-de-sacs and tract homes at golden hour sliding into night —
long raking shadows, buzzing streetlights, dead lawns.

**FX — "the light dying":** a darkness overlay ramps with `f` (golden hour up top,
nightfall at home). Streetlights punch light-pools in the dark; outside them enemy
sprites dim and get harder to track, so the pools read as safer lanes. Render-layer
only.

| Family | Behavior | Move | What it is | Weapon | Tiers |
|---|---|---|---|---|---|
| **Were-Coyote** | `chaser` | ambulatory | SoCal coyote, turned; lopes at you | contact | 3 |
| **Sprinkler Head** | `shooter` | static | pops from lawns, sweep-fires water-bolts | ranged | 3 |
| **Garden Gnome** | `swarmer` | ambulatory | animated ceramic gnomes in a pack | contact | 2 |
| **Ice Cream Truck** | `charger` | ambulatory | distant jingle, then barrels at you | melee ram | 2 |

**Twists:** the tier-3 Sprinkler (Rain Bird) widens its sweep into a **spread** fan.

---

## Biome 02 — Rave-Gone-Wrong

**Looks:** a desert/warehouse rave bled into the cul-de-sac — laser fans, fog,
glowstick smears on rotted stucco, blacklight purple-on-black.

**FX — "blacklight":** the world goes near-black and only enemies and drops stay
lit; you read threats as floating glows. Ramps with `f` (dimmest near home).
Render-layer only.

| Family | Behavior | Move | What it is | Weapon | Tiers |
|---|---|---|---|---|---|
| **Glowstick Ghoul** | `chaser` | ambulatory | neon ghoul, walks at you | contact | 3 |
| **The Decks** | `shooter` | static | spectre rooted at a turntable | ranged sound-bolt | 3 |
| **Kandi** | `swarmer` | ambulatory | little bead-things in packs | contact | 2 |
| **Subwoofer** | `charger` | ambulatory | speaker on legs, lunges | melee slam | 2 |

**Twists:** **Subwoofer** is an **exploder** — its lunge detonates a knockback blast
that hits everyone in range, hero and enemies alike; the tier-3 Decks (Headliner)
fires a **spread**.

---

## Biome 03 — Freak Winter

A SoCal suburb buried under snow that should not exist.

**Looks:** snow-choked lawns and streets, gray-white sky, frozen pools, icicle-hung
tract homes, palms under frost. Whiteout, not dusk.

**FX — "ice-slick":** the streets have no traction — the hero and enemies carry
momentum and slide instead of stopping. Gets glassier as `f` climbs, so the home
stretch is a skating rink. A friction term in the movement integrator.

| Family | Behavior | Move | What it is | Weapon | Tiers |
|---|---|---|---|---|---|
| **Snowman** | `chaser` | ambulatory | animated snowman, slides at you | contact | 3 |
| **Frost Wisp** | `shooter` | ambulatory | floating frost spirit, lobs icicles | ranged shard | 3 |
| **Snowball** | `swarmer` | ambulatory | rolling snowballs in packs | contact | 2 |
| **Yeti** | `charger` | ambulatory | hulking beast, lunges | melee slam | 2 |

---

## Biome 04 — Brushfire / Santa Ana

The hills and the suburb gone up — wildfire season turned apocalyptic.

**Looks:** orange smoke-choked sky, ash falling like snow, charred palms, embers
drifting, houses glowing from inside.

**FX — "Santa Ana wind":** a constant directional gust shoves the hero, the
enemies, *and projectiles* — shots curve with or against it, so aiming changes for
the whole run. Direction is set per-day by seed; strength ramps with `f`. A wind
vector in the movement integrator.

| Family | Behavior | Move | What it is | Weapon | Tiers |
|---|---|---|---|---|---|
| **Cinder Ghoul** | `chaser` | ambulatory | charred husk, stumbles at you | contact | 3 |
| **Ash Wraith** | `shooter` | ambulatory | floating smoke spirit, lobs fireballs | ranged ember | 3 |
| **Sparks** | `swarmer` | ambulatory | swarm of flying embers | contact | 2 |
| **Burning Tumbleweed** | `charger` | ambulatory | flaming tumbleweed, hurled at you | melee roll | 2 |

**Twists:** **Burning Tumbleweed** is an **exploder** (bursts into a fire-blast on
contact, hero and enemies alike); **Ash Wraith** lobs **grenades** — arcing
fire-bombs that burst where they land.

---

## Biome 05 — Flood / El Niño

The rains came and never stopped — the suburb looks drowned. (Cosmetic only:
there is **no** reactive water simulation. Rain overlay + waterlogged-looking
ground tiles; movement is unchanged.)

**Looks:** rain sheeting over everything, waterlogged dark ground tiles,
half-submerged cars, palms dripping, debris everywhere.

**FX — "downpour":** a full-screen rain overlay and slick, waterlogged ground tiles
that darken as `f` climbs. Purely cosmetic render-layer — no movement effect.

| Family | Behavior | Move | What it is | Weapon | Tiers |
|---|---|---|---|---|---|
| **Drowned** | `chaser` | ambulatory | waterlogged ghoul, shambles at you | contact | 3 |
| **Storm Cloud** | `shooter` | ambulatory | floating cloud, spits rain-bolts | ranged bolt | 3 |
| **Piranha** | `swarmer` | ambulatory | fish drifting through the streets in packs | contact | 2 |
| **Shark** | `charger` | ambulatory | a fin gliding the streets, lunges | melee bite | 2 |

---

## Biome 06 — Earthquake / The Big One

The ground itself betrays you.

**Looks:** buckled streets, split asphalt, toppled fences, sagging power lines, dust
haze, houses slumped off their foundations.

**FX — "aftershocks":** the screen periodically shakes and fissures crack open
across the ground — brief hazard gaps to route around. Quakes hit harder and
fissures open wider/longer as `f` climbs. Telegraphed dodge pressure (rumble + a
crack appearing), not a movement-feel change.

| Family | Behavior | Move | What it is | Weapon | Tiers |
|---|---|---|---|---|---|
| **Rubble Golem** | `chaser` | ambulatory | animated heap of debris, lurches at you | contact | 3 |
| **Power Line** | `shooter` | static | downed live wire, whips electric bolts | ranged zap | 3 |
| **Gravel** | `swarmer` | ambulatory | skittering chunks of broken road in packs | contact | 2 |
| **Boulder** | `charger` | ambulatory | dislodged rock, rolls you down | melee roll | 2 |

**Twists:** the static **Power Line** arrives as an **escort** — Rubble Golems and
Boulders bodyguard it, so you can't just walk up and silence it.

---

## Biome 07 — Innsmouth-on-Sea

A rotted boardwalk town where the wrong things came in with the tide. Cosmic
horror at a Saturday-morning-cartoon level (spec 14) — too many eyes, never gore.

**Looks:** a barnacled pier-and-tackle town under a wrong-colored green-black sky,
tentacles curling out of storm drains, googly eyes blinking in the tide pools,
slime-slick boardwalk, fish-shacks sagging into the water, marine-layer fog over it
all.

**FX — "fog & the deep watching":** a tight marine-layer fog collapses sight-range
to a radius around the hero (enemies loom out of the gray), *and* the view warps —
the horizon bows, colors slide to sickly hues, the screen edges ripple as if seen
through water. Both intensify as `f` climbs, so the home stretch is near-blind and
swimming. Render-layer only; no movement effect.

| Family | Behavior | Move | What it is | Weapon | Tiers |
|---|---|---|---|---|---|
| **Deep One** | `chaser` | ambulatory | fish-folk, shambles at you | contact | 3 |
| **Idol** | `shooter` | static | carved fish-god idol, spits green bolts | ranged bolt | 3 |
| **Spawn** | `swarmer` | ambulatory | tentacled larvae swarming in packs | contact | 2 |
| **Tentacle** | `charger` | ambulatory | erupts from the ground and slams | melee slam | 2 |

**Twists:** the static **Idol** arrives as an **escort** behind a wall of Deep Ones;
its tier-3 spits a **spread** of green bolts.

---

## Biome 08 — Dead Mall

The half-abandoned commercial strip the kids cut through every day, gone feral
after 3pm.

**Looks:** a cracked-asphalt parking lot and a row of failed storefronts —
soaped-over windows, a dead fountain, flickering signage, shopping carts adrift, a
sun-bleached anchor-store husk.

**FX — "power surges":** the dying grid browns out and spikes — the level dims to
emergency-red, then signage and sparks flare too-bright in pulses. Surges hit harder
and the dark stretches longer as `f` climbs. Render-layer only; nothing syncs to it.

| Family | Behavior | Move | What it is | Weapon | Tiers |
|---|---|---|---|---|---|
| **Mannequin** | `chaser` | ambulatory | display dummy, jerks toward you | contact | 3 |
| **Gumball Machine** | `shooter` | static | rooted globe, spits gumballs | ranged | 3 |
| **Rats** | `swarmer` | ambulatory | mall rats, scurry in packs | contact | 2 |
| **Soda Machine** | `charger` | ambulatory | rushes you and slams (upright, never tips) | melee slam | 2 |

**Twists:** the static **Gumball Machine** arrives as an **escort** behind a
Mannequin screen; its tier-3 coughs a **spread** of gumballs.
