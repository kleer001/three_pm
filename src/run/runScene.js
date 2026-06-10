// Vertical-slice RUN scene: a forced southward descent. The camera auto-scrolls
// down (background slides up), holding Marvin inside the moving window; home is
// the bottom band. Three brained enemies (BFS pathfinding, ported from BrainMaze).
import { generate, TILE } from "./levelgen.js";
import { moveAndCollide } from "./collision.js";
import { makeRng, subSeed } from "../core/rng.js";
import { findPath, randomWalkableTile, nearestWalkable } from "../ai/ai.js";

const VIEW_W = 800, VIEW_H = 600;
const SCALE = 2;
const TS = 24 * SCALE; // 2x grid (task 2)
const SCROLL = 55; // px/s the window descends (task 1: slow, forces player down)
const MARGIN = TS; // keep the hero this far inside the window edges

// Px-space constants, tuned for the 2x grid.
const HERO = { speed: 270, maxHp: 50, atkDamage: 9, atkCooldown: 0.45, atkRadius: 80, iframeDur: 0.8, r: 13 };
const KIND = {
  chaser:   { speed: 150, maxHp: 26, contact: 6, r: 14, color: "#c0392b", repath: 0.4 },  // Shambler: BFS-seeks the hero
  wanderer: { speed: 210, maxHp: 12, contact: 4, r: 11, color: "#8e44ad", repath: 0 },     // Imp: BFS to random waypoints
  patroller:{ speed: 170, maxHp: 34, contact: 8, r: 16, color: "#d35400", repath: 0 },     // Brute: BFS cycles fixed waypoints
};
const SPAWN = { chaser: 3, wanderer: 4, patroller: 2 };

const TILE_COLOR = {
  [TILE.STREET]: "#5a5a5a", [TILE.SIDEWALK]: "#9a9a9a", [TILE.YARD]: "#6f9a55",
  [TILE.ALLEY]: "#4a4a4a", [TILE.FLOOR]: "#caa37a", [TILE.WALL]: "#2e2e2e", [TILE.RUBBLE]: "#7c6a55",
};

