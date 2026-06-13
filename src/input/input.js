// Keyboard intent + mouse aim/fire + touch (docs/04-combat.md input contract).
// Movement: WASD, arrow keys, vim hjkl, or a floating touch joystick.
const BLOCK = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);
const JOY_RADIUS = 60, JOY_DEADZONE = 8; // logical px: stick travel and slack

export function createInput(canvas) {
  const keys = new Set();
  let mx = 0, my = 0, firing = false;

  // Floating virtual joystick + tap queue. A touchstart anchors an origin under
  // the finger; drag distance/direction becomes a normalized movement vector.
  let touchActive = false;      // any touch this session → gates auto-fire + indicator
  let joyId = null;             // pointer id owning the stick (multitouch-safe)
  let joyOrigin = null, joyCur = null; // {x,y} in logical canvas coords
  let joyVec = { x: 0, y: 0 };  // normalized stick vector (zero when idle)
  const tapQueue = [];          // fresh presses, drained one-per-frame by menus

  // Map a display-space pointer (clientX/Y) to logical canvas px (0..w, 0..h).
  // Scaling by canvas.width/rect.width is required once CSS resizes the canvas.
  const toCanvas = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left) * (canvas.width / r.width),
      y: (clientY - r.top) * (canvas.height / r.height),
    };
  };

  addEventListener("keydown", (e) => {
    if (BLOCK.has(e.code)) e.preventDefault(); // stop arrows/space scrolling the page
    keys.add(e.code);
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  canvas.addEventListener("mousemove", (e) => {
    const p = toCanvas(e.clientX, e.clientY);
    mx = p.x;
    my = p.y;
  });
  canvas.addEventListener("mousedown", () => (firing = true));
  addEventListener("mouseup", () => (firing = false));

  const setJoy = () => {
    const dx = joyCur.x - joyOrigin.x, dy = joyCur.y - joyOrigin.y;
    const m = Math.hypot(dx, dy);
    if (m < JOY_DEADZONE) joyVec = { x: 0, y: 0 };
    else joyVec = { x: dx / m, y: dy / m }; // direction only; magnitude is full-speed
  };

  // touchstart/touchmove are non-passive so preventDefault() can suppress
  // scroll/zoom on older iOS Safari (touch-action:none in CSS is the primary guard).
  canvas.addEventListener("touchstart", (e) => {
    touchActive = true;
    e.preventDefault();
    for (const t of e.changedTouches) {
      const p = toCanvas(t.clientX, t.clientY);
      tapQueue.push(p); // every fresh press is a candidate tap; menus drain it
      if (joyId === null) {
        joyId = t.identifier;
        joyOrigin = p;
        joyCur = p;
        joyVec = { x: 0, y: 0 };
      }
    }
  }, { passive: false });
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      joyCur = toCanvas(t.clientX, t.clientY);
      setJoy();
    }
  }, { passive: false });
  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      joyId = null;
      joyOrigin = joyCur = null;
      joyVec = { x: 0, y: 0 };
    }
  };
  canvas.addEventListener("touchend", endTouch);
  canvas.addEventListener("touchcancel", endTouch);

  const k = (...codes) => codes.some((c) => keys.has(c));
  return {
    intent() {
      let x = 0, y = 0;
      if (k("KeyW", "ArrowUp", "KeyK")) y -= 1;
      if (k("KeyS", "ArrowDown", "KeyJ")) y += 1;
      if (k("KeyA", "ArrowLeft", "KeyH")) x -= 1;
      if (k("KeyD", "ArrowRight", "KeyL")) x += 1;
      x += joyVec.x; // zero unless the stick is held → desktop vector unchanged
      y += joyVec.y;
      const m = Math.hypot(x, y) || 1;
      return { x: x / m, y: y / m };
    },
    mouse: () => ({ x: mx, y: my }),
    down: (code) => keys.has(code),
    get firing() {
      return firing;
    },
    touchActive: () => touchActive,
    joystick: () => (joyOrigin && { origin: joyOrigin, cur: joyCur, radius: JOY_RADIUS }),
    consumeTap: () => tapQueue.shift() || null,
  };
}
