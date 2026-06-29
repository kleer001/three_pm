import { startLoop } from "./core/loop.js";
import { createInput } from "./input/input.js";
import { createRunScene } from "./run/runScene.js";
import { createPartySelectScene } from "./run/domPartyScene.js";
import { createSummaryScene } from "./run/domSummaryScene.js";
import { createTitleScene, createGameOverScene } from "./run/domTitleScene.js";
import { createAutopilot } from "./run/autopilot.js";
import { hideOverlay } from "./ui/overlay.js";
import { load, save, resetCampaign } from "./meta/save.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const input = createInput(canvas);

// Secret test modes (gated by URL param, off in normal play):
//   ?bot  → the run autopilots home (src/run/autopilot.js) AND is invincible — for the
//           headless campaign harness (tools/playthrough.mjs), which drives the menus.
//   ?god  → invincible only; you still steer by hand (manual level inspection).
// `bot` implies `god`. A fresh autopilot is built per run (its flow field is level-bound).
const PARAMS = new URLSearchParams(location.search);
const BOT = PARAMS.has("bot");
const GOD = BOT || PARAMS.has("god");
let botInput = null;

// The campaign loop, as a small scene FSM:
//   PARTY (field the crew + order) → RUN (descent) → SUMMARY (DEATH/VICTORY; banks the
//   payout, culls the run's fallen from the crew, advances the day) → PARTY (next day) → …
// A run that empties the crew (crew-wide permadeath) routes to GAME OVER instead, which
// resets the campaign — a fresh starter crew on a fresh Day 1 — while the durable meta
// (credits, unlocks, upgrades) carries over. The seed advances each day so the
// neighborhood regenerates; on a new campaign it resets so the first day is a clean start.
const FIRST_SEED = 7;
let phase = "title";
let scene = createTitleScene(ctx, input, load());
startLoop({
  update(dt) {
    if (BOT && phase === "run" && botInput) botInput.tick(scene._probe); // autopilot reads the live run before it steps
    scene.update(dt);
    if (phase === "title" && scene.done) {
      if (scene.choice === "new") save(resetCampaign(load())); // fresh crew + Day 1, meta kept
      scene = createPartySelectScene(ctx, input, FIRST_SEED, load());
      phase = "party";
    } else if (phase === "party" && scene.done) {
      hideOverlay(); // reveal the canvas for the descent
      botInput = BOT ? createAutopilot() : null; // fresh per run: the flow field is bound to this level
      scene = createRunScene(ctx, botInput || input, scene.seed, scene.party, load(), scene.bgId, { god: GOD });
      phase = "run";
    } else if (phase === "run" && scene.finished) {
      scene = createSummaryScene(ctx, input, scene.result, scene.nextSeed, scene.bgId);
      phase = "summary";
    } else if (phase === "summary" && scene.done) {
      if (scene.wipe) {
        scene = createGameOverScene(ctx, input, load()); // DOM, replaces the summary overlay
        phase = "gameover";
      } else {
        scene = createPartySelectScene(ctx, input, scene.nextSeed, load());
        phase = "party";
      }
    } else if (phase === "gameover" && scene.done) {
      save(resetCampaign(load())); // fresh crew + Day 1, meta kept
      scene = createTitleScene(ctx, input, load());
      phase = "title";
    }
  },
  render(alpha) {
    scene.render(alpha);
  },
});

// Handle for the campaign harness (tools/playthrough.mjs), gated to ?bot so normal play exposes
// nothing on window. `phase` is the robust scene signal; `probe()` and `forceLose()` let the
// death-scenario test kill party members / trigger a wipe deterministically mid-run.
if (BOT) window.__threepm = {
  get phase() { return phase; },
  probe: () => (phase === "run" && scene._probe) || null,
  forceLose: () => { if (phase === "run" && scene._forceLose) scene._forceLose(); },
};
