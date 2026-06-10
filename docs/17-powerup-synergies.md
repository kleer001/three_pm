# Spec 17 — Exclusive & synergistic powerups, per hero

Concrete powerup design that makes in-run choices *exclusive* (real opportunity
cost) and *synergistic* (mods that combine into a build). Extends the powerup
system in `docs/07-powerups.md` and the hero kits in `docs/05` + `docs/10–13`.

3pm is real-time action with a single hero and two weapons (a `basic` and a
`signature`, `docs/04-combat.md`). So exclusivity does NOT come from deck slots
or pick-1 card draws as in a deck-builder — it comes from four levers:

## How exclusivity is created (the four levers)
1. **Weapon-mod slots.** The hero has a small fixed number of mod slots split
   across the two weapons (e.g. 2 on `basic`, 2 on `signature`, 1 trait). You
   cannot hold every mod, so each pickup has an opportunity cost; a full slot
   must be swapped, not added.
2. **Forks (one-or-the-other).** Some powerups are offered as a pair where taking
   one *locks out* the other for the run. This is the strongest exclusivity and
   the main "which build is this run" decision.
3. **Faustian trade-offs.** Strong upside with a real downside, so a mod reshapes
   the run rather than strictly improving it (especially lethal on low-CON
   heroes — risk *is* the build).
4. **Conditional value.** Generic mods (shared loot pool) are great for one hero
   and dead weight for another, so *what's worth taking* depends on your hero —
   a meaningful choice with no per-hero authoring.

## How synergy is created
- **Tags.** Every mod carries tags (`pierce`, `knockback`, `burn`, `curse`,
  `mana`, `crit`, `dash`, `summon`, `slow`, `wall`…). Tag pairs trigger emergent
  effects via the declarative table in `docs/07` (`synergies.json`).
- **Pivots.** A mod is mild on its own but *transforms* a specific hero's
  signature — the StS "pivot" idea translated to weapons. Pivots are where a run
  goes from "upgraded" to "broken on purpose."

Mod **types** below: **Fork** (exclusive pair) · **Trade** (Faustian) ·
**Pivot** (transforms the signature) · **Combo** (pairs with another mod/tag).

---

## Marvin Merrick — "The Median" (flexible hybrid)
Basic *Backpack Swing* (melee arc, STR) · Signature *Pop Quiz* (3-pencil spread,
MAG). His all-5 kit branches the hardest — melee bruiser **or** ranged skirmisher.

| Mod | Type | Effect | Exclusivity / Synergy |
|---|---|---|---|
| **Heavy Backpack** | Fork A | Backpack Swing +50% dmg & knockback, −20% swing speed | Locks out *Sharpened*; commits to the melee lane |
| **No. 2 Sharpened** | Fork B | Pop Quiz fires 5 pencils, +1 pierce | Locks out *Heavy Backpack*; commits to the ranged lane |
| **Cram** | Trade | +30% attack speed (both weapons), −15% max HP per stack | Greed; great on the ranged lane, dangerous stacked |
| **Group Project** | Pivot | Every 5th basic hit fires a free Pop Quiz pencil | Mild alone; with *Sharpened* + *Cram* (faster hits, more pencils) it snowballs into a pencil storm |

Signature combo: **Heavy Backpack** (`knockback`) + generic **Wall Smarts**
(`wall`: enemies take damage slammed into walls) → the descent's walls become a
melee weapon. Tag pair `knockback`+`wall`.

## Chad "Tank" Brawnson — "The Varsity" (bruiser)
Basic *Haymaker* (heavy melee, STR) · Signature *Body Slam* (nova, knockback +
stun). Build around getting in, throwing bodies, and the walls around you.

| Mod | Type | Effect | Exclusivity / Synergy |
|---|---|---|---|
| **Pancake** | Fork A | Body Slam radius +50%, stun +0.5s | Locks out *Blitz*; the zone-control lane |
| **Blitz** | Fork B | Haymaker becomes a forward lunge that closes distance | Locks out *Pancake*; the dive lane |
| **Roid Rage** | Trade | +40% melee dmg, but HP only regens on kills | Forces aggression; safe-ish behind CON 8 |
| **Bleacher Smash** | Pivot | Knocked-back enemies that hit a wall take heavy bonus dmg + restun | Pivots *Body Slam* (it knocks back) into a wall-combo nuke; pairs with *Pancake* and the wall-dense map. `knockback`+`wall` |

