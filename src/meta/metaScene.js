// META scene (spec 08, between runs): read-through-load, write-through-save. Shows
// banked credits and the active hero's upgrade tree; a buy spends credits on the
// next rank via save(purchaseUpgrade(load(), …)). A trailing "Head out" item is the
// sole exit, carrying the next day's seed into the weapon-select → RUN loop.
//
// The slice ships only Marvin, so this lists Marvin's tree directly; the save API
// is hero-keyed, ready for the rest of the roster.
import { THEME } from "../run/balance.js";
import { load, save, purchaseUpgrade, UPGRADES, upgradeRank, nextCost } from "./save.js";

const VIEW_W = 800, VIEW_H = 600;
const HERO = "marvin";

export function createMetaScene(ctx, input, nextSeed) {
  let blob = load();
  const upgradeIds = Object.keys(UPGRADES[HERO]);
  const items = [...upgradeIds, "__continue__"]; // last item exits to the next run
  let i = 0, done = false;
  let armed = false, prevUp = false, prevDown = false, prevConfirm = false;

  function update() {
    if (!input.down("Space") && !input.down("Enter")) armed = true;

    const up = input.down("ArrowUp") || input.down("KeyW") || input.down("KeyK");
    const down = input.down("ArrowDown") || input.down("KeyS") || input.down("KeyJ");
    if (up && !prevUp) i = (i - 1 + items.length) % items.length;
    if (down && !prevDown) i = (i + 1) % items.length;
    prevUp = up; prevDown = down;

    const confirm = input.down("Space") || input.down("Enter");
    if (armed && confirm && !prevConfirm) {
      if (items[i] === "__continue__") done = true;
      else blob = save(purchaseUpgrade(load(), HERO, items[i])); // buy (no-op if maxed/broke)
    }
    prevConfirm = confirm;
  }

  function render() {
    const M = THEME.meta;
    ctx.fillStyle = M.bg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.textAlign = "center";
    ctx.fillStyle = M.title;
    ctx.font = M.titleFont;
    ctx.fillText("Between days", VIEW_W / 2, 66);

    ctx.fillStyle = M.credits;
    ctx.font = M.creditsFont;
    ctx.fillText(`${blob.credits} credits   ·   run ${blob.runCount}   ·   ${blob.stats.wins} home`, VIEW_W / 2, 98);

    const rowH = 56, exitH = 44, gap = 6, rowW = 560, x = (VIEW_W - rowW) / 2;
    ctx.lineWidth = 2; // shared by every row's active border
    let y = 132;
    for (let n = 0; n < upgradeIds.length; n++) {
      const id = upgradeIds[n], def = UPGRADES[HERO][id], active = n === i;
      const rank = upgradeRank(blob, HERO, id), cost = nextCost(blob, HERO, id);
      ctx.fillStyle = active ? M.rowActive : M.row;
      ctx.fillRect(x, y, rowW, rowH);
      if (active) {
        ctx.strokeStyle = M.border;
        ctx.strokeRect(x + 1, y + 1, rowW - 2, rowH - 2);
      }
      ctx.textAlign = "left";
      ctx.fillStyle = M.name;
      ctx.font = M.nameFont;
      ctx.fillText(def.name, x + 16, y + 24);
      ctx.fillStyle = M.blurb;
      ctx.font = M.blurbFont;
      ctx.fillText(def.blurb, x + 16, y + 44);

      ctx.textAlign = "right";
      ctx.fillStyle = M.rank;
      ctx.font = M.nameFont;
      ctx.fillText(pips(rank, def.maxRank), x + rowW - 16, y + 24);
      ctx.font = M.costFont;
      if (cost === null) { ctx.fillStyle = M.maxed; ctx.fillText("MAX", x + rowW - 16, y + 44); }
      else { ctx.fillStyle = blob.credits >= cost ? M.cost : M.broke; ctx.fillText(`${cost} cr`, x + rowW - 16, y + 44); }
      y += rowH + gap;
    }

    // The exit item, styled as a shorter row.
    const contActive = i === upgradeIds.length;
    ctx.fillStyle = contActive ? M.rowActive : M.row;
    ctx.fillRect(x, y, rowW, exitH);
    if (contActive) {
      ctx.strokeStyle = M.border;
      ctx.strokeRect(x + 1, y + 1, rowW - 2, exitH - 2);
    }
    ctx.textAlign = "center";
    ctx.fillStyle = M.cont;
    ctx.font = M.nameFont;
    ctx.fillText("› Head out for the day", VIEW_W / 2, y + 28);

    ctx.fillStyle = M.hint;
    ctx.font = M.hintFont;
    ctx.fillText("↑/↓ choose    SPACE buy / continue", VIEW_W / 2, VIEW_H - 28);
    ctx.textAlign = "left";
  }

  return { update, render, get done() { return done; }, nextSeed };
}

// Filled/empty rank pips, e.g. ●●○ for rank 2 of 3.
function pips(rank, max) {
  return "●".repeat(rank) + "○".repeat(max - rank);
}
