import { startLoop } from "./core/loop.js";
import { createInput } from "./input/input.js";
import { createRunScene } from "./run/runScene.js";
import { createSelectScene } from "./run/selectScene.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const input = createInput(canvas);

// Each day is two phases: pick a weapon, then descend. Picking flows into the run
// with the chosen weapon; ending the run (death or home) flows back to the picker
// for the next day, regenerating the neighborhood from the next seed.
let scene = createSelectScene(ctx, input, 7);
let selecting = true;
startLoop({
  update(dt) {
    scene.update(dt);
    if (selecting && scene.done) {
      scene = createRunScene(ctx, input, scene.seed, scene.weaponId);
      selecting = false;
    } else if (!selecting && scene.restart) {
      scene = createSelectScene(ctx, input, scene.nextSeed);
      selecting = true;
    }
  },
  render(alpha) {
    scene.render(alpha);
  },
});
