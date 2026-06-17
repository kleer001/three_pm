// Party-select picker (spec 05/16 HERO-SELECT, slice stub). Shown before each day's
// descent in place of the old weapon picker: the player assembles their party from the
// unlocked cast and sets its order (first pick = the controllable head, the rest trail
// as the follower train). Locked characters are gated by run count and can't be chosen.
// No level is generated here — the scene only carries the `seed` through to the run.
import { BALANCE, THEME } from "./balance.js";
import { hitRect } from "../input/input.js";
import { isHeroUnlocked, save, purchaseUpgrade, UPGRADES, upgradeRank, nextCost } from "../meta/save.js";
import { createPartyPreview } from "./partyPreview.js";
import { VOID_BACKGROUNDS } from "./voidBackgrounds.js";

const VIEW_W = 800, VIEW_H = 600;
const COLS = 3;
// Background-picker coverflow under the Start button: the selected name sits centered
// and large, neighbours shrink/fade toward the edges; the list wraps around.
const CAR_CY = 520, CAR_SPACING = 150;

export function createPartySelectScene(ctx, input, seed, blob) {
  const roster = BALANCE.roster;
  const MAX = BALANCE.partyMax;
  const GRID = roster.length, START = GRID, BG = GRID + 1; // focusables: cards, Start, then the bg carousel
  const unlocked = (c) => isHeroUnlocked(blob, c.id);

  let bgIndex = 0; // chosen void background (index into VOID_BACKGROUNDS)

  // Pre-fill the party with everyone unlocked (up to the cap), in roster order — the
  // player can hit Start immediately or toggle/reorder by re-picking.
  let party = roster.filter(unlocked).slice(0, MAX).map((c) => c.id);

  let i = 0, confirmed = false;
  let armed = false; // require confirm to be released once (held SPACE ended the prior run)
  let pUp = false, pDown = false, pLeft = false, pRight = false, pConfirm = false, pClear = false;
  const pDigit = [false, false, false, false]; // edge state for the 1–4 buy keys

  const byId = (id) => roster.find((c) => c.id === id);

  // Spend banked credits on the highlighted hero's upgrade (spec 08): persist via
  // save() so the next run's load() sees it, and re-bind blob so the panel + the
  // unlock gate read the new state. A no-op when maxed/broke (purchaseUpgrade).
  const buyUpgrade = (heroId, upId) => { blob = save(purchaseUpgrade(blob, heroId, upId)); };
  // The highlighted hero's tree as [upgradeId, def] pairs, or [] when the focus is
  // on Start/BG/a locked card (no buyable hero) — the one source render + input share.
  function upgradeEntries() {
    if (i === START || i === BG || i >= GRID || !unlocked(roster[i])) return [];
    return Object.entries(UPGRADES[roster[i].id] || {});
  }
  // Buyable-row rects under the preview column, one per upgrade track (carries `id`
  // and `track` for the 1–4 keys), shared by render (draw) and update (tap + key).
  function upgradeRows() {
    const entries = upgradeEntries();
    if (!entries.length) return [];
    const { preview: pv } = layout();
    const rowH = 28, gap = 4, y0 = pv.y + pv.h + 14 + 20; // 20px under the panel header
    return entries.map(([id], n) => ({ id, track: n, x: pv.x, y: y0 + n * (rowH + gap), w: pv.w, h: rowH }));
  }

  // Only unlocked cards (and the Start button) can be highlighted/selected — locked
  // heroes are skipped by nav and taps, so the preview only ever runs for reachable picks.
  const selectable = (n) => n === START || n === BG || (n < GRID && unlocked(roster[n]));
  const lastUnlocked = () => { for (let n = GRID - 1; n >= 0; n--) if (unlocked(roster[n])) return n; return 0; };

  // Live action-preview in the right column; lazily built (needs the static rect from
  // layout()). Rebuilt whenever the highlighted index changes.
  let preview = null, prevI = -1;
  const prev = () => (preview || (preview = createPartyPreview(ctx, layout().preview)));
  function syncPreview() {
    if (i === START || i === BG) prev().setHero(party.length ? byId(party[0]) : null); // Start/BG: the head
    else prev().setHero(roster[i]);
  }

  // Card grid + Start button geometry in logical canvas px — shared by render (draw)
  // and update (tap hit-testing) so taps land exactly where the cards are drawn.
  // Compact, left-aligned 3×3 (cards + gaps shrunk ~70%) frees a tall preview column on
  // the right. The single source for both render and tap hit-testing.
  function layout() {
    const cardW = 150, cardH = 84, gx = 6, gy = 6, portH = 40;
    const gridW = COLS * cardW + (COLS - 1) * gx; // 462
    const x0 = 24, y0 = 70;
    const cards = [];
    for (let n = 0; n < GRID; n++) {
      cards.push({ x: x0 + (n % COLS) * (cardW + gx), y: y0 + Math.floor(n / COLS) * (cardH + gy), w: cardW, h: cardH, index: n });
    }
    const dy = y0 + 3 * (cardH + gy) + 8, dh = 60;
    const start = { x: x0, y: dy + dh + 8, w: gridW, h: 34 };
    const previewX = x0 + gridW + 24;
    // Preview bottom aligns with the bottom of the 3 hero rows so the detail sheet below stays clear.
    const preview = { x: previewX, y: y0, w: VIEW_W - previewX - 16, h: 3 * (cardH + gy) - gy };
    return { cardW, cardH, portH, gridW, x0, y0, cards, dy, dh, start, preview };
  }

  function toggle(c) {
    if (!unlocked(c)) return;
    const at = party.indexOf(c.id);
    if (at >= 0) { party.splice(at, 1); return; } // already in → drop it (the rest renumber)
    if (party.length >= MAX) party.shift();        // full → evict the head (FIFO), the rest shift up
    party.push(c.id);                              // new pick lands last; first in line still leads
  }

  function update(dt) {
    if (!input.down("Space") && !input.down("Enter")) armed = true;

    const up = input.down("ArrowUp") || input.down("KeyW") || input.down("KeyK");
    const down = input.down("ArrowDown") || input.down("KeyS") || input.down("KeyJ");
    const left = input.down("ArrowLeft") || input.down("KeyA") || input.down("KeyH");
    const right = input.down("ArrowRight") || input.down("KeyD") || input.down("KeyL");

    // Nav lands only on selectable cells; moves onto locked cards are rejected. Down a
    // column falls to Start, then to the bg carousel; up reverses. On the carousel,
    // left/right scroll the wrapping background list instead of moving focus.
    if (i === BG) {
      const N = VOID_BACKGROUNDS.length;
      if (left && !pLeft) bgIndex = (bgIndex - 1 + N) % N;
      if (right && !pRight) bgIndex = (bgIndex + 1) % N;
      if (up && !pUp) i = START;
    } else {
      if (left && !pLeft && i !== START) { const ni = Math.floor(i / COLS) * COLS + ((i % COLS) - 1 + COLS) % COLS; if (selectable(ni)) i = ni; }
      if (right && !pRight && i !== START) { const ni = Math.floor(i / COLS) * COLS + ((i % COLS) + 1) % COLS; if (selectable(ni)) i = ni; }
      if (down && !pDown) { if (i === START) i = BG; else { const ni = i + COLS; i = ni < GRID && selectable(ni) ? ni : START; } }
      if (up && !pUp) i = i === START ? lastUnlocked() : (i >= COLS && selectable(i - COLS) ? i - COLS : i);
    }
    pUp = up; pDown = down; pLeft = left; pRight = right;

    const confirm = input.down("Space") || input.down("Enter");
    if (armed && confirm && !pConfirm) {
      if (i === START || i === BG) { if (party.length) confirmed = true; } // BG: Space also starts
      else toggle(roster[i]);
    }
    pConfirm = confirm;

    const clear = input.down("KeyC");
    if (clear && !pClear) party = []; // C wipes the whole selection
    pClear = clear;

    // Buy the highlighted hero's upgrades with credits: number keys 1–4 map to the
    // visible tracks (edge-detected so a held key buys one rank, not 60/s).
    const upRows = upgradeRows();
    for (let n = 0; n < pDigit.length; n++) {
      const held = input.down(`Digit${n + 1}`);
      if (held && !pDigit[n] && upRows[n]) buyUpgrade(roster[i].id, upRows[n].id);
      pDigit[n] = held;
    }

    // Touch: tap a card to toggle it into/out of the party; tap Start to begin;
    // tap an upgrade row to buy its next rank for the highlighted hero.
    // Taps are fresh-press edge events, so a held touch can't auto-confirm — no arming.
    const { cards, start } = layout();
    for (let tap; (tap = input.consumeTap()); ) {
      const card = cards.find((r) => hitRect(tap, r));
      const upRow = upRows.find((r) => hitRect(tap, r));
      if (card) { if (unlocked(roster[card.index])) { i = card.index; toggle(roster[card.index]); } } // ignore taps on locked
      else if (upRow) buyUpgrade(roster[i].id, upRow.id);
      else if (hitRect(tap, start)) { i = START; if (party.length) confirmed = true; }
      else if (Math.abs(tap.y - CAR_CY) < 24) { // tap a name in the carousel band → pick the nearest
        let best = null;
        for (const c of carouselCells()) if (!best || Math.abs(tap.x - c.cx) < Math.abs(tap.x - best.cx)) best = c;
        i = BG; bgIndex = best.idx;
      }
    }

    if (i !== prevI) { syncPreview(); prevI = i; } // rebuild the demo when the highlight moves
    prev().update(dt);
  }

  // Placeholder portrait: a flat color block in the character's hue. Isolated so a real
  // sprite swaps in here later without touching the rest of the scene (art stays droppable).
  function drawPortrait(c, x, y, w, h) {
    ctx.fillStyle = c.color;
    ctx.fillRect(x, y, w, h);
  }

  // Visible coverflow entries: center (d=0) prominent, ±1/±2 fade toward the edges,
  // list wraps. `cx` is each name's screen-x; doubles as the tap target center.
  function carouselCells() {
    const N = VOID_BACKGROUNDS.length, out = [];
    for (let d = -2; d <= 2; d++) {
      const idx = ((bgIndex + d) % N + N) % N;
      const alpha = d === 0 ? 1 : Math.abs(d) === 1 ? 0.5 : 0.22;
      out.push({ idx, d, alpha, cx: VIEW_W / 2 + d * CAR_SPACING });
    }
    return out;
  }

  function renderCarousel() {
    const P = THEME.party, focused = i === BG;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = focused ? P.start : P.hint; ctx.font = P.hintFont;
    ctx.fillText("Background", VIEW_W / 2, CAR_CY - 22);
    for (const c of carouselCells()) {
      ctx.globalAlpha = c.alpha;
      ctx.fillStyle = c.d === 0 ? (focused ? P.start : P.name) : P.hint;
      ctx.font = c.d === 0 ? "bold 20px system-ui, sans-serif" : P.nameFont;
      ctx.fillText(VOID_BACKGROUNDS[c.idx].name, c.cx, CAR_CY);
    }
    ctx.globalAlpha = 1;
    if (focused) { // caret hints when the carousel holds focus
      ctx.fillStyle = P.start; ctx.font = "bold 20px system-ui, sans-serif";
      ctx.fillText("‹", VIEW_W / 2 - 100, CAR_CY);
      ctx.fillText("›", VIEW_W / 2 + 100, CAR_CY);
    }
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  }

  function render() {
    const P = THEME.party;
    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.textAlign = "center";
    ctx.fillStyle = P.title;
    ctx.font = P.titleFont;
    ctx.fillText("Pick your party for the walk home", VIEW_W / 2, 42);

    const { cardW, cardH, portH, gridW, x0, cards, dy, dh, start } = layout();

    for (let n = 0; n < GRID; n++) {
      const c = roster[n], active = n === i, free = unlocked(c);
      const cx = cards[n].x, cy = cards[n].y;

      ctx.fillStyle = active ? P.cardActive : P.card;
      ctx.fillRect(cx, cy, cardW, cardH);

      const px = cx + (cardW - portH) / 2, py = cy + 8;
      drawPortrait(c, px, py, portH, portH);

      ctx.fillStyle = P.name;
      ctx.font = P.nameFont;
      ctx.fillText(c.name, cx + cardW / 2, cy + portH + 15);
      ctx.fillStyle = P.weapon;
      ctx.font = P.weaponFont;
      ctx.fillText(BALANCE.weapons[c.weaponId].name, cx + cardW / 2, cy + portH + 30);

      // Selection-order badge (head = 1) on chosen cards.
      const slot = party.indexOf(c.id);
      if (slot >= 0) {
        const bx = cx + 12, by = cy + 12;
        ctx.fillStyle = P.badge;
        ctx.beginPath(); ctx.arc(bx, by, 10, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = P.badgeText;
        ctx.font = P.badgeFont;
        ctx.fillText(String(slot + 1), bx, by + 4);
      }

      // Locked: veil + gate label, non-selectable.
      if (!free) {
        ctx.fillStyle = P.lockTint;
        ctx.fillRect(cx, cy, cardW, cardH);
        ctx.fillStyle = P.lockText;
        ctx.font = P.lockFont;
        ctx.fillText(`↻ run ${c.unlockAtRuns}`, cx + cardW / 2, cy + cardH / 2 + 5);
      }

      if (active) {
        ctx.strokeStyle = P.border;
        ctx.lineWidth = 2;
        ctx.strokeRect(cx + 1, cy + 1, cardW - 2, cardH - 2);
      }
    }

    // Hover detail: the highlighted character's full readout below the grid (or a
    // head→tail party summary when the Start button is focused).
    ctx.fillStyle = P.card;
    ctx.fillRect(x0, dy, gridW, dh);
    renderDetail(x0, dy, gridW, dh);

    // Start button below the detail panel, dimmed until the party has a head.
    const ready = party.length > 0;
    ctx.fillStyle = i === START ? P.cardActive : P.card;
    ctx.fillRect(start.x, start.y, start.w, start.h);
    if (i === START) { ctx.strokeStyle = P.border; ctx.lineWidth = 2; ctx.strokeRect(start.x + 1, start.y + 1, start.w - 2, start.h - 2); }
    ctx.textAlign = "center";
    ctx.fillStyle = ready ? P.start : P.startOff;
    ctx.font = P.nameFont;
    ctx.fillText(ready ? `› Start the walk home  (${party.length})` : "Pick at least one", VIEW_W / 2, start.y + 23);

    renderCarousel(); // background-picker coverflow under the Start button

    ctx.fillStyle = P.hint;
    ctx.font = P.hintFont;
    ctx.fillText("←↑↓→/tap · SPACE pick/start · 1–4/tap upgrade · C clear · ↓ Background", VIEW_W / 2, VIEW_H - 14);
    ctx.textAlign = "left";

    prev().render(); // live action-preview in the right column
    renderUpgrades(); // the highlighted hero's buyable upgrade tree, under the preview
  }

  // The highlighted hero's upgrade tree (spec 08), drawn under the preview column:
  // a credits header plus one row per track with its name, effect, rank pips, and
  // the next-rank cost (greyed MAX when capped, red when unaffordable). Reuses the
  // META theme tokens. Nothing draws when the focus isn't on a buyable hero.
  function renderUpgrades() {
    const rows = upgradeRows();
    if (!rows.length) return;
    const M = THEME.meta, hero = roster[i];
    const { preview: pv } = layout();
    const hy = pv.y + pv.h + 14;
    ctx.textAlign = "left";
    ctx.fillStyle = M.credits; ctx.font = "bold 14px system-ui, sans-serif";
    ctx.fillText(`Upgrades · ${blob.credits} cr`, pv.x, hy + 12);
    for (const r of rows) {
      const def = UPGRADES[hero.id][r.id];
      const rank = upgradeRank(blob, hero.id, r.id), cost = nextCost(blob, hero.id, r.id);
      ctx.fillStyle = M.row;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.textAlign = "left";
      ctx.fillStyle = M.name; ctx.font = "13px system-ui, sans-serif";
      ctx.fillText(`${r.track + 1} ${def.name}`, r.x + 8, r.y + 12);
      ctx.fillStyle = M.blurb; ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(def.blurb, r.x + 8, r.y + 24);
      ctx.textAlign = "right";
      ctx.fillStyle = M.rank; ctx.font = "12px ui-monospace, monospace";
      ctx.fillText("●".repeat(rank) + "○".repeat(def.maxRank - rank), r.x + r.w - 8, r.y + 12);
      ctx.font = "12px ui-monospace, monospace";
      if (cost === null) { ctx.fillStyle = M.maxed; ctx.fillText("MAX", r.x + r.w - 8, r.y + 24); }
      else { ctx.fillStyle = blob.credits >= cost ? M.cost : M.broke; ctx.fillText(`${cost} cr`, r.x + r.w - 8, r.y + 24); }
    }
    ctx.textAlign = "left";
  }

  // The hover readout: portrait + name/genre, basic weapon, signature, stats, and the
  // character's party status — or a head→tail party summary when Start is focused.
  function renderDetail(x, y, w, h) {
    const P = THEME.party;
    if (i === START || i === BG) { // Start/BG focus: show the head→tail party summary, not a card
      ctx.textAlign = "left";
      ctx.fillStyle = P.weapon; ctx.font = P.weaponFont;
      ctx.fillText("Party, head → tail:", x + 16, y + 26);
      ctx.fillStyle = P.name; ctx.font = P.nameFont;
      ctx.fillText(party.length ? party.map((id) => byId(id).name).join("   →   ") : "(no one picked yet)", x + 16, y + 48);
      return;
    }
    const c = roster[i], wdef = BALANCE.weapons[c.weaponId], sig = BALANCE.signatures[c.signatureId];
    const sw = 44, sx = x + 14, swy = y + (h - sw) / 2;
    drawPortrait(c, sx, swy, sw, sw);
    const tx = sx + sw + 16;
    ctx.textAlign = "left";
    ctx.fillStyle = c.color; ctx.font = P.nameFont;
    ctx.fillText(c.name, tx, y + 20);
    ctx.fillStyle = P.weapon; ctx.font = P.weaponFont;
    ctx.fillText(`${wdef.name} — ${wdef.desc}${sig ? `      ·      Sig: ${sig.name}` : ""}`, tx, y + 39);
    const st = c.stats || BALANCE.hero.stats;
    ctx.fillStyle = P.lockText;
    ctx.fillText(`SPD ${st.speed}   CON ${st.constitution}   STR ${st.strength}   MAG ${st.magic}`, tx, y + 56);

    const slot = party.indexOf(c.id), free = unlocked(c);
    let status, scol;
    if (!free) { status = `locked · unlocks at run ${c.unlockAtRuns}`; scol = P.lockText; }
    else if (slot >= 0) { status = slot === 0 ? "in party · slot 1 (head)" : `in party · slot ${slot + 1}`; scol = P.start; }
    else { status = "available — SPACE to add"; scol = P.weapon; }
    ctx.textAlign = "right"; ctx.fillStyle = scol; ctx.font = P.weaponFont;
    ctx.fillText(status, x + w - 14, y + 20);
  }

  return {
    update, render,
    get done() { return confirmed; },
    get party() { return party.slice(); }, // ordered char ids, head first
    get bgId() { return VOID_BACKGROUNDS[bgIndex].id; }, // chosen void background for the run
    seed,
  };
}
