// Vertical-slice RUN scene: Marvin moves on a generated suburb, fights one
// chaser, wins by reaching the home band. Hardcoded starter; the registry,
// HUD, powerups, and meta land in later increments.
import { generate, TILE } from "./levelgen.js";
import { moveAndCollide } from "./collision.js";

const VIEW_W = 800, VIEW_H = 600;

// Marvin = all-5 baseline (docs/05-characters.md) reduced to slice constants.
const HERO = { speed: 140, maxHp: 50, atkDamage: 9, atkCooldown: 0.45, atkRadius: 42, iframeDur: 0.8 };
const CHASER = { speed: 95, maxHp: 24, contactDamage: 6 };

const TILE_COLOR = {
  [TILE.STREET]: "#5a5a5a",
  [TILE.SIDEWALK]: "#9a9a9a",
  [TILE.YARD]: "#6f9a55",
  [TILE.ALLEY]: "#4a4a4a",
  [TILE.FLOOR]: "#caa37a",
  [TILE.WALL]: "#2e2e2e",
  [TILE.RUBBLE]: "#7c6a55",
};

export function createRunScene(ctx, input, seed) {
  const bearing = (seed % 360) * (Math.PI / 180);
  const level = generate(seed, { w: 48, h: 48, bearing });
  const ts = level.tileSize;
  const homeSet = new Set(level.homeBand.map(([x, y]) => y * level.w + x));

  const hero = {
    x: level.start.x * ts + ts / 2, y: level.start.y * ts + ts / 2,
    w: 16, h: 16, hp: HERO.maxHp, cd: 0, iframes: 0,
  };
  // Place the chaser a few streets ahead toward home, on a walkable tile.
  const enemy = spawnAhead(level, hero);

  const cam = { x: 0, y: 0 };
  let swingT = 0; // melee flash timer
  let outcome = null; // 'win' | 'lose'

  function update(dt) {
    if (outcome) return;
    hero.cd = Math.max(0, hero.cd - dt);
    hero.iframes = Math.max(0, hero.iframes - dt);
    swingT = Math.max(0, swingT - dt);

    // Movement
    const intent = input.intent();
    moveAndCollide(level, hero, intent.x * HERO.speed * dt, intent.y * HERO.speed * dt);

    // Aim (world) from hero center to cursor
    const m = input.mouse();
    const ax = m.x + cam.x - hero.x, ay = m.y + cam.y - hero.y;
    const am = Math.hypot(ax, ay) || 1;
    const aim = { x: ax / am, y: ay / am };

    // Basic attack: Backpack Swing (melee arc, front half)
    if (input.firing && hero.cd <= 0) {
      hero.cd = HERO.atkCooldown;
      swingT = 0.12;
      if (enemy.hp > 0) {
        const dx = enemy.x - hero.x, dy = enemy.y - hero.y;
        const d = Math.hypot(dx, dy);
        if (d < HERO.atkRadius && (dx / d) * aim.x + (dy / d) * aim.y > 0) {
          enemy.hp -= HERO.atkDamage;
          enemy.x += (dx / d) * 14; // knockback
          enemy.y += (dy / d) * 14;
        }
      }
    }

    // Chaser AI: pursue hero, contact damage (respecting i-frames)
    if (enemy.hp > 0) {
      const dx = hero.x - enemy.x, dy = hero.y - enemy.y;
      const d = Math.hypot(dx, dy) || 1;
      moveAndCollide(level, enemy, (dx / d) * CHASER.speed * dt, (dy / d) * CHASER.speed * dt);
      if (d < 16 && hero.iframes <= 0) {
        hero.hp -= CHASER.contactDamage;
        hero.iframes = HERO.iframeDur;
        if (hero.hp <= 0) outcome = "lose";
      }
    }

    // Win: hero's tile is in the home band
    const tx = Math.floor(hero.x / ts), ty = Math.floor(hero.y / ts);
    if (homeSet.has(ty * level.w + tx)) outcome = "win";

    // Camera follow + clamp
    cam.x = clamp(hero.x - VIEW_W / 2, 0, level.w * ts - VIEW_W);
    cam.y = clamp(hero.y - VIEW_H / 2, 0, level.h * ts - VIEW_H);
  }

  function render() {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    const x0 = Math.max(0, Math.floor(cam.x / ts)), x1 = Math.min(level.w - 1, Math.ceil((cam.x + VIEW_W) / ts));
    const y0 = Math.max(0, Math.floor(cam.y / ts)), y1 = Math.min(level.h - 1, Math.ceil((cam.y + VIEW_H) / ts));
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        ctx.fillStyle = TILE_COLOR[level.tiles[ty * level.w + tx]];
        ctx.fillRect(tx * ts - cam.x, ty * ts - cam.y, ts, ts);
      }
    // Home band glow
    ctx.fillStyle = "rgba(255,215,0,0.35)";
    for (const [hx, hy] of level.homeBand)
      if (hx >= x0 && hx <= x1 && hy >= y0 && hy <= y1)
        ctx.fillRect(hx * ts - cam.x, hy * ts - cam.y, ts, ts);

    if (enemy.hp > 0) dot(ctx, enemy.x - cam.x, enemy.y - cam.y, 9, "#c0392b");
    dot(ctx, hero.x - cam.x, hero.y - cam.y, 9, hero.iframes > 0 ? "#7fb3ff" : "#2d6cdf");
    if (swingT > 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.arc(hero.x - cam.x, hero.y - cam.y, HERO.atkRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Minimal debug HUD
    ctx.fillStyle = "#111";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText(`HP ${Math.max(0, hero.hp)}/${HERO.maxHp}   home: ${level.homeEdge}`, 12, 20);
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

function spawnAhead(level, hero) {
  const ts = level.tileSize;
  const step = level.homeEdge === "E" ? [1, 0] : level.homeEdge === "W" ? [-1, 0] : level.homeEdge === "N" ? [0, -1] : [0, 1];
  let tx = Math.floor(hero.x / ts), ty = Math.floor(hero.y / ts);
  for (let i = 0; i < 8; i++) {
    const nx = tx + step[0] * 3, ny = ty + step[1] * 3;
    if (level.walkable[ny * level.w + nx]) { tx = nx; ty = ny; }
  }
  return { x: tx * ts + ts / 2, y: ty * ts + ts / 2, w: 16, h: 16, hp: CHASER.maxHp };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
