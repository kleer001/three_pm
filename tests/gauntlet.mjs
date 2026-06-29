// Headless gauntlet harness — runs the real RUN scene with no browser and no
// rendering, driving the hero with a naive "just get home" bot, so we can stress
// the balance knobs across many heroes/parties/seeds in seconds.
//
//   node tests/gauntlet.mjs [seeds] [maxSeconds]
//
// seeds defaults to 20, maxSeconds (per-run safety cap) to 200. For each party size
// 1..MAX it sweeps `seeds` runs and reports win%, mean distance, kills, death causes.
//
// The bot is deliberately dumb: it does NOT dodge enemies (they're transient; the
// crush wall is the permanent threat). It climbs a static heat field — pure southness
// + a mild pull to the street's center + a fading penalty on cells it just occupied so
// it backs out of dead-ends instead of grinding into a wall. No pathfinding.
import { createRunScene } from "../src/run/runScene.js";
import { isWalkable } from "../src/run/levelgen.js";
import { BALANCE } from "../src/run/balance.js";
import { load, isHeroUnlocked } from "../src/meta/save.js";
import { createAutopilot } from "../src/run/autopilot.js";

// --- naive get-home bot ---------------------------------------------------
// Two nav brains, same dumb-about-combat body (always fires, never dodges):
//
//   "flow"  (default, the grading bot) — the shared autopilot (src/run/autopilot.js): one BFS
//           flood-fill from the home band per seed, then gradient-descend the distance field.
//           Removes navigation as a confound so the run reaches deep game and the metrics
//           reflect COMBAT, not pathing. The flood-fill is O(map) once, not per-frame A*.
//   "greedy" (the feel bot) — pure local: step into the southward cell that stays open
//           deepest (short lookahead), or commit a wall-follow detour when boxed. Models a
//           naive player with no map knowledge; caps mid-map because the crush out-paces
//           the ground it bleeds on detours. Useful for player-experience reads, not depth.
//
// Both aim at the CENTER of the chosen tile: the hero's body is ~½ a tile wide, so hugging
// an edge straddles the neighbor column and snags on walls there — lane-centering fixes it.
const norm = ([dx, dy]) => { const m = Math.hypot(dx, dy) || 1; return { x: dx / m, y: dy / m }; };
const LOOK = 4, REACH = 6; // greedy: south-lookahead depth, lateral gap-scan reach

function clearSouth(level, tx, ty, max) { let n = 0; while (n < max && isWalkable(level, tx, ty + 1 + n)) n++; return n; }
function gapDistance(level, tx, ty, dir, reach) {
  for (let k = 1; k <= reach; k++) {
    const cx = tx + dir * k;
    if (!isWalkable(level, cx, ty)) return Infinity;
    if (isWalkable(level, cx, ty + 1)) return k;
  }
  return Infinity;
}

function makeGreedyBot() {
  let pulse = false, detour = 0;
  let vec = { x: 0, y: 1 };

  function chooseIntent(probe) {
    const { hero, level } = probe;
    const ts = level.tileSize, cx = level.w / 2;
    const htx = Math.floor(hero.x / ts), hty = Math.floor(hero.y / ts);
    const aim = (tx, ty) => norm([(tx + 0.5) * ts - hero.x, (ty + 0.5) * ts - hero.y]);

    // greedy: deepest open southward lane, else committed wall-follow detour
    const south = [[0, 1], [1, 1], [-1, 1]].filter(([dx, dy]) => isWalkable(level, htx + dx, hty + dy));
    if (south.length) {
      detour = 0;
      const best = south.reduce((a, b) => {
        const da = clearSouth(level, htx + a[0], hty + a[1], LOOK);
        const db = clearSouth(level, htx + b[0], hty + b[1], LOOK);
        if (db !== da) return db > da ? b : a;
        return Math.abs(htx + b[0] - cx) < Math.abs(htx + a[0] - cx) ? b : a;
      });
      return aim(htx + best[0], hty + best[1]);
    }
    if (!detour) {
      const gE = gapDistance(level, htx, hty, 1, REACH), gW = gapDistance(level, htx, hty, -1, REACH);
      detour = gE < gW ? 1 : gW < gE ? -1 : (htx < cx ? 1 : -1);
    }
    if (isWalkable(level, htx + detour, hty)) return aim(htx + detour, hty);
    if (isWalkable(level, htx - detour, hty)) { detour = -detour; return aim(htx + detour, hty); }
    return aim(htx, hty - 1);
  }

  return {
    tick(probe) { pulse = !pulse; vec = chooseIntent(probe); },
    intent: () => vec,
    down: (code) => code === "Space" || (code === "KeyQ" && pulse),
    touchActive: () => false,
    joystick: () => null,
    consumeTap: () => null,
    get firing() { return false; },
  };
}

const makeBot = (navMode = "flow") => (navMode === "flow" ? createAutopilot() : makeGreedyBot());

// --- run loop -------------------------------------------------------------
const NOOP = () => {};
const stubCtx = new Proxy({}, { get: () => NOOP }); // never drawn; update() never touches ctx

