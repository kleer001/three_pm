import { startLoop } from "./core/loop.js";
import { createInput } from "./input/input.js";
import { createRunScene } from "./run/runScene.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const input = createInput(canvas);

// Slice: drop straight into a run. A new run (restart, or a new day) regenerates
// the neighborhood from the next seed.
let scene = createRunScene(ctx, input, 7);
startLoop({
  update(dt) {
    scene.update(dt);
    if (scene.restart) scene = createRunScene(ctx, input, scene.nextSeed);
  },
  render(alpha) {
    scene.render(alpha);
  },
});
