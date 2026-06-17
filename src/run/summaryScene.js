// Run-summary scene (spec 15): the DEATH / VICTORY screen. One screen handles both,
// branching on result.won. It commits the run to the durable save EXACTLY ONCE on
// construction — save(recordRun(load(), result)) — and derives the displayed deltas
// from the pre-commit blob so the numbers are exact. Then it shows the payout
// breakdown and waits for a single confirm to advance to META.
import { THEME } from "./balance.js";
import { load, save, recordRun, computePayout, PAYOUT } from "../meta/save.js";

const VIEW_W = 800, VIEW_H = 600;

export function createSummaryScene(ctx, input, result, nextSeed, bgId) {
  // Commit-once on enter (spec 15): load → record (banks payout, bumps runCount,
  // refreshes unlocks) → save. Deltas come off the pre-commit blob.
  const before = load();
  const payout = computePayout(result);
  const after = save(recordRun(before, result));
  const newUnlocks = after.unlockedHeroes.filter((id) => !before.unlockedHeroes.includes(id));
  const bestBeaten = result.distanceFraction > before.stats.bestDistance && !result.won;

  const S = THEME.summary;
  const distCredits = Math.round(result.distanceFraction * PAYOUT.distance);
  const killCredits = result.kills * PAYOUT.perKill;
  const distPct = Math.round(result.distanceFraction * 100); // a percentage, not the payout

  // Payout breakdown rows, built once (the screen is static). [label, value, color];
  // a null label renders the divider rule instead of a text row.
  const rows = [
    ["Distance", `+${distCredits}`, S.plus],
    [`Kills (${result.kills})`, `+${killCredits}`, S.plus],
  ];
  if (result.won) rows.push(["Made it home", `+${PAYOUT.win}`, S.plus]);
  rows.push([null, "", ""]);
  rows.push(["Earned", `+${payout}`, S.plus]);
  if (!result.won) rows.push(["Cash lost", `${result.cashDiscarded}`, S.lost]);
  rows.push(["Banked", `${after.credits}`, S.value]);

  let armed = false, done = false; // require confirm release before accepting (held
  // SPACE from firing at the moment of death must not instantly skip the screen)

  function update() {
    if (!input.down("Space") && !input.down("Enter")) armed = true;
    if (armed && (input.down("Space") || input.down("Enter"))) done = true;
    // Touch: any tap advances. A fresh touchstart only queues after the death-fire
    // finger lifts, so a held touch can't instantly skip the screen (no arming needed).
    while (input.consumeTap()) done = true;
  }

  function render() {
    ctx.fillStyle = S.bg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.textAlign = "center";
    ctx.font = S.titleFont;
    ctx.fillStyle = result.won ? S.win : S.lose;
    ctx.fillText(result.won ? "MADE IT HOME" : "ANOTHER 3PM…", VIEW_W / 2, 96);

    ctx.font = S.subFont;
    ctx.fillStyle = S.sub;
    ctx.fillText(
      result.won ? `${result.heroId} made it home today.` : `${result.heroId} didn't make it home.`,
      VIEW_W / 2, 132,
    );
    if (!result.won) {
      ctx.fillText(`Got ${distPct}% of the way${result.cause ? " — " + result.cause : ""}.`, VIEW_W / 2, 158);
    }

    // Left-aligned monospaced payout table, centered as a block (rows built once).
    ctx.font = S.rowFont;
    const labelX = VIEW_W / 2 - 150, valueX = VIEW_W / 2 + 150;
    let y = 220;
    for (const [label, value, color] of rows) {
      if (label === null) {
        ctx.strokeStyle = S.rule;
        ctx.beginPath();
        ctx.moveTo(labelX, y - 6);
        ctx.lineTo(valueX, y - 6);
        ctx.stroke();
        y += 14;
        continue;
      }
      ctx.textAlign = "left";
      ctx.fillStyle = S.label;
      ctx.fillText(label, labelX, y);
      ctx.textAlign = "right";
      ctx.fillStyle = color;
      ctx.fillText(value, valueX, y);
      y += 30;
    }

    ctx.textAlign = "center";
    if (newUnlocks.length) {
      ctx.fillStyle = S.unlock;
      ctx.font = S.subFont;
      ctx.fillText(`Unlocked: ${newUnlocks.join(", ")}`, VIEW_W / 2, y + 20);
      y += 34;
    }
    if (bestBeaten) {
      ctx.fillStyle = S.unlock;
      ctx.font = S.subFont;
      ctx.fillText("New best distance!", VIEW_W / 2, y + 20);
    }

    ctx.fillStyle = S.cta;
    ctx.font = S.ctaFont;
    ctx.fillText(result.won ? "› head to tomorrow   [SPACE / tap]" : "› try another day   [SPACE / tap]", VIEW_W / 2, VIEW_H - 48);
    ctx.textAlign = "left";
  }

  return { update, render, get done() { return done; }, nextSeed, bgId }; // bgId passes through to the between-days screen
}
