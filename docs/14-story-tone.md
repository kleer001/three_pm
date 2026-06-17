# Spec 14 — Story & tone bible

The narrative and tonal reference for **3pm**. Fixes premise, watch lore, the
tone guardrails (cartoon-terror), and light per-hero flavor. This spec designs
**no mechanics** — it dresses systems frozen elsewhere (run loop spec 01, world
spec 02, enemies spec 06, presentation spec 09). Where a beat surfaces in code,
this doc points at the owning spec; it never redefines it.

## Decisions in force
- **Genre fiction:** nine 16-year-olds at Merriton High trying to get home alive
  through a post-apocalypse **cartoon** hellscape (ruined suburbia, spec 02).
- **Tone is cartoon-terror:** a genuinely menacing hellscape played with absurd,
  darkly comic Saturday-morning energy. Menace is real; gore is not.
- **Death fiction = "groundhog day":** each run is a fresh **day** (spec 01: run
  = one in-game day). Dying resets the teen to the start of another 3pm.
- **The regenerated neighborhood is the in-fiction proof** that each run is
  a new day — the loop and the morning's new streets are the same fact told
  twice (below).
- **Narrative depth is light:** premise + brief per-hero flavor only. **No** plot
  arcs, **no** cutscenes, **no** dialogue trees, **no** story progression gates.
  Heroes unlock on `unlockAtRuns` (spec 05), never on story.

## Premise
The final bell rang at 3pm and the world outside Merriton High had gone wrong.
The suburb that surrounds the school — its streets, lawns, split-levels, and
cul-de-sacs — is still recognizably home, but rotted, cratered, and crawling
with things that should not be on a Tuesday. Nobody explains it. There is no
lore dump, no villain monologue, no rescue. There is only the walk home before
dark, and the dark is full of teeth.

**"Home"** is literal: the kid's own house, downhill past the ruins. Every run
descends; home is always the way down, the fixed south edge (spec 02 home band).
Win = reach that edge. There is no reunion scene and no twist — getting to your
own front door, alive, is the whole victory.

## The watch (the one constant)
Every hero carries the same cheap smart-watch — the one device that still works.
Its single app reads the way home, rendered in-game as the depth indicator on
the HUD (spec 09).

- **What it is:** a kids' GPS smart-watch, the kind a parent buys so they can
  find their kid. It still phones home. Nothing else does.
- **Why it gives the way home:** it's locked to the wearer's house, not to true
  north. Home is always downhill — the fixed south edge — so the watch always
  says the same thing: keep descending. It doesn't navigate; it just *yearns*
  one way, and reads as a depth / distance-to-home gauge. The hero trusts it
  because it is the only thing left that knows where home is.
- **Why every day is new:** the suburb regenerates overnight. The streets,
  lawns, and split-levels rearrange into a fresh map each morning (a new day's
  seed, spec 01); the watch's day count ticks up. Same descent, never the same
  walk.
- **Why that justifies the loop:** the kids don't remember dying. To them each
  3pm is the first 3pm. The only evidence that it has happened before is the
  neighborhood itself: the streets are different today, which means today is new,
  which means yesterday *was* — even though no one recalls it. **The regenerated
  suburb is the groundhog-day clock.** Players read it as a new seed; the fiction
  reads it as proof the day reset.

## Tone bible — cartoon-terror
The target feeling: a haunted-house ride that is actually frightening but cannot
stop cracking jokes. Think a kids' cartoon that wandered into a horror film and
decided to stay. Use this section to vet art, SFX, copy, and animation.

### The register
- **Menace is sincere.** Enemies are genuinely trying to kill the kids; the music
  goes tense; the ruins are oppressive. We do not wink the threat away.
- **Presentation is absurd.** Squash-and-stretch, rubber-hose limbs, googly
  panic, comic timing, onomatopoeia. The kids are kids — they quip, they
  over-react, they treat mortal danger like a pop quiz they didn't study for.
- **The seam is the joke.** Comedy comes from cartoon characters taking deadly
  stakes seriously. Neither half apologizes for the other.

### Horror at a cartoon level — DO
- **Bloodless slapstick deaths.** Enemies burst into dust, confetti, springs,
  cartoon stars, a puff with an X-eyed sprite — *poof*, not splatter.
- **Implied menace over depicted harm.** Silhouettes, too many eyes in a dark
  window, a long shadow, a wet *crunch* off-screen. Suggest; don't show.
- **Hero "death" is a comic faint, not a corpse.** Spinning, stars, a flop, a
  cut to black — never gore, never a dead body on screen (see Death beat below).
