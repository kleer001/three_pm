import { startLoop } from "./core/loop.js";
import { createInput } from "./input/input.js";
import { createRunScene } from "./run/runScene.js";
import { createSelectScene } from "./run/selectScene.js";
import { createSummaryScene } from "./run/summaryScene.js";
import { createMetaScene } from "./meta/metaScene.js";
import { load } from "./meta/save.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const input = createInput(canvas);

// The slice ships only Marvin; the hero id is chosen here at the FSM boundary and
// threaded into RUN, ready for a HERO-SELECT scene to vary it later (spec 16).
const HERO_ID = "marvin";

// The day loop, as a small scene FSM:
//   SELECT (weapon) → RUN (descent) → SUMMARY (DEATH/VICTORY, banks the payout)
//   → META (spend credits on upgrades) → SELECT (next day, fresh seed) → …
// The seed advances each day so the neighborhood regenerates; meta progress
// persists across runs via the save blob (spec 08).
let phase = "select";
let scene = createSelectScene(ctx, input, 7);
startLoop({
  update(dt) {
    scene.update(dt);
    if (phase === "select" && scene.done) {
      scene = createRunScene(ctx, input, scene.seed, scene.weaponId, load(), HERO_ID);
      phase = "run";
    } else if (phase === "run" && scene.finished) {
      scene = createSummaryScene(ctx, input, scene.result, scene.nextSeed);
      phase = "summary";
    } else if (phase === "summary" && scene.done) {
      scene = createMetaScene(ctx, input, scene.nextSeed);
      phase = "meta";
    } else if (phase === "meta" && scene.done) {
      scene = createSelectScene(ctx, input, scene.nextSeed);
      phase = "select";
    }
  },
  render(alpha) {
    scene.render(alpha);
  },
});
