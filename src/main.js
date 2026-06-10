import { startLoop } from "./core/loop.js";
import { createInput } from "./input/input.js";
import { createRunScene } from "./run/runScene.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const input = createInput(canvas);

// Slice: drop straight into a run with a fixed seed (the "day").
const seed = 7;
const scene = createRunScene(ctx, input, seed);
startLoop(scene);
