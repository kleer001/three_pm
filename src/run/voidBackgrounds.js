// Void backgrounds — the animated effects that fill the "holes in reality" (the
// rubble tiles that read as torn windows into a void). Ported verbatim from the
// art-test/holes_in_reality.html prototype: same constants, periods, colors,
// counts, and formulas. The prototype's fixed 800×600 viewport is replaced with a
// per-instance w×h so the same effect can drive both the full-screen game and
// small carousel previews — every other visual constant stays absolute, so a
// preview is a true-scale window onto the effect, not a shrunken copy.
//
// createVoidRenderer(id, w, h) returns an instance owning its own offscreen
// buffers / particle pools, so multiple instances never clobber each other. Its
// draw(ctx, t, camY) fills (0,0,w,h) in the CURRENT ctx transform/clip — it does
// NOT translate; the caller positions and clips.

export const VOID_BACKGROUNDS = [
  { id: "stars",   name: "Starfield" },
  { id: "glitch",  name: "Datamosh" },
  { id: "soup",    name: "Code Soup" },
  { id: "moire",   name: "Moiré" },
  { id: "ribbons", name: "Pink Tubes" },
  { id: "perlin",  name: "Perlin" },
  { id: "flow",    name: "Flow" },
  { id: "truchet", name: "Truchet" },
  { id: "bolt",    name: "Lightning" },
];

// ---- shared helpers (ported once, used across effects) ----
const TAU = Math.PI * 2;

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

