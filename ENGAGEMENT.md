# ENGAGEMENT — emotional involvement in 3pm

Design notes on what keeps a player invested, drawn from *Slay the Spire* (StS)
and the broader roguelite canon, mapped onto 3pm's own systems (a forced
top-down descent home through a cartoon-terror suburb). 3pm is not a
deck-builder — these are *principles* to translate, not mechanics to copy.

The throughline: **engagement comes from meaningful decisions whose outcomes the
player can read, made under pressure, in a run that feels distinct — and from a
failure that still moves you forward.**

## What Slay the Spire does right, and how 3pm borrows it

### 1. Every choice is a real trade-off
StS never offers a strictly-best option. Card rewards force damage-vs-survival,
now-vs-later; "if any choice is always superior, the designer failed." Player
agency over *meaningful* choices is what separates deep games from shallow ones.

**In 3pm:** in-run powerups are the choice engine (`docs/07-powerups.md`). Make
pickups mutually exclusive in the moment — limited `scrap`, shops that force
"the projectile-spread *or* the dash, not both." Each powerup should be
incomplete on its own and only sing in combination, so the player *builds* a run
rather than collecting upgrades. Avoid pickups that are never wrong to grab.

### 2. Telegraphed intent — the player loses to information they had
StS's single most-praised innovation is the **intent system**: enemies show
exactly what they'll do next turn, so defeat is "I misread the board," never "the
game surprised me." Visible intent is what lets players form plans.

**In 3pm:** enemies wind up before they strike — melee shows a telegraph ring
before the stick hits, ranged draws an aim line before the potshot. Hold this
line hard as the roster grows: **every lethal action gets a readable wind-up the
player can react to.** A death must always trace to a choice, not a gotcha.

### 3. Pressure that forces greed-vs-safety
StS creates *temporal tension* — accept a loss now for a later gain, or bank
safety now and pay more later. The clock is always implicitly ticking (HP, deck
bloat, act bosses).

**In 3pm the descent IS the clock.** The window scrolls down and crushes
stragglers, so every detour — into a house for loot, toward a shop, to finish off
an enemy — is weighed against staying ahead of the crush. Lean into this: place
the best `scrap`/powerups slightly *off* the safe descent line, so reward means
risk. The watch depth gauge keeps the stakes legible.

### 4. Run variety from synergy, not just randomness
StS replayability comes from **emergent build synergies** across characters and
cards, not raw RNG. Different heroes reshape which choices are good; runs feel
distinct because the *strategy* differs, not just the layout.

**In 3pm:** the nine teens have hard-specialized kits (`docs/05`, `docs/10–13`, `docs/19`)
and powerups stack with declared synergies (`docs/07`). Push synergies that
"pivot" — a powerup that's fine alone but transforms a specific hero's signature.
The goal: a player thinks "this is a *spread-Marvin* run" the way StS players
think "this is a *poison* run."

### 5. Failure that still pays out
The roguelite contract: death says *two* things — "you erred" **and** "you still
progressed." Losing a long Hades run stings less when your next attempt starts
stronger. (StS itself runs *thin* meta on purpose — mastery is the reward — so
calibrate how much the meta carries the player vs. how much skill must.)

**In 3pm:** groundhog-day framing (`docs/14`) plus banked `credits` and per-hero
upgrade trees (`docs/08`) turn each death into measurable progress. The
run-summary (`docs/15`) must *show* it — distance reached, credits earned, a heat
of "next run you'll have X." Death lands as "another day, a little tougher,"
never as pure loss.

### 6. Total readability = trust = re-runs
Underneath all of it: the player must always understand the board. StS shows
exact numbers, clear intents, legible state. Confusion reads as unfairness and
kills retention.

**In 3pm:** obstacles must read as solid, walkable ground as walkable, telegraphs
as threats, the depth gauge as the goal. Any moment where the player can't tell
*why* something happened is an engagement leak — fix readability before content.

### 7. Attachment: make the protagonist matter
Beyond systems, StS/Hades land emotionally because the run is *about someone* —
a character with a voice and a reason. 3pm's premise is inherently sympathetic:
a scared 16-year-old just trying to get home. Spend that. Per-hero voice/barks
(`docs/14`), distinct silhouettes, and the unlock cadence (a new teen every few
runs) give the player someone to root for and a reason to come back.

## Where 3pm is already aligned vs. where to push

- **Already aligned:** telegraphed enemy intent; a built-in time-pressure clock
  (the descent); a sympathetic premise; meta that banks progress on death;
  synergy-capable powerups in the spec.
- **Highest-leverage to push next:** make powerup choices genuinely exclusive and
  synergy-pivoting (decision depth); seed the best rewards off the safe line
  (greed-vs-safety); make the run-summary *celebrate* progress (failure-as-payout);
  guard readability as content grows (trust).

## Realized: exclusive & synergistic powerups
The decision-depth lever is designed concretely in `docs/17-powerup-synergies.md`.
Because 3pm is real-time action with a single hero and weapons (not a turn-based
deck-builder), exclusivity comes from four levers — limited **weapon-mod slots**,
one-or-the-other **forks**, **Faustian trade-offs**, and **conditional value**
(a generic mod is great for one hero, dead weight for another) — and synergy
comes from **tags** that combine plus mods that **pivot** a hero's signature.
Spec 17 gives each hero a Fork / Trade / Pivot / Combo set (authored for the
original five; the roster of record is now nine, `docs/19`).

## Sources
- [Reverse-engineering Slay the Spire's decisions — Cloudfall Studios](https://www.cloudfallstudios.com/blog/2020/11/2/game-design-tips-reverse-engineering-slay-the-spires-decisions)
- [In-Depth Analysis of Game Design in 'Slay the Spire' — Oreate AI](https://www.oreateai.com/blog/indepth-analysis-of-game-design-in-slay-the-spire/31e5a1880268eaa391d06856f239fbf6)
- [How Slay the Spire's devs use data to balance — Game Developer](https://www.gamedeveloper.com/design/how-i-slay-the-spire-i-s-devs-use-data-to-balance-their-roguelike-deck-builder)
- [Roguelike vs Roguelite, meta-progression and failure — Switchblade Gaming](https://www.switchbladegaming.com/strategy-games/roguelike-vs-roguelite-explained/)
- [Roguelite progression systems — Game Rant](https://gamerant.com/roguelite-games-with-best-progression-systems/)
