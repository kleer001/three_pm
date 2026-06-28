// All world + HUD drawing for the run scene: textured (dual-grid) or flat ground,
// the "holes in reality" void compositing, every entity/effect layer, the HUD, the
// touch joystick, and the pause overlay. Pure presentation — it reads live game
// state through env (by reference) and never mutates it (beyond a transient camera
// jitter for screen shake that it restores). Built once per run via
// createRunRenderer(env); the tile atlas is a droppable asset loaded lazily here.
import { TILE } from "./levelgen.js";
import { BALANCE, THEME } from "./balance.js";
import { createVoidRenderer } from "./voidBackgrounds.js";
import { disc, ring, bar, glyph, drawMember } from "./draw.js";

const GLOW_BLUR = 6;
const GLOW_COLOR = "rgba(165,205,255,1)";
const GLOW_GAIN = 1.5;
const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]; // ordered dither base for the void dissolve

// Per-level void-dissolve style (see balance.voidDissolve.styles). The run picks one, salted with a
// per-run seed, so every descent's tear edge looks different but stays reproducible. The threshold
// field decides, for each sub-cell, the reveal level at which it flips to void; the dissolve grows
// as the cell's reveal (0→1) crosses more thresholds. Default = the crisp Bayer look.
const DEFAULT_DISSOLVE_STYLE = { pattern: "bayer", size: 8, sizeVar: 0, shuffle: 0, boil: 0, nscale: 0.2, seed: 0 };
function dhash(x, y, s) { let h = (x * 374761393 + y * 668265263 + (s | 0) * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return (h ^ (h >>> 16)) >>> 0; }
const dnf = (x, y, s) => dhash(x, y, s) / 4294967296;
const dsstep = (a) => a * a * (3 - 2 * a);
function dvnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = dsstep(x - xi), yf = dsstep(y - yi);
  const L = (a, b, f) => a + (b - a) * f, c = (dx, dy) => dnf(xi + dx, yi + dy, s);
  return L(L(c(0, 0), c(1, 0), xf), L(c(0, 1), c(1, 1), xf), yf);
}
// reveal threshold in [0,1) for sub-cell (ix,iy) of cell (cx,cy) under style `st` at boil frame
function dissolveThreshold(st, cx, cy, ix, iy, frame) {
  switch (st.pattern) {
    case "bayerCell": { const h = st.shuffle ? dhash(cx, cy + frame * 101, st.seed) : 0; const ox = h & 3, oy = (h >> 2) & 3, fl = (h >> 4) & 1, a = (iy + oy) & 3, b = (ix + ox) & 3; return (BAYER4[fl ? b : a][fl ? a : b] + 0.5) / 16; }
    case "hash": return dnf(cx * 64 + ix, cy * 64 + iy + frame * 977, st.seed);
    case "value": { const s = st.nscale; return dvnoise((cx * 16 + ix) * s + frame * 0.7, (cy * 16 + iy) * s, st.seed); }
    case "worley": {
      const s = st.nscale, gx = (cx * 16 + ix) * s, gy = (cy * 16 + iy) * s, fx = Math.floor(gx), fy = Math.floor(gy); let best = 9;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const px2 = fx + ox + dnf(fx + ox, fy + oy + frame * 53, st.seed), py2 = fy + oy + dnf(fx + ox + 99, fy + oy, st.seed); const d = (px2 - gx) ** 2 + (py2 - gy) ** 2; if (d < best) best = d; }
      return Math.min(1, Math.sqrt(best));
    }
    default: return (BAYER4[iy & 3][ix & 3] + 0.5) / 16; // "bayer"
  }
}
// per-cell dither square size in px (base ± seeded jitter)
function dissolveCellSize(st, cx, cy) {
  if (!st.sizeVar) return st.size;
  const j = (dnf(cx * 7 + 1, cy * 7 + 1, st.seed) * 2 - 1) * st.sizeVar;
  return Math.max(2, Math.min(24, Math.round(st.size * (1 + j))));
}

