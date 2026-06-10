// Keyboard intent + mouse aim/fire (docs/04-combat.md input contract).
// Movement: WASD, arrow keys, and vim hjkl.
const BLOCK = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

export function createInput(canvas) {
  const keys = new Set();
  let mx = 0, my = 0, firing = false;
  addEventListener("keydown", (e) => {
    if (BLOCK.has(e.code)) e.preventDefault(); // stop arrows/space scrolling the page
    keys.add(e.code);
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    mx = e.clientX - r.left;
    my = e.clientY - r.top;
  });
  canvas.addEventListener("mousedown", () => (firing = true));
  addEventListener("mouseup", () => (firing = false));

  const k = (...codes) => codes.some((c) => keys.has(c));
  return {
    intent() {
      let x = 0, y = 0;
      if (k("KeyW", "ArrowUp", "KeyK")) y -= 1;
      if (k("KeyS", "ArrowDown", "KeyJ")) y += 1;
      if (k("KeyA", "ArrowLeft", "KeyH")) x -= 1;
      if (k("KeyD", "ArrowRight", "KeyL")) x += 1;
      const m = Math.hypot(x, y) || 1;
      return { x: x / m, y: y / m };
    },
    mouse: () => ({ x: mx, y: my }),
    down: (code) => keys.has(code),
    get firing() {
      return firing;
    },
  };
}
