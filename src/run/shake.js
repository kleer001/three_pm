// Impact screen shake. Two reality-based mechanisms, tuned per "kind" in BALANCE.shake
// (authored in art-test/screen-shake.html):
//   • Trauma + smoothed-noise (Eiserloh, GDC 2016): a hit adds trauma (0..1) that decays; the
//     per-frame amount is trauma^exponent (perceptual), and offsets come from value noise sampled
//     over time — separate streams for x, y, rotation — never raw per-frame random.
//   • Directional kick: a hit shoves the camera along the impact direction; a damped spring
//     (stiffness/damping) pulls it home with optional overshoot.
//
// One controller owns the live state. runRender reads offset(); impact sites push addShake(kind)
// or addKick(kind, dx, dy). Overlapping shakes share one trauma pool + one kick offset; the
// dominant kind's profile (the strongest still-active one) drives the noise/spring character, so a
// tiny tap mid-explosion doesn't hijack the boom's feel.
import { BALANCE } from "./balance.js";

const DEG = Math.PI / 180;

function hash(n) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967295 * 2 - 1;
}
function noise(seed, x) {
  const s = Math.imul(seed, 0x9e3779b1) | 0;
  const xi = Math.floor(x), xf = x - xi, u = xf * xf * (3 - 2 * xf);
  return hash((xi | 0) + s) + (hash((xi + 1 | 0) + s) - hash((xi | 0) + s)) * u;
}

export function createShake() {
  const KINDS = BALANCE.shake;
  let trauma = 0, clock = 0;
  let kx = 0, ky = 0, kvx = 0, kvy = 0;   // kick offset + velocity (damped spring)
  let p = KINDS.boom;                       // current dominant profile

  const adopt = (r) => { if (r.trauma >= trauma) p = r; }; // bigger-or-equal hit takes the character

  function addShake(kind) {
    const r = KINDS[kind]; if (!r) return;
    adopt(r); trauma = Math.min(1, trauma + r.trauma);
  }
  function addKick(kind, dx, dy) {
    const r = KINDS[kind]; if (!r) return;
    adopt(r); trauma = Math.min(1, trauma + r.trauma);
    if (r.kickMag) { const m = Math.hypot(dx, dy) || 1; kx += dx / m * r.kickMag; ky += dy / m * r.kickMag; }
  }
  function step(dt) {
    clock += dt;
    trauma = Math.max(0, trauma - p.recovery * dt);
    const ax = -p.stiffness * kx - p.damping * kvx, ay = -p.stiffness * ky - p.damping * kvy;
    kvx += ax * dt; kvy += ay * dt; kx += kvx * dt; ky += kvy * dt;
  }
  function offset() {
    const s = Math.pow(trauma, p.exponent), f = clock * p.frequency;
    return { dx: p.maxOffset * s * noise(1, f) + kx, dy: p.maxOffset * s * noise(2, f) + ky,
             angle: p.maxAngle * DEG * s * noise(3, f) };
  }
  return { addShake, addKick, step, offset };
}