// Per-type shaft wave (the `wave` on each voidTentacle TENTACLE_TYPE): maps (f along shaft 0..1,
// time s, per-tentacle seed) to a perpendicular displacement in ~[-1.5,1.5], scaled by THEME
// waveAmp. The motion reads the threat at a glance — drag CURLS, knock WHIPS, root SNAKES.
const TENTACLE_WAVES = {
  snake: (f, t, s) => Math.sin(f * Math.PI * 2 - t * 6 + s),
  whip:  (f, t, s) => f * Math.sin(f * 4 - t * 9 + s) * 1.4,
  curl:  (f, t, s) => f * f * Math.sin(t * 3 + s) * 1.6,
};
// Dim a #rrggbb toward black by dimK, then lighten toward white by lightAmt (the telegraph band).
function shadeHex(hex, dimK, lightAmt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16 & 255) * dimK, g = (n >> 8 & 255) * dimK, b = (n & 255) * dimK;
  r += (255 - r) * lightAmt; g += (255 - g) * lightAmt; b += (255 - b) * lightAmt;
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}
// Telegraph band intensity at shaft fraction f for a band centred at p (0..1), or 0 if p is null.
function pulseAt(f, p, width, falloff) {
  return p == null ? 0 : Math.exp(-Math.pow(Math.abs((f - p) / width), falloff));
}

// Optional textured ground (assets/tiles.png). The game renders flat THEME.tile fills
// until this dual-grid atlas loads, and keeps doing so if it never does — tiles are a
// droppable asset. Material mapping: WALL→hedge, FLOOR→brick, paved→road, yard→grass
// base. RUBBLE is the void — it is NOT a dual-grid material; the churn punches through the
// tile it replaces (see drawDissolveMask), so RUBBLE maps to no material.
const TILE_TO_MAT = [];
TILE_TO_MAT[TILE.STREET] = TILE_TO_MAT[TILE.SIDEWALK] = TILE_TO_MAT[TILE.ALLEY] = "road";
TILE_TO_MAT[TILE.FLOOR] = "brick";
TILE_TO_MAT[TILE.WALL] = "hedge";
TILE_TO_MAT[TILE.YARD] = null;

let tileAtlas = null; // { sheet, ground, mats:{name:[16 frames]}, order:[names] }
(function loadTileAtlas() {
  fetch(new URL("../../assets/tiles.json", import.meta.url))
    .then((r) => r.json())
    .then((desc) => new Promise((res) => {
      const img = new Image();
      img.onload = () => res({ desc, img });
      img.onerror = () => res(null); // missing png → stay on flat fills
      img.src = new URL("../../assets/" + desc.sheet, import.meta.url).href;
    }))
    .then((loaded) => {
      if (!loaded) return;
      const { desc, img } = loaded;
      const order = Object.keys(desc.materials); // priority order, last on top
      const mats = {};
      for (const m of order) {
        const arr = new Array(16);
        for (let c = 0; c < 16; c++) arr[c] = desc.frames[desc.materials[m][c]];
        mats[m] = arr;
      }
      tileAtlas = { sheet: img, ground: desc.frames[desc.ground], mats, order };
    })
    .catch(() => {}); // missing/bad json → stay on flat fills
})();

