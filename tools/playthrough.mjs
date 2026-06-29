// Campaign playthrough harness — drives the REAL game GUI in headless Chrome to pin the
// level→level + add-hero progression (the part tests/gauntlet.mjs can't reach, since that only
// runs the RUN scene). The run autopilots home and is invincible (?bot), so the harness only
// drives the menus; it screenshots the party screen and hard-asserts hero availability, crew
// changes, the day counter, and zero page/console errors.
//
//   node tools/playthrough.mjs [days]     clean crew-growth sweep (default 5 = Marvin→Eugene)
//   node tools/playthrough.mjs deaths     death scenarios: all-9 portraits, follower cull, wipe
//
// Screenshots + a report land in /tmp/three_pm-playthrough/. Exits non-zero on any failure.
//
// Like tools/verify.mjs this is deliberately NOT a repo dependency: puppeteer-core lives in a
// machine cache and Chrome is the system browser. Override with PUPPETEER_CORE_PATH/CHROME_PATH.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BALANCE } from "../src/run/balance.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "/tmp/three_pm-playthrough";
const PORT = 8124;
const MODE = process.argv[2] === "deaths" ? "deaths" : "sweep";
const DAYS = MODE === "sweep" ? Number(process.argv[2] || 5) : 0;
const RUN_TIMEOUT_MS = 180_000; // realtime traversal of the long map; generous
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CORE_DIR = process.env.PUPPETEER_CORE_PATH || join(homedir(), ".cache/three_pm-verify");
let CORE;
try { CORE = createRequire(join(CORE_DIR, "package.json")).resolve("puppeteer-core"); }
catch {
  console.error(`puppeteer-core not found under ${CORE_DIR}\n` +
    `Install it once (outside the repo):  mkdir -p ~/.cache/three_pm-verify && ` +
    `cd ~/.cache/three_pm-verify && npm i puppeteer-core`);
  process.exit(1);
}
const CHROME = process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync);
if (!CHROME) { console.error("No system Chrome/Chromium found; set CHROME_PATH."); process.exit(1); }

// Expected unlock schedule, derived from the roster the same way save.js does:
// isHeroUnlocked = (campaign.day - 1) >= unlockAtRuns. So at day N the unlocked set is every
// hero whose unlockAtRuns <= N-1. The crew grows by recruiting newcomers up to partyMax.
const roster = BALANCE.roster;
const PARTY_MAX = BALANCE.partyMax;
const idAt = (i) => roster[i].id;
const indexOfId = (id) => roster.findIndex((h) => h.id === id);
const unlockedIdsAt = (day) => roster.filter((h) => (day - 1) >= h.unlockAtRuns).map((h) => h.id);
const sameSet = (a, x) => a.length === x.length && a.every((v) => x.includes(v));

const puppeteer = (await import(CORE)).default;
mkdirSync(OUT, { recursive: true });

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: REPO, stdio: "ignore" });

