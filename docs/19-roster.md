# Spec 19 — Roster: the nine (music-genre signatures)

The playable cast is **nine heroes, one per electronic-music genre**. It merges
the original five (spec 05, 10–13) with characters distilled from the imported
vibe board (`docs/prototype-roster.md`, 27 characters → one per genre). This spec
supersedes the five-hero cast of spec 05 as the roster of record; every hero still
conforms to spec 05's `characters.json` schema (stats, `basic`, `signature`,
sprite) and the 1–10 stat scale.

Each hero's **signature** carries a music-themed name and a single mechanic. The
basic attack is each hero's weapon; the signature is the special.

## Conga-train constraint

The party is a **follower train** (centipede): the player steers the head, the
rest follow as segments snapped to the head's breadcrumb trail. A follower has no
independent movement or input — so a signature is an **auto-firing weapon/effect
emanating from the hero's own segment**, auto-aimed at the nearest enemy to that
segment. Movement-based abilities (dash, reposition) are impossible by
construction; "speed" expresses as rate-of-fire, reach, or trail-wake.

## The nine

| Genre | Hero | Signature | Effect |
|---|---|---|---|
| Techno | Eugene "Sparkplug" Okafor | **Drum Machine** | drops looping auto-turrets that hold position as the train scrolls past |
| Industrial | Chad "Tank" Brawnson | **Mosh Pit** | shrapnel burst (~12 particles) in a radius from the hero; no friendly fire |
| Psytrance | Dash Velocity | **Redline** | rapid-fire stream of fast, low-damage projectiles (very low cooldown); speed = fire rate |
| Dubtechno | Wendolyn Crowe | **Deep Freeze** | AoE freeze (~2 s) on nearby enemies + a few points of damage |
| House | Marvin Merrick | **Good Vibes** | passive: regenerate a few HP every couple of seconds |
| Trance | Jess | **The Drop** | build a meter from damage dealt/taken; release a large AoE that scales with damage taken |
| Acid | ZigZag | **Bad Trip** | confuse nearby enemies into attacking each other for ~2 s; rearm takes ~2× the active duration |
| Ambient | Jasper | **Chill Zone** | drops a field ~25% larger than the hex that slows enemies inside and chips light tick damage |
| Synthwave | Valentine | **Flashback** | projectile does a few points on hit, then detonates for area damage a couple of seconds later |

Five are carried from the original cast (Eugene, Chad, Dash, Wendolyn, Marvin) and
mapped to the genre that fits their identity; four are new (Jess, ZigZag, Jasper,
Valentine). Wendolyn takes Dubtechno (goth/stealth aesthetic); the Acid confuse
mechanic is its own new character (ZigZag).

Marvin, ZigZag, and Wendolyn have **utility signatures** (heal / confuse /
freeze-with-chip); their damage output comes from their basic weapon, not the
signature.

## Powerups (shared pool, not hero-bound)

Two speed/time effects live in the powerup pool rather than on a hero, since
neither fits a single auto-firing segment:

- **BPM Boost** — temporary large move-speed increase.
- **Slow Jam** — temporary bullet-time; slows all combat timers (the descent
  scroll must slow with it).

## Effect primitives required

Mapping the nine onto the engine (weapon shapes `projectile`/`pierce`,
`melee-arc`, `nova`, `bomb`, `field`; effects damage/knockback/freeze):

| Reuses an existing primitive | Needs a net-new primitive |
|---|---|
| Mosh Pit (`nova` / projectile fan) | Drum Machine — persistent placed turret entity |
| Redline (`projectile`, low cd) | Good Vibes — passive HP regen |
| Deep Freeze (`nova` + `freeze`) | The Drop — charge meter (build → release) |
| The Drop release (`nova`) | Bad Trip — enemy confuse/flee targeting |
| Chill Zone base (`field`) | Chill Zone — enemy slow (move-speed multiplier) |
| Flashback (`bomb`, delayed detonate) | Chill Zone — DoT tick state (if not folded into `field`) |
| | Slow Jam — global time-scale on the fixed-timestep loop + scroll |

## Interfaces this spec freezes

- The nine heroes and their genre assignment as the roster of record (supersedes
  spec 05's five-hero cast; entries still follow spec 05's `characters.json`
  schema and the 1–10 stat scale).
- Each hero's signature **name** and mechanic as listed above (numbers are tuning
  data, set in the balance config, not contracts).
- The conga-train constraint: signatures fire/emanate from a hero's segment; no
  per-segment movement.
- **BPM Boost** and **Slow Jam** as powerups, not hero signatures.
- The net-new effect primitives above as the engine work this roster requires
  (slow, confuse/flee, DoT, passive heal, persistent turret, charge meter,
  global time-scale).
