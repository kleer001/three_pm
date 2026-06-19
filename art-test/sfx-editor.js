// SFX editor engine — offline DSP. Loads the candidate samples picked in sfx-candidates.html,
// steps through each game-event slot, and crops / layers / applies an animatable FX rack into a
// baked WAV the game can load (plus a re-editable recipe). Sandbox tool: imports nothing from the
// game and writes nothing into src/ or assets/ — the game still boots without any of this.
//
// All rendering is manual DSP on Float32Array, NOT the Web Audio graph: native playbackRate/detune
// couple pitch to duration, so a time-preserving pitch envelope is impossible through the graph.
// The AudioContext is used only to decode source files and to play back the rendered preview.

const BASE = "sfx-preview/";              // pool samples + manifest live here (relative; Pages-safe)
const POOL = BASE + "pool/";

// ---------------------------------------------------------------- audio context (lazy)
let ctx = null;
function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();
  return ctx;
}
addEventListener("pointerdown", () => { ensureCtx(); if (ctx.state === "suspended") ctx.resume(); });

export const sampleRate = () => ensureCtx().sampleRate;

const decoded = {};                       // sourceFile -> mono Float32Array @ ctx.sampleRate
export async function decodeMono(file) {
  if (decoded[file]) return decoded[file];
  const url = file.startsWith("pool/") ? BASE + file : POOL + file;
  const buf = await fetch(url).then(r => r.arrayBuffer()).then(b => ensureCtx().decodeAudioData(b));
  const n = buf.length, mono = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += ch[i] / buf.numberOfChannels;
  }
  decoded[file] = mono;
  return mono;
}

// ---------------------------------------------------------------- lane configs + mappings
const SR_NYQ = () => ensureCtx().sampleRate / 2;
const cutoffHz = v => 20 * Math.pow(SR_NYQ() / 20, Math.max(0, Math.min(1, v)));
const stretchMap = v => Math.pow(2, (v - 0.5) * 2);     // 0.5×..2×, unity at v=.5
const pitchRatio = v => Math.pow(2, (v - 0.5) * 2);     // ±1 octave, unity at v=.5
const MAXHOLD = 50;                                     // decimation: samples held at full crush
const fmtHz = f => f >= 1000 ? (f / 1000).toFixed(1) + "k" : Math.round(f) + "";

// key, label, accent, default value, optional y-snap steps, value formatter, range caption
export const LANES = [
  { key: "pitch",    label: "Pitch",        color: "#c4322b", def: 0.5, snap: 24,
    fmt: v => { const s = (v - 0.5) * 24; return (s >= 0 ? "+" : "") + s.toFixed(0) + " st"; }, read: "-12 … +12 st" },
  { key: "gain",     label: "Gain (fades)", color: "#2f8f4e", def: 1.0,
    fmt: v => v.toFixed(2) + "×", read: "0 … 1 (fades)" },
  { key: "bits",     label: "Bitcrush",     color: "#7a4fd0", def: 1.0,
    fmt: v => (1 + v * 15).toFixed(1) + " bit", read: "16 … 1 bit" },
  { key: "decimate", label: "Sample-rate",  color: "#b06a12", def: 1.0,
    fmt: v => "÷" + Math.round(1 + (1 - v) * (MAXHOLD - 1)), read: "full … crush" },
  { key: "lpCutoff", label: "LP filter",    color: "#2563c4", def: 1.0,
    fmt: v => fmtHz(cutoffHz(v)) + " Hz", read: "lowpass cutoff" },
  { key: "hpCutoff", label: "HP filter",    color: "#1f9bb0", def: 0.0,
    fmt: v => fmtHz(cutoffHz(v)) + " Hz", read: "highpass cutoff" },
  { key: "drive",    label: "Drive",        color: "#d04f9a", def: 0.0,
    fmt: v => (v * 100).toFixed(0) + "%", read: "clean … hot" },
  { key: "stretch",  label: "Time-stretch", color: "#168a8a", def: 0.5,
    fmt: v => stretchMap(v).toFixed(2) + "×", read: "0.5 … 2× length" },
  { key: "ringmod",  label: "Ring mod",     color: "#888888", def: 0.0,
    fmt: v => (v * 2000).toFixed(0) + " Hz", read: "0 … 2 kHz" },
];
const LANE = Object.fromEntries(LANES.map(l => [l.key, l]));

function defaultEnvelopes() {
  const e = {};
  for (const l of LANES) e[l.key] = [{ t01: 0, v01: l.def }, { t01: 1, v01: l.def }];
  return e;
}
function defaultEcho() { return { time: 0.09, feedback: 0.0, mix: 0.0, tailCap01: 1 }; }

