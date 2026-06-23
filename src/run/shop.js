// In-run shops: scatter stalls down the descent, detect when the hero steps onto
// one (which pauses the world), and run the pick-one-item modal (input + render).
// Each stall draws stock from the shared loot bag so no item is offered twice
// run-wide; prices are a reactive snapshot of cash-on-hand, locked when the hero
// arrives. Built once per run via createShop(env). Owns its own modal state.
import { BALANCE, THEME } from "./balance.js";
import { POWERUPS, priceItem } from "./powerups.js";
import { isWalkable } from "./levelgen.js";
import { hitRect } from "../input/input.js";
import { dist } from "../core/geom.js";

export function createShop({ ctx, input, level, homeSet, lootRng, lootBag, runState, acquire, ts, viewW, viewH }) {
  const LOOT = BALANCE.loot;

  // One stall per even depth band, each stocked from the shared bag. Placed here,
  // not in levelgen (which "emits geometry only").
  function placeShops() {
    const { count, minTileY, r, stock } = BALANCE.shop;
    const lo = Math.max(minTileY, BALANCE.spawnMinTileY), hi = level.h - 3;
    const bandH = (hi - lo) / count;
    const out = [];
    for (let b = 0; b < count; b++) {
      const y0 = Math.floor(lo + b * bandH), y1 = Math.floor(lo + (b + 1) * bandH);
      const cells = [];
      for (let ty = y0; ty < y1; ty++)
        for (let tx = 1; tx < level.w - 1; tx++)
          if (isWalkable(level, tx, ty) && !homeSet.has(ty * level.w + tx)) cells.push([tx, ty]);
      if (!cells.length) continue;
      const [tx, ty] = lootRng.pick(cells);
      const items = [];
      for (let k = 0; k < stock && lootBag.length; k++)
        items.push({ defId: lootBag.shift(), bought: false });
      if (!items.length) continue; // bag exhausted — no stall here
      out.push({ tx, ty, x: tx * ts + ts / 2, y: ty * ts + ts / 2, r, items });
    }
    return out;
  }

  const shops = placeShops();

  let nearShop = null;
  // shopLatch keeps a still-overlapping hero from reopening a stall they just left;
  // it clears once they step off. prev* edge-trigger the modal's discrete keys.
  let shopOpen = false, shopLatch = false, shopSel = 0;
  let prevBuy = false, prevUp = false, prevDown = false, prevLeave = false;

  // Panel/row geometry in logical canvas px — one source of truth for render() and
  // step() (tap hit-testing). Rows carry their item index.
  function shopLayout() {
    const items = nearShop.items;
    const panelW = 520, rowH = 56, gap = 8;
    const panelH = 132 + items.length * (rowH + gap);
    const px = (viewW - panelW) / 2, py = (viewH - panelH) / 2;
    const rows = [];
    let y = py + 92;
    for (let n = 0; n < items.length; n++) {
      rows.push({ x: px + 20, y, w: panelW - 40, h: rowH, index: n });
      y += rowH + gap;
    }
    return { items, px, py, panelW, panelH, rowH, gap, rows };
  }

  // Quote every unbought item as a fraction of cash-on-hand, locked the instant the
  // player reaches the stall (the rate tiers sum to >1, so a stall can't be cleared).
  function priceShop(shop) {
    const snapshot = runState.cash;
    for (const it of shop.items)
      if (!it.bought) it.price = priceItem(POWERUPS[it.defId].rarity, snapshot, LOOT);
  }

  function buyItem(n) {
    const it = nearShop.items[n];
    if (it.bought || runState.cash < it.price) return;
    runState.cash -= it.price;
    acquire(it.defId);
    it.bought = true;
  }

  function leaveShop() {
    shopOpen = false; shopLatch = true; nearShop = null;
  }

  function step() {
    const items = nearShop.items;
    const up = input.down("ArrowUp") || input.down("KeyW") || input.down("KeyK");
    const down = input.down("ArrowDown") || input.down("KeyS") || input.down("KeyJ");
    if (up && !prevUp) shopSel = (shopSel - 1 + items.length) % items.length;
    if (down && !prevDown) shopSel = (shopSel + 1) % items.length;
    prevUp = up; prevDown = down;

    const buy = input.down("KeyE") || input.down("Enter");
    if (buy && !prevBuy) buyItem(shopSel);
    prevBuy = buy;

    const lay = shopLayout();
    const panel = { x: lay.px, y: lay.py, w: lay.panelW, h: lay.panelH };
    for (let tap; (tap = input.consumeTap()); ) {
      const hit = lay.rows.find((r) => hitRect(tap, r));
      if (hit) { shopSel = hit.index; buyItem(hit.index); }
      else if (!hitRect(tap, panel)) { leaveShop(); break; }
    }
    if (!shopOpen) return; // a tap already left the stall

    const leave = input.down("KeyQ") || input.down("Escape");
    if ((leave && !prevLeave) || items.every((it) => it.bought)) leaveShop();
    prevLeave = leave;
  }

  // Per-frame overlap test: stepping onto a stall with stock left opens the paused
  // pick modal (step() runs it next frame). Leaving the pad re-arms the latch.
  function detect(hero) {
    nearShop = null;
    for (const s of shops)
      if (dist(s.x, s.y, hero.x, hero.y) < hero.r + s.r) { nearShop = s; break; }
    if (!nearShop) shopLatch = false;
    else if (!shopLatch && nearShop.items.some((it) => !it.bought)) { priceShop(nearShop); shopOpen = true; shopSel = 0; }
  }

  // The paused stall: a centered card list of stock, reusing the select-screen
  // palette; cost is colored by affordability (dimmed once sold).
  function render() {
    const S = THEME.select;
    const { items, px, py, panelW, panelH, rows, rowH } = shopLayout();
    ctx.fillStyle = THEME.overlay.bg;
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.fillStyle = S.bg;
    ctx.fillRect(px, py, panelW, panelH);

    ctx.textAlign = "center";
    ctx.fillStyle = S.title; ctx.font = S.titleFont;
    ctx.fillText("Shop", viewW / 2, py + 46);
    ctx.fillStyle = S.hint; ctx.font = S.hintFont;
    ctx.fillText(`cash ${runState.cash}`, viewW / 2, py + 70);

    for (let n = 0; n < items.length; n++) {
      const it = items[n], def = POWERUPS[it.defId], active = n === shopSel, y = rows[n].y;
      const can = runState.cash >= it.price;
      ctx.fillStyle = active ? S.cardActive : S.card;
      ctx.fillRect(px + 20, y, panelW - 40, rowH);
      if (active) { ctx.strokeStyle = S.border; ctx.lineWidth = 2; ctx.strokeRect(px + 21, y + 1, panelW - 42, rowH - 2); }
      ctx.textAlign = "left";
      ctx.fillStyle = it.bought ? S.hint : S.name; ctx.font = S.nameFont;
      ctx.fillText(it.bought ? `${def.name}  (sold)` : def.name, px + 40, y + 24);
      ctx.fillStyle = S.desc; ctx.font = S.descFont;
      ctx.fillText(def.blurb, px + 40, y + 44);
      ctx.textAlign = "right";
      ctx.fillStyle = it.bought ? S.hint : can ? THEME.shop.afford : THEME.shop.broke;
      ctx.font = S.nameFont;
      ctx.fillText(it.bought ? "—" : `${it.price}`, px + panelW - 40, y + 34);
    }

    ctx.textAlign = "center";
    ctx.fillStyle = S.hint; ctx.font = S.hintFont;
    ctx.fillText("↑/↓ or tap to pick    E buy    Q / tap outside to leave", viewW / 2, py + panelH - 18);
    ctx.textAlign = "left";
  }

  return { shops, isOpen: () => shopOpen, step, detect, render };
}
