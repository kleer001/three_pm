// Vertical-slice RUN scene: a forced southward descent. The camera window
// auto-scrolls down (background slides up), holding Marvin inside it; home is
// the south band, four times the map away. Enemies use BFS pathfinding (ported
// from BrainMaze) and stop to attack: melee strikes and ranged potshots.
import { generate, TILE, isWalkable } from "./levelgen.js";
import { moveAndCollide, boxBlocked } from "./collision.js";
import { makeRng, subSeed } from "../core/rng.js";
import { findPath, randomWalkableTile, localWalkableTile } from "../ai/ai.js";

const VIEW_W = 800, VIEW_H = 600;
const SCALE = 2;
const TS = 24 * SCALE; // 2x grid
const SCROLL = 55; // px/s the window descends — forces the player down
const MARGIN = TS; // keep the hero this far inside the window edges
const MAP_H = 192; // 4x the descent length to get home

const HERO = { speed: 135, maxHp: 50, atkDamage: 9, atkCooldown: 0.45, atkRadius: 80, iframeDur: 0.8, r: 13 };

// Enemies are slower than the hero (dodgeable) and stop to attack.
const KIND = {
  // Stops and hits with a stick: chase, then windup -> strike -> recover.
  melee:    { speed: 110, maxHp: 30, r: 15, color: "#d35400", dmg: 10, range: 64, windup: 0.45, recover: 0.6, repath: 0.4 },
  // Stops to take potshots: approach to range, aim, fire a projectile, cool down.
  ranged:   { speed: 95,  maxHp: 18, r: 13, color: "#27ae60", dmg: 7, prefRange: 320, aim: 0.55, cooldown: 1.7, shot: 300, repath: 0.4 },
  // Ambient roamer; light contact damage.
  wanderer: { speed: 120, maxHp: 12, r: 11, color: "#8e44ad", contact: 4 },
};
const SPAWN = { melee: 10, ranged: 7, wanderer: 8 };

