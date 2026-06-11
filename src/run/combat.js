// The one combat resolver — health, mana, and damage for every entity, hero and
// enemy alike (spec 04's applyDamage, slice-shaped). Health/mana are a uniform
// component bag: { hp, maxHp, [iframes, iframeDur], [mana, maxMana, manaRegen],
// dead }. These functions don't care whose bag they're handed, which is the
// whole point — one code path, not one for the hero and one for the horde.

// Percent-of-HP damage model: flat plus a fraction of the target's max and
// current HP. A pure pctMax weapon kills in 1/pctMax hits regardless of tier; a
// pure pctCur weapon asymptotes (never reaches 0) and needs a flat floor to finish.
export function weaponDamage(d, maxHp, curHp) {
  return d.flat + maxHp * d.pctMax + curHp * d.pctCur;
}

// Apply damage through the i-frame gate. Only entities with an `iframeDur` (the
// hero) get an invulnerability window; enemies have none, so they take every hit.
export function applyDamage(target, amount) {
  if (target.iframes > 0) return;
  target.hp -= amount;
  if (target.iframeDur) target.iframes = target.iframeDur;
  if (target.hp <= 0) { target.hp = 0; target.dead = true; }
}

// Mana: regenerate toward the pool cap (no-op for entities without one), and
// the spend gate casters and the hero share.
export function regenMana(t, dt) {
  if (t.maxMana) t.mana = Math.min(t.maxMana, t.mana + t.manaRegen * dt);
}
export const canCast = (t, cost) => t.mana >= cost;
export const spendMana = (t, cost) => { t.mana -= cost; };
