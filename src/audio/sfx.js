// Procedural sound effects — synthesized at runtime via the Web Audio API, zero asset
// files. Like the art (CLAUDE.md: assets are droppable), audio is non-essential: if the
// browser has no AudioContext, or the user mutes, every call is a silent no-op and the
// game runs unchanged. One singleton, imported wherever a game event wants a sound.
//
// The event vocabulary (the `play(name)` keys) is the hook taxonomy the rest of the code
// fires through — combatKit/runScene call play() at chokepoints, this maps names→synths.
// New event → one entry in SFX, picked up everywhere that name is already fired.

// Per-play knobs per event. `vary` = pitch randomization in cents (±), so identical
// sounds fired many times a second don't phase-stack into a grating tone. `debounce` =
// minimum ms between two plays of the SAME event, dropping the acoustic pile-up when
// dozens land per frame. `gain` = base level (jittered ±5% per play).
const SFX = {
  // Player/ally projectile launch — bright square "pew", quick downward sweep.
  shoot:      { gain: 0.18, vary: 120, debounce: 45, make: (a, g) => tone(a, g, "square",   660, 440, 0.08) },
  // Enemy projectile — lower, duller triangle so incoming reads distinct from outgoing.
  enemyShoot: { gain: 0.15, vary: 100, debounce: 55, make: (a, g) => tone(a, g, "triangle", 320, 220, 0.10) },
  // Nova / charge release — short bright noise pop with a body tone.
  nova:       { gain: 0.30, vary:  60, debounce: 60, make: (a, g) => boom(a, g, 1400, 180, 0.22) },
  // Lingering field deployed — soft low pulse, not a bang (it ticks, doesn't blast).
  field:      { gain: 0.16, vary:  40, debounce: 120, make: (a, g) => tone(a, g, "sine",     180, 140, 0.18) },
  // Melee arc — airy band-passed whoosh.
  swing:      { gain: 0.20, vary: 100, debounce: 45, make: (a, g) => whoosh(a, g, 1600, 0.10) },
  // Enemy took damage — crisp high-passed tick. Highest-density sound, so most jitter.
  hit:        { gain: 0.16, vary: 150, debounce: 35, make: (a, g) => whoosh(a, g, 3200, 0.05) },
  // Hero/ally took damage — harsher, lower, alerting; clearly not an enemy-hit tick.
  hurt:       { gain: 0.34, vary:  70, debounce: 80, make: (a, g) => boom(a, g, 800, 120, 0.20) },
  // Enemy froze (freeze-stack stand-in for a kill) — glassy descending chime.
  freeze:     { gain: 0.20, vary:  80, debounce: 50, make: (a, g) => tone(a, g, "triangle", 1100, 300, 0.16) },
  // Enemy died — noise crunch over a sine sub-bass thump (layered: body + low end) for punch.
  death:      { gain: 0.26, vary: 120, debounce: 40, make: (a, g) => { boom(a, g, 900, 90, 0.28); tone(a, g, "sine", 110, 45, 0.30); } },
  // Bomb / big detonation — the bassiest, longest hit; noise body + deep sine drop under it.
  explode:    { gain: 0.40, vary:  50, debounce: 70, make: (a, g) => { boom(a, g, 1200, 70, 0.42); tone(a, g, "sine", 120, 40, 0.50); } },
  // Powerup collected — bright ascending two-note arpeggio, musical and rewarding.
  pickup:     { gain: 0.30, vary:  20, debounce: 60, make: (a, g) => arp(a, g, [523, 784], 0.16) },
  // Run won — ascending major triad stinger.
  win:        { gain: 0.40, vary:   0, debounce: 0,  make: (a, g) => arp(a, g, [523, 659, 784], 0.5) },
  // Run lost — slow descending tone.
  lose:       { gain: 0.40, vary:   0, debounce: 0,  make: (a, g) => tone(a, g, "sawtooth", 330, 110, 0.6) },
  // A hero dies — a wailing, vibrato'd downward cry (synth stand-in for a real scream sample).
  scream:     { gain: 0.42, vary:  60, debounce: 250, make: (a, g) => scream(a, g, 0.55) },
  // --- UI / menu blips (sample-overridable via SAMPLES) ---
  uiMove:     { gain: 0.18, vary:   0, debounce: 30, make: (a, g) => tone(a, g, "sine", 480, 520, 0.05) }, // navigation tick
  uiSelect:   { gain: 0.28, vary:   0, debounce: 40, make: (a, g) => tone(a, g, "sine", 660, 880, 0.08) }, // confirm / pick
  uiBack:     { gain: 0.22, vary:   0, debounce: 40, make: (a, g) => tone(a, g, "sine", 560, 360, 0.09) }, // cancel / close
};