const TILE_COLOR = {
  [TILE.STREET]: "#5a5a5a", [TILE.SIDEWALK]: "#9a9a9a", [TILE.YARD]: "#6f9a55",
  [TILE.ALLEY]: "#4a4a4a", [TILE.FLOOR]: "#caa37a", [TILE.WALL]: "#2e2e2e", [TILE.RUBBLE]: "#7c6a55",
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export function createRunScene(ctx, input, seed) {
  const level = generate(seed, { w: 48, h: MAP_H, bearing: (3 * Math.PI) / 2, tileSize: TS });
  const mapW = level.w * TS, mapH = level.h * TS;
  const homeSet = new Set(level.homeBand.map(([x, y]) => y * level.w + x));
  const rng = makeRng(subSeed(seed, "spawns"));

  const hero = {
    x: level.start.x * TS + TS / 2, y: level.start.y * TS + TS / 2,
    w: HERO.r * 2, h: HERO.r * 2, hp: HERO.maxHp, cd: 0, iframes: 0,
  };

  const enemies = [];
  for (const [kind, n] of Object.entries(SPAWN))
    for (let i = 0; i < n; i++) {
      let tx, ty;
      do { [tx, ty] = randomWalkableTile(level, rng); } while (ty < 9);
      const k = KIND[kind];
      enemies.push({
        kind, x: tx * TS + TS / 2, y: ty * TS + TS / 2, w: k.r * 2, h: k.r * 2,
        hp: k.maxHp, path: null, pi: 0, repathT: 0, state: null, timer: 0,
      });
    }

  const projectiles = [];
  const cam = { x: 0, y: 0 };
  let swingT = 0;
  let outcome = null;
  const state = { restart: false };

  const tileOf = (e) => [Math.floor(e.x / TS), Math.floor(e.y / TS)];

  function followPath(e, speed, dt) {
    if (!e.path || e.pi >= e.path.length) return true;
    const [tx, ty] = e.path[e.pi];
    const cx = tx * TS + TS / 2, cy = ty * TS + TS / 2;
    const dx = cx - e.x, dy = cy - e.y, d = Math.hypot(dx, dy) || 1;
    if (d < 5) { e.pi++; return e.pi >= e.path.length; }
    moveAndCollide(level, e, (dx / d) * speed * dt, (dy / d) * speed * dt);
    return false;
  }

  function repathTo(e, k, tx, ty) {
    e.path = findPath(level, ...tileOf(e), tx, ty) || [];
    e.pi = 0;
    e.repathT = k.repath;
  }

  function hurtHero(amount) {
    if (hero.iframes > 0) return;
    hero.hp -= amount;
    hero.iframes = HERO.iframeDur;
    if (hero.hp <= 0) outcome = "lose";
  }

  function stepEnemy(e, dt, heroTile) {
    const k = KIND[e.kind];
    const d = dist(e.x, e.y, hero.x, hero.y);
    e.repathT -= dt;

    if (e.kind === "wanderer") {
      if (!e.path || e.pi >= e.path.length) {
        const [ex, ey] = tileOf(e);
        const [wx, wy] = localWalkableTile(level, rng, ex, ey, 12);
        e.path = findPath(level, ex, ey, wx, wy) || [];
        e.pi = 0;
      }
      followPath(e, k.speed, dt);
      if (d < HERO.r + k.r) hurtHero(k.contact);
      return;
    }

    if (e.kind === "melee") {
      e.state = e.state || "seek";
      if (e.state === "seek") {
        if (d < k.range) { e.state = "windup"; e.timer = k.windup; return; }
        if (!e.path || e.pi >= e.path.length || e.repathT <= 0) repathTo(e, k, heroTile[0], heroTile[1]);
        followPath(e, k.speed, dt);
      } else if (e.state === "windup") {
        e.timer -= dt; // plant feet, telegraph the swing
        if (e.timer <= 0) {
          if (d < k.range + 14) hurtHero(k.dmg);
          e.state = "recover"; e.timer = k.recover;
        }
      } else { // recover
        e.timer -= dt;
        if (e.timer <= 0) e.state = "seek";
      }
      return;
    }

    // ranged
    e.state = e.state || "approach";
    if (e.state === "approach") {
      if (d <= k.prefRange) { e.state = "aim"; e.timer = k.aim; return; }
      if (!e.path || e.pi >= e.path.length || e.repathT <= 0) repathTo(e, k, heroTile[0], heroTile[1]);
      followPath(e, k.speed, dt);
    } else if (e.state === "aim") {
      e.timer -= dt; // stop and draw a bead, telegraphed
      if (e.timer <= 0) {
        const dx = hero.x - e.x, dy = hero.y - e.y, m = Math.hypot(dx, dy) || 1;
        projectiles.push({ x: e.x, y: e.y, vx: (dx / m) * k.shot, vy: (dy / m) * k.shot, life: 2.5, dmg: k.dmg, dead: false });
        e.state = "cooldown"; e.timer = k.cooldown;
      }
    } else { // cooldown — back off if the hero crowds in
      e.timer -= dt;
      if (d < k.prefRange * 0.55) {
        const dx = e.x - hero.x, dy = e.y - hero.y, m = Math.hypot(dx, dy) || 1;
        moveAndCollide(level, e, (dx / m) * k.speed * dt, (dy / m) * k.speed * dt);
      }
      if (e.timer <= 0) e.state = "approach";
    }
  }

  function update(dt) {
    if (outcome) {
      if (input.down("Space") || input.down("Enter")) state.restart = true;
      return;
    }
    hero.cd = Math.max(0, hero.cd - dt);
    hero.iframes = Math.max(0, hero.iframes - dt);
    swingT = Math.max(0, swingT - dt);

    cam.y = clamp(cam.y + SCROLL * dt, 0, mapH - VIEW_H); // window descends

    const intent = input.intent();
    moveAndCollide(level, hero, intent.x * HERO.speed * dt, intent.y * HERO.speed * dt);

    const m = input.mouse();
    const ax = m.x + cam.x - hero.x, ay = m.y + cam.y - hero.y;
    const am = Math.hypot(ax, ay) || 1;
    const aim = { x: ax / am, y: ay / am };

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

    // Enemy brains (only those near the window stay active, for perf on the long map)
    const heroTile = tileOf(hero);
    const activeY = cam.y + VIEW_H / 2;
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      if (Math.abs(e.y - activeY) < VIEW_H) stepEnemy(e, dt, heroTile);
    }

    // Enemy projectiles
    for (const p of projectiles) {
      if (p.dead) continue;
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0 || !isWalkable(level, Math.floor(p.x / TS), Math.floor(p.y / TS))) { p.dead = true; continue; }
      if (dist(p.x, p.y, hero.x, hero.y) < HERO.r + 5) { p.dead = true; hurtHero(p.dmg); }
    }
    for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].dead) projectiles.splice(i, 1);

    // Stay inside the moving window; the advancing top edge can crush the hero
    // against a wall, which is fatal.
    hero.x = clamp(hero.x, MARGIN, mapW - MARGIN);
    const minY = cam.y + MARGIN;
    if (hero.y < minY) {
      hero.y = minY;
      if (boxBlocked(level, hero)) outcome = "lose";
    }
    hero.y = clamp(hero.y, minY, cam.y + VIEW_H - MARGIN);
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
        const i = ty * level.w + tx;
        const sx = tx * TS - cam.x, sy = ty * TS - cam.y;
        ctx.fillStyle = TILE_COLOR[level.tiles[i]];
        ctx.fillRect(sx, sy, TS, TS);
        // Make non-walkable tiles read as solid obstacles so collision is legible.
        if (!level.walkable[i]) {
          ctx.fillStyle = "rgba(0,0,0,0.38)";
          ctx.fillRect(sx, sy, TS, TS);
          ctx.strokeStyle = "rgba(255,255,255,0.16)";
          ctx.lineWidth = 2;
          ctx.strokeRect(sx + 1, sy + 1, TS - 2, TS - 2);
        }
      }
    ctx.fillStyle = "rgba(255,215,0,0.35)";
    for (const [hx, hy] of level.homeBand)
      if (hx >= x0 && hx <= x1 && hy >= y0 && hy <= y1)
        ctx.fillRect(hx * TS - cam.x, hy * TS - cam.y, TS, TS);

    // Enemy projectiles
    for (const p of projectiles) disc(ctx, p.x - cam.x, p.y - cam.y, 5, "#145a32");

    for (const e of enemies) {
      if (e.hp <= 0) continue;
      const sx = e.x - cam.x, sy = e.y - cam.y, k = KIND[e.kind];
      disc(ctx, sx, sy, k.r, k.color);
      // Telegraphs so attacks are readable/reactable
      if (e.kind === "melee" && e.state === "windup") ring(ctx, sx, sy, k.range, "rgba(231,76,60,0.7)");
      if (e.kind === "ranged" && e.state === "aim") {
        ring(ctx, sx, sy, k.r + 5, "rgba(39,174,96,0.9)");
        ctx.strokeStyle = "rgba(39,174,96,0.5)";
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(hero.x - cam.x, hero.y - cam.y);
        ctx.stroke();
      }
    }

    disc(ctx, hero.x - cam.x, hero.y - cam.y, HERO.r, hero.iframes > 0 ? "#7fb3ff" : "#2d6cdf");
    if (swingT > 0) ring(ctx, hero.x - cam.x, hero.y - cam.y, HERO.atkRadius, "rgba(255,255,255,0.85)");

    ctx.fillStyle = "#111";
    ctx.font = "14px system-ui, sans-serif";
    const depth = Math.round((cam.y / (mapH - VIEW_H)) * 100);
    ctx.fillText(`HP ${Math.max(0, hero.hp)}/${HERO.maxHp}   home in ${100 - depth}%`, 12, 20);
    if (outcome) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, VIEW_H / 2 - 50, VIEW_W, 100);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.font = "32px system-ui, sans-serif";
      ctx.fillText(outcome === "win" ? "MADE IT HOME" : "ANOTHER 3PM…", VIEW_W / 2, VIEW_H / 2 - 4);
      ctx.font = "16px system-ui, sans-serif";
      ctx.fillText("press SPACE to try another day", VIEW_W / 2, VIEW_H / 2 + 26);
      ctx.textAlign = "left";
    }
  }

  return { update, render, get restart() { return state.restart; }, nextSeed: seed + 1 };
}

function disc(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
function ring(ctx, x, y, r, color) {
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}