function runOne(party, seed, maxFrames, navMode) {
  const bot = makeBot(navMode);
  const scene = createRunScene(stubCtx, bot, seed, party, load());
  // Scale the head's move speed in place (the train retraces its trail, so this scales the
  // whole party's traversal). The bot never buys powerups, so nothing recomputes it away.
  if (heroSpeedMult !== 1) scene._probe.hero.derived.moveSpeed *= heroSpeedMult;
  let frames = 0;
  while (!scene.finished && frames < maxFrames) {
    bot.tick(scene._probe);
    scene.update(1 / 60);
    frames++;
  }
  // Enemy-pressure metrics, read off the live state at the moment the run ends: how much
  // of the head's HP the mob chewed through, and how many followers it lost. These — not
  // win/distance (which a naive runner gates on the crush) — are where the difficulty
  // changes show up.
  const { hero, followers } = scene._probe;
  const headHpFrac = Math.max(0, hero.hp) / hero.derived.maxHp;
  const followersLost = (party.length - 1) - followers.filter((f) => !f.dead).length;
  if (!scene.finished) return { distanceFraction: distOf(scene), kills: 0, won: false, cause: "timeout", headHpFrac, followersLost };
  return { ...scene.result, headHpFrac, followersLost };
}

// distanceFraction when a run times out (never finished): recompute from the probe.
function distOf(scene) {
  const { hero, level } = scene._probe;
  const ts = level.tileSize;
  const startY = level.start.y * ts + ts / 2;
  const homeY = level.homeBand[0][1] * ts + ts / 2;
  return Math.max(0, Math.min(1, (hero.y - startY) / (homeY - startY || 1)));
}

// --- sweep + report -------------------------------------------------------
const seeds = Number(process.argv[2] || 20);
const maxFrames = Math.round(Number(process.argv[3] || 200) * 60);
const navMode = process.argv[4] === "greedy" ? "greedy" : "flow";

// Knob overrides for lever experiments: argv[5] = "iframe=0.3,heal=0,threat=0.5".
// Mutates BALANCE before any scene is built, so the sweep grades that setting.
const KNOBS = {
  iframe: (v) => { BALANCE.hero.iframeDur = v; BALANCE.follower.iframeDur = v; },
  heal: (v) => { BALANCE.signatures.good_vibes.hpPerSec = v; },
  threat: (v) => { BALANCE.director.partyThreatScale = v; },
  cd: (v) => { BALANCE.heroFireCooldownMult = v; },
  base: (v) => { BALANCE.director.baseThreat = v; },
  slope: (v) => { BALANCE.director.threatSlope = v; },
  maxlive: (v) => { BALANCE.director.maxLive = v; },
};
let heroSpeedMult = 1; // hspeed: scales the head's (and thus the train's) move speed
const overrides = (process.argv[5] || "").split(",").filter(Boolean);
for (const o of overrides) {
  const [k, val] = o.split("=");
  if (k === "hspeed") { heroSpeedMult = Number(val); continue; }
  if (!KNOBS[k]) { console.error(`unknown knob "${k}" (have: hspeed, ${Object.keys(KNOBS).join(", ")})`); process.exit(1); }
  KNOBS[k](Number(val));
}
const blob = load();
const unlocked = BALANCE.roster.filter((c) => isHeroUnlocked(blob, c.id)).map((c) => c.id);
const MAX = Math.min(BALANCE.partyMax, unlocked.length);

console.log(`Gauntlet — ${seeds} seeds/size, nav=${navMode} (no enemy dodge)` +
  `${overrides.length ? `  overrides: ${overrides.join(" ")}` : ""}\n` +
  `party drawn from unlocked prefix: ${unlocked.slice(0, MAX).join(", ")}\n`);
console.log("size  win%   meanDist  meanKills  headHP%  follLost  topCause");
console.log("----  -----  --------  ---------  -------  --------  --------");

for (let size = 1; size <= MAX; size++) {
  const party = unlocked.slice(0, size);
  let wins = 0, dist = 0, kills = 0, headHp = 0, follLost = 0;
  const causes = {};
  for (let s = 1; s <= seeds; s++) {
    const r = runOne(party, s, maxFrames, navMode);
    if (r.won) wins++;
    dist += r.distanceFraction;
    kills += r.kills;
    headHp += r.headHpFrac;
    follLost += r.followersLost;
    const c = r.won ? "WON" : (r.cause || "?");
    causes[c] = (causes[c] || 0) + 1;
  }
  const top = Object.entries(causes).sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}:${n}`).join(" ");
  console.log(
    `${String(size).padEnd(4)}  ` +
    `${String(Math.round((wins / seeds) * 100)).padStart(4)}%  ` +
    `${(dist / seeds * 100).toFixed(1).padStart(7)}%  ` +
    `${(kills / seeds).toFixed(1).padStart(8)}   ` +
    `${(headHp / seeds * 100).toFixed(0).padStart(6)}%  ` +
    `${(follLost / seeds).toFixed(1).padStart(7)}   ` +
    top,
  );
}
