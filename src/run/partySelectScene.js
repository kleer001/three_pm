// Party-select picker (spec 05/16 HERO-SELECT, slice stub). Shown before each day's
// descent in place of the old weapon picker: the player assembles their party from the
// unlocked cast and sets its order (first pick = the controllable head, the rest trail
// as the follower train). Locked characters are gated by run count and can't be chosen.
// No level is generated here — the scene only carries the `seed` through to the run.
import { BALANCE, THEME } from "./balance.js";
import { hitRect } from "../input/input.js";
import { isHeroUnlocked } from "../meta/save.js";
import { createPartyPreview } from "./partyPreview.js";

const VIEW_W = 800, VIEW_H = 600;
const COLS = 3;

export function createPartySelectScene(ctx, input, seed, blob) {
  const roster = BALANCE.roster;
  const MAX = BALANCE.partyMax;
  const GRID = roster.length, START = GRID; // last focusable is the Start button
  const unlocked = (c) => isHeroUnlocked(blob, c.id);

  // Pre-fill the party with everyone unlocked (up to the cap), in roster order — the
  // player can hit Start immediately or toggle/reorder by re-picking.
  let party = roster.filter(unlocked).slice(0, MAX).map((c) => c.id);

  let i = 0, confirmed = false;
  let armed = false; // require confirm to be released once (held SPACE ended the prior run)
  let pUp = false, pDown = false, pLeft = false, pRight = false, pConfirm = false, pClear = false;

  const byId = (id) => roster.find((c) => c.id === id);

  // Only unlocked cards (and the Start button) can be highlighted/selected — locked
  // heroes are skipped by nav and taps, so the preview only ever runs for reachable picks.
  const selectable = (n) => n === START || (n < GRID && unlocked(roster[n]));
  const lastUnlocked = () => { for (let n = GRID - 1; n >= 0; n--) if (unlocked(roster[n])) return n; return 0; };

  // Live action-preview in the right column; lazily built (needs the static rect from
  // layout()). Rebuilt whenever the highlighted index changes.
  let preview = null, prevI = -1;
  const prev = () => (preview || (preview = createPartyPreview(ctx, layout().preview)));
  function syncPreview() {
    if (i === START) { prev().setHero(party.length ? byId(party[0]) : null, "head"); return; } // Start: the head
    // First pick is the head (fires its weapon); everyone else is a follower (fires its
    // signature). An unpicked card previews as it WOULD join: head if no party yet, else follower.
    const c = roster[i];
    const isHead = party.length === 0 || party[0] === c.id;
    prev().setHero(c, isHead ? "head" : "follower");
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
    const preview = { x: previewX, y: y0, w: VIEW_W - previewX - 16, h: VIEW_H - y0 - 30 };
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

    // Nav lands only on selectable cells; moves onto locked cards are rejected. Down from
    // a card falls through to Start when the cell below is locked/out; up from Start lands
    // on the last unlocked card.
    if (left && !pLeft && i !== START) { const ni = Math.floor(i / COLS) * COLS + ((i % COLS) - 1 + COLS) % COLS; if (selectable(ni)) i = ni; }
    if (right && !pRight && i !== START) { const ni = Math.floor(i / COLS) * COLS + ((i % COLS) + 1) % COLS; if (selectable(ni)) i = ni; }
    if (down && !pDown && i !== START) { const ni = i + COLS; i = ni < GRID && selectable(ni) ? ni : START; }
    if (up && !pUp) i = i === START ? lastUnlocked() : (i >= COLS && selectable(i - COLS) ? i - COLS : i);
    pUp = up; pDown = down; pLeft = left; pRight = right;

    const confirm = input.down("Space") || input.down("Enter");
    if (armed && confirm && !pConfirm) {
      if (i === START) { if (party.length) confirmed = true; }
      else toggle(roster[i]);
    }
    pConfirm = confirm;

    const clear = input.down("KeyC");
    if (clear && !pClear) party = []; // C wipes the whole selection
    pClear = clear;

    // Touch: tap a card to toggle it into/out of the party; tap Start to begin.
    // Taps are fresh-press edge events, so a held touch can't auto-confirm — no arming.
    const { cards, start } = layout();
    for (let tap; (tap = input.consumeTap()); ) {
      const card = cards.find((r) => hitRect(tap, r));
      if (card) { if (unlocked(roster[card.index])) { i = card.index; toggle(roster[card.index]); } } // ignore taps on locked
      else if (hitRect(tap, start)) { i = START; if (party.length) confirmed = true; }
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

    ctx.fillStyle = P.hint;
    ctx.font = P.hintFont;
    ctx.fillText("←↑↓→ or tap    SPACE / tap to pick · start    C clear    (first pick leads)", VIEW_W / 2, VIEW_H - 14);
    ctx.textAlign = "left";

    prev().render(); // live action-preview in the right column
  }

  // The hover readout: portrait + name/genre, basic weapon, signature, stats, and the
  // character's party status — or a head→tail party summary when Start is focused.
  function renderDetail(x, y, w, h) {
    const P = THEME.party;
    if (i === START) {
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
    ctx.fillText(`${c.name}   ·   ${c.genre}`, tx, y + 20);
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
    seed,
  };
}
