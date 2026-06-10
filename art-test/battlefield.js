// Standalone art sandbox. Loads the sprite atlas and shows it two ways:
// a labeled review grid and a live "battlefield" where actors wander over
// generated ground. Self-contained — imports nothing from the game's src/.

const DESC_URL = "../assets/sprites.json";
const SHEET_URL = "../assets/sprites.png";
const TS = 48;

const desc = await fetch(DESC_URL).then((r) => r.json());
const sheet = await new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => rej(new Error("sprites.png failed to load"));
  img.src = SHEET_URL;
});

const blit = (ctx, id, dx, dy, flipX = false) => {
  const f = desc.frames[id];
  if (flipX) {
    ctx.save();
    ctx.translate(dx + f.w, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(sheet, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    ctx.restore();
  } else {
    ctx.drawImage(sheet, f.x, f.y, f.w, f.h, dx, dy, f.w, f.h);
  }
};

// --- Atlas review: one labeled, upscaled cell per frame ---
const review = document.getElementById("review");
for (const id of Object.keys(desc.frames)) {
  const f = desc.frames[id];
  const cell = document.createElement("div");
  cell.className = "cell";
  const c = document.createElement("canvas");
  c.width = f.w * 2;
  c.height = f.h * 2;
  const cx = c.getContext("2d");
  cx.imageSmoothingEnabled = false;
  cx.drawImage(sheet, f.x, f.y, f.w, f.h, 0, 0, f.w * 2, f.h * 2);
  const label = document.createElement("span");
  label.textContent = id;
  cell.append(c, label);
  review.append(cell);
}

// --- Battlefield: generated ground + wandering actors ---
const field = document.getElementById("field");
const ctx = field.getContext("2d");
ctx.imageSmoothingEnabled = false;
const COLS = Math.ceil(field.width / TS);
const ROWS = Math.ceil(field.height / TS);
const T = { STREET: 0, SIDEWALK: 1, YARD: 2, ALLEY: 3, FLOOR: 4, WALL: 5, RUBBLE: 6 };

let ground = [];
function shuffleGround() {
  // A toy neighborhood: yards, a cross of streets with sidewalks, a couple of
  // houses (wall border + floor) and scattered rubble — enough to show every tile.
  ground = new Array(COLS * ROWS).fill(T.YARD);
  const set = (x, y, t) => { if (x >= 0 && x < COLS && y >= 0 && y < ROWS) ground[y * COLS + x] = t; };
  const midX = (COLS >> 1), midY = (ROWS >> 1);
  for (let y = 0; y < ROWS; y++) { set(midX, y, T.STREET); set(midX - 1, y, T.SIDEWALK); set(midX + 1, y, T.SIDEWALK); }
  for (let x = 0; x < COLS; x++) { set(x, midY, T.STREET); set(x, midY - 1, T.SIDEWALK); set(x, midY + 1, T.SIDEWALK); }
  const house = (ox, oy, w, h) => {
    for (let y = oy; y < oy + h; y++)
      for (let x = ox; x < ox + w; x++)
        set(x, y, (x === ox || x === ox + w - 1 || y === oy || y === oy + h - 1) ? T.WALL : T.FLOOR);
  };
  house(1, 1, 4, 3);
  house(COLS - 5, ROWS - 4, 4, 3);
  for (let i = 0; i < 10; i++) set(2 + ((i * 7) % (COLS - 4)), 2 + ((i * 5) % (ROWS - 4)), T.RUBBLE);
  // a short alley
  for (let x = 1; x < 5; x++) set(x, ROWS - 6, T.ALLEY);
}
shuffleGround();

const KINDS = ["marvin", "melee", "ranged", "wanderer"];
const actors = [];
for (const id of KINDS)
  for (let i = 0; i < (id === "marvin" ? 2 : 3); i++) {
    const a = Math.random() * Math.PI * 2, sp = 25 + Math.random() * 45;
    actors.push({ id, x: Math.random() * field.width, y: Math.random() * field.height,
                  vx: Math.cos(a) * sp, vy: Math.sin(a) * sp });
  }

let paused = false;
addEventListener("keydown", (e) => {
  if (e.code === "KeyR") shuffleGround();
  if (e.code === "Space") { e.preventDefault(); paused = !paused; }
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) {
    for (const a of actors) {
      a.x += a.vx * dt; a.y += a.vy * dt;
      if (a.x < 24 || a.x > field.width - 24) a.vx *= -1;
      if (a.y < 24 || a.y > field.height - 24) a.vy *= -1;
      a.x = Math.max(24, Math.min(field.width - 24, a.x));
      a.y = Math.max(24, Math.min(field.height - 24, a.y));
    }
  }
  // ground
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++)
      blit(ctx, desc.tiles[String(ground[y * COLS + x])], x * TS, y * TS);
  // actors, y-sorted (lower = in front)
  for (const a of [...actors].sort((p, q) => p.y - q.y))
    blit(ctx, a.id, Math.round(a.x - TS / 2), Math.round(a.y - TS / 2), a.vx > 0);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
