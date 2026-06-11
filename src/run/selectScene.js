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
  let prevUp = false, prevDown = false;

  function update() {
    // Arm only after SPACE/Enter come up at least once this scene.
    if (!input.down("Space") && !input.down("Enter")) armed = true;

    const up = input.down("ArrowUp") || input.down("KeyW") || input.down("KeyK") || input.down("ArrowLeft") || input.down("KeyA");
    const down = input.down("ArrowDown") || input.down("KeyS") || input.down("KeyJ") || input.down("ArrowRight") || input.down("KeyD");
    if (up && !prevUp) i = (i - 1 + IDS.length) % IDS.length;
    if (down && !prevDown) i = (i + 1) % IDS.length;
    prevUp = up; prevDown = down;

    if (armed && (input.down("Space") || input.down("Enter"))) confirmed = true;
  }

  function render() {
    const S = THEME.select;
    ctx.fillStyle = S.bg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.textAlign = "center";
    ctx.fillStyle = S.title;
    ctx.font = S.titleFont;
    ctx.fillText("Pick your weapon for the walk home", VIEW_W / 2, 76);

    const rowH = 58, gap = 8, rowW = 560;
    const totalH = IDS.length * (rowH + gap) - gap;
    const x = (VIEW_W - rowW) / 2;
    let y = (VIEW_H - totalH) / 2 + 24;
    for (let n = 0; n < IDS.length; n++) {
      const w = BALANCE.weapons[IDS[n]], active = n === i;
      ctx.fillStyle = active ? S.cardActive : S.card;
      ctx.fillRect(x, y, rowW, rowH);
      if (active) {
        ctx.strokeStyle = S.border;
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1.5, y + 1.5, rowW - 3, rowH - 3);
      }
      // Color swatch
      ctx.fillStyle = THEME.weaponShot[IDS[n]];
      ctx.beginPath();
      ctx.arc(x + 32, y + rowH / 2, 12, 0, Math.PI * 2);
      ctx.fill();
      // Name + one-line description
      ctx.textAlign = "left";
      ctx.fillStyle = S.name;
      ctx.font = S.nameFont;
      ctx.fillText(w.name, x + 60, y + rowH / 2 - 4);
      ctx.fillStyle = S.desc;
      ctx.font = S.descFont;
      ctx.fillText(w.desc, x + 60, y + rowH / 2 + 16);
      ctx.textAlign = "center";
      y += rowH + gap;
    }

    ctx.fillStyle = S.hint;
    ctx.font = S.hintFont;
    ctx.fillText("↑/↓ choose    SPACE start", VIEW_W / 2, VIEW_H - 36);
    ctx.textAlign = "left";
  }

  return {
    update, render,
    get done() { return confirmed; },
    get weaponId() { return IDS[i]; },
    seed,
  };
}
