import { startLoop } from "./core/loop.js";
import { createInput } from "./input/input.js";
import { createRunScene } from "./run/runScene.js";
import { createPartySelectScene } from "./run/domPartyScene.js";
import { createSummaryScene } from "./run/domSummaryScene.js";
import { createTitleScene, createGameOverScene } from "./run/domTitleScene.js";
import { hideOverlay } from "./ui/overlay.js";
import { load, save, resetCampaign } from "./meta/save.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const input = createInput(canvas);

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
    scene.update(dt);
    if (phase === "title" && scene.done) {
      if (scene.choice === "new") save(resetCampaign(load())); // fresh crew + Day 1, meta kept
      scene = createPartySelectScene(ctx, input, FIRST_SEED, load());
      phase = "party";
    } else if (phase === "party" && scene.done) {
      hideOverlay(); // reveal the canvas for the descent
      scene = createRunScene(ctx, input, scene.seed, scene.party, load(), scene.bgId);
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
