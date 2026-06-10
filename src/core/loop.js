// Fixed-timestep loop (docs/01-core-engine.md). Owns no game state.
export function startLoop(scene) {
  const DT = 1 / 60;
  let last = performance.now() / 1000;
  let acc = 0;
  function frame(nowMs) {
    const now = nowMs / 1000;
    let delta = now - last;
    last = now;
    if (delta > 0.25) delta = 0.25; // avoid spiral of death
    acc += delta;
    while (acc >= DT) {
      scene.update(DT);
      acc -= DT;
    }
    scene.render(acc / DT);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
