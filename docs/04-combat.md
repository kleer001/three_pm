# Spec 04 — Combat & interaction model

Real-time, top-down. WASD moves, mouse aims. Every offensive action — basic
attack and signature ability alike — flows through **one attack resolver**;
they differ only by data. Per-character basic *and* signature attacks are
content (spec 05); this spec fixes the machinery.

## Input → intent + aim (`input/`)
- WASD → `movement.intent` (normalized 8-way / analog vector).
- Mouse position → world coords (subtract camera offset) → `aim` = unit vector
  from the hero to the cursor. 360° aiming.
- Buttons: LMB = basic attack, RMB / key = signature ability.

## Attack descriptor (unifies basic + signature)
A basic attack is just a zero-mana ability on its own cooldown. One schema:
```
Attack {
  shape:    melee-arc | projectile | nova | deploy | ...
  scaling:  strength | magic          // which stat powers the damage
  base, ratio                         // dmg = base + stat*ratio; magic also * abilityPower
  manaCost, cooldown                  // basic: manaCost 0
  hitbox:   { radius | arc | size }   // melee/aoe geometry
  projectile?: { speed, lifespan, pierce }
  deploy?:  { spawnDef, faction, lifespan, maxActive, placement, turret }
  effects:  [ knockback, status, ... ]
}
```
- **Basic:** `manaCost 0`, usually `scaling: strength`, per-character `shape`.
- **Signature:** defined by `manaCost > 0` + `cooldown` — nothing else. Its
  `scaling` may be `strength` OR `magic`, or it may carry no real damage at all
  and earn its slot through `effects` (knockback, stun, dash, i-frames). Do not
  assume a signature scales on magic.
Cooldowns/mana are the only gates — checked identically for both.

**`deploy` shape.** Spawns a persistent friendly entity rather than (or before)
dealing direct damage; `base`/`ratio` may be 0. The `deploy` payload:
- `spawnDef` — factory def for the spawned entity (e.g. `deployable:sentry_turret`, spec 03).
- `faction` — faction tag of the spawned entity (`player` for friendly deployables).
- `lifespan` — seconds before it despawns on its own.
- `maxActive` — cap on standing instances per deployer; spawning past it despawns the oldest.
- `placement` — where it lands (e.g. `aim`).
- `turret` — descriptor (`scaling`, `base`, `ratio`, `attack`, `fireRate`, `range`,
  `projectile`) driving the spawned entity's periodic attack.

The deployed entity is an ordinary spec 03 entity (transform + collider +
`faction` + a `brain`-style controller) that periodically calls the existing
`useAttack` against the nearest opposite-faction target in `range`, scaled by the
deployer's `abilityPower`. No new combat machinery — it routes through the one
resolver and the faction rule below.

## Resolver
`useAttack(entity, attackId, aim)`
1. Reject if `cooldowns[attackId] > 0` or `mana < manaCost`.
2. Deduct mana, set `cooldowns[attackId] = cooldown`.
3. Spawn the hit source via factory:
   - `melee-arc / nova` → transient hitbox entity (lifespan ~1 frame–short), no
     movement, centered/oriented on `aim`.
   - `projectile` → moving entity (movement+collider+`projectile`), travels along
     `aim`, despawns on hit (unless `pierce`) or `lifespan`.

`applyDamage(target, amount, source)`
1. If `target.health.iframes > 0` → ignore (player after-hit window).
2. `dealt = amount * (1 - target.derived.dmgResist)`; `hp -= dealt`.
3. Apply `knockback` impulse to `target.movement` along the hit normal.
4. If `target` has `iframeDuration` → set `iframes = iframeDuration` (heroes).
5. `hp <= 0` → despawn, `emit('death', target, source)`. Hero death → DEATH scene.

`amount` for an attack = `base + stat*ratio`, where `stat` is strength or magic
per `scaling`; magic attacks also multiply by `derived.abilityPower`.

## Enemy damage
- **Contact:** enemies carry `contactDamage`; on collider overlap with the hero,
  call `applyDamage` (gated by hero i-frames).
- **Projectiles/telegraphs:** enemy `brain` (spec on enemies later) calls the same
  `useAttack` with enemy-owned attack defs. Faction on the hit source decides
  valid targets — **a hit source damages entities of the OPPOSITE faction**.
  `enemy` sources damage every `player`-faction entity (the hero *and* any
  `player` deployable/summon); `player` sources (the hero and its deployables)
  damage `enemy` entities. `neutral` is never damaged and never the aggressor.

## Cooldown & resource ticking
- Per-entity `cooldowns` map decremented each `update(dt)`.
- `mana.mana += mana.regen * dt`, clamped to `maxMana`.
- `health.iframes` decremented each step.

## Interfaces this spec freezes
- `Attack` descriptor schema (basic & signature share it), including the
  `deploy` shape and its `deploy` payload (`spawnDef`, `faction`, `lifespan`,
  `maxActive`, `placement`, `turret`)
- Signature definition: `manaCost > 0` + `cooldown`; `scaling` is `strength` or
  `magic` (or utility-only via `effects`), not forced to magic
- `useAttack(entity, attackId, aim)` and `applyDamage(target, amount, source)`
- Faction damage rule: a hit source damages the opposite faction; `player`
  (hero + deployables) ↔ `enemy`; `neutral` never
- `contactDamage`, `iframes`/`iframeDuration`, `cooldowns`, `projectile`,
  `mana.regen` field additions to the entity model
- Mouse→world `aim` derivation as the aiming contract
