// Dual-grid autotiling demo. Loads the directional tileset and lets you paint
// materials on a logic grid; the display layer is offset half a cell so each
// display tile samples its 4 corners from 4 world cells (TL=1,TR=2,BR=4,BL=8) and
// picks the matching tile. Self-contained — imports nothing from the game's src/.

const desc = await fetch("../assets/tiles.json").then((r) => r.json());
const sheet = await new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => rej(new Error("tiles.png failed to load"));
  img.src = "../assets/tiles.png";
});

const CELL = desc.cell;
const blit = (ctx, fid, dx, dy) => {
  const f = desc.frames[fid];
  ctx.drawImage(sheet, f.x, f.y, f.w, f.h, dx, dy, f.w, f.h);
};

const canvas = document.getElementById("paint");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;
const GW = Math.floor(canvas.width / CELL);
const GH = Math.floor(canvas.height / CELL);
const MATS = Object.keys(desc.materials); // draw order = priority (last on top)

// logic grid: each world cell holds a material name or null (=> ground)
const grid = Array.from({ length: GH }, () => new Array(GW).fill(null));
let showGrid = false;

// seed a little scene so autotiling is visible on load
function seed() {
  const set = (x, y, m) => { if (x >= 0 && x < GW && y >= 0 && y < GH) grid[y][x] = m; };
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 5; x++) set(x, y, MATS[0]); // hedge block w/ inner corner
  set(3, 2, null); set(3, 3, null);                                            // carve a notch
  for (let x = 0; x < GW; x++) { set(x, 7, MATS.includes("road") ? "road" : MATS[3]); } // a road
  for (let y = 6; y <= 9; y++) for (let x = 10; x <= 13; x++) set(x, y, MATS[2]); // crater field
  for (let y = 1; y <= 3; y++) for (let x = 11; x <= 14; x++) set(x, y, MATS[1]); // brick
}
seed();

// --- dual-grid render ---
function cellMat(x, y) { return (x < 0 || y < 0 || x >= GW || y >= GH) ? null : grid[y][x]; }

function render() {
  // ground fill
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) blit(ctx, desc.ground, x * CELL, y * CELL);
  // one offset display pass per material, in priority order
  for (const m of MATS) {
    const tiles = desc.materials[m];
    for (let y = -1; y < GH; y++)
      for (let x = -1; x < GW; x++) {
        const tl = cellMat(x, y) === m, tr = cellMat(x + 1, y) === m;
        const br = cellMat(x + 1, y + 1) === m, bl = cellMat(x, y + 1) === m;
        const c = (tl ? 1 : 0) | (tr ? 2 : 0) | (br ? 4 : 0) | (bl ? 8 : 0);
        if (c) blit(ctx, tiles[c], x * CELL + CELL / 2, y * CELL + CELL / 2);
      }
  }
  if (showGrid) {
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    for (let x = 0; x <= GW; x++) { ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, GH * CELL); ctx.stroke(); }
    for (let y = 0; y <= GH; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(GW * CELL, y * CELL); ctx.stroke(); }
  }
}

// --- palette UI ---
let current = MATS[0];
const palette = document.getElementById("palette");
MATS.forEach((m, i) => {
  const b = document.createElement("button");
  b.className = "swatch" + (m === current ? " active" : "");
  b.textContent = `${i + 1} · ${m}`;
  b.onclick = () => { current = m; refreshPalette(); };
  palette.append(b);
});
const eraseBtn = document.createElement("button");
eraseBtn.className = "swatch";
eraseBtn.textContent = "0 · erase";
eraseBtn.onclick = () => { current = null; refreshPalette(); };
palette.append(eraseBtn);
function refreshPalette() {
  [...palette.children].forEach((b, i) => {
    const isErase = i === MATS.length;
    b.classList.toggle("active", isErase ? current === null : MATS[i] === current);
  });
}

// --- painting ---
let painting = 0; // 0 none, 1 paint current, 2 erase (right button)
function paintAt(ev) {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((ev.clientX - r.left) / (r.width / GW));
  const y = Math.floor((ev.clientY - r.top) / (r.height / GH));
  if (x < 0 || y < 0 || x >= GW || y >= GH) return;
  grid[y][x] = painting === 2 ? null : current;
  render();
}
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => { painting = e.button === 2 ? 2 : 1; paintAt(e); });
canvas.addEventListener("pointermove", (e) => { if (painting) paintAt(e); });
addEventListener("pointerup", () => { painting = 0; });

addEventListener("keydown", (e) => {
  if (e.code === "Digit0") { current = null; refreshPalette(); }
  const n = "Digit1 Digit2 Digit3 Digit4".split(" ").indexOf(e.code);
  if (n >= 0 && n < MATS.length) { current = MATS[n]; refreshPalette(); }
  if (e.code === "KeyC") { for (const row of grid) row.fill(null); render(); }
  if (e.code === "KeyG") { showGrid = !showGrid; render(); }
});

// --- atlas strip: all 16 tiles per material ---
const atlas = document.getElementById("atlas");
for (const m of MATS) {
  const row = document.createElement("div");
  row.className = "matrow";
  const label = document.createElement("b");
  label.textContent = m;
  const c = document.createElement("canvas");
  c.width = 16 * CELL; c.height = CELL;
  const cx = c.getContext("2d");
  cx.imageSmoothingEnabled = false;
  for (let i = 0; i < 16; i++) blit(cx, desc.materials[m][i], i * CELL, 0);
  row.append(label, c);
  atlas.append(row);
}

render();