Combo: **Blitz** (lunge) + generic **Second Wind** (kills shave Body Slam
cooldown) → chain lunge→slam→lunge through a crowd.

## Wendolyn Crowe — "The Occultist" (glass cannon)
Basic *Hex Bolt* (free magic bolt) · Signature *Summon the Hall Monitor* (nova
nuke, heavy mana). Enormous damage; CON 2 means *don't get touched* is the cost.

| Mod | Type | Effect | Exclusivity / Synergy |
|---|---|---|---|
| **Hex Mastery** | Fork A | Hex Bolt applies a stacking curse (DoT) | Locks out *Big Casting*; the attrition lane |
| **Big Casting** | Fork B | Hall Monitor −30% mana cost, +40% dmg | Locks out *Hex Mastery*; the burst-nuke lane |
| **Blood Pact** | Trade | Spells may spend HP when mana is empty (1 HP / missing mana) | Absurd uptime, lethal at CON 2 — the defining glass-cannon gamble |
| **Overcharge** | Pivot | +100% mana regen while undamaged | Mild alone; with *Big Casting* it makes the nuke near-spammable *if you stay untouched* — pivots her whole risk/reward |

Combo: **Hex Mastery** (`curse`) + generic **Detonate** (killing a cursed enemy
spreads curse to nearby) → chain-plague a crowd. Rewards the curse lane only.

## Dash Velocity — "The Track Star" (skirmisher)
Basic *Baton Jab* (short poke) · Signature *Anchor Leg* (dash + i-frames). Damage
comes from motion; standing still is death.

| Mod | Type | Effect | Exclusivity / Synergy |
|---|---|---|---|
| **Slipstream** | Fork A | Anchor Leg leaves a damaging trail | Locks out *Track Star*; weaponizes the dash |
| **Track Star** | Fork B | Anchor Leg −50% cooldown, +1 charge | Locks out *Slipstream*; dodge-spam mobility |
| **Glass Cleats** | Trade | +25% move speed, Baton Jab scales with current speed; −1 dash i-frame window | Rewards speed, punishes mistimed dashes |
| **Momentum** | Pivot | Consecutive Baton Jabs without taking a hit ramp damage (combo meter) | Mild alone; with *Track Star* you reposition often enough to keep the combo alive — pivots the hit-and-run loop |

Combo: **Slipstream** (`dash` trail) + generic **Afterimage** (dashing *through*
an enemy marks it for bonus jab dmg) → dash through, poke the marked target.

## Eugene "Sparkplug" Okafor — "The Robotics Nerd" (zoner / deployables)
Basic *Wrench Whack* (weak melee) · Signature *Deploy Sentry Turret*. Slow and
durable (CON 8); let the robots fight and control space.

| Mod | Type | Effect | Exclusivity / Synergy |
|---|---|---|---|
| **Twin Mount** | Fork A | Up to 2 turrets active | Locks out *Overclocked*; spread/crossfire zoning |
| **Overclocked Servo** | Fork B | Single turret: 2× fire rate, +range | Locks out *Twin Mount*; one strong emplacement |
| **Glass Chassis** | Trade | Turrets +60% dmg but gain HP and can be destroyed | Your zoning can be dismantled — protect it |
| **Tesla Coil** | Pivot | Turrets apply `slow`/shock on hit | Mild alone; with *Twin Mount* the crossfire perma-slows a kill-box — pivots turrets into a trap field he tanks inside |

Combo: **Overclocked Servo** (one big turret) + generic **Tracking Firmware**
(turret prioritizes the enemy you last hit) → mark with Wrench Whack, turret
deletes it — turns his weak basic into a targeting laser.

---

## Authoring notes
- **Forks** are the load-bearing exclusivity: each hero ships at least one
  fork pair so "which lane this run" is a real, locking decision.
- **Pivots** are each hero's signature-defining build; they should feel
  build-around, not incremental.
- **Generic mods** (Wall Smarts, Second Wind, Detonate, Afterimage, Tracking
  Firmware, …) live in the shared loot pool and gain their exclusivity from
  *conditional value* — strong for the heroes whose tags they complete, dead
  weight for others — so the same drop is a different decision per hero.
- All effects resolve through the existing `Attack`/`useAttack`/`applyPowerup`
  machinery (`docs/04`, `docs/07`); tags drive `synergies.json`. No new combat
  systems are required — these are data on top of the existing model.
