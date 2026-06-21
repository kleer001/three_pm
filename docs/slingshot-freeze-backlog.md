# Slingshot / freeze — idea backlog

Parked ideas for Marvin's slingshot and the freeze theme. **Not spec** — a holding pen
for things we talked through but didn't build. The numbered `docs/` are the source of
truth; this is the "someday/maybe" list. Each entry notes the existing hook it would
plug into so picking one up isn't a cold start.

## Already shipped (the "love touches")

- **Knockback on hit** — `slingshot.knockback: 1`; the freeze now lands with a shove
  (rides out collision-aware via `runScene` `knockback`/`applyKb`).
- **Half-size pellet** — `shotR: 6 → 3`, reads as a pebble.
- **Persist** — spent pellets rest on the ground where they land (`persist: true`,
  fed into the `debris` sink in `combatKit`, culled once scrolled off-top). Decorative
  for now — but see idea #4, which wants to make them *do* something.
- **Costs mana** — `manaCost: 0 → 6`. Self-throttling (regen 8/s vs 40 pool ≈ 10s of
  full-auto before it eases to the regen rate; never a hard lockout). This is what makes
  Marvin's magic stat — and his `honor_roll` upgrade track — finally matter.

## The enabling prerequisite for most "freeze branch" nodes

Today `applyHeroUpgrades` only folds the **four base stats** (`STAT_KEYS`). An upgrade
node can say `apply: { magic: 1 }` and nothing else — there's no way to express
"−1 mana/shot", "+freeze duration", or "freeze radius" as a purchase. Several ideas
below are **kit-mods**, which means a payload extension first: let `apply` (or a new
field) carry non-stat effects the run folds onto the chosen weapon at run start. Build
that once and ideas #1, #3, and most of a real Marvin magic tree become data.

## Freeze ideas

### From the chat (kleer001)

1. **Freeze area effect** — impact freezes a small radius, not just the struck enemy.
   New `freezeRadius` weapon stat; on hit, run the existing `blast()` path with
   `damage: 0, freeze: true` over that radius. Good as a weapon baseline *or* a kit-mod
   upgrade node (needs the payload extension).
2. **Freeze by contact** — Marvin's *body* freezes enemies on overlap (a defensive cold
   aura), independent of firing. Hook: the enemy/hero separation pass already iterates
   overlaps each frame — set `frozenT`/`freezeCount` there. Defensive identity, not DPS.
   Likely a signature or an upgrade unlock rather than always-on.
3. **Freeze length** — `+freezeDur` per rank. The canonical kit-mod node; the cleanest
   first customer for the payload extension above.
4. **Dropped shot still freezes but doesn't injure** — *the* synergy with persist (we
   already litter spent pellets). A spent pellet becomes a tiny freeze-mine: enemy
   contact → `frozenT = FREEZE_DUR`, zero damage, pellet consumed. Turns the descent's
   debris trail into a passive zoning tool. Hook: give `debris` entries a small radius and
   test enemy overlap in the enemy step. Watch perf if pellets pile up (they're
   scroll-culled, so bounded).

### Added in discussion (#5+)

5. **Shatter / chain freeze** — hitting an *already-frozen* enemy shatters it: instant
   kill (or a burst that spreads `freeze` to neighbors). Rewards stacking; `freezeCount`
   + `freezesToKill` already track the stack, so the trigger exists.
6. **Brittle while frozen** — frozen enemies take bonus damage and/or carry knockback
   further; a melee hit on a frozen body shatters it outright. Pairs with the knockback
   we just added and with the party's melee heroes (set-up → shatter combo).
7. **Mana refund on freeze-kill** — an enemy killed *by reaching `freezesToKill`* refunds
   a little mana (drop a shard pickup, or refund on the spot). Closes the loop the
   mana-cost change just opened: efficient freezing sustains itself, sloppy spraying
   starves you. Strongest *systemic* idea here.
8. **Frozen = solid** — a frozen enemy becomes a temporary obstacle other enemies path
   around (the AI already does BFS pathing). Converts freeze into zoning/terrain control,
   which fits the "hold the line against the crush" pressure.
9. **Slippery patch** — where a pellet lands or an enemy shatters, leave brief ice that
   slows/slides enemies. Reuses the existing `slowT`/`slowMult` debuff (Chill Zone), so
   it's mostly placement + tint.
10. **Thaw tell** — frozen enemies visibly thaw as `frozenT` runs down (freeze tint
    already exists); a re-hit resets the timer. Pure presentation polish, cheap.

## How a real "Marvin magic tree" might read (someday)

Once the payload extension exists, `honor_roll` (or a richer tree) could offer, beyond
`+magic`: `+manaRegen` (sustained freeze rate, not just pool), `−manaCost` (efficiency),
`+freezeDur` (#3), `freezeRadius` (#1), and a capstone unlock for contact-freeze (#2) or
freeze-kill refund (#7). That's the difference between "his magic matters" and "his magic
is a build."
