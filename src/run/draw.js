// Shared canvas primitives for the run scene and its party-select preview, so a hero looks
// identical in both. Each takes an explicit `ctx` (no closure) and reads the same THEME
// tokens. Presentation lives here once — adding a readout (e.g. the cooldown dot) updates
// the game and the preview together, instead of drifting between two hand-kept copies.
import { BALANCE, THEME } from "./balance.js";

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function disc(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function ring(ctx, x, y, r, color) {
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

// Cooldown readout drawn ON the body: a dark dot whose radius tracks the remaining cooldown
// fraction (1 = just fired → big dot, 0 = ready → gone). Universal across heroes and reads
// cleanly under a sprite later. `remain` is the 0..1 remaining-cooldown fraction.
export function cdDot(ctx, x, y, r, remain) {
  const ir = remain * r * 0.72;
  if (ir < 0.6) return; // ready (or nearly): draw nothing
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  ctx.arc(x, y, ir, 0, Math.PI * 2);
  ctx.fill();
}

// A centered single-character icon (pickup/shop markers).
export function glyph(ctx, ch, x, y, color, font) {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.fillText(ch, x, y);
  ctx.textAlign = "left";
}

// A centered status bar (HP/mana): dark backing + a `frac`-wide fill.
export function bar(ctx, cx, y, frac, fill) {
  const B = THEME.bar, x = cx - B.w / 2;
  ctx.fillStyle = B.back;
  ctx.fillRect(x, y, B.w, B.h);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, B.w * clamp(frac, 0, 1), B.h);
}

// Draw one party member's body + readouts at screen (x,y). Role-accurate to runScene: a
// head shows its weapon's cooldown + mana; a follower shows its signature's cooldown; both
// show HP and, for a charge signature, the charge meter. The disc flashes white on i-frames
// and fades in on spawn. `weapon` is the head's live weapon (kept outside the entity because
// powerups rebuild it); it is ignored for a follower.
export function drawMember(ctx, m, x, y, role, weapon) {
  const B = THEME.bar, head = role === "head";
  ctx.globalAlpha = m.fadeT > 0 ? 1 - m.fadeT / BALANCE.spawnFade : 1;
  disc(ctx, x, y, m.r, m.iframes > 0 ? (head ? THEME.hero.hit : THEME.follower.hit) : m.color);
  ctx.globalAlpha = 1;
  if (head) {
    if (weapon.cd) cdDot(ctx, x, y, m.r, m.cd / (weapon.cd * BALANCE.heroFireCooldownMult));
  } else if (m.signature && m.signature.cd) {
    cdDot(ctx, x, y, m.r, m.sigCd / (m.signature.cd * BALANCE.heroFireCooldownMult));
  }
  let by = y - m.r - B.gap - B.h;
  bar(ctx, x, by, m.hp / m.derived.maxHp, B.hp);
  if (head && weapon.manaCost > 0) { by -= B.h + 1; bar(ctx, x, by, m.mana / m.derived.maxMana, m.mana >= weapon.manaCost ? B.mana : B.tapped); }
  if (m.signature && m.signature.shape === "charge") { by -= B.h + 1; bar(ctx, x, by, m.charge / m.signature.threshold, THEME.charge.fill); }
}