// linear-interp sampler over a sorted keyframe array — the single sampler the render chain calls
function sampleEnv(kf, t01) {
  if (t01 <= kf[0].t01) return kf[0].v01;
  const last = kf[kf.length - 1];
  if (t01 >= last.t01) return last.v01;
  for (let i = 1; i < kf.length; i++) {
    if (t01 <= kf[i].t01) {
      const a = kf[i - 1], b = kf[i], f = (t01 - a.t01) / (b.t01 - a.t01 || 1);
      return a.v01 + (b.v01 - a.v01) * f;
    }
  }
  return last.v01;
}
const isFlat = (kf, val) => kf.every(p => Math.abs(p.v01 - val) < 1e-4);

// ---------------------------------------------------------------- DSP primitives
function linInterp(a, x) {
  if (x <= 0 || x >= a.length - 1) return 0;
  const i = x | 0, f = x - i;
  return a[i] * (1 - f) + a[i + 1] * f;
}

// Time-preserving (and time-stretching) granular overlap-add. Output advances at a fixed hop while
// the input read pointer advances at 1/stretch; each grain is resampled by the pitch ratio r, which
// shifts pitch without changing how fast we traverse the clip. Caveat: plain OLA smears transients
// on percussive SFX — keep pitch moves modest on hits/explosions.
function granular(input, pitchKf, stretchKf) {
  const M = input.length, G = 1024, H = 256, half = G >> 1;
  const hann = new Float32Array(G);
  for (let k = 0; k < G; k++) hann[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (G - 1));
  const cap = Math.ceil(M * 2.2) + G;
  const out = new Float32Array(cap), win = new Float32Array(cap);
  let pIn = 0, pOut = 0;
  while (pIn < M && pOut < cap - G) {
    const t01 = Math.min(1, pIn / M);
    const r = pitchRatio(sampleEnv(pitchKf, t01));
    const st = stretchMap(sampleEnv(stretchKf, t01));
    const base = Math.round(pOut);
    for (let k = 0; k < G; k++) {
      const oi = base + k - half;
      if (oi < 0 || oi >= cap) continue;
      out[oi] += linInterp(input, pIn + (k - half) * r) * hann[k];
      win[oi] += hann[k];
    }
    pIn += H / st;
    pOut += H;
  }
  const L = Math.min(cap, Math.round(pOut) + half);
  const res = new Float32Array(L);
  for (let i = 0; i < L; i++) res[i] = win[i] > 1e-6 ? out[i] / win[i] : 0;
  return res;
}