function vhash(x, y, z){ // integer hash → [0,1)
  let h = (x*374761393 + y*668265263 + z*2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const sstep = a => a*a*(3-2*a);
function vnoise(x, y, z){
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = sstep(x-xi), yf = sstep(y-yi), zf = sstep(z-zi);
  const L = (a,b,f) => a+(b-a)*f;
  const c = (dx,dy,dz) => vhash(xi+dx, yi+dy, zi+dz);
  const x00 = L(c(0,0,0),c(1,0,0),xf), x10 = L(c(0,1,0),c(1,1,0),xf);
  const x01 = L(c(0,0,1),c(1,0,1),xf), x11 = L(c(0,1,1),c(1,1,1),xf);
  return L(L(x00,x10,yf), L(x01,x11,yf), zf);
}
function hslToRgb(h, s, l){ // h 0..1
  const a = s*Math.min(l,1-l), f = n => { const k=(n+h*12)%12; return l - a*Math.max(-1,Math.min(k-3,9-k,1)); };
  return [f(0)*255, f(8)*255, f(4)*255];
}
const mkCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

// ---- 1 · Starfield: 3 parallax layers, wrapped in a cell ----
const CELL = 360;
function makeStarLayer(seed, n, parallax, sz, bright){
  const r = mulberry32(seed), stars = [];
  for (let i = 0; i < n; i++)
    stars.push({ x: r()*CELL, y: r()*CELL, b: bright*(0.4+0.6*r()),
                 sz: sz*(0.5+r()), tw: 0.5+r()*2.5, ph: r()*6.28,
                 hue: r()<0.15 ? (r()<0.5?"#9fd0ff":"#ffd9a0") : "#ffffff" });
  return { stars, parallax };
}
function createStars(w, h){
  const LAYERS = [ makeStarLayer(7, 70, 0.12, 2, 0.5),
                   makeStarLayer(8, 45, 0.28, 2, 0.8),
                   makeStarLayer(9, 22, 0.5, 3, 1.0) ];
  return function draw(ctx, t, camY){
    ctx.fillStyle = "#05060d"; ctx.fillRect(0,0,w,h);
    for (const Lr of LAYERS) {
      const ox = ((-(0)*Lr.parallax) % CELL), oy = ((-(camY)*Lr.parallax) % CELL);
      for (let by = -CELL; by < h + CELL; by += CELL)
        for (let bx = -CELL; bx < w + CELL; bx += CELL)
          for (const s of Lr.stars) {
            const a = s.b * (0.55 + 0.45*Math.sin(t*s.tw + s.ph));
            if (a <= 0.02) continue;
            ctx.globalAlpha = a;
            ctx.fillStyle = s.hue;
            ctx.fillRect((bx+ox+s.x)|0, ((by+oy+s.y)%(h+2*CELL))|0, s.sz, s.sz);
          }
    }
    ctx.globalAlpha = 1;
  };
}

// ---- 2 · Glitch / datamosh: stateful, lingering bars + RGB-split scanlines ----
const GCOLORS = ["#ff2e88","#2effd0","#7a5cff","#101018","#1a0030"];
function createGlitch(w, h){
  let gbars = [], gspawn = 0, prevT = null;
  const grng = mulberry32(424242);
  function updateGlitch(dt){
    gspawn -= dt;
    while (gspawn <= 0) {
      gspawn += 1/12;
      const big = grng() < 0.25;
      const baseLife = 0.5 + grng()*0.5;
      const life = big ? baseLife*(1.4 + grng()*0.6) : baseLife;
      gbars.push({
        x: (grng()*w)|0, y: (grng()*h)|0,
        w: 40 + (grng()*w)|0,
        h: big ? (24 + grng()*40)|0 : (3 + grng()*16)|0,
        c: GCOLORS[(grng()*GCOLORS.length)|0],
        a0: 0.4 + grng()*0.5, t: 0, life,
      });
    }
    for (let i = gbars.length-1; i >= 0; i--) { gbars[i].t += dt; if (gbars[i].t >= gbars[i].life) gbars.splice(i,1); }
  }
  return function draw(ctx, t, camY){
    const dt = prevT === null ? 0 : Math.max(0, Math.min(0.05, t - prevT));
    prevT = t;
    updateGlitch(dt);
    ctx.fillStyle = "#0a0010"; ctx.fillRect(0,0,w,h);
    for (const b of gbars) {
      const k = b.t / b.life;
      ctx.globalAlpha = b.a0 * (1 - k*k);
      ctx.fillStyle = b.c;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    ctx.globalAlpha = 0.5;
    for (let y = -(camY*0.6 % 6); y < h; y += 6) { ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(0,y,w,2); }
    ctx.globalAlpha = 1;
  };
}

// ---- 3 · Code soup: drifting glyph fog ----
const GLYPHS = ("01{}[]<>/\\|=+*#%$&@!?;:~^()_-." +
  "ABCDEFGHJKLMNPQRTUVWXYZ" +
  "αβγδλπσφψΩμ" +
  "∑∫∂∆∇√∞≈≠≡⊕⊗⊥∴∵" +
  "←→↑↓↔⇒⇔" +
  "▓▒░█▤▥▦▧▨▩").split("");
function createSoup(w, h){
  return function draw(ctx, t, camY){
    ctx.fillStyle = "#02100a"; ctx.fillRect(0,0,w,h);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const layers = [ {p:0.15, fs:14, c:"#0c3", n:0.10, sp:0}, {p:0.35, fs:18, c:"#1f6", n:0.06, sp:1}, {p:0.6, fs:24, c:"#3fa", n:0.04, sp:2} ];
    const epoch = (t / 7) | 0; // glyphs hold for 7s, then quietly reshuffle
    for (const Lr of layers) {
      ctx.font = Lr.fs + "px monospace";
      const step = Lr.fs + 4;
      const worldShift = Math.floor((camY * Lr.p) / step);
      const oy = (camY * Lr.p) % step;
      for (let gy = -step, row = 0; gy < h + step; gy += step, row++)
        for (let gx = 0, col = 0; gx < w; gx += step, col++) {
          const wrow = row + worldShift;
          const r = mulberry32((col*73856093 ^ wrow*19349663) + Lr.sp*1000 + epoch*2654435761);
          if (r() > Lr.n*6) continue;
          ctx.globalAlpha = 0.25 + r()*0.6;
          ctx.fillStyle = Lr.c;
          ctx.fillText(GLYPHS[(r()*GLYPHS.length)|0], gx, gy - oy);
        }
    }
    ctx.globalAlpha = 1; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  };
}

// ---- 4 · Moiré diamonds: 3 diagonal-lattice layers, dark blue on black ----
function createMoire(w, h){
  const moire = [ { size: 12, period: 2.6 }, { size: 14, period: 3.1 }, { size: 16, period: 2.8 } ];
  const SUM_A = w/2 + h/2, DIFF_A = w/2 - h/2;
  return function draw(ctx, t){
    ctx.fillStyle = "#000308"; ctx.fillRect(0,0,w,h);
    ctx.lineWidth = 6; ctx.strokeStyle = "rgba(80,160,255,0.28)";
    for (const Lr of moire) {
      const om = Lr.period === 0 ? 0 : 2*Math.PI / Lr.period;
      const s = Lr.size * (1 + 0.2*Math.sin(om * t)); // breathing spacing, 0.8–1.2×
      ctx.beginPath();
      // family 1: x+y=c, anchored so the lattice scales about center
      for (let c = SUM_A - Math.ceil((SUM_A + h)/s)*s; c < w + h; c += s) {
        ctx.moveTo(c, 0); ctx.lineTo(c - h, h);
      }
      // family 2: x-y=c, same anchoring
      for (let c = DIFF_A - Math.ceil((DIFF_A + h)/s)*s; c < w; c += s) {
        ctx.moveTo(c, 0); ctx.lineTo(c + h, h);
      }
      ctx.stroke();
    }
  };
}

// ---- 5 · Pink sinewave ribbons: a pile of waving tubes ----
const PINKS = ["#ff5fa2","#ff9ec7","#e0408a","#ff7ab8","#c83d83"];
const ribCfg = { widthMul: 1.3, bands: 12, edgeDark: 0.35, coreLight: 0.2, opacity: 0.5 };
function shadeHex(hex, f){ // f<0 darken toward black, f>0 lighten toward white
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const mix = c => (f < 0 ? c*(1+f) : c + (255-c)*f) | 0;
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}
function createRibbons(w, h){
  const r = mulberry32(99), ribbons = [];
  for (let i = 0; i < 16; i++)
    ribbons.push({ baseX: r()*w, amp: 18 + r()*55, freq: 0.008 + r()*0.022,
                   phase: r()*6.28, speed: (0.5 + r()*2.2) * 0.5, w: (5 + r()*16) * 10,
                   c: PINKS[(r()*PINKS.length)|0] });
  return function draw(ctx, t){
    ctx.fillStyle = "#160008"; ctx.fillRect(0,0,w,h);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const C = ribCfg, bands = C.bands;
    for (const rb of ribbons) {
      const path = new Path2D();
      for (let y = -20, first = true; y <= h + 20; y += 6, first = false) {
        const x = rb.baseX + Math.sin(y * rb.freq + rb.phase + t * rb.speed) * rb.amp
                           + Math.sin(y * rb.freq * 2.3 + t * rb.speed * 0.6) * rb.amp * 0.3;
        first ? path.moveTo(x, y) : path.lineTo(x, y);
      }
      for (let k = 0; k < bands; k++) {
        const tt = bands === 1 ? 1 : k / (bands - 1);        // 0 = outer edge, 1 = core
        const shade = -C.edgeDark + tt * (C.edgeDark + C.coreLight);
        ctx.strokeStyle = shadeHex(rb.c, shade);
        ctx.globalAlpha = C.opacity;
        ctx.lineWidth = Math.max(1, rb.w * C.widthMul * (1 - tt * 0.88));
        ctx.stroke(path);
      }
    }
    ctx.globalAlpha = 1;
  };
}

// ---- 6 · Pulsing perlin (3D value noise), dark-rainbow palette ----
// Noise buffer is sized to hold the prototype's ~6.6px-per-texel feel at any w×h,
// scaled up blurry. Rainbow animation is baked: reps sweep 1↔6, period 7s.
function createPerlin(w, h){
  const NW = Math.max(8, Math.round(w/6.6)), NH = Math.max(6, Math.round(h/6.6));
  const noiseCanvas = mkCanvas(NW, NH);
  const nctx = noiseCanvas.getContext("2d");
  const nimg = nctx.createImageData(NW, NH);
  const rainbowPeriod = 7; // baked: animate on, reps sweep 1↔6, period 7s
  return function draw(ctx, t){
    const z = t * 0.35, pulse = 0.5 + 0.5*Math.sin(t*1.4); // brightness pulse
    const reps = 3.5 + 2.5*Math.sin(2*Math.PI * t / rainbowPeriod); // smooth 1↔6 sweep
    const sc = 0.045, d = nimg.data;
    for (let py = 0; py < NH; py++)
      for (let px = 0; px < NW; px++) {
        let n = vnoise(px*sc, py*sc, z);
        n += 0.5 * vnoise(px*sc*2.1, py*sc*2.1, z*1.3); // 2 octaves
        n /= 1.5;
        const hue = (n*reps + t*0.03) % 1;
        const light = 0.06 + n*0.18 + pulse*0.12;
        const [r,g,b] = hslToRgb(hue, 0.85, light);
        const i = (py*NW+px)*4; d[i]=r; d[i+1]=g; d[i+2]=b; d[i+3]=255;
      }
    nctx.putImageData(nimg, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(noiseCanvas, 0, 0, NW, NH, 0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
  };
}

// ---- 7 · Flow streaks: particles advected by a noise flow field ----
// flowCfg baked to its prototype-current values. Particle count scales by area so
// small previews aren't a solid blob; the pool is allocated to FLOW_MAX but only
// the effective count is iterated. Trail buffer + brushes are per-instance.
const flowCfg = { count: 300, speed: 0.3, swirl: 5, perMin: 6, perMax: 8, softness: 1, hue: 0 };
const FLOW_MAX = 1500, FLOW_HUES = 24, BR = 32;
function createFlow(w, h){
  const flowCanvas = mkCanvas(w, h);
  const fctx = flowCanvas.getContext("2d");
  fctx.fillStyle = "#05030c"; fctx.fillRect(0,0,w,h);
  const flowRng = mulberry32(7071);
  const rp = mulberry32(707), rh = mulberry32(909), flowP = []; // rh salted apart from rp
  for (let i = 0; i < FLOW_MAX; i++)
    flowP.push({ x: rp()*w, y: rp()*h, life: rp()*200,
                 sr: rp(), sph: rp()*6.28, hr: rh(), hph: rh()*6.28 });
  const flowBrush = []; for (let i = 0; i < FLOW_HUES; i++) flowBrush.push(mkCanvas(BR, BR));
  let flowBrushKey = "";
  function rebuildBrushes(soft, hueBase){
    const key = soft + "|" + hueBase; if (key === flowBrushKey) return; flowBrushKey = key;
    const inner = Math.min(0.95, 1 - soft);
    for (let i = 0; i < FLOW_HUES; i++) {
      const bx = flowBrush[i].getContext("2d"); bx.clearRect(0,0,BR,BR);
      const [r,g,b] = hslToRgb(((hueBase + i/FLOW_HUES) % 1 + 1) % 1, 0.8, 0.6);
      const grad = bx.createRadialGradient(BR/2,BR/2,0, BR/2,BR/2,BR/2);
      grad.addColorStop(0, `rgba(${r|0},${g|0},${b|0},0.5)`);
      grad.addColorStop(inner, `rgba(${r|0},${g|0},${b|0},0.5)`);
      grad.addColorStop(1, `rgba(${r|0},${g|0},${b|0},0)`);
      bx.fillStyle = grad; bx.fillRect(0,0,BR,BR);
    }
  }
  // area-scaled effective count, capped at the pool size
  const count = Math.min(FLOW_MAX, Math.max(30, Math.round(flowCfg.count * (w*h)/(800*600))));
  return function draw(ctx, t){
    const C = flowCfg, span = C.perMax - C.perMin;
    rebuildBrushes(C.softness, C.hue);
    for (let i = 0; i < count; i++) {
      const p = flowP[i];
      const ang = vnoise(p.x*0.004, p.y*0.004, t*0.15) * TAU * C.swirl;
      p.x += Math.cos(ang) * C.speed * 6; p.y += Math.sin(ang) * C.speed * 6; p.life++;
      const sPer = C.perMin + p.sr * span;
      const sizeV = 1 + 15 * (0.5 + 0.5*Math.sin(t*TAU/sPer + p.sph));
      const s2 = sizeV * 4, hh = s2 / 2;
      const hPer = C.perMin + p.hr * span;
      const bin = (((t/hPer + p.hph) % 1 + 1) % 1) * FLOW_HUES | 0;
      fctx.drawImage(flowBrush[bin], p.x - hh, p.y - hh, s2, s2);
      if (p.life > 600 || p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
        p.x = flowRng()*w; p.y = flowRng()*h; p.life = 0;
      }
    }
    ctx.drawImage(flowCanvas, 0, 0);
  };
}

// ---- 8 · Multi-scale Truchet (after Carlson, Bridges 2018) ----
// truCfg baked to prototype-current values. Three phase-offset planes scroll with
// camY for parallax; blue↔green hue cycles over 36s. Sprites are per-instance.
const truCfg = { detail: 0.55, speed: 1.2, wave: 0.5 };
const TRU_SIZES = [16, 32, 64], truPad = s => Math.ceil(s/6) + 1;
const truPlanes = [
  { scroll: 0.125, salt: 7777, alpha: 0.25, phase: 2*TAU/3 }, // far
  { scroll: 0.25,  salt: 9991, alpha: 0.5,  phase: TAU/3 },   // back
  { scroll: 0.5,   salt: 0,    alpha: 1.0,  phase: 0 },       // front
];
function truHash(a,b){ let h = (a*73856093 ^ b*19349663) | 0; h = (h ^ (h>>>13))*1274126177 | 0; return h; }
function fillPie(x, cx, cy, r, a0, a1){ x.beginPath(); x.moveTo(cx,cy); x.arc(cx,cy,r,a0,a1); x.closePath(); x.fill(); }
function fillBand(x, cx, cy, a0, a1, s){ // quarter-annulus band, width s/6, centred on the s/2 midline
  fillPie(x, cx, cy, 7*s/12, a0, a1);
  x.globalCompositeOperation = "destination-out"; fillPie(x, cx, cy, 5*s/12, a0, a1);
  x.globalCompositeOperation = "source-over";
}
function createTruchet(w, h){
  const truSprite = {}; // size → { A, B, dots }, redrawn per frame for the live hue
  TRU_SIZES.forEach(s => { const sz = s + truPad(s)*2; truSprite[s] = { A: mkCanvas(sz, sz), B: mkCanvas(sz, sz), dots: mkCanvas(sz, sz) }; });
  function redrawTruSprites(fg){
    const H = Math.PI/2, PI = Math.PI;
    for (const s of TRU_SIZES) {
      const p = truPad(s), sz = s + p*2;
      const xA = truSprite[s].A.getContext("2d"); xA.clearRect(0,0,sz,sz); xA.save(); xA.translate(p,p); xA.fillStyle = fg;
      fillBand(xA, 0, 0, 0, H, s); fillBand(xA, s, s, PI, PI+H, s); xA.restore();          // "\": NW + SE
      const xB = truSprite[s].B.getContext("2d"); xB.clearRect(0,0,sz,sz); xB.save(); xB.translate(p,p); xB.fillStyle = fg;
      fillBand(xB, s, 0, H, PI, s); fillBand(xB, 0, s, PI+H, TAU, s); xB.restore();          // "/": NE + SW
      const xD = truSprite[s].dots.getContext("2d"); xD.clearRect(0,0,sz,sz); xD.save(); xD.translate(p,p); xD.fillStyle = fg;
      const r = s/6;
      for (const [mx,my] of [[s/2,0],[s,s/2],[s/2,s],[0,s/2]]) { xD.beginPath(); xD.arc(mx,my,r,0,TAU); xD.fill(); }
      xD.restore();
    }
  }
  function drawTruPlane(ctx, t, scrollY, salt, alpha){
    const MIN = 16, MAX = 64;
    ctx.globalAlpha = alpha;
    const gy0 = Math.floor(scrollY/MAX) - 1, gy1 = Math.floor((scrollY+h)/MAX) + 1, gx1 = Math.ceil(w/MAX);
    for (let gy = gy0; gy <= gy1; gy++)
      for (let gx = 0; gx < gx1; gx++) {
        const r = mulberry32((truHash(gx,gy) ^ (salt*2654435761|0)) | 0);
        const rec = (x,y,size) => {
          if (size > MIN && r() < truCfg.detail) { const hh = size/2; rec(x,y,hh); rec(x+hh,y,hh); rec(x,y+hh,hh); rec(x+hh,y+hh,hh); }
          else {
            const orient = Math.sin(t*truCfg.speed + (x+y)/64*truCfg.wave + r()*TAU) > 0 ? "A" : "B"; // snappy flip
            const p = truPad(size), S = truSprite[size], dx = x - p, dy = (y - scrollY) - p;
            ctx.drawImage(S[orient], dx, dy);
            ctx.drawImage(S.dots, dx, dy);
          }
        };
        rec(gx*MAX, gy*MAX, MAX);
      }
  }
  return function draw(ctx, t, camY){
    ctx.fillStyle = "#04060a"; ctx.fillRect(0,0,w,h);
    for (const pl of truPlanes) {
      const k = 0.5 + 0.5*Math.sin(TAU*t/36 + pl.phase); // 36 s cycle, 1/3 phase apart
      const [rr,gg,bb] = hslToRgb(0.33 + 0.34*k, 0.8, 0.6); // green ↔ blue only
      redrawTruSprites(`rgb(${rr|0},${gg|0},${bb|0})`);
      drawTruPlane(ctx, t, camY*pl.scroll, pl.salt, pl.alpha);
    }
    ctx.globalAlpha = 1;
  };
}

// ---- 9 · Branching lightning: fractal bolts that crawl + fork + flicker ----
function buildBolt(x1,y1,x2,y2,disp,rng,depth,branchProb,out,curr){
  if (depth <= 0) { curr.push(x2,y2); return; }
  const mx = (x1+x2)/2 + (rng()-0.5)*disp, my = (y1+y2)/2 + (rng()-0.5)*disp;
  buildBolt(x1,y1,mx,my,disp*0.6,rng,depth-1,branchProb,out,curr);
  if (rng() < branchProb) {                           // fork a branch off the midpoint
    const ang = Math.atan2(my-y1,mx-x1) + (rng()-0.5)*1.3, len = disp*2.2;
    const br = [mx,my];
    buildBolt(mx,my,mx+Math.cos(ang)*len,my+Math.sin(ang)*len,disp*0.6,rng,depth-1,0,out,br);
    out.push(br);
  }
  buildBolt(mx,my,x2,y2,disp*0.6,rng,depth-1,branchProb,out,curr);
}
const BOLT_MAX = 40;
const boltParams = (function(){
  const a = [];
  for (let b = 0; b < BOLT_MAX; b++) { const r = mulberry32(b*99991 + 7);
    a.push({ fr: 0.5 + 4.5*r(), w: 1 + r(), jag: 80 + 20*r(), br: 1 + r() }); }
  return a;
})();
const BOLT_GLOW = (function(){ const [r,g,b] = hslToRgb(0.62, 0.6, 0.65); return `rgb(${r|0},${g|0},${b|0})`; })();
function createBolt(w, h){
  return function draw(ctx, t){
    ctx.fillStyle = "#03030a"; ctx.fillRect(0,0,w,h);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    const count = Math.round(10 + 30*Math.abs(Math.sin(TAU*t/24))); // rectified sine: 10 ↔ 40
    for (let b = 0; b < count && b < BOLT_MAX; b++) {
      const P = boltParams[b];
      const life = t*P.fr, epoch = Math.floor(life), frac = life - epoch; // 0→1 through this strike's life
      const rng = mulberry32(b*1000 + epoch*7 + 1);     // own flicker schedule
      const x1 = rng()*w, x2 = Math.max(0, Math.min(w, x1 + (rng()-0.5)*w*0.5));
      const out = [], main = [x1, -10];
      buildBolt(x1, -10, x2, h+10, P.jag, rng, 6, P.br - 1, out, main); // branchProb = br−1
      out.push(main);
      const alpha = (0.5 + 0.5*rng()) * Math.exp(-5*frac); // flash bright, fade fast
      for (const poly of out) {
        ctx.beginPath(); ctx.moveTo(poly[0], poly[1]);
        for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i+1]);
        ctx.globalAlpha = alpha*0.3; ctx.strokeStyle = BOLT_GLOW;  ctx.lineWidth = P.w*4; ctx.stroke();
        ctx.globalAlpha = alpha;     ctx.strokeStyle = "#eaf2ff";  ctx.lineWidth = P.w;   ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  };
}

const FACTORIES = {
  stars: createStars, glitch: createGlitch, soup: createSoup, moire: createMoire,
  ribbons: createRibbons, perlin: createPerlin, flow: createFlow,
  truchet: createTruchet, bolt: createBolt,
};

// Create a renderer instance for one effect at pixel size w×h. Each instance owns
// its own state (offscreen buffers, particle pools) so multiple instances coexist
// independently. draw(ctx, t, camY) fills (0,0,w,h) in the current ctx
// transform/clip without translating; t = seconds, camY = scroll px for parallax.
export function createVoidRenderer(id, w, h){
  const make = FACTORIES[id];
  if (!make) throw new Error(`unknown void background id: ${id}`);
  const draw = make(w, h);
  return { id, draw };
}