- **Expressive over realistic.** Big eyes, exaggerated fear/relief, readable
  poses. Fear is *performed*, like a cartoon character's, not simulated.

### Off-limits — DON'T
- No realistic gore, blood pools, dismemberment, or wounds on the kids.
- No real-world atrocity, no human (adult) corpses, no self-harm imagery.
- No cruelty played straight — the suburb is scary, never grim or hopeless.
- No fourth-wall lore explaining the apocalypse. The mystery stays a mystery.
- No tonal whiplash *within* a beat (e.g. a gag mid-jumpscare); the seam is
  between sincere-menace and absurd-presentation, not random mood swings.

### Audio register (guides SFX/music, spec 09)
- SFX skew **cartoon foley:** boings, splats-without-gore, slide-whistles,
  comedic impacts — but enemy and ambient sounds keep a real low-end growl so
  the room still feels dangerous.
- Music per scene (spec 09): RUN tense-but-bouncy; DEATH a comic sad-trombone
  stinger into its loop; VICTORY a triumphant little fanfare.

## Per-hero flavor
One-line hook + a few example barks/voice-notes per hero. Voice = how that kid
copes with a hellscape, consistent with their stat identity (specs 05, 10–13).
Barks are flavor only — no system reads them; they guide VO/copy/art.

### Marvin Merrick — "The Median" (spec 05)
**Hook:** the aggressively average kid whose only special thing is the watch —
and somehow that's enough to keep walking.
- "Okay. Okay. This is fine. This is a completely normal Tuesday."
- "Watch says that way. Watch has never lied to me. ...Right?"
- (hit) "Ow! That's gonna be on the quiz, isn't it."

### Chad "Tank" Brawnson — "The Varsity" (spec 10)
**Hook:** wrestling captain who solves the apocalypse the way he solves
everything — walk through it and hit it once, hard.
- "Bro. BRO. Did you SEE that? I bench more than that thing weighs."
- "Cardio's for losers. I'll just stand here and win."
- (signature) "BODY. SLAM. State finals, baby!"

### Wendolyn Crowe — "The Occultist" (spec 11)
**Hook:** the goth everyone called a phase — turns out she meant every word, and
the parking lot is about to find out.
- "Everyone said the candles were 'a lot.' Who's laughing now."
- "I read about this in a forbidden tome. ...Or a fan-wiki. Same thing."
- (low HP) "If I die out here my mom is going to be SO smug."

### Dash Velocity — "The Track Star" (spec 12)
**Hook:** the 400m state champ who treats the whole hellscape as one very long,
very fast relay leg.
- "You can't hit what you can't catch. *Stay mad.*"
- "PR'd the cul-de-sac. New record. No one will ever know."
- (dash) "Anchor leg — coming through, ghoul!"

### Eugene "Sparkplug" Okafor — "The Robotics Nerd" (spec 13)
**Hook:** robotics-club president who can't run and won't punch — he just
furnishes the street with turrets and lets the math do the killing.
- "Fight YOU? No. Fight my turrets. Plural. There are several."
- "Regional champion three years running. The demons were not informed."
- (deploy) "Sentry online. Stand on the X. Trust the build."

## How tone surfaces in already-specced systems
Reference only — these specs own the mechanics; this doc fixes their *feel*.

- **Enemies (spec 06):** the four families (Shamblers/zombies, Imps/demons,
  Cultists, Brutes/ghoul-brutes) are dressed cartoon-monstrous — menacing
  silhouettes, expressive googly menace — and die per the bloodless-poof rule
  above. Generic horror, never a named or explained antagonist.
- **Victory / home-arrival beat (spec 01 VICTORY, spec 09):** touching the home
  band (spec 02) ends the day with the triumphant fanfare and a warm "you made
  it home" relief beat — small, wordless, no cutscene. Then back to META.
- **Death / reset beat (spec 01 DEATH, spec 09):** a comic faint (stars, flop,
  sad-trombone stinger), not a corpse — then the day resets. Fictionally the kid
  wakes to another 3pm with no memory; mechanically the run drops and a new seed
  regenerates the neighborhood (spec 01), which *is* the in-world proof a new day
  began.

## Interfaces this spec freezes
- **None.** This is a content/tone reference. It introduces no schema, no API,
  and no mechanic. It binds only the *fiction and feel* of systems frozen in
  specs 01, 02, 05, 06, 09, and 10–13; downstream art/audio/copy conform to the
  tone bible above without changing any contract.
