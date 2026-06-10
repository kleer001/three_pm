# Spec 10 — Hero: The Varsity

Defines the unlockable melee bruiser, Chad "Tank" Brawnson. Conforms to the
`characters.json` entry schema and 1–10 stat scale frozen in spec 05.

## Decisions in force
- **Slot:** melee bruiser — tanky front-line damage; walk in, soak hits, hit hard.
- **Hard specialist:** strength peak, magic dump. Reads as the inverse of a caster.
- **Stat spread (1–10, 5 = baseline):**
  - `strength: 9` — peak. Top-tier melee damage + knockback (`meleeDamage`, `knockback`).
  - `constitution: 8` — high. Big `maxHp` + `dmgResist`; survives the front line.
  - `speed: 3` — low. Slow on his feet; commits to a position, can't kite.
  - `magic: 2` — dump. Tiny `maxMana`/`abilityPower`; the signature can't lean on raw spell power.
- **Unlock:** `unlockAtRuns: 1`. The first hero earned, one run after Marvin.
- No passives. Kit is stats + `basic` + `signature` only.

## Chad "Tank" Brawnson — "The Varsity"
The varsity wrestling captain who never left a protein shake unfinished. All
muscle, no mana. He doesn't dodge — he occupies. The bruiser the rest of the
roster is read against: where Marvin is even, Chad is a single enormous spike.

```json
"varsity": {
  "name": "Chad Brawnson",
  "archetype": "The Varsity",
  "blurb": "Wrestling captain, absurdly swole, allergic to leg day excuses. Walks through hits to land one.",
  "unlockAtRuns": 1,
  "stats": { "speed": 3, "constitution": 8, "strength": 9, "magic": 2 },
  "basic": {
    "name": "Haymaker",
    "shape": "melee-arc",
    "scaling": "strength",
    "base": 8, "ratio": 1.4,
    "manaCost": 0, "cooldown": 0.6,
    "hitbox": { "arc": 70, "radius": 36 },
    "effects": ["knockback:medium"]
  },
  "signature": {
    "name": "Body Slam",
    "shape": "nova",
    "scaling": "magic",
    "base": 10, "ratio": 0.5,
    "manaCost": 15, "cooldown": 5.0,
    "hitbox": { "radius": 90 },
    "effects": ["knockback:large", "stun:0.5"]
  },
  "sprite": "varsity"
}
```
- **Haymaker:** a tight, hard melee arc — narrower than Marvin's Backpack Swing
  but far heavier (`base`/`ratio` ride the 9 strength). Slower swing, medium
  knockback. The bruiser's bread-and-butter.
- **Body Slam:** a leaping ground-pound `nova` around Chad. Per the schema it
  `scaling: magic`, but the 2-magic dump means its damage component is modest —
  it earns its slot as a panic/control button: large-radius **knockback** plus a
  short **stun** that clears the swarm off the front line. Cheap mana, long
  cooldown.

Numbers are starting values tied to the balance config; they are tuning data,
not contracts.

## Interfaces this spec freezes
- The `varsity` entry conforming to the spec 05 `characters.json` schema
- `unlockAtRuns: 1` as this hero's meta gate
- `stun:<seconds>` effect token on the signature (resolver must honor it as a status)
