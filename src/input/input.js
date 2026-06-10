// Keyboard intent + mouse aim/fire (docs/04-combat.md input contract).
export function createInput(canvas) {
  const keys = new Set();
  let mx = 0, my = 0, firing = false;
  addEventListener("keydown", (e) => keys.add(e.code));
  addEventListener("keyup", (e) => keys.delete(e.code));
  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    mx = e.clientX - r.left;
    my = e.clientY - r.top;
  });
  canvas.addEventListener("mousedown", () => (firing = true));
  addEventListener("mouseup", () => (firing = false));
  return {
    intent() {
      let x = 0, y = 0;
      if (keys.has("KeyW")) y -= 1;
      if (keys.has("KeyS")) y += 1;
      if (keys.has("KeyA")) x -= 1;
      if (keys.has("KeyD")) x += 1;
      const m = Math.hypot(x, y) || 1;
      return { x: x / m, y: y / m };
    },
    mouse: () => ({ x: mx, y: my }),
    get firing() {
      return firing;
    },
  };
}