// Optional sample layer (droppable, like art): event name → a file (or array of files for
// round-robin variants) under assets/sfx/. When files load, play() uses a SAMPLE instead of
// the synth recipe; if a file is absent (404) or won't decode, the recipe stands in — the
// game never depends on a file existing. Any event in SFX can be sample-backed here.
const SAMPLES = {
  shoot:      "assets/sfx/shoot.wav",
  swing:      "assets/sfx/swing.wav",
  hit:        "assets/sfx/hit.wav",
  freeze:     "assets/sfx/freeze.wav",
  nova:       "assets/sfx/nova.wav",
  field:      "assets/sfx/field.wav",
  enemyShoot: "assets/sfx/enemyShoot.wav",
  explode:    "assets/sfx/explode.wav",
  hurt:       "assets/sfx/hurt.wav",
  scream:     "assets/sfx/scream.wav",
  pickup:     "assets/sfx/pickup.wav",
  lose:       "assets/sfx/lose.wav",
  uiMove:     "assets/sfx/uiMove.wav",
  uiSelect:   "assets/sfx/uiSelect.wav",
  uiBack:     "assets/sfx/uiBack.wav",
  win:        "assets/sfx/win.wav",
  death:      "assets/sfx/death.wav",
};
const buffers = {}; // event → array of decoded AudioBuffers, present once ≥1 file loads OK

const MAX_VOICES = 24;      // global concurrent-node cap; new sounds drop when saturated
const MAX_RATE_VARY = 0.08; // ±8% playback-rate jitter on noise bursts (research: 5–12%)

let ctx = null;             // lazily created on first gesture (autoplay policy)
let master = null;          // master gain → destination; doubles as the mute switch
let noiseBuf = null;        // one reused white-noise buffer for all noise bursts
let voices = 0;             // live source nodes, for the polyphony cap
let muted = false;
const lastPlay = {};        // event name → ctx-time of its last play, for debounce

// Create the context + master bus on demand. Browsers start an AudioContext "suspended"
// until a user gesture, so this is wired to the first input event below. Guarded: a
// browser with no Web Audio leaves ctx null and every play() falls through to silence.
function ensure() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(ctx.destination);
  const n = ctx.sampleRate; // 1s of white noise, sampled by every burst at a random offset
  noiseBuf = ctx.createBuffer(1, n, n);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  preloadSamples();
}

// Kick off the optional sample loads once (ensure() runs its body only once). A failed or
// missing file simply never populates `buffers`, leaving that event on its synth recipe.
function preloadSamples() {
  for (const name in SAMPLES) {
    const urls = Array.isArray(SAMPLES[name]) ? SAMPLES[name] : [SAMPLES[name]];
    for (const url of urls) {
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : null)) // 404/missing → no buffer, stay procedural
        .then((b) => b && ctx.decodeAudioData(b))
        .then((buf) => { if (buf) (buffers[name] || (buffers[name] = [])).push(buf); })
        .catch(() => {}); // unreachable / undecodable → stay procedural (droppable asset)
    }
  }
}

// Resume on the first real gesture (autoplay policy; also covers itch.io's iframe, which
// needs an in-frame interaction). Toggle mute on M. Attached once at module load.
function arm() {
  ensure();
  if (ctx && ctx.state === "suspended") ctx.resume();
}
if (typeof addEventListener !== "undefined") { // browser-only; the module imports clean under Node (tests/gauntlet.mjs)
  addEventListener("keydown", (e) => { if (e.code === "KeyM") toggleMute(); else arm(); });
  addEventListener("pointerdown", arm);
  addEventListener("touchstart", arm, { passive: true });
}

// A gain node with a fast attack + exponential decay to `dur` — the shared envelope. Use
// a tiny floor (exponentialRamp can't reach 0) then hard-stop the source at `dur`.
function envGain(peak, dur) {
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return g;
}

