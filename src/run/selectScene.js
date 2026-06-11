// Per-run weapon picker. Shown before each day's descent; the chosen weapon is
// the hero's single offense for the run. No level is generated here — the scene
// only carries the `seed` through to the run it precedes.
import { BALANCE, THEME } from "./balance.js";

const VIEW_W = 800, VIEW_H = 600;
const IDS = Object.keys(BALANCE.weapons);

export function createSelectScene(ctx, input, seed) {
  let i = 0;
  let armed = false; // require SPACE to be released once, so the held SPACE that
  let confirmed = false; // ended the previous run doesn't instantly auto-confirm
  let prevLeft = false, prevRight = false;

  function update() {
    // Arm only after SPACE/Enter come up at least once this scene.
    if (!input.down("Space") && !input.down("Enter")) armed = true;

    const left = input.down("ArrowLeft") || input.down("KeyA") || input.down("KeyH");
    const right = input.down("ArrowRight") || input.down("KeyD") || input.down("KeyL");
    if (left && !prevLeft) i = (i - 1 + IDS.length) % IDS.length;
    if (right && !prevRight) i = (i + 1) % IDS.length;
    prevLeft = left; prevRight = right;

    if (armed && (input.down("Space") || input.down("Enter"))) confirmed = true;
  }

  function render() {
    const S = THEME.select;
    ctx.fillStyle = S.bg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.textAlign = "center";
    ctx.fillStyle = S.title;
    ctx.font = S.titleFont;
    ctx.fillText("Pick your weapon for the walk home", VIEW_W / 2, 130);

    const cw = 300, ch = 150, gap = 40;
    const totalW = IDS.length * cw + (IDS.length - 1) * gap;
    let x = (VIEW_W - totalW) / 2;
    const y = VIEW_H / 2 - ch / 2;
    for (let n = 0; n < IDS.length; n++) {
      const w = BALANCE.weapons[IDS[n]], active = n === i;
      ctx.fillStyle = active ? S.cardActive : S.card;
      ctx.fillRect(x, y, cw, ch);
      if (active) {
        ctx.strokeStyle = S.border;
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1.5, y + 1.5, cw - 3, ch - 3);
      }
      ctx.fillStyle = THEME.weaponShot[IDS[n]];
      ctx.beginPath();
      ctx.arc(x + cw / 2, y + 46, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = S.name;
      ctx.font = S.nameFont;
      ctx.fillText(w.name, x + cw / 2, y + 92);
      ctx.fillStyle = S.desc;
      ctx.font = S.descFont;
      ctx.fillText(w.desc, x + cw / 2, y + 118);
      x += cw + gap;
    }

    ctx.fillStyle = S.hint;
    ctx.font = S.hintFont;
    ctx.fillText("←/→ choose    SPACE start", VIEW_W / 2, VIEW_H - 90);
    ctx.textAlign = "left";
  }

  return {
    update, render,
    get done() { return confirmed; },
    get weaponId() { return IDS[i]; },
    seed,
  };
}
