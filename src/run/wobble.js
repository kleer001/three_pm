// Deterministic "hand-drawn boil" jitter, ported verbatim from art-test/wobble.html.
// jit(id, k, wf, amp) returns a stable offset in [-amp, amp] that is constant within a
// held wobble-frame and only re-rolls when `wf` changes — so a cell shudders in discrete
// snaps (the boil), not a per-render-frame vibration (which reads as TV static). Keyed by
// `id` (per-cell, so cells don't move in lockstep), `k` (axis: 0=x, 1=y), and `wf` (the
// slow wobble-frame index, e.g. (clock*hz)|0). Caller rounds for the crisp pixel-snap.
export function jit(id, k, wf, amp) {
  const seed = id * 73 + k * 131 + wf * 977;
  const h = Math.sin(seed) * 43758.5453;
  return ((h - Math.floor(h)) - 0.5) * 2 * amp;
}
