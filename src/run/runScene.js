// Vertical-slice RUN scene: a forced southward descent. The camera window
// auto-scrolls down, holding Marvin inside it; home is the south band, four
// times the map away. Enemies use BFS pathfinding (ported from BrainMaze), take
// up space (soft body collision), and stop to attack. Marvin fights back with
// an auto-aiming slingshot that freezes — two freezes kill.
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
const FREEZE_DUR = 2.5; // how long a slingshot hit immobilizes an enemy

const HERO = { speed: 135, maxHp: 50, iframeDur: 0.8, r: 13, shotCD: 3, shotSpeed: 360, shotRange: 470, shotR: 6 };

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
    w: HERO.r * 2, h: HERO.r * 2, r: HERO.r, hp: HERO.maxHp, cd: 0, iframes: 0,
    animT: 0, facing: Math.PI / 2, moving: false,
  };

  const enemies = [];
  for (const [kind, n] of Object.entries(SPAWN))
    for (let i = 0; i < n; i++) {
      let tx, ty;
      do { [tx, ty] = randomWalkableTile(level, rng); } while (ty < 9);
      const k = KIND[kind];
      enemies.push({
        kind, x: tx * TS + TS / 2, y: ty * TS + TS / 2, w: k.r * 2, h: k.r * 2, r: k.r,
        hp: k.maxHp, path: null, pi: 0, repathT: 0, state: null, timer: 0,
        frozenT: 0, freezeCount: 0, dead: false,
      });
    }

  const projectiles = []; // enemy shots
  const shots = [];        // hero slingshot pebbles
  const cam = { x: 0, y: 0 };
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
      if (d < hero.r + e.r) hurtHero(k.contact);
      return;
    }

    if (e.kind === "melee") {
      e.state = e.state || "seek";
      if (e.state === "seek") {
        if (d < k.range) { e.state = "windup"; e.timer = k.windup; return; }
        if (!e.path || e.pi >= e.path.length || e.repathT <= 0) repathTo(e, k, heroTile[0], heroTile[1]);
        followPath(e, k.speed, dt);
      } else if (e.state === "windup") {
        e.timer -= dt;
        if (e.timer <= 0) {
          if (d < k.range + 14) hurtHero(k.dmg);
          e.state = "recover"; e.timer = k.recover;
        }
      } else {
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
      e.timer -= dt;
      if (e.timer <= 0) {
        const dx = hero.x - e.x, dy = hero.y - e.y, m = Math.hypot(dx, dy) || 1;
        projectiles.push({ x: e.x, y: e.y, vx: (dx / m) * k.shot, vy: (dy / m) * k.shot, life: 2.5, dmg: k.dmg, dead: false });
        e.state = "cooldown"; e.timer = k.cooldown;
      }
    } else {
      e.timer -= dt;
      if (d < k.prefRange * 0.55) {
        const dx = e.x - hero.x, dy = e.y - hero.y, m = Math.hypot(dx, dy) || 1;
        moveAndCollide(level, e, (dx / m) * k.speed * dt, (dy / m) * k.speed * dt);
      }
      if (e.timer <= 0) e.state = "approach";
    }
  }

  // Soft body collision: shift `e` (and optionally `o`) so circles stop overlapping,
  // never into a wall.
  function shift(e, dx, dy) {
    e.x += dx; e.y += dy;
    if (boxBlocked(level, e)) { e.x -= dx; e.y -= dy; }
  }
  function separate(a, b, moveA) {
    const dx = b.x - a.x, dy = b.y - a.y;
    let d = Math.hypot(dx, dy) || 0.001;
    const min = a.r + b.r;
    if (d >= min) return;
    const o = min - d, nx = dx / d, ny = dy / d;
    if (moveA) { shift(a, -nx * o * 0.5, -ny * o * 0.5); shift(b, nx * o * 0.5, ny * o * 0.5); }
    else shift(b, nx * o, ny * o); // push only b (b out of an immovable a)
  }

  // Hard block: the hero cannot move deeper into any body (living enemy or corpse),
  // but may always move away from one (so it never gets permanently stuck).
  function bodyDeeper(px, py) {
    for (const e of enemies) {
      if (e.dead) continue; // corpses are pushable, only living enemies hard-block
      const min = hero.r + e.r;
      const nd = dist(hero.x, hero.y, e.x, e.y);
      if (nd < min && nd < dist(px, py, e.x, e.y)) return true;
    }
    return false;
  }
  function heroMove(dx, dy) {
    const ox = hero.x;
    hero.x += dx;
    if (boxBlocked(level, hero) || bodyDeeper(ox, hero.y)) hero.x = ox;
    const oy = hero.y;
    hero.y += dy;
    if (boxBlocked(level, hero) || bodyDeeper(hero.x, oy)) hero.y = oy;
  }

  function update(dt) {
    if (outcome) {
      if (input.down("Space") || input.down("Enter")) state.restart = true;
      return;
    }
    hero.cd = Math.max(0, hero.cd - dt);
    hero.iframes = Math.max(0, hero.iframes - dt);

    cam.y = clamp(cam.y + SCROLL * dt, 0, mapH - VIEW_H);

    const intent = input.intent();
    heroMove(intent.x * HERO.speed * dt, intent.y * HERO.speed * dt);
    hero.animT += dt;
    hero.moving = intent.x !== 0 || intent.y !== 0;
    if (hero.moving) hero.facing = Math.atan2(intent.y, intent.x);

    // Slingshot: SPACE fires at the nearest living enemy in range, on a shotCD.
    if (hero.cd <= 0 && input.down("Space")) {
      let best = null, bd = HERO.shotRange;
      for (const e of enemies) {
        if (e.dead) continue;
        const d = dist(e.x, e.y, hero.x, hero.y);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) {
        const dx = best.x - hero.x, dy = best.y - hero.y, m = Math.hypot(dx, dy) || 1;
        shots.push({ x: hero.x, y: hero.y, vx: (dx / m) * HERO.shotSpeed, vy: (dy / m) * HERO.shotSpeed, life: 2, dead: false });
        hero.cd = HERO.shotCD;
      }
    }

    // Hero pebbles: freeze on hit; a second freeze kills.
    for (const s of shots) {
      if (s.dead) continue;
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0 || !isWalkable(level, Math.floor(s.x / TS), Math.floor(s.y / TS))) { s.dead = true; continue; }
      for (const e of enemies) {
        if (e.dead) continue;
        if (dist(s.x, s.y, e.x, e.y) < HERO.shotR + e.r) {
          e.freezeCount++;
          e.frozenT = FREEZE_DUR;
          if (e.freezeCount >= 2) { e.dead = true; e.hp = 0; }
          s.dead = true;
          break;
        }
      }
    }

    // Enemy brains (skip dead/frozen; cull far enemies on the long map)
    const heroTile = tileOf(hero);
    const activeY = cam.y + VIEW_H / 2;
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.frozenT > 0) { e.frozenT -= dt; continue; }
      if (Math.abs(e.y - activeY) < VIEW_H) stepEnemy(e, dt, heroTile);
    }

    // Enemy projectiles
    for (const p of projectiles) {
      if (p.dead) continue;
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0 || !isWalkable(level, Math.floor(p.x / TS), Math.floor(p.y / TS))) { p.dead = true; continue; }
      if (dist(p.x, p.y, hero.x, hero.y) < hero.r + 5) { p.dead = true; hurtHero(p.dmg); }
    }

    // Bodies take up space. The hero hard-blocks against bodies in heroMove;
    // here push living enemies out of one another, the hero, and solid corpses.
    const live = enemies.filter((e) => !e.dead);
    const corpses = enemies.filter((e) => e.dead);
    for (let i = 0; i < live.length; i++) {
      separate(hero, live[i], false);
      for (const c of corpses) separate(c, live[i], false);
      for (let j = i + 1; j < live.length; j++) separate(live[i], live[j], true);
    }
    for (const c of corpses) separate(hero, c, false); // the hero shoves (heavy) corpses aside

    for (let i = shots.length - 1; i >= 0; i--) if (shots[i].dead) shots.splice(i, 1);
    for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].dead) projectiles.splice(i, 1);

    // Stay inside the moving window; being crushed against a wall is fatal.
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
        // Floor + 1px overscan so fractional camera scroll leaves no seams.
        const sx = Math.floor(tx * TS - cam.x), sy = Math.floor(ty * TS - cam.y);
        ctx.fillStyle = TILE_COLOR[level.tiles[i]];
        ctx.fillRect(sx, sy, TS + 1, TS + 1);
        if (!level.walkable[i]) { // darken obstacles so collision is legible
          ctx.fillStyle = "rgba(0,0,0,0.4)";
          ctx.fillRect(sx, sy, TS + 1, TS + 1);
        }
      }
    ctx.fillStyle = "rgba(255,215,0,0.35)";
    for (const [hx, hy] of level.homeBand)
      if (hx >= x0 && hx <= x1 && hy >= y0 && hy <= y1)
        ctx.fillRect(Math.floor(hx * TS - cam.x), Math.floor(hy * TS - cam.y), TS + 1, TS + 1);

    // Corpses (drawn under everything live)
    for (const e of enemies)
      if (e.dead) disc(ctx, e.x - cam.x, e.y - cam.y, e.r, "#2b2622");

    for (const p of projectiles) disc(ctx, p.x - cam.x, p.y - cam.y, 5, "#145a32");
    for (const s of shots) disc(ctx, s.x - cam.x, s.y - cam.y, HERO.shotR, "#d8d4c8");

    for (const e of enemies) {
      if (e.dead) continue;
      const sx = e.x - cam.x, sy = e.y - cam.y, k = KIND[e.kind];
      disc(ctx, sx, sy, e.r, k.color);
      if (e.frozenT > 0) {
        disc(ctx, sx, sy, e.r, "rgba(150,205,255,0.55)");
        ring(ctx, sx, sy, e.r + 2, "rgba(190,230,255,0.9)");
      } else { // telegraphs only when active
        if (e.kind === "melee" && e.state === "windup") ring(ctx, sx, sy, k.range, "rgba(231,76,60,0.7)");
        if (e.kind === "ranged" && e.state === "aim") {
          ring(ctx, sx, sy, e.r + 5, "rgba(39,174,96,0.9)");
          ctx.strokeStyle = "rgba(39,174,96,0.5)";
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(hero.x - cam.x, hero.y - cam.y);
          ctx.stroke();
        }
      }
    }

    // Hero: always-on idle/walk bob + facing nub + grounding shadow.
    {
      const hx = hero.x - cam.x, hy = hero.y - cam.y;
      const bob = Math.sin(hero.animT * (hero.moving ? 14 : 4)) * (hero.moving ? 3 : 1.5);
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      ctx.ellipse(hx, hy + hero.r * 0.7, hero.r * 0.85, hero.r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      disc(ctx, hx, hy - bob, hero.r, hero.iframes > 0 ? "#7fb3ff" : "#2d6cdf");
      disc(ctx, hx + Math.cos(hero.facing) * hero.r * 0.55, hy - bob + Math.sin(hero.facing) * hero.r * 0.55, 3, "#fff");
    }

    ctx.fillStyle = "#111";
    ctx.font = "14px system-ui, sans-serif";
    const depth = Math.round((cam.y / (mapH - VIEW_H)) * 100);
    const sling = hero.cd <= 0 ? "ready" : `${hero.cd.toFixed(1)}s`;
    ctx.fillText(`HP ${Math.max(0, hero.hp)}/${HERO.maxHp}   home in ${100 - depth}%   slingshot ${sling} [SPACE]`, 12, 20);
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