// Track a started source against the voice cap and auto-disconnect it when it ends, so
// nodes don't leak (OscillatorNode/AudioBufferSourceNode are one-shot — new node per play).
function track(src, chainHead) {
  voices++;
  src.onended = () => { voices--; chainHead.disconnect(); };
}

// --- synth primitives: each builds its graph onto `out` (the per-play, jittered gain) ---

// A pitched blip: oscillator sweeping f0→f1 over dur, through the envelope.
function tone(detune, out, type, f0, f1, dur) {
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  o.detune.value = detune;
  const g = envGain(0.9, dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + dur);
  track(o, o);
}

// A noise burst through a lowpass sweeping down — body of hits, deaths, explosions.
// `f0`→`f1` is the cutoff sweep; lower f1 = heavier/bassier thud.
function boom(detune, out, f0, f1, dur) {
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.playbackRate.value = 1 + (Math.random() * 2 - 1) * MAX_RATE_VARY + detune / 1200;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(f0, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  const g = envGain(0.9, dur);
  s.connect(lp).connect(g).connect(out);
  s.start(t); s.stop(t + dur);
  track(s, s);
}

// A short band-passed noise tick/whoosh — swings and enemy hits. `freq` sets the band.
function whoosh(detune, out, freq, dur) {
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.playbackRate.value = 1 + (Math.random() * 2 - 1) * MAX_RATE_VARY + detune / 1200;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = 1.2;
  const g = envGain(0.9, dur);
  s.connect(bp).connect(g).connect(out);
  s.start(t); s.stop(t + dur);
  track(s, s);
}

// A wailing cry: a sawtooth swept downward with fast vibrato (an LFO modulating the
// pitch) — a death-scream stand-in. A real recorded scream would land harder; this is the
// asset-free placeholder behind the same `scream` hook.
function scream(detune, out, dur) {
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(720, t);
  o.frequency.exponentialRampToValueAtTime(180, t + dur);
  o.detune.value = detune;
  const lfo = ctx.createOscillator(); // vibrato: wobble the pitch ±55 Hz at 16 Hz
  lfo.type = "sine";
  lfo.frequency.value = 16;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 55;
  lfo.connect(lfoGain).connect(o.frequency);
  const g = envGain(0.9, dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + dur);
  lfo.start(t); lfo.stop(t + dur);
  lfo.onended = () => lfoGain.disconnect();
  track(o, o);
}

// An ascending arpeggio of sine blips — pickups and the victory stinger.
function arp(detune, out, freqs, total) {
  const step = total / freqs.length;
  freqs.forEach((f, i) => {
    const t = ctx.currentTime + i * step;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + step);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + step);
    track(o, o);
  });
}

function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.6;
  return muted;
}

// Fire a sound by event name. Cheap, fire-and-forget, safe to call every frame: no-ops
// when audio is unavailable/muted, when the same event replayed inside its debounce, or
// when the voice cap is saturated. Unknown names no-op (a hook can name a sound before
// its recipe exists).
function play(name) {
  if (!ctx || muted || voices >= MAX_VOICES) return;
  const def = SFX[name];
  const bufs = buffers[name];
  if (!def && !bufs) return; // unknown event with no loaded sample
  const debounce = def ? def.debounce : 50;
  const t = ctx.currentTime;
  if (debounce && lastPlay[name] != null && (t - lastPlay[name]) * 1000 < debounce) return;
  lastPlay[name] = t;
  const out = ctx.createGain();
  out.gain.value = (def ? def.gain : 0.6) * (0.95 + Math.random() * 0.1); // ±5% volume jitter
  out.connect(master);
  const cents = (Math.random() * 2 - 1) * (def ? def.vary : 60); // ±vary cents pitch jitter
  if (bufs) playBuffer(bufs[Math.floor(Math.random() * bufs.length)], out, cents); // round-robin a loaded sample
  else def.make(cents, out);
}

// Fire-and-forget a decoded sample through `out`, pitch-jittered by `cents` (detune in
// cents → playbackRate ratio). One-shot source, tracked + auto-disconnected like the synths.
function playBuffer(buf, out, cents) {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.playbackRate.value = Math.pow(2, cents / 1200);
  s.connect(out);
  s.start(ctx.currentTime);
  track(s, s);
}

export const sfx = { play, toggleMute, isMuted: () => muted };
