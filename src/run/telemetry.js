// Optional gameplay telemetry (see docs/playtesting-and-launch-roadmap.md §2 and
// docs/playtest-session-kit.md for the index.html snippet that turns this on).
//
// DROPPABLE, like art (CLAUDE.md "Art is isolated from game code"): the game must
// boot and play identically with analytics absent, ad-blocked, or offline. This
// module is the single funnel every gameplay event passes through. It sends to
// PostHog when the page provides `window.posthog` (its loader snippet, pasted into
// index.html), and is an EXPLICIT no-op otherwise — a disabled feature with a
// one-time console note, not a silent fallback hiding a bug. The try/catch guards a
// genuine trust boundary (third-party code + network), so a tester's blocker can't
// white-screen the descent; a bug in OUR own props object still throws at the call
// site, before it reaches the sink.
//
// Privacy: PostHog can run cookieless (no consent banner). We never send names,
// inputs, or free text — only the flat run metrics below. Local dev has no snippet,
// so it sends nothing.

let noted = false; // one-time "telemetry off" note, so missing analytics is visible but not spammy

// Resolve the sink each call (cheap): PostHog's loader may set window.posthog after
// boot, and we want to pick it up without a restart. Returns null when disabled.
function sink() {
  const ph = typeof window !== "undefined" ? window.posthog : null;
  if (ph && typeof ph.capture === "function") return ph;
  if (!noted) {
    noted = true;
    if (typeof console !== "undefined") console.info("[telemetry] disabled — no analytics snippet on page");
  }
  return null;
}

// Fire one named event with flat string/number props (the shape PostHog funnels and
// breakdowns expect). Transport errors are swallowed by design; see the header.
export function track(event, props) {
  const s = sink();
  if (!s) return;
  try { s.capture(event, props); } catch (_) { /* analytics must never break play */ }
}

// A short opaque id to correlate the events of one run (run_start → band_reached → run_end)
// into a funnel, without identifying the player. Not persisted; new per run.
export function newRunId() {
  return Math.random().toString(36).slice(2, 10);
}
