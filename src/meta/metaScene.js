// META scene (spec 08, between runs): a slim glance at your meta progress before
// heading back out. Upgrade buying moved to the party-select screen once every hero
// got a tree (save.js UPGRADES), so this screen is now read-only — it shows the
// running tally and nothing else. A floating panel sits over a DIMMED version of the
// run's "world-is-broken" void background (the same effect the descent rendered),
// threaded in as `bgId`. Read-through-load(); it writes nothing.
import { BALANCE, THEME } from "../run/balance.js";
import { load } from "./save.js";
import { createVoidRenderer } from "../run/voidBackgrounds.js";

const VIEW_W = 800, VIEW_H = 600;

export function createMetaScene(ctx, input, nextSeed, bgId) {
  const blob = load();
  // Reuse the run's void effect at full screen; null bgId (shouldn't happen in the
  // normal flow) falls back to a flat fill so the panel still has a backdrop.
  const voidBg = bgId ? createVoidRenderer(bgId, VIEW_W, VIEW_H) : null;
  let clock = 0, armed = false, done = false;

  // The day's tally, built once (the screen is static). [label, value].
  const rows = [
    ["Credits banked",  `${blob.credits}`],
    ["Days survived",   `${blob.runCount}`],
    ["Made it home",    `${blob.stats.wins}`],
    ["Best distance",   `${Math.round(blob.stats.bestDistance * 100)}%`],
    ["Total kills",     `${blob.stats.totalKills}`],
    ["Heroes unlocked", `${blob.unlockedHeroes.length} / ${BALANCE.roster.length}`],
  ];

  function update(dt) {
    clock += dt; // real-time clock drives the void animation
    if (!input.down("Space") && !input.down("Enter")) armed = true; // release the held end-of-run confirm first
    if (armed && (input.down("Space") || input.down("Enter"))) done = true;
    while (input.consumeTap()) done = true; // any tap heads out
  }

  function render() {
    const M = THEME.meta;
    // Dimmed "world-is-broken" backdrop: the run's void effect full-screen, then a
    // dark wash so the floating panel reads on top. camY drifts slowly for parallax.
    if (voidBg) {
      voidBg.draw(ctx, clock, clock * 24);
      ctx.fillStyle = "rgba(8,9,12,0.62)";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    } else {
      ctx.fillStyle = M.bg;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    // Floating panel, centered.
    const pw = 460, ph = 408, px = (VIEW_W - pw) / 2, py = (VIEW_H - ph) / 2;
    ctx.fillStyle = "rgba(18,20,23,0.86)";
    panelPath(ctx, px, py, pw, ph, 14); ctx.fill();
    ctx.strokeStyle = M.border; ctx.lineWidth = 2;
    panelPath(ctx, px + 1, py + 1, pw - 2, ph - 2, 13); ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = M.title; ctx.font = M.titleFont;
    ctx.fillText("Between days", VIEW_W / 2, py + 54);
    ctx.fillStyle = M.hint; ctx.font = M.hintFont;
    ctx.fillText("the day's tally", VIEW_W / 2, py + 80);

    // Label / value stat rows.
    ctx.font = M.creditsFont;
    const lx = px + 40, vx = px + pw - 40;
    let y = py + 132;
    for (const [label, value] of rows) {
      ctx.textAlign = "left";  ctx.fillStyle = M.name;    ctx.fillText(label, lx, y);
      ctx.textAlign = "right"; ctx.fillStyle = M.credits; ctx.fillText(value, vx, y);
      y += 38;
    }

    // Sole exit.
    ctx.textAlign = "center";
    ctx.fillStyle = M.cont; ctx.font = M.nameFont;
    ctx.fillText("› Head out for the day", VIEW_W / 2, py + ph - 28);
    ctx.fillStyle = M.hint; ctx.font = M.hintFont;
    ctx.fillText("SPACE / tap to continue", VIEW_W / 2, VIEW_H - 24);
    ctx.textAlign = "left";
  }

  return { update, render, get done() { return done; }, nextSeed };
}

// Rounded-rect subpath (ctx.roundRect isn't safe across all targets the slice ships to).
function panelPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
