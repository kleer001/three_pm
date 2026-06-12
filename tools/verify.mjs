// Browser verification harness — drives the real game in headless Chrome and dumps
// screenshots so visual/input behavior (rendering, HUD, the shop modal) can be eyeballed.
//
// Deliberately NOT a repo dependency: the game ships zero-dep. The driver library
// (puppeteer-core) lives in a machine-level cache outside the repo, and Chrome is the
// system browser already on PATH — this script only reuses what the machine provides.
//
//   node tools/verify.mjs [weaponId] [seconds]
//
// weaponId defaults to "beam"; seconds (southward run length) defaults to 12. Frames
// land in /tmp/three_pm-verify/. Override the driver/browser with PUPPETEER_CORE_PATH
// and CHROME_PATH if they live elsewhere.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BALANCE } from "../src/run/balance.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "/tmp/three_pm-verify";
const PORT = 8123;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The driver lib lives outside the repo; resolve it from its install dir (honoring
// that package's own `exports` map) rather than guessing an entry file.
const CORE_DIR = process.env.PUPPETEER_CORE_PATH ||
  join(homedir(), ".cache/three_pm-verify");
let CORE;
try {
  CORE = createRequire(join(CORE_DIR, "package.json")).resolve("puppeteer-core");
} catch {
  console.error(`puppeteer-core not found under ${CORE_DIR}\n` +
    `Install it once (outside the repo):  mkdir -p ~/.cache/three_pm-verify && ` +
    `cd ~/.cache/three_pm-verify && npm i puppeteer-core`);
  process.exit(1);
}
const CHROME = process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync);
if (!CHROME) { console.error("No system Chrome/Chromium found; set CHROME_PATH."); process.exit(1); }

const weaponId = process.argv[2] || "beam";
const seconds = Number(process.argv[3] || 12);
const ids = Object.keys(BALANCE.weapons);
const weaponIndex = ids.indexOf(weaponId);
if (weaponIndex < 0) { console.error(`Unknown weapon "${weaponId}". One of: ${ids.join(", ")}`); process.exit(1); }

const puppeteer = (await import(CORE)).default;
mkdirSync(OUT, { recursive: true });

// Self-contained static server (ES modules need HTTP, not file://).
const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: REPO, stdio: "ignore" });
const shot = (page, name) => page.screenshot({ path: join(OUT, name) }).then(() => console.log("  " + join(OUT, name)));

let browser;
try {
  await sleep(600);
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--window-size=820,640"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 820, height: 640 });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle0" });
  await sleep(800); // let the select scene arm (it waits for Space to be released once)

  // The game polls input once per frame, so a fast keydown→keyup can fall between
  // two frames and be missed. Hold every discrete key long enough to span several
  // frames before releasing.
  const tap = async (key, holdMs = 150) => {
    await page.keyboard.down(key); await sleep(holdMs); await page.keyboard.up(key); await sleep(120);
  };

  console.log(`select → ${weaponId}:`);
  await shot(page, "01-select.png");
  for (let i = 0; i < weaponIndex; i++) await tap("ArrowDown");
  await tap("Space"); // start the descent
  await sleep(800);
  await shot(page, "02-run-start.png"); // confirm we left the select screen

  console.log("descent (holding south, firing) — filmstrip:");
  const frames = 8, stepMs = (seconds * 1000) / frames;
  await page.keyboard.down("KeyS");
  for (let f = 0; f < frames; f++) {
    const fires = Math.max(1, Math.round(stepMs / 300));
    for (let s = 0; s < fires; s++) await tap("Space"); // robust fire taps
    await shot(page, `run-${String(f + 1).padStart(2, "0")}.png`);
  }
  await page.keyboard.up("KeyS");
  console.log(`done. ${OUT}/`);
} finally {
  if (browser) await browser.close();
  server.kill();
}
