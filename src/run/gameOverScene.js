// GAME OVER (the campaign wipe screen): shown when a run empties the crew — crew-wide
// permadeath has taken everyone. A bare, functional screen for now; Phase-5 reskins it
// in the UV/MSN look. It reads the (already-saved) wiped campaign for the day count and
// waits for one confirm; main.js then resets the campaign (keeping the meta tier) and
// heads back to a fresh first day.
import { THEME } from "./balance.js";
import { sfx } from "../audio/sfx.js";

const VIEW_W = 800, VIEW_H = 600;

export function createGameOverScene(ctx, input, blob) {
  const days = blob.campaign.day;
  const lost = blob.campaign.dead.length;
  let armed = false, done = false;

  function update() {
    if (!input.down("Space") && !input.down("Enter")) armed = true;
    if (armed && (input.down("Space") || input.down("Enter")) && !done) { done = true; sfx.play("uiSelect"); }
    while (input.consumeTap()) { if (!done) sfx.play("uiSelect"); done = true; }
  }

  function render() {
    const S = THEME.summary;
    ctx.fillStyle = S.bg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = "center";

    ctx.font = S.titleFont;
    ctx.fillStyle = S.lose;
    ctx.fillText("EVERYONE'S GONE", VIEW_W / 2, 240);

    ctx.font = S.subFont;
    ctx.fillStyle = S.sub;
    ctx.fillText(`The whole crew is lost. You lasted ${days} day${days === 1 ? "" : "s"}.`, VIEW_W / 2, 286);
    ctx.fillText(`${lost} hero${lost === 1 ? "" : "es"} didn't make it home.`, VIEW_W / 2, 312);

    ctx.font = S.ctaFont;
    ctx.fillStyle = S.cta;
    ctx.fillText("› start a new crew   [SPACE / tap]", VIEW_W / 2, VIEW_H - 80);
    ctx.textAlign = "left";
  }

  return { update, render, get done() { return done; } };
}