export function createRunRenderer({
  ctx, input, level, cam, hero, weapon, followers, enemies, shop,
  pickups, projectiles, blasts, swings, fields, deployables, floaters, debris, dustPuffs, voidFalling,
  voidTentacles,
  runState, bgId, getShake, getPaused, getVoidClock, getHeldLine, ts, viewW, viewH,
  getTearProgress = () => 0, getVoidOrig = () => 0,
  dissolveStyle = DEFAULT_DISSOLVE_STYLE,
}) {
  const TS = ts, VIEW_W = viewW, VIEW_H = viewH;
  const mapH = level.h * TS;
  const TILE_COLOR = THEME.tile;
  const LOOT = BALANCE.loot;

  // How "void" a logic cell is for the dissolve: 1 if it's an open hole (RUBBLE), else the tear
  // progress (0→1) ramping across the whole WOBBLE+FADE window so the surface crumbles into the
  // churn from the first frame of the transition (no separate telegraph beat).
  const cellReveal = (x, y) => {
    if (x < 0 || y < 0 || x >= level.w || y >= level.h) return 0;
    const i = y * level.w + x;
    if (level.tiles[i] === TILE.RUBBLE) return 1;
    return getTearProgress(i);
  };

  const voidRenderer = bgId ? createVoidRenderer(bgId, VIEW_W, VIEW_H) : null;
  const mkBuf = () => { const c = document.createElement("canvas"); c.width = VIEW_W; c.height = VIEW_H; return c; };
  const voidBuf = voidRenderer ? mkBuf() : null;
  const maskBuf = voidRenderer ? mkBuf() : null;
  const glowBuf = voidRenderer ? mkBuf() : null;
  const voidBufCtx = voidBuf ? voidBuf.getContext("2d") : null;
  const maskBufCtx = maskBuf ? maskBuf.getContext("2d") : null;
  const glowBufCtx = glowBuf ? glowBuf.getContext("2d") : null;

  // Dual-grid textured ground: a static grass base, then one offset pass per material.
  // Each display tile sits half a cell up-left of the logic grid and samples its 4 corner
  // cells (TL=1,TR=2,BR=4,BL=8) to pick an autotile, so an island's outline closes.
  // A void cell (RUBBLE) reads as the material it replaced (getVoidOrig), NOT as absence — so the
  // surrounding land stays continuous and does not round its corners around the hole; the void then
  // punches a hard square through that intact land (see drawDissolveMask).
  function drawTiles(x0, x1, y0, y1) {
    const A = tileAtlas, g = A.ground;
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        ctx.drawImage(A.sheet, g.x, g.y, g.w, g.h, Math.floor(tx * TS - cam.x), Math.floor(ty * TS - cam.y), TS + 1, TS + 1);
    const matCell = (x, y) => {
      if (x < 0 || y < 0 || x >= level.w || y >= level.h) return null;
      const i = y * level.w + x, t = level.tiles[i];
      return TILE_TO_MAT[t === TILE.RUBBLE ? getVoidOrig(i) : t];
    };
    const dx0 = Math.floor((cam.x - TS / 2) / TS), dx1 = Math.ceil((cam.x + VIEW_W) / TS);
    const dy0 = Math.floor((cam.y - TS / 2) / TS), dy1 = Math.ceil((cam.y + VIEW_H) / TS);
    for (const m of A.order) {
      const frames = A.mats[m];
      for (let y = dy0; y <= dy1; y++)
        for (let x = dx0; x <= dx1; x++) {
          const c = (matCell(x, y) === m ? 1 : 0) | (matCell(x + 1, y) === m ? 2 : 0) | (matCell(x + 1, y + 1) === m ? 4 : 0) | (matCell(x, y + 1) === m ? 8 : 0);
          if (!c) continue;
          const f = frames[c];
          ctx.drawImage(A.sheet, f.x, f.y, f.w, f.h, Math.floor(x * TS + TS / 2 - cam.x), Math.floor(y * TS + TS / 2 - cam.y), TS + 1, TS + 1);
        }
    }
  }

  // The void punches through the tile it replaces — it is NOT a dual-grid material. Each void cell
  // fills its own square footprint into `dst` (a destination-in mask for the churn); a cell mid-tear
  // crumbles in via this run's dissolve style (balance.voidDissolve, picked per level) — its sub-cell
  // threshold field vs the cell's reveal (0→1) — so the surface erodes with a ragged, cell-aligned
  // edge whose pattern/size differs every descent.
  function drawDissolveMask(dst, dx0, dx1, dy0, dy1) {
    const st = dissolveStyle;
    const frame = st.boil > 0 ? Math.floor(getVoidClock() * st.boil) : 0;
    dst.fillStyle = "#fff";
    for (let ty = dy0; ty <= dy1; ty++)
      for (let tx = dx0; tx <= dx1; tx++) {
        const r = cellReveal(tx, ty);
        if (r <= 0) continue;
        const sx = Math.floor(tx * TS - cam.x), sy = Math.floor(ty * TS - cam.y);
        if (r >= 1) { dst.fillRect(sx, sy, TS + 1, TS + 1); continue; }
        const size = dissolveCellSize(st, tx, ty);
        for (let py = 0; py < TS; py += size)
          for (let px = 0; px < TS; px += size)
            if (r > dissolveThreshold(st, tx, ty, (px / size) | 0, (py / size) | 0, frame))
              dst.fillRect(sx + px, sy + py, size, size);
      }
  }

  // Simple tapered glow (per the spec — not a segmented rope): the shaft is a smooth
  // gradient of overlapping discs from a thick rim base to a thin glowing bulb tip, tinted
  // from the tentacle's own color (so a future color reads at a glance). During the
  // telegraph it shows a pulsing ring + the locked-aim line — the dodge cue.
  function drawTentacles() {
    const T = THEME.voidTentacle, vc = getVoidClock();
    for (const t of voidTentacles.tentacles) {
      const bx = t.baseX - cam.x, by = t.baseY - cam.y, body = t.color;
      if (t.state === "telegraph") {
        const pulse = 0.5 + 0.5 * Math.sin(vc * T.pulseRate);
        ctx.globalAlpha = 0.4 + 0.4 * pulse;
        ring(ctx, bx, by, T.budR + 4 + pulse * 4, T.ring);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = T.aimLine;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + t.aimX * t.maxReach, by + t.aimY * t.maxReach);
        ctx.stroke();
      }
      // The bud IS the whole taper collapsed at the rim under one growing scale (budT) — no
      // separate circle, no pop. As the shaft extends (len grows) the discs unfurl and the wave
      // fades in; retract reverses both. budT runs 0→1 on bud and 1→0 on retract.
      const scale = (t.state === "bud" || t.state === "retract") ? t.budT : 1;
      const spread = Math.min(1, t.len / t.restLen); // length + wave appear only as the shaft extends
      // Telegraph charge band: rides base→tip over the telegraph window (lighter + glowier).
      const pc = t.state === "telegraph"
        ? Math.min(1, Math.max(0, 1 - t.timer / BALANCE.voidTentacle.telegraphT)) : null;
      const tipX = bx + t.aimX * t.len, tipY = by + t.aimY * t.len;
      const perpX = -t.aimY, perpY = t.aimX;              // unit normal to the aim — the wave pushes along it
      const wave = TENTACLE_WAVES[t.type.wave] || TENTACLE_WAVES.snake;
      const N = 14; // denser sampling so the waved curve stays smooth
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const f = i / N;
        const off = T.waveAmp * wave(f, vc, t.seed) * Math.min(1, f * 4) * spread; // pin the root, wave the rest
        pts.push({ x: bx + (tipX - bx) * f + perpX * off, y: by + (tipY - by) * f + perpY * off,
                   r: (T.baseR * (1 - f) + t.tipR * f) * scale, pulse: pulseAt(f, pc, T.pulseWidth, T.pulseFalloff) });
      }
      const a = t.state === "retract" ? 0.7 : 1;
      // same-color glow halo (brighter where the charge band rides), then the dimmed body on top
      ctx.save(); ctx.shadowColor = body; ctx.globalAlpha = a;
      for (const p of pts) { ctx.shadowBlur = T.glowBlur + p.pulse * T.pulseGlowBoost; disc(ctx, p.x, p.y, p.r, body); }
      ctx.restore();
      ctx.globalAlpha = a;
      for (const p of pts) disc(ctx, p.x, p.y, p.r, shadeHex(body, T.bodyDim, p.pulse * T.pulseLighten));
      ctx.globalAlpha = 1;
      // glowing bulb at the waved tip: a soft halo + a solid core
      const tip = pts[pts.length - 1], glow = 0.6 + 0.4 * Math.sin(vc * T.pulseRate + t.seed);
      ctx.globalAlpha = glow;
      disc(ctx, tip.x, tip.y, tip.r + 3, T.tipGlow);
      ctx.globalAlpha = 1;
      disc(ctx, tip.x, tip.y, tip.r, shadeHex(body, T.bodyDim, tip.pulse * T.pulseLighten));
    }
  }

  function render() {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    // Screen shake biases the camera by a random jitter for the world draw, undone before
    // the HUD so only the world shakes. Everything world-space reads cam.x/cam.y together.
    const shake = getShake();
    const shx = shake > 0 ? (Math.random() * 2 - 1) * shake : 0;
    const shy = shake > 0 ? (Math.random() * 2 - 1) * shake : 0;
    cam.x += shx; cam.y += shy;
    const x0 = Math.max(0, Math.floor(cam.x / TS)), x1 = Math.min(level.w - 1, Math.ceil((cam.x + VIEW_W) / TS));
    const y0 = Math.max(0, Math.floor(cam.y / TS)), y1 = Math.min(level.h - 1, Math.ceil((cam.y + VIEW_H) / TS));
    // A tearing cell needs no separate telegraph: the void's block dissolve (below) crumbles its
    // surface in from the first frame of the transition.
    if (tileAtlas) {
      drawTiles(x0, x1, y0, y1);
    } else for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const i = ty * level.w + tx;
        const sx = Math.floor(tx * TS - cam.x), sy = Math.floor(ty * TS - cam.y);
        ctx.fillStyle = TILE_COLOR[level.tiles[i]];
        ctx.fillRect(sx, sy, TS + 1, TS + 1);
        if (!level.walkable[i]) {
          ctx.fillStyle = THEME.obstacleDarken;
          ctx.fillRect(sx, sy, TS + 1, TS + 1);
        }
      }

    // Holes in reality: render the void into its buffer, punch it to the dissolve mask (the void
    // replaces whole tiles — it is not a dual-grid material), then composite over the scene with a
    // glowing blue rim.
    if (voidRenderer) {
      const vb = voidBufCtx;
      vb.clearRect(0, 0, VIEW_W, VIEW_H);
      voidRenderer.draw(vb, getVoidClock(), cam.y);
      maskBufCtx.clearRect(0, 0, VIEW_W, VIEW_H);
      drawDissolveMask(maskBufCtx, x0, x1, y0, y1);
      vb.save();
      vb.globalCompositeOperation = "destination-in";
      vb.drawImage(maskBuf, 0, 0);
      vb.restore();
      // Pre-blur the rim once: blur the hole-shaped void into glowBuf, tint it blue, then
      // composite glow (haloing the edges) + the sharp void on top.
      const gc = glowBufCtx;
      gc.globalCompositeOperation = "source-over";
      gc.clearRect(0, 0, VIEW_W, VIEW_H);
      gc.filter = `blur(${GLOW_BLUR}px)`;
      gc.drawImage(voidBuf, 0, 0);
      gc.filter = "none";
      gc.globalCompositeOperation = "source-in";
      gc.fillStyle = GLOW_COLOR;
      gc.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.save();
      ctx.globalAlpha = Math.min(1, GLOW_GAIN);
      ctx.drawImage(glowBuf, 0, 0);
      if (GLOW_GAIN > 1) { ctx.globalAlpha = GLOW_GAIN - 1; ctx.drawImage(glowBuf, 0, 0); }
      ctx.restore();
      ctx.drawImage(voidBuf, 0, 0);
    }

    ctx.fillStyle = THEME.homeBand;
    for (const [hx, hy] of level.homeBand)
      if (hx >= x0 && hx <= x1 && hy >= y0 && hy <= y1)
        ctx.fillRect(Math.floor(hx * TS - cam.x), Math.floor(hy * TS - cam.y), TS + 1, TS + 1);

    // Shop spots are structures — draw on the ground, under everything live.
    for (const s of shop.shops) {
      if (s.items.every((it) => it.bought)) continue;
      const sx = s.x - cam.x, sy = s.y - cam.y;
      ctx.fillStyle = THEME.shop.roof;
      ctx.fillRect(sx - s.r, sy - s.r - 4, s.r * 2, 6);
      disc(ctx, sx, sy, s.r, THEME.shop.fill);
      ring(ctx, sx, sy, s.r, THEME.shop.ring);
      glyph(ctx, "$", sx, sy + 5, THEME.shop.glyph, THEME.shop.glyphFont);
    }

    for (const f of fields) {
      disc(ctx, f.x - cam.x, f.y - cam.y, f.r, THEME.field.fill);
      ring(ctx, f.x - cam.x, f.y - cam.y, f.r, THEME.field.ring);
    }

    for (const d of deployables) {
      if (d.dead) continue;
      disc(ctx, d.x - cam.x, d.y - cam.y, d.r, THEME.deploy.fill);
      ring(ctx, d.x - cam.x, d.y - cam.y, d.r + 2, THEME.deploy.ring);
    }

    for (const d of debris) disc(ctx, d.x - cam.x, d.y - cam.y, d.r, THEME.pellet);

    for (const p of dustPuffs) {
      const k = p.t / p.life;
      ctx.globalAlpha = 1 - k;
      disc(ctx, p.x - cam.x, p.y - cam.y, p.r * (0.5 + k), THEME.dust);
      ctx.globalAlpha = 1;
    }

    for (const e of enemies)
      if (e.dead) disc(ctx, e.x - cam.x, e.y - cam.y, e.r, THEME.corpse);

    // Bodies sinking into a reality break: drawn in their own color, shrinking toward a pixel.
    for (const b of voidFalling) disc(ctx, b.x - cam.x, b.y - cam.y, b.r, b.color);

    // Void tentacles: drawn here (over the hole, under the members) so a struck member's disc
    // renders on top — the tentacle reads as gripping it.
    if (voidTentacles) drawTentacles();

    for (const p of pickups) {
      if (p.dead) continue;
      const px = p.x - cam.x, py = p.y - cam.y + Math.sin(p.t * LOOT.pickupBobRate) * LOOT.pickupBob;
      disc(ctx, px, py, p.r, THEME.pickup.fill);
      ring(ctx, px, py, p.r, THEME.pickup.ring);
      glyph(ctx, "+", px, py + 4, THEME.pickup.glyph, THEME.pickup.glyphFont);
    }

    // Piercing shots draw as a beam from launch origin to the live tip (a sin envelope
    // over the shot's life thins it at fire, swells it mid-flight, fades it out); the rest are dots.
    for (const p of projectiles) {
      if (p.pierce) {
        const env = Math.sin(Math.PI * (1 - p.life / p.life0));
        ctx.globalAlpha = Math.max(0, env);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = THEME.beam.width * env + 1;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.ox - cam.x, p.oy - cam.y);
        ctx.lineTo(p.x - cam.x, p.y - cam.y);
        ctx.stroke();
        ctx.globalAlpha = 1; ctx.lineWidth = 1;
      } else disc(ctx, p.x - cam.x, p.y - cam.y, p.shotR, p.color);
    }

    for (const e of enemies) {
      if (e.dead) continue;
      const sx = e.x - cam.x, sy = e.y - cam.y, k = e.def;
      disc(ctx, sx, sy, e.r, k.color);
      if (e.confuseT > 0) { disc(ctx, sx, sy, e.r, THEME.confuse.fill); ring(ctx, sx, sy, e.r + 2, THEME.confuse.ring); }
      else if (e.slowT > 0) disc(ctx, sx, sy, e.r, THEME.slow.fill);
      if (e.frozenT > 0) {
        disc(ctx, sx, sy, e.r, THEME.freeze.fill);
        ring(ctx, sx, sy, e.r + THEME.freeze.ringPad, THEME.freeze.ring);
      } else {
        if (e.def.behavior === "shooter" && e.state === "aim") {
          ring(ctx, sx, sy, e.r + THEME.rangedTelegraph.ringPad, THEME.rangedTelegraph.ring);
          ctx.strokeStyle = THEME.rangedTelegraph.line;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(hero.x - cam.x, hero.y - cam.y);
          ctx.stroke();
        }
        if (e.def.behavior === "charger" && (e.state === "telegraph" || e.state === "lunge")) {
          const tg = THEME.chargerTelegraph;
          ring(ctx, sx, sy, e.r + tg.ringPad, e.state === "lunge" ? tg.lunge : tg.ring);
          ctx.strokeStyle = e.state === "lunge" ? tg.lunge : tg.line;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + e.lockAim.x * k.lungeRange, sy + e.lockAim.y * k.lungeRange);
          ctx.stroke();
        }
      }
      // Status bars: HP (only once chipped) and, for casters, a mana pip that dims when
      // too dry to cast — the visible "wait it out" tell.
      const B = THEME.bar, cast = k.attack && k.attack.manaCost;
      let by = sy - e.r - B.gap - B.h;
      if (e.hp < e.derived.maxHp) { bar(ctx, sx, by, e.hp / e.derived.maxHp, B.hp); by -= B.h + 1; }
      if (cast) bar(ctx, sx, by, e.mana / e.derived.maxMana, e.mana >= k.attack.manaCost ? B.mana : B.tapped);
    }

    for (const b of blasts)
      ring(ctx, b.x - cam.x, b.y - cam.y, b.r * (0.4 + 0.6 * b.t / THEME.blast.dur), THEME.blast.ring);

    for (const s of swings) {
      const a = Math.atan2(s.ay, s.ax), half = s.arc * Math.PI / 360;
      ctx.globalAlpha = 1 - s.t / THEME.melee.dur;
      ctx.fillStyle = THEME.melee.swing;
      ctx.beginPath();
      ctx.moveTo(s.x - cam.x, s.y - cam.y);
      ctx.arc(s.x - cam.x, s.y - cam.y, s.r, a - half, a + half);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Follower train + head via the shared drawMember (so run scene and party-select
    // preview present a hero identically): a follower shows its signature recharge, the
    // head its weapon recharge + mana.
    for (const f of followers) {
      if (f.pending) continue;
      drawMember(ctx, f, f.x - cam.x, f.y - cam.y, "follower");
    }
    drawMember(ctx, hero, hero.x - cam.x, hero.y - cam.y, "head", weapon);

    const HN = THEME.hitNumber;
    ctx.font = HN.font;
    ctx.fillStyle = HN.color;
    ctx.textAlign = "center";
    for (const f of floaters) {
      ctx.globalAlpha = (1 - f.t / HN.dur) * HN.alpha;
      ctx.fillText(f.value, f.x - cam.x, f.y - cam.y - f.t * HN.rise);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";

    cam.x -= shx; cam.y -= shy; // end screen shake: HUD draws in untouched screen space

    ctx.font = THEME.hud.font;
    const depth = Math.round((cam.y / (mapH - VIEW_H)) * 100);
    const ready = hero.cd <= 0 ? "ready" : `${hero.cd.toFixed(1)}s`;
    const mana = weapon.manaCost > 0 ? `   MP ${Math.round(hero.mana)}/${hero.derived.maxMana}` : "";
    const hud = `HP ${Math.max(0, Math.round(hero.hp))}/${hero.derived.maxHp}${mana}   cash ${runState.cash}   home in ${100 - depth}%   ${weapon.name} ${ready} [SPACE]`;
    ctx.fillStyle = THEME.hud.box;
    ctx.fillRect(6, 6, ctx.measureText(hud).width + 12, 22);
    ctx.fillStyle = THEME.hud.text;
    ctx.fillText(hud, 12, 21);

    const s = hero.stats;
    const statLine = `SPD ${Math.round(s.speed)}   CON ${Math.round(s.constitution)}   STR ${Math.round(s.strength)}   MAG ${Math.round(s.magic)}`;
    ctx.fillStyle = THEME.hud.box;
    ctx.fillRect(6, 32, ctx.measureText(statLine).width + 12, 20);
    ctx.fillStyle = THEME.hud.text;
    ctx.fillText(statLine, 12, 46);

    const heldLine = getHeldLine();
    if (heldLine) {
      ctx.fillStyle = THEME.hud.box;
      ctx.fillRect(6, 58, ctx.measureText(heldLine).width + 12, 20);
      ctx.fillStyle = THEME.hud.text;
      ctx.fillText(heldLine, 12, 72);
    }

    const joy = input.joystick();
    if (joy) {
      ring(ctx, joy.origin.x, joy.origin.y, joy.radius, THEME.joystick.ring);
      disc(ctx, joy.cur.x, joy.cur.y, THEME.joystick.knobR, THEME.joystick.knob);
    }

    if (shop.isOpen()) shop.render();
    if (getPaused()) {
      const O = THEME.overlay;
      ctx.fillStyle = O.bg; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = O.fg; ctx.textAlign = "center";
      ctx.font = O.titleFont; ctx.fillText("PAUSED", VIEW_W / 2, VIEW_H / 2 - 8);
      ctx.font = O.subFont; ctx.fillText("Esc to resume", VIEW_W / 2, VIEW_H / 2 + 24);
      ctx.textAlign = "left";
    }
  }

  return { render };
}
