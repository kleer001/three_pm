import { startLoop } from "./core/loop.js";
import { createInput } from "./input/input.js";
import { createRunScene } from "./run/runScene.js";
import { createPartySelectScene } from "./run/partySelectScene.js";
import { createSummaryScene } from "./run/summaryScene.js";
import { createMetaScene } from "./meta/metaScene.js";
import { load } from "./meta/save.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const input = createInput(canvas);

// The day loop, as a small scene FSM:
//   PARTY (pick the cast + order) → RUN (descent) → SUMMARY (DEATH/VICTORY, banks the
//   payout) → META (spend credits on upgrades) → PARTY (next day, fresh seed) → …
// The seed advances each day so the neighborhood regenerates; meta progress (credits,
// unlocked cast) persists across runs via the save blob (spec 08), which the party
// picker reads to gate still-locked characters.
let phase = "party";
let scene = createPartySelectScene(ctx, input, 7, load());
startLoop({
  update(dt) {
    scene.update(dt);
    if (phase === "party" && scene.done) {
      scene = createRunScene(ctx, input, scene.seed, scene.party, load(), scene.bgId);
      phase = "run";
    } else if (phase === "run" && scene.finished) {
      scene = createSummaryScene(ctx, input, scene.result, scene.nextSeed, scene.bgId);
      phase = "summary";
    } else if (phase === "summary" && scene.done) {
      scene = createMetaScene(ctx, input, scene.nextSeed, scene.bgId);
      phase = "meta";
    } else if (phase === "meta" && scene.done) {
      scene = createPartySelectScene(ctx, input, scene.nextSeed, load());
      phase = "party";
    }
  },
  render(alpha) {
    scene.render(alpha);
  },
});