let browser;
try {
  await sleep(600);
  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--window-size=820,640"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 820, height: 640 });

  // Error buckets. A real JS fault (uncaught exception, or a console error that isn't a
  // droppable-asset 404) fails the active scenario. Missing optional assets (art/audio are
  // droppable; sfx.js falls back to synth) are collected separately and reported as info.
  let errs = [];
  const missingAssets = new Set();
  const isResource404 = (t) => /Failed to load resource/i.test(t);
  page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !isResource404(m.text())) errs.push(`console.error: ${m.text()}`); });
  page.on("response", (r) => { if (r.status() === 404) missingAssets.add(r.url().replace(/^https?:\/\/[^/]+\//, "")); });

  // --- shared helpers -----------------------------------------------------
  const phase = () => page.evaluate(() => window.__threepm && window.__threepm.phase);
  const blob = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("threepm:save")); } catch { return null; } });
  const cards = () => page.$$eval("#ui-overlay [data-i]", (els) => els.map((e) => ({
    i: +e.dataset.i,
    locked: e.classList.contains("lock"),
    dead: e.classList.contains("dead"),
    inparty: e.classList.contains("inparty"),
    name: (e.querySelector(".nm") && e.querySelector(".nm").textContent) || "",
    lk: (e.querySelector(".lk") && e.querySelector(".lk").textContent) || "",
    bustW: (e.querySelector(".av img") && e.querySelector(".av img").naturalWidth) || 0,
    hasImg: !!e.querySelector(".av img"),
  })));
  const shot = (name) => page.screenshot({ path: join(OUT, name) });
  const waitPhase = async (want, timeout = 15_000, gone = false) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const p = await phase();
      if (gone ? p !== want : p === want) return p;
      await sleep(150);
    }
    return phase();
  };
  // Skip the summary reveal then confirm, until the FSM leaves the summary.
  const clearSummary = async () => {
    await sleep(400); // summary arms ~200ms after open
    for (let k = 0; k < 10; k++) {
      if ((await phase()) !== "summary") break;
      await page.keyboard.press("Space");
      await sleep(250);
    }
  };
  // Inject a campaign save and open its party screen (Continue if in progress, else New).
  const openCampaign = async (campaign) => {
    await page.evaluate((c) => localStorage.setItem("threepm:save", JSON.stringify({
      version: 2, credits: 0, runCount: 9, heroUpgrades: {},
      stats: { wins: 0, bestDistance: 0, totalKills: 0 }, campaign: c,
    })), campaign);
    await page.reload({ waitUntil: "networkidle0" });
    const cont = await page.$('#ui-overlay [data-act="continue"]');
    await page.click(cont ? '#ui-overlay [data-act="continue"]' : '#ui-overlay [data-act="new"]');
    await waitPhase("party");
    await page.waitForSelector("#ui-overlay [data-start]", { timeout: 10_000 });
    await sleep(250);
  };

  // --- mode: clean crew-growth sweep -------------------------------------
  async function cleanSweep() {
    await page.goto(`http://localhost:${PORT}/index.html?bot=1`, { waitUntil: "networkidle0" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector('#ui-overlay [data-act="new"]', { timeout: 10_000 });
    await page.click('#ui-overlay [data-act="new"]');
    await waitPhase("party");

    for (let day = 1; day <= DAYS; day++) {
      console.log(`\n=== Day ${day} ===`);
      errs = [];
      await page.waitForSelector("#ui-overlay [data-start]", { timeout: 10_000 });
      await sleep(200);
      await shot(`day-${String(day).padStart(2, "0")}-party.png`);

      const b0 = await blob();
      b0 && b0.campaign.day === day ? ok(`campaign.day == ${day}`) : fail(`campaign.day expected ${day}, got ${b0 && b0.campaign.day}`);

      const expectUnlocked = unlockedIdsAt(day);
      const cs = await cards();
      const actualUnlocked = cs.filter((c) => !c.locked && !c.dead).map((c) => idAt(c.i));
      sameSet(actualUnlocked, expectUnlocked)
        ? ok(`unlocked cards = [${expectUnlocked.join(", ")}]`)
        : fail(`unlocked cards expected [${expectUnlocked.join(", ")}], got [${actualUnlocked.join(", ")}]`);
      const leak = cs.find((c) => c.locked && c.name !== "?????");
      leak ? fail(`locked card ${idAt(leak.i)} leaks name "${leak.name}"`) : ok("locked cards censor names");

      const cap = Math.min(PARTY_MAX, expectUnlocked.length);
      const inParty = new Set(b0.campaign.crew);
      const toAdd = cs.filter((c) => !c.locked && !c.dead && !inParty.has(idAt(c.i))).map((c) => c.i);
      for (const i of toAdd) { if (inParty.size >= cap) break; await page.click(`#ui-overlay [data-i="${i}"]`); inParty.add(idAt(i)); await sleep(120); }

      await page.click("#ui-overlay [data-start]");
      (await waitPhase("run", 8_000)) === "run" ? ok("entered RUN") : fail("did not enter RUN");

      const expectCrew = expectUnlocked.slice(0, cap);
      const bRun = await blob();
      bRun && sameSet(bRun.campaign.crew, expectCrew)
        ? ok(`crew = [${expectCrew.join(", ")}] (${cap})`)
        : fail(`crew expected [${expectCrew.join(", ")}], got [${bRun && bRun.campaign.crew.join(", ")}]`);

      const ended = await waitPhase("run", RUN_TIMEOUT_MS, true);
      ended === "summary" ? ok("reached home → SUMMARY") : (fail(`run did not finish (phase=${ended})`), await shot(`day-${String(day).padStart(2, "0")}-stuck.png`));

      await clearSummary();
      (await waitPhase("party", 8_000)) === "party" ? ok("advanced to next day's PARTY") : fail("did not reach next PARTY");

      const b1 = await blob();
      b1 && b1.campaign.day === day + 1 ? ok(`day advanced to ${day + 1}`) : fail(`day expected ${day + 1}, got ${b1 && b1.campaign.day}`);

      errs.length === 0 ? ok("no page/console errors") : errs.forEach(fail);
    }
  }

  // --- mode: death scenarios ---------------------------------------------
  async function deathScenarios() {
    await page.goto(`http://localhost:${PORT}/index.html?bot=1`, { waitUntil: "networkidle0" });

    // 1) Portraits: with every hero unlocked, all 9 cards (busts) + each dossier body must load.
    console.log("\n=== Portraits (all 9 unlocked) ===");
    errs = [];
    await openCampaign({ day: 9, crew: ["marvin"], dead: [] });
    await shot("portraits-all9.png");
    const cs = await cards();
    cs.filter((c) => c.locked).length === 0 ? ok("all 9 cards unlocked") : fail(`${cs.filter((c) => c.locked).length} cards still locked at day 9`);
    const noBust = cs.filter((c) => !c.hasImg || c.bustW === 0);
    noBust.length === 0 ? ok("all 9 bust portraits loaded (naturalWidth>0)") : fail(`busts missing/blank: ${noBust.map((c) => idAt(c.i)).join(", ")}`);
    // cycle selection so each full-body dossier shot loads, and check it decoded
    const badBodies = [];
    for (let i = 0; i < roster.length; i++) {
      await page.click(`#ui-overlay [data-i="${i}"]`);
      let bodyW = 0; // poll: the dossier <img> is recreated on render and decodes on first load
      for (let t = 0; t < 12 && bodyW <= 0; t++) {
        await sleep(150);
        bodyW = await page.$eval("#ui-overlay .doss .bodyshot", (el) => (el.tagName === "IMG" ? el.naturalWidth : -1)).catch(() => 0);
      }
      if (bodyW <= 0) badBodies.push(idAt(i));
    }
    badBodies.length === 0 ? ok("all 9 body portraits loaded") : fail(`body shots missing/blank: ${badBodies.join(", ")}`);
    const portrait404 = [...missingAssets].filter((u) => /portraits\//.test(u));
    portrait404.length === 0 ? ok("zero portrait 404s") : fail(`portrait 404s: ${portrait404.join(", ")}`);

    // 2) Follower death → cull, fallen card, no longer recruitable, survivors carry, day advances.
    console.log("\n=== Follower death → cull / fallen / availability ===");
    errs = [];
    await openCampaign({ day: 3, crew: ["marvin", "chad", "dash"], dead: [] });
    await page.click("#ui-overlay [data-start]");
    (await waitPhase("run", 8_000)) === "run" ? ok("entered RUN with 3-crew") : fail("did not enter RUN");
    // wait for both followers to materialize, then kill them mid-run (head stays invincible)
    const inPlay = async () => page.evaluate(() => { const p = window.__threepm.probe(); return !!p && p.followers.length >= 2 && p.followers.every((f) => !f.pending); });
    { const t0 = Date.now(); while (Date.now() - t0 < 25_000 && !(await inPlay())) await sleep(300); }
    (await inPlay()) ? ok("followers materialized") : fail("followers never materialized");
    await page.evaluate(() => { const p = window.__threepm.probe(); for (const f of p.followers) f.dead = true; });
    (await waitPhase("run", RUN_TIMEOUT_MS, true)) === "summary" ? ok("head survived → SUMMARY") : fail("run did not end after follower deaths");
    await clearSummary();
    (await waitPhase("party", 8_000)) === "party" ? ok("returned to PARTY") : fail("did not return to PARTY");
    const bd = await blob();
    sameSet(bd.campaign.crew, ["marvin"]) ? ok("crew culled to [marvin]") : fail(`crew expected [marvin], got [${bd.campaign.crew.join(", ")}]`);
    sameSet(bd.campaign.dead, ["chad", "dash"]) ? ok("dead = [chad, dash]") : fail(`dead expected [chad, dash], got [${bd.campaign.dead.join(", ")}]`);
    bd.campaign.day === 4 ? ok("day advanced to 4 (survivor lived)") : fail(`day expected 4, got ${bd.campaign.day}`);
    await shot("after-follower-death-party.png");
    const csd = await cards();
    const chadC = csd[indexOfId("chad")], dashC = csd[indexOfId("dash")];
    (chadC.dead && dashC.dead) ? ok("chad & dash cards marked dead") : fail("fallen cards not marked dead");
    (/FELL/.test(chadC.lk) && /FELL/.test(dashC.lk)) ? ok("fallen cards show ✝ FELL") : fail(`FELL veil missing (chad lk="${chadC.lk}", dash lk="${dashC.lk}")`);
    const recruitableNow = csd.filter((c) => !c.locked && !c.dead).map((c) => idAt(c.i));
    (!recruitableNow.includes("chad") && !recruitableNow.includes("dash")) ? ok("fallen heroes not recruitable") : fail("fallen heroes still recruitable");
    errs.length === 0 ? ok("no page/console errors") : errs.forEach(fail);

    // 3) Whole-crew wipe → GAME OVER → campaign resets to the Day-1 starter.
    console.log("\n=== Crew wipe → GAME OVER → reset ===");
    errs = [];
    await openCampaign({ day: 1, crew: ["marvin"], dead: [] });
    await page.click("#ui-overlay [data-start]");
    (await waitPhase("run", 8_000)) === "run" ? ok("entered RUN (solo Marvin)") : fail("did not enter RUN");
    await sleep(1500);
    await page.evaluate(() => window.__threepm.forceLose());
    (await waitPhase("run", 15_000, true)) === "summary" ? ok("run ended as loss") : fail("forced loss did not end run");
    await clearSummary();
    (await waitPhase("gameover", 10_000)) === "gameover" ? ok("wipe → GAME OVER") : fail("did not reach GAME OVER");
    await shot("wipe-gameover.png");
    await sleep(400);
    await page.keyboard.press("Space"); // dismiss game over → resets campaign → title
    (await waitPhase("title", 8_000)) === "title" ? ok("GAME OVER → title") : fail("did not return to title");
    const bw = await blob();
    (bw && bw.campaign.day === 1 && bw.campaign.crew.length === 1 && bw.campaign.dead.length === 0)
      ? ok("campaign reset to Day 1 starter crew") : fail(`reset wrong: ${JSON.stringify(bw && bw.campaign)}`);
    errs.length === 0 ? ok("no page/console errors") : errs.forEach(fail);
  }

  if (MODE === "deaths") await deathScenarios(); else await cleanSweep();

  console.log(`\n${"=".repeat(40)}`);
  if (missingAssets.size) console.log(`info — ${missingAssets.size} droppable asset(s) 404'd (synth/placeholder fallback): ${[...missingAssets].join(", ")}`);
  console.log(failures === 0 ? `PASS — ${MODE} clean` : `FAIL — ${failures} assertion(s) failed`);
  console.log(`screenshots: ${OUT}/`);
} finally {
  if (browser) await browser.close();
  server.kill();
}
process.exit(failures === 0 ? 0 : 1);
