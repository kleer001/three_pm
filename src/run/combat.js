// The one combat resolver — health, mana, damage, and the spec-03 stat→derived
// model for every entity, hero and enemy alike (spec 04's applyDamage + spec 03's
// recomputeDerived). Entities carry `stats` (four 1–10 levels), a `derived` cache,
// `faction`, and the health/mana component. These functions don't care whose bag
// they're handed — one code path, not one for the hero and one for the horde.

// Recompute the derived cache from base stats. Runs on spawn (and would run after
// any stat change: level-up, powerup). HP/mana are clamped by callers to the new
// maxima. `C` is BALANCE.derive.
export function recomputeDerived(e, C) {
  const s = e.stats;
  e.derived = {
    moveSpeed: C.BASE_SPEED * (C.speedBase + C.speedPerLvl * s.speed),
    maxHp: C.BASE_HP + s.constitution * C.HP_PER_CON,
    dmgResist: Math.min(C.RESIST_CAP, s.constitution * C.RESIST_PER_CON),
    knockback: s.strength * C.KB_PER_STR,
    maxMana: C.BASE_MANA + s.magic * C.MANA_PER_MAG,
    abilityPower: C.BASE_AP + s.magic * C.AP_PER_MAG,
  };
}

// Damage of a spec-04 attack against a target: a stat-scaled flat term plus
// optional fractions of the target's max/current HP (the slice's percent-HP
// weapons). `amount = (base + stat*ratio)[*abilityPower if magic] + maxHp*pctMax
// + curHp*pctCur`. `attacker` supplies stats + derived.abilityPower.
export function weaponDamage(d, attacker, maxHp, curHp) {
  const stat = d.scaling === "magic" ? attacker.stats.magic : attacker.stats.strength;
  let flat = d.base + stat * d.ratio;
  if (d.scaling === "magic") flat *= attacker.derived.abilityPower;
  return flat + maxHp * (d.pctMax || 0) + curHp * (d.pctCur || 0);
}

// Apply damage through the i-frame gate and the target's dmgResist. Only entities
// with an `iframeDur` (the hero) get an invulnerability window; enemies take every
// hit. Knockback is applied by the caller (it needs the level for collision).
export function applyDamage(target, amount) {
  if (target.iframes > 0) return;
  target.hp -= amount * (1 - (target.derived.dmgResist || 0));
  if (target.iframeDur) target.iframes = target.iframeDur;
  if (target.hp <= 0) { target.hp = 0; target.dead = true; }
}

// Mana: regenerate toward the derived pool cap (only for entities with a regen
// rate), and the spend gate casters and the hero share.
export function regenMana(t, dt) {
  if (t.manaRegen) t.mana = Math.min(t.derived.maxMana, t.mana + t.manaRegen * dt);
}
export const canCast = (t, cost) => t.mana >= cost;
export const spendMana = (t, cost) => { t.mana -= cost; };