// One RBJ biquad pass with a per-sample cutoff (Q≈0.707). type: "lp" | "hp".
function biquad(buf, kf, type) {
  const sr = ensureCtx().sampleRate, Q = 0.7071, n = buf.length;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const f0 = cutoffHz(sampleEnv(kf, i / n));
    const w0 = (2 * Math.PI * f0) / sr, cw = Math.cos(w0), sw = Math.sin(w0), alpha = sw / (2 * Q);
    let b0, b1, b2;
    if (type === "lp") { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
    else { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
    const a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
    const x = buf[i];
    const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    buf[i] = y;
  }
}

// Feedback delay; returns a possibly-longer buffer with the (capped, faded) echo tail appended.
function echo(input, e) {
  const sr = ensureCtx().sampleRate, inLen = input.length;
  if (e.mix <= 0 || e.feedback <= 0) return input;
  const D = Math.max(1, Math.round(e.time * sr));
  const fullTail = Math.ceil((Math.log(1e-3) / Math.log(e.feedback)) * D);
  const tail = Math.max(0, Math.round(fullTail * e.tailCap01));
  const extLen = inLen + tail;
  const dl = new Float32Array(extLen), out = new Float32Array(extLen);
  for (let i = 0; i < extLen; i++) {
    const x = i < inLen ? input[i] : 0;
    const dRead = i >= D ? dl[i - D] : 0;
    dl[i] = x + e.feedback * dRead;
    out[i] = x + e.mix * dRead;
  }
  const fade = Math.min(tail, Math.round(0.12 * sr));      // fade the very end into the cap
  for (let i = 0; i < fade; i++) out[extLen - 1 - i] *= i / fade;
  return out;
}

// ---------------------------------------------------------------- per-layer render (the FX chain)
function renderLayer(layer) {
  let buf = decoded[layer.sourceFile];
  if (!buf) return new Float32Array(0);
  if (layer.reverse) buf = buf.slice().reverse();

  const N = buf.length;
  const i0 = Math.max(0, Math.floor(layer.crop.start01 * N));
  const i1 = Math.min(N, Math.floor(layer.crop.end01 * N));
  buf = buf.slice(i0, Math.max(i0 + 1, i1));

  const e = layer.envelopes;
  // crop → time/pitch → ringmod → HP → LP → drive → bitcrush → decimate → gain → echo
  if (!(isFlat(e.pitch, 0.5) && isFlat(e.stretch, 0.5))) buf = granular(buf, e.pitch, e.stretch);
  const L = buf.length;

  if (!isFlat(e.ringmod, 0)) {
    const sr = ensureCtx().sampleRate; let ph = 0;
    for (let i = 0; i < L; i++) { const f = sampleEnv(e.ringmod, i / L) * 2000; buf[i] *= Math.sin(ph); ph += (2 * Math.PI * f) / sr; }
  }
  if (!isFlat(e.hpCutoff, 0)) biquad(buf, e.hpCutoff, "hp");
  if (!isFlat(e.lpCutoff, 1)) biquad(buf, e.lpCutoff, "lp");
  if (!isFlat(e.drive, 0)) for (let i = 0; i < L; i++) { const d = sampleEnv(e.drive, i / L); buf[i] = Math.tanh(buf[i] * (1 + d * 15)); }
  if (!isFlat(e.bits, 1)) for (let i = 0; i < L; i++) { const step = 2 / Math.pow(2, 1 + sampleEnv(e.bits, i / L) * 15); buf[i] = Math.round(buf[i] / step) * step; }
  if (!isFlat(e.decimate, 1)) {
    let held = 0, ctr = 0;
    for (let i = 0; i < L; i++) {
      const hold = Math.round(1 + (1 - sampleEnv(e.decimate, i / L)) * (MAXHOLD - 1));
      if (ctr <= 0) { held = buf[i]; ctr = hold; } buf[i] = held; ctr--;
    }
  }
  for (let i = 0; i < L; i++) buf[i] *= sampleEnv(e.gain, i / L);   // gain lane = fades + volume
  buf = echo(buf, layer.echo);
  return buf;
}

// ---------------------------------------------------------------- slot render (mix + normalize)
export function renderSlot(recipe, soloIdx = null) {
  const rendered = recipe.layers.map((l, i) => (soloIdx != null && soloIdx !== i) ? null : renderLayer(l));
  const lens = rendered.map(r => r ? r.length : 0);
  const longest = Math.max(1, ...lens);
  let total = 1;
  recipe.layers.forEach((l, i) => { if (rendered[i]) total = Math.max(total, Math.round(l.offset01 * longest) + lens[i]); });
  const mix = new Float32Array(total);
  recipe.layers.forEach((l, i) => {
    if (!rendered[i]) return;
    const off = Math.round(l.offset01 * longest);
    for (let k = 0; k < lens[i]; k++) mix[off + k] += rendered[i][k];
  });
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(mix[i]));
  const g = (recipe.master.normalize && peak > 1e-6 ? 1 / peak : 1) * recipe.master.gain;
  if (g !== 1) for (let i = 0; i < total; i++) mix[i] *= g;
  return mix;
}

// ---------------------------------------------------------------- WAV encode + preview playback
export function encodeWav(float32, sr) {
  const n = float32.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true); ws(36, "data"); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

let lastSrc = null;
export function playFloat(float32) {
  const c = ensureCtx();
  if (c.state === "suspended") c.resume();
  if (lastSrc) try { lastSrc.stop(); } catch {}
  const ab = c.createBuffer(1, Math.max(1, float32.length), c.sampleRate);
  ab.copyToChannel(float32, 0);
  const src = c.createBufferSource();
  src.buffer = ab; src.connect(c.destination); src.start();
  lastSrc = src;
  return float32.length / c.sampleRate;
}

// ---------------------------------------------------------------- slot/recipe construction
export function makeLayer(sourceFile) {
  return { sourceFile, reverse: false, crop: { start01: 0, end01: 1 }, offset01: 0,
           echo: defaultEcho(), envelopes: defaultEnvelopes() };
}
export function makeRecipe(event, files) {
  return { event, sampleRate: ensureCtx().sampleRate, master: { normalize: true, gain: 1 },
           layers: files.map(makeLayer) };
}

// picks { event: [file|"synth"] } -> ordered recipes for events with ≥1 real sample
export function slotsFromPicks(picks) {
  const out = [];
  for (const event in picks) {
    const files = picks[event].filter(f => f && f !== "synth").map(f => f.startsWith("pool/") ? f : "pool/" + f);
    if (files.length) out.push(makeRecipe(event, files));
  }
  return out;
}

export { LANE, sampleEnv, defaultEcho };