export function createRunScene(ctx, input, seed) {
  // Forced descent: home is always the south edge for this mode.
  const level = generate(seed, { w: 48, h: 48, bearing: (3 * Math.PI) / 2, tileSize: TS });
  const mapW = level.w * TS, mapH = level.h * TS;
  const homeSet = new Set(level.homeBand.map(([x, y]) => y * level.w + x));
  const rng = makeRng(subSeed(seed, "spawns"));

  // Patrol waypoints: four quadrant centers (BrainMaze PatrolBehavior), shared.
  const q = [[level.w >> 2, level.h >> 2], [(3 * level.w) >> 2, level.h >> 2],
             [level.w >> 2, (3 * level.h) >> 2], [(3 * level.w) >> 2, (3 * level.h) >> 2]]
    .map(([x, y]) => nearestWalkable(level, x, y));

  const hero = {
    x: level.start.x * TS + TS / 2, y: level.start.y * TS + TS / 2,
    w: HERO.r * 2, h: HERO.r * 2, hp: HERO.maxHp, cd: 0, iframes: 0,
  };

  const enemies = [];
  for (const [kind, n] of Object.entries(SPAWN))
    for (let i = 0; i < n; i++) {
      const [tx, ty] = randomWalkableTile(level, rng);
      const k = KIND[kind];
      enemies.push({
        kind, x: tx * TS + TS / 2, y: ty * TS + TS / 2, w: k.r * 2, h: k.r * 2,
        hp: k.maxHp, path: null, pi: 0, repathT: 0, wpIndex: i % q.length,
      });
    }

  const cam = { x: 0, y: 0 };
  let swingT = 0;
  let outcome = null;

  const tileOf = (e) => [Math.floor(e.x / TS), Math.floor(e.y / TS)];
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function followPath(e, speed, dt) {
    if (!e.path || e.pi >= e.path.length) return true; // exhausted
    const [tx, ty] = e.path[e.pi];
    const cx = tx * TS + TS / 2, cy = ty * TS + TS / 2;
    const dx = cx - e.x, dy = cy - e.y, d = Math.hypot(dx, dy) || 1;
    if (d < 5) { e.pi++; return e.pi >= e.path.length; }
    moveAndCollide(level, e, (dx / d) * speed * dt, (dy / d) * speed * dt);
    return false;
  }

  function stepEnemy(e, dt, heroTile) {
    const k = KIND[e.kind];
    const [ex, ey] = tileOf(e);
    e.repathT -= dt;

    if (e.kind === "chaser") {
      if (!e.path || e.repathT <= 0) {
        e.path = findPath(level, ex, ey, heroTile[0], heroTile[1]);
        e.pi = 0;
        e.repathT = k.repath;
      }
      followPath(e, k.speed, dt);
    } else if (e.kind === "wanderer") {
      if (!e.path || e.pi >= e.path.length) {
        const [wx, wy] = randomWalkableTile(level, rng);
        e.path = findPath(level, ex, ey, wx, wy) || [];
        e.pi = 0;
      }
      followPath(e, k.speed, dt);
    } else { // patroller: cycle quadrant waypoints
      if (!e.path || e.pi >= e.path.length) {
        e.wpIndex = (e.wpIndex + 1) % q.length;
        e.path = findPath(level, ex, ey, q[e.wpIndex][0], q[e.wpIndex][1]) || [];
        e.pi = 0;
      }
      followPath(e, k.speed, dt);
    }
  }

  function update(dt) {
    if (outcome) return;
    hero.cd = Math.max(0, hero.cd - dt);
    hero.iframes = Math.max(0, hero.iframes - dt);
    swingT = Math.max(0, swingT - dt);

    // Window descends; this is what forces the player down.
    cam.y = clamp(cam.y + SCROLL * dt, 0, mapH - VIEW_H);

    // Hero movement
    const intent = input.intent();
    moveAndCollide(level, hero, intent.x * HERO.speed * dt, intent.y * HERO.speed * dt);

    // Aim from hero to cursor (world space)
    const m = input.mouse();
    const ax = m.x + cam.x - hero.x, ay = m.y + cam.y - hero.y;
    const am = Math.hypot(ax, ay) || 1;
    const aim = { x: ax / am, y: ay / am };

    // Basic attack (Backpack Swing) — hits any enemy in the front arc
    if (input.firing && hero.cd <= 0) {
      hero.cd = HERO.atkCooldown;
      swingT = 0.12;
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        const dx = e.x - hero.x, dy = e.y - hero.y, d = Math.hypot(dx, dy) || 1;
        if (d < HERO.atkRadius && (dx / d) * aim.x + (dy / d) * aim.y > 0) {
          e.hp -= HERO.atkDamage;
          e.x += (dx / d) * 18;
          e.y += (dy / d) * 18;
        }
      }
    }

    // Enemies: brains + contact damage
    const heroTile = tileOf(hero);
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      stepEnemy(e, dt, heroTile);
      const dx = hero.x - e.x, dy = hero.y - e.y, d = Math.hypot(dx, dy);
      if (d < HERO.r + KIND[e.kind].r && hero.iframes <= 0) {
        hero.hp -= KIND[e.kind].contact;
        hero.iframes = HERO.iframeDur;
        if (hero.hp <= 0) outcome = "lose";
      }
    }

    // Hero stays inside the moving window (top clamp pushes them down) and the map
    hero.x = clamp(hero.x, MARGIN, mapW - MARGIN);
    hero.y = clamp(hero.y, cam.y + MARGIN, cam.y + VIEW_H - MARGIN);

    // Camera x follows hero, clamped to map
    cam.x = clamp(hero.x - VIEW_W / 2, 0, mapW - VIEW_W);

    const [tx, ty] = tileOf(hero);
    if (homeSet.has(ty * level.w + tx)) outcome = "win";
  }

  function render() {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    const x0 = Math.max(0, Math.floor(cam.x / TS)), x1 = Math.min(level.w - 1, Math.ceil((cam.x + VIEW_W) / TS));
    const y0 = Math.max(0, Math.floor(cam.y / TS)), y1 = Math.min(level.h - 1, Math.ceil((cam.y + VIEW_H) / TS));
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        ctx.fillStyle = TILE_COLOR[level.tiles[ty * level.w + tx]];
        ctx.fillRect(tx * TS - cam.x, ty * TS - cam.y, TS, TS);
      }
    ctx.fillStyle = "rgba(255,215,0,0.35)";
    for (const [hx, hy] of level.homeBand)
      if (hx >= x0 && hx <= x1 && hy >= y0 && hy <= y1)
        ctx.fillRect(hx * TS - cam.x, hy * TS - cam.y, TS, TS);

    for (const e of enemies)
      if (e.hp > 0) disc(ctx, e.x - cam.x, e.y - cam.y, KIND[e.kind].r, KIND[e.kind].color);
    disc(ctx, hero.x - cam.x, hero.y - cam.y, HERO.r, hero.iframes > 0 ? "#7fb3ff" : "#2d6cdf");
    if (swingT > 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.arc(hero.x - cam.x, hero.y - cam.y, HERO.atkRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = "#111";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText(`HP ${Math.max(0, hero.hp)}/${HERO.maxHp}   descend ↓`, 12, 20);
    if (outcome) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, VIEW_H / 2 - 40, VIEW_W, 80);
      ctx.fillStyle = "#fff";
      ctx.font = "32px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(outcome === "win" ? "MADE IT HOME" : "ANOTHER 3PM…", VIEW_W / 2, VIEW_H / 2 + 10);
      ctx.textAlign = "left";
    }
  }

  return { update, render };
}

function disc(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
