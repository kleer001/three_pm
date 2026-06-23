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

const VOID_CORNER_FRAC = 0.45; // rounding radius for exposed void-hole corners (× ts)
const GLOW_BLUR = 14;
const GLOW_COLOR = "rgba(165,205,255,1)";
const GLOW_GAIN = 1.5;

// ctx.roundRect isn't safe across all targets the slice ships to, so build a closed
// rounded-rect subpath from arcTo (per-corner radii; 0 = square corner).
function addRoundTile(c, x, y, w, h, tl, tr, br, bl) {
  c.moveTo(x + tl, y);
  c.arcTo(x + w, y,     x + w, y + h, tr);
  c.arcTo(x + w, y + h, x,     y + h, br);
  c.arcTo(x,     y + h, x,     y,     bl);
  c.arcTo(x,     y,     x + w, y,     tl);
  c.closePath();
}

// Optional textured ground (assets/tiles.png). The game renders flat THEME.tile fills
// until this dual-grid atlas loads, and keeps doing so if it never does — tiles are a
// droppable asset. Material mapping: WALL→hedge, FLOOR→brick, RUBBLE→crater,
// paved→road, yard→grass base.
const TILE_TO_MAT = [];
TILE_TO_MAT[TILE.STREET] = TILE_TO_MAT[TILE.SIDEWALK] = TILE_TO_MAT[TILE.ALLEY] = "road";
TILE_TO_MAT[TILE.FLOOR] = "brick";
TILE_TO_MAT[TILE.WALL] = "hedge";
TILE_TO_MAT[TILE.RUBBLE] = "crater";
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
  pickups, projectiles, blasts, swings, fields, deployables, floaters, debris, dustPuffs,
  runState, bgId, getShake, getPaused, getVoidClock, getHeldLine, ts, viewW, viewH,
}) {
  const TS = ts, VIEW_W = viewW, VIEW_H = viewH;
  const VOID_CORNER = TS * VOID_CORNER_FRAC;
  const mapH = level.h * TS;
  const TILE_COLOR = THEME.tile;
  const LOOT = BALANCE.loot;

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
  function drawTiles(x0, x1, y0, y1) {
    const A = tileAtlas, g = A.ground;
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        ctx.drawImage(A.sheet, g.x, g.y, g.w, g.h, Math.floor(tx * TS - cam.x), Math.floor(ty * TS - cam.y), TS + 1, TS + 1);
    const matCell = (x, y) => (x < 0 || y < 0 || x >= level.w || y >= level.h) ? null : TILE_TO_MAT[level.tiles[y * level.w + x]];
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

  // The crater material's dual-grid silhouette (same shape drawTiles renders), drawn
  // into `dst` as a destination-in mask so the void exactly fills the crater holes.
  function drawCraterMask(dst, dx0, dx1, dy0, dy1) {
    const A = tileAtlas, frames = A.mats.crater;
    const isC = (x, y) => x >= 0 && y >= 0 && x < level.w && y < level.h && TILE_TO_MAT[level.tiles[y * level.w + x]] === "crater";
    for (let y = dy0; y <= dy1; y++)
      for (let x = dx0; x <= dx1; x++) {
        const c = (isC(x, y) ? 1 : 0) | (isC(x + 1, y) ? 2 : 0) | (isC(x + 1, y + 1) ? 4 : 0) | (isC(x, y + 1) ? 8 : 0);
        if (!c) continue;
        const f = frames[c];
        dst.drawImage(A.sheet, f.x, f.y, f.w, f.h, Math.floor(x * TS + TS / 2 - cam.x), Math.floor(y * TS + TS / 2 - cam.y), TS + 1, TS + 1);
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
    if (tileAtlas) drawTiles(x0, x1, y0, y1);
    else for (let ty = y0; ty <= y1; ty++)
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

    // Holes in reality: render the void into its buffer, mask it to the crater's exact
    // silhouette, then composite over the scene with a glowing blue rim. Without the
    // atlas, fall back to rounded-rect hole shapes.
    if (voidRenderer) {
      const rub = (tx, ty) => tx >= 0 && ty >= 0 && tx < level.w && ty < level.h && level.tiles[ty * level.w + tx] === TILE.RUBBLE;
      const vb = voidBufCtx;
      vb.clearRect(0, 0, VIEW_W, VIEW_H);
      voidRenderer.draw(vb, getVoidClock(), cam.y);
      if (tileAtlas && tileAtlas.mats.crater) {
        const dx0 = Math.floor((cam.x - TS / 2) / TS), dx1 = Math.ceil((cam.x + VIEW_W) / TS);
        const dy0 = Math.floor((cam.y - TS / 2) / TS), dy1 = Math.ceil((cam.y + VIEW_H) / TS);
        maskBufCtx.clearRect(0, 0, VIEW_W, VIEW_H);
        drawCraterMask(maskBufCtx, dx0, dx1, dy0, dy1);
        vb.save();
        vb.globalCompositeOperation = "destination-in";
        vb.drawImage(maskBuf, 0, 0);
        vb.restore();
      } else {
        vb.save();
        vb.globalCompositeOperation = "destination-in";
        vb.fillStyle = "#fff";
        vb.beginPath();
        for (let ty = y0; ty <= y1; ty++)
          for (let tx = x0; tx <= x1; tx++) {
            if (level.tiles[ty * level.w + tx] !== TILE.RUBBLE) continue;
            const sx = Math.floor(tx * TS - cam.x), sy = Math.floor(ty * TS - cam.y);
            const up = rub(tx, ty - 1), dn = rub(tx, ty + 1), lf = rub(tx - 1, ty), rt = rub(tx + 1, ty);
            addRoundTile(vb, sx, sy, TS + 1, TS + 1,
              (!up && !lf) ? VOID_CORNER : 0, (!up && !rt) ? VOID_CORNER : 0,
              (!dn && !rt) ? VOID_CORNER : 0, (!dn && !lf) ? VOID_CORNER : 0);
          }
        vb.fill();
        vb.restore();
      }
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
