// Screenshot the shake/impact onion-skin A/B page (art-test/onion-skin.html) headlessly.
// Not a repo dependency: uses the machine's global `playwright` + the pre-installed Chromium,
// same spirit as tools/verify.mjs. Output → /tmp/three_pm-verify/onion-skin.png
import { createRequire } from "node:module";
import { spawn, execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "/tmp/three_pm-verify"; const PORT = 8124;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const globalRoot = execSync("npm root -g").toString().trim();
const require = createRequire(join(globalRoot, "x.js"));
const { chromium } = require("playwright");

const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: process.cwd(), stdio: "ignore" });
let browser;
try {
  await sleep(600);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 720, height: 1180 }, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:${PORT}/art-test/onion-skin.html`, { waitUntil: "networkidle" });
  await page.waitForFunction("window.__done === true", { timeout: 5000 });
  await sleep(150);
  const path = join(OUT, "onion-skin.png");
  await page.screenshot({ path, fullPage: true });
  console.log("wrote " + path);
} finally {
  if (browser) await browser.close();
  server.kill();
}
