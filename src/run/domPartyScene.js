// Hero picker — the accepted "3A Console" comp (art-test/picker-redesign, uv-base.css +
// uv-portraits.css + uv-render-p.js, final = 3A-FINAL-eq.png) ported to a live DOM-overlay
// scene and wired to the campaign crew. Same return contract as the canvas picker so main.js
// is unchanged: { update, render, done, party, bgId, seed }.
//
// Layout: header · 3×3 roster grid (left) · right rail = dossier (full-body portrait) + a
// LIVE-SIG arena · footer (conga + VOID FEED). Bust head-chips on every card, greyed for
// locked/fallen heroes; recessed grey slot numerals (not colored badges); no halftone dots.
// Keyboard focus moves across zones: grid ⇄ Start ⇄ Void-feed. ENTER starts from anywhere,
// SPACE enlists/promotes the focused hero, ←→ on the feed cycles backgrounds.
import { BALANCE } from "./balance.js";
import { isHeroUnlocked, save, purchaseUpgrade, UPGRADES, upgradeRank, nextCost } from "../meta/save.js";
import { VOID_BACKGROUNDS } from "./voidBackgrounds.js";
import { createPartyPreview } from "./partyPreview.js";
import { mountOverlay } from "../ui/overlay.js";
import { sfx } from "../audio/sfx.js";

const STATS = [["SPD", "speed"], ["CON", "constitution"], ["STR", "strength"], ["MAG", "magic"]];
const bust = (id) => `assets/portraits/busts/${id}.png`; // head+shoulders crop for the card chip
const body = (id) => `assets/portraits/${id}.png`;        // full-body for the dossier

const CSS = `
#ui-overlay .uvp{--uv:#ccff00;--mag:#ff2d95;--cyan:#00e5ff;--ink:#f2f4f0;--dim:#6f7566;--card:#0b0c09;--card2:#070806;--line:#1c1f18;--num:#3c4232;
  width:800px;height:600px;position:relative;overflow:hidden;background:#040404;color:var(--ink);font-family:"Oswald",sans-serif}
#ui-overlay .uvp .mono{font-family:"Space Mono",monospace}
#ui-overlay .uvp .hdr{position:absolute;top:0;left:0;right:0;height:62px;display:flex;align-items:flex-end;justify-content:space-between;padding:0 20px 10px;border-bottom:2px solid var(--uv)}
#ui-overlay .uvp .title{font-family:"Anton",sans-serif;font-size:34px;line-height:.82;letter-spacing:.01em;text-transform:uppercase}
#ui-overlay .uvp .title em{font-style:normal;color:var(--uv);text-shadow:0 0 18px rgba(204,255,0,.55)}
#ui-overlay .uvp .title small{display:block;font-family:"Space Mono",monospace;font-size:9px;letter-spacing:.38em;color:var(--cyan);margin-top:5px}
#ui-overlay .uvp .rhead{font-family:"Space Mono",monospace;font-size:10px;color:var(--dim);text-align:right;line-height:1.7;letter-spacing:.06em}
#ui-overlay .uvp .rhead b{color:var(--mag)}
#ui-overlay .uvp .body{position:absolute;top:72px;left:18px;right:18px;bottom:92px;display:grid;grid-template-columns:1fr 232px;gap:12px}
#ui-overlay .uvp .grid{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:8px}
#ui-overlay .uvp .card{position:relative;border:1px solid var(--line);background:linear-gradient(180deg,var(--card),var(--card2));padding:8px 10px 8px 54px;overflow:hidden;cursor:pointer}
#ui-overlay .uvp .card .av{position:absolute;left:8px;top:20px;width:40px;height:40px;border-radius:3px;overflow:hidden;border:1px solid var(--line)}
#ui-overlay .uvp .card .av img{width:100%;height:100%;object-fit:cover;object-position:center 22%}
#ui-overlay .uvp .card .av .ph{width:100%;height:100%}
#ui-overlay .uvp .card .av .ph circle,#ui-overlay .uvp .card .av .ph path{fill:#3c4232}
#ui-overlay .uvp .card .no{position:absolute;right:7px;top:5px;font-family:"Anton";font-size:22px;color:var(--num);line-height:1}
#ui-overlay .uvp .card .slot{position:absolute;right:30px;top:6px;font-family:"Anton";font-size:14px;color:#8a9468;line-height:1;display:none}
#ui-overlay .uvp .card.inparty .slot{display:block}
#ui-overlay .uvp .card .nm{font-family:"Anton";font-size:17px;text-transform:uppercase;line-height:1;color:#fff;position:relative;z-index:2}
#ui-overlay .uvp .card .gn{font-family:"Space Mono",monospace;font-size:8px;letter-spacing:.18em;margin-top:5px;text-transform:uppercase;position:relative;z-index:2}
#ui-overlay .uvp .card .sig{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;margin-top:3px;position:relative;z-index:2}
#ui-overlay .uvp .card .eq{position:absolute;left:54px;right:10px;bottom:8px;display:flex;gap:3px;align-items:flex-end;height:14px}
#ui-overlay .uvp .card .eq i{flex:1;background:#1a1d14;position:relative;height:100%}
#ui-overlay .uvp .card .eq i span{position:absolute;left:0;right:0;bottom:0;display:block}
#ui-overlay .uvp .card.sel{border-color:var(--uv);box-shadow:0 0 0 1px var(--uv),inset 0 0 30px rgba(204,255,0,.08)}
#ui-overlay .uvp .card.sel .no{color:rgba(204,255,0,.16)}
#ui-overlay .uvp .card.lock,#ui-overlay .uvp .card.dead{opacity:.5;cursor:default}
#ui-overlay .uvp .card .lk{position:absolute;left:54px;right:6px;bottom:7px;font-family:"Space Mono";font-size:9px;letter-spacing:.16em;color:var(--cyan)}
#ui-overlay .uvp .card.dead .lk{color:var(--mag)}
#ui-overlay .uvp .rail{display:flex;flex-direction:column;gap:10px;min-height:0}
#ui-overlay .uvp .doss{flex:1;border:1px solid var(--line);background:linear-gradient(180deg,#0a0b08,#060705);padding:12px 13px;display:flex;flex-direction:column;position:relative;overflow:hidden;padding-right:88px}
#ui-overlay .uvp .doss .tag{font-family:"Space Mono";font-size:8.5px;letter-spacing:.26em;color:var(--cyan)}
#ui-overlay .uvp .doss h2{font-family:"Anton";font-size:34px;text-transform:uppercase;line-height:.86;margin-top:6px;color:#fff}
#ui-overlay .uvp .doss .gn{font-family:"Space Mono";font-size:9px;letter-spacing:.2em;margin-top:6px;text-transform:uppercase}
#ui-overlay .uvp .doss .sigbox{margin-top:10px;border-left:3px solid var(--mag);padding:2px 0 2px 10px}
#ui-overlay .uvp .doss .sigbox small{font-family:"Space Mono";font-size:8px;letter-spacing:.2em;color:var(--dim);display:block}
#ui-overlay .uvp .doss .sigbox b{font-family:"Anton";font-size:18px;text-transform:uppercase;color:var(--mag);text-shadow:0 0 16px rgba(255,45,149,.5)}
#ui-overlay .uvp .doss .status{margin-top:8px;font-family:"Space Mono";font-size:8.5px;letter-spacing:.14em;text-transform:uppercase}
#ui-overlay .uvp .doss .upg{margin-top:5px;font-family:"Space Mono";font-size:8.5px;letter-spacing:.16em;color:var(--cyan);cursor:pointer;text-transform:uppercase}
#ui-overlay .uvp .doss .dstats{margin-top:auto;display:flex;flex-direction:column;gap:5px;padding-top:8px}
#ui-overlay .uvp .doss .ds{display:grid;grid-template-columns:26px 1fr 14px;gap:7px;align-items:center}
#ui-overlay .uvp .doss .ds i{font-family:"Space Mono";font-style:normal;font-size:8.5px;color:var(--dim)}
#ui-overlay .uvp .doss .ds .t{height:7px;background:#15170f;display:flex;gap:2px}
#ui-overlay .uvp .doss .ds .t b{flex:1;background:#22261a}
#ui-overlay .uvp .doss .ds .nn{font-family:"Anton";font-size:12px;text-align:right}
#ui-overlay .uvp .doss .bodyshot{position:absolute;right:2px;bottom:0;height:184px;width:auto;filter:drop-shadow(0 3px 6px rgba(0,0,0,.6))}
#ui-overlay .uvp .doss .bodyshot.ph circle,#ui-overlay .uvp .doss .bodyshot.ph path{fill:#22261a}
#ui-overlay .uvp .arena{height:120px;position:relative;border:1px solid var(--line);background:radial-gradient(120% 90% at 50% 0%,#0c0f0a,#040503);overflow:hidden;flex:0 0 auto}
#ui-overlay .uvp .arena .alab{position:absolute;left:9px;top:8px;font-family:"Space Mono";font-size:8px;letter-spacing:.18em;color:var(--uv);text-shadow:0 0 10px rgba(204,255,0,.5)}
#ui-overlay .uvp .arena .alab .dl{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--mag);box-shadow:0 0 8px var(--mag);margin-right:5px;vertical-align:middle}
#ui-overlay .uvp .arena .ent{position:absolute;border-radius:50%;transform:translate(-50%,-50%)}
#ui-overlay .uvp .arena .hero{box-shadow:0 0 16px currentColor,inset 0 0 0 2px rgba(255,255,255,.25)}
#ui-overlay .uvp .arena .dummy{background:#e8743b;box-shadow:0 0 8px rgba(232,116,59,.6)}
#ui-overlay .uvp .arena .nova{position:absolute;border-radius:50%;border:2px solid var(--mag);box-shadow:0 0 24px rgba(255,45,149,.6),inset 0 0 24px rgba(255,45,149,.3);transform:translate(-50%,-50%)}
#ui-overlay .uvp .arena .arena-cv{position:absolute;left:0;top:0;z-index:0}
#ui-overlay .uvp .arena .alab{z-index:2}
#ui-overlay .uvp .foot{position:absolute;left:0;right:0;bottom:0;height:80px;border-top:2px solid var(--uv);background:#060604;display:grid;grid-template-rows:1fr 1fr}
#ui-overlay .uvp .conga{display:flex;align-items:center;padding:0 20px;border-bottom:1px solid #16180f;overflow:hidden}
#ui-overlay .uvp .clab{font-family:"Space Mono";font-size:9px;letter-spacing:.2em;color:var(--dim);white-space:nowrap;margin-right:14px}
#ui-overlay .uvp .chip{display:flex;align-items:center;gap:5px;padding:3px 8px;border:1px solid var(--line);margin-right:5px;white-space:nowrap}
#ui-overlay .uvp .chip .sn{font-family:"Anton";font-size:11px;color:#8a9468}
#ui-overlay .uvp .chip .d{width:7px;height:7px;border-radius:50%}
#ui-overlay .uvp .chip b{font-family:"Oswald";font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.02em}
#ui-overlay .uvp .arr{color:#2a2d22;margin:0 1px}
#ui-overlay .uvp .start{margin-left:auto;font-family:"Anton";font-size:14px;text-transform:uppercase;letter-spacing:.03em;color:#050505;background:var(--uv);padding:6px 14px;white-space:nowrap;box-shadow:0 0 18px rgba(204,255,0,.4);cursor:pointer}
#ui-overlay .uvp .start.off{background:#2a2d22;color:#6f7566;box-shadow:none;cursor:default}
#ui-overlay .uvp .start.focus{outline:2px solid #fff;outline-offset:2px}
#ui-overlay .uvp .bgrow{display:flex;align-items:center;padding:0 20px;overflow:hidden}
#ui-overlay .uvp .bgs{display:flex;gap:14px;align-items:center}
#ui-overlay .uvp .bgs b{font-family:"Space Mono";font-size:10px;letter-spacing:.12em;color:#33372a;text-transform:uppercase;white-space:nowrap;cursor:pointer}
#ui-overlay .uvp .bgs b.on{color:var(--cyan);text-shadow:0 0 14px rgba(0,229,255,.6)}
#ui-overlay .uvp .bgs b.auto{color:var(--uv);border:1px solid #2c3320;padding:2px 8px}
#ui-overlay .uvp .bgs b.auto.on{color:#050505;background:var(--uv);border-color:var(--uv)}
#ui-overlay .uvp .bgrow.focus .bgs b.on{outline:2px solid #fff;outline-offset:2px}
#ui-overlay .uvp .modal{position:absolute;inset:0;background:rgba(2,3,1,.82);display:flex;align-items:center;justify-content:center;z-index:10}
#ui-overlay .uvp .mpanel{width:440px;border:1px solid var(--uv);background:#0a0b08;padding:16px 18px}
#ui-overlay .uvp .mpanel h3{font-family:"Anton";font-size:21px;text-transform:uppercase;color:#fff}
#ui-overlay .uvp .mpanel .cr{font-family:"Space Mono";font-size:11px;color:var(--uv);float:right;margin-top:5px}
#ui-overlay .uvp .urow{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;border-top:1px solid #16180f;padding:8px 0}
#ui-overlay .uvp .urow .un{font-weight:600;font-size:13px;text-transform:uppercase}
#ui-overlay .uvp .urow .ub{font-size:10px;color:var(--dim)}
#ui-overlay .uvp .urow .pip{font-family:"Space Mono";font-size:11px;color:var(--cyan);margin-right:10px}
#ui-overlay .uvp .urow .buy{font-family:"Space Mono";font-size:11px;color:#050505;background:var(--uv);padding:4px 10px;cursor:pointer}
#ui-overlay .uvp .urow .buy.no{background:#2a2d22;color:#6f7566;cursor:default}
#ui-overlay .uvp .mclose{margin-top:12px;font-family:"Space Mono";font-size:10px;color:var(--dim);cursor:pointer;text-align:center}
`;

export function createPartySelectScene(ctx, input, seed, blob) {
  if (!document.getElementById("uvp-css")) {
    const s = document.createElement("style"); s.id = "uvp-css"; s.textContent = CSS; document.head.appendChild(s);
  }
  const roster = BALANCE.roster;
  const dead = new Set(blob.campaign.dead);
  const unlocked = (c) => isHeroUnlocked(blob, c.id);
  const isDead = (id) => dead.has(id);
  const isIn = (id) => party.includes(id);
  const canEnlist = (c) => unlocked(c) && !isDead(c.id) && !isIn(c.id);
  const navigable = (i) => isIn(roster[i].id) || canEnlist(roster[i]); // focusable cards: crew + reserves (locked/fallen are skipped)
  const wName = (h) => BALANCE.weapons[h.weaponId].name;
  const sName = (h) => (BALANCE.signatures[h.signatureId] || {}).name || "—";
  const accent = (h, sel) => (sel ? "#ccff00" : h.color);

  let party = blob.campaign.crew.slice();
  let gridSel = Math.max(0, roster.findIndex((c) => c.id === party[0]));
  let zone = "grid";               // 'grid' | 'start' | 'bg'
  let bgIndex = -1;                // -1 = Automatic, else index into VOID_BACKGROUNDS
  let modal = null, confirmed = false, armed = false;

  const root = document.createElement("div");
  root.className = "uvp";
  const resolveBg = () => (bgIndex < 0 ? VOID_BACKGROUNDS[(Math.random() * VOID_BACKGROUNDS.length) | 0] : VOID_BACKGROUNDS[bgIndex]).id;
  let chosenBg = null; // locked in at start (so Automatic resolves once)

  // Live battle preview (shared combat sim): drawn into a canvas that persists across the
  // picker's DOM re-renders — re-attached into the .arena each render, driven by the loop
  // through this scene's update/render. The focused hero acts in its role (head=weapon,
  // reserve=signature), matching runScene.
  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = 230; previewCanvas.height = 118; previewCanvas.className = "arena-cv";
  const preview = createPartyPreview(previewCanvas.getContext("2d"), { x: 0, y: 0, w: 230, h: 118 });
  const roleOf = (id) => (party[0] === id ? "head" : "follower");
  let lastPreviewSel = -1;

  function cardHTML(h, i) {
    const slot = party.indexOf(h.id), lk = !unlocked(h), dd = isDead(h.id), a = accent(h, i === gridSel && zone === "grid");
    const cls = ["card", i === gridSel && zone === "grid" ? "sel" : "", slot >= 0 ? "inparty" : "", lk ? "lock" : "", dd ? "dead" : ""].join(" ");
    const eq = STATS.map(([, k]) => `<i><span style="height:${h.stats[k] / 10 * 100}%;background:${a}"></span></i>`).join("");
    const veil = dd ? `<div class="lk">✝ FELL</div>` : lk ? `<div class="lk">⟳ RUN ${h.unlockAtRuns}</div>` : "";
    const av = (lk || dd)
      ? `<svg class="ph" viewBox="0 0 40 40"><circle cx="20" cy="14" r="8"></circle><path d="M4 40 Q20 22 36 40 Z"></path></svg>`
      : `<img src="${bust(h.id)}" alt="" onerror="this.remove()">`;
    return `<div class="${cls}" data-i="${i}">
      <div class="av" style="background:${lk || dd ? "#0e1009" : h.color}">${av}</div>
      <div class="slot">${slot >= 0 ? slot + 1 : ""}</div><div class="no">${String(i + 1).padStart(2, "0")}</div>
      <div class="nm"${lk ? ` style="color:#5a6147"` : ""}>${lk ? "?????" : h.name}</div>
      ${lk ? "" : `<div class="gn" style="color:${h.color}">${h.genre}</div><div class="sig" style="color:${a}">✦ ${sName(h)}</div>`}
      ${veil || `<div class="eq">${eq}</div>`}</div>`;
  }

  function dossHTML() {
    const h = roster[gridSel], slot = party.indexOf(h.id);
    if (!unlocked(h)) { // unknown hero: censor everything (name, genre, sig, stats, figure)
      const blanks = STATS.map(([lab]) => `<div class="ds"><i>${lab}</i><div class="t">${"<b></b>".repeat(10)}</div><div class="nn" style="color:#3c4232">?</div></div>`).join("");
      return `<div class="tag">LOCKED · UNIT ${String(gridSel + 1).padStart(2, "0")}</div>
        <h2 style="color:#5a6147">?????</h2>
        <div class="gn" style="color:var(--dim)">UNLOCKS AT RUN ${h.unlockAtRuns}</div>
        <div class="sigbox"><small>SIGNATURE</small><b style="color:#5a6147">??????</b></div>
        <div class="status" style="color:var(--cyan)">locked — keep getting home to unlock</div>
        <div class="dstats">${blanks}</div>
        <svg class="bodyshot ph" viewBox="0 0 80 188"><circle cx="40" cy="44" r="26"></circle><path d="M0 188 Q40 96 80 188 Z"></path></svg>`;
    }
    const bars = STATS.map(([lab, k]) =>
      `<div class="ds"><i>${lab}</i><div class="t">${Array.from({ length: 10 }, (_, j) =>
        `<b style="${j < h.stats[k] ? `background:${h.color};box-shadow:0 0 6px ${h.color}` : ""}"></b>`).join("")}</div><div class="nn">${h.stats[k]}</div></div>`).join("");
    let status, scol;
    if (isDead(h.id)) { status = "✝ fell — gone for good"; scol = "var(--mag)"; }
    else if (!unlocked(h)) { status = `locked · unlocks run ${h.unlockAtRuns}`; scol = "var(--dim)"; }
    else if (slot === 0) { status = "on the walk · head"; scol = "var(--uv)"; }
    else if (slot > 0) { status = `on the walk · slot ${slot + 1} — SPACE to lead`; scol = "var(--uv)"; }
    else { status = "reserve — SPACE to enlist"; scol = "var(--cyan)"; }
    const upg = (unlocked(h) && UPGRADES[h.id]) ? `<div class="upg" data-upg>▸ UPGRADES (${blob.credits} CR)</div>` : "";
    return `<div class="tag">SELECTED · UNIT ${String(gridSel + 1).padStart(2, "0")}${slot >= 0 ? " · SLOT " + (slot + 1) : ""}</div>
      <h2>${h.name}</h2><div class="gn" style="color:${h.color}">${h.genre}</div>
      <div class="sigbox"><small>SIGNATURE</small><b>${sName(h)}</b></div>
      <div class="status" style="color:${scol}">${status}</div>${upg}
      <div class="dstats">${bars}</div>
      <img class="bodyshot" src="${body(h.id)}" alt="" onerror="this.remove()">`;
  }

  function arenaHTML() {
    const h = roster[gridSel], lk = !unlocked(h);
    const what = lk ? "??????" : party[0] === h.id ? "WEAPON: " + wName(h).toUpperCase() : "SIG: " + sName(h).toUpperCase();
    return `<div class="alab"><span class="dl"></span>LIVE ▸ ${what}</div>`; // the canvas is re-attached here each render
  }

  function congaHTML() {
    const chips = party.map((id, o) => {
      const x = roster.find((c) => c.id === id);
      const arr = o < party.length - 1 ? '<span class="arr">▸</span>' : "";
      return `<div class="chip"><span class="sn">${o + 1}</span><span class="d" style="background:${x.color};box-shadow:0 0 8px ${x.color}"></span><b>${x.name}</b></div>${arr}`;
    }).join("");
    const cls = "start" + (party.length ? "" : " off") + (zone === "start" ? " focus" : "");
    return `<span class="clab">CONGA ▸ HEAD→TAIL</span>${chips}<div class="${cls}" data-start>▶ START THE WALK [${party.length}]</div>`;
  }

  function bgHTML() {
    const items = ["⟳ AUTOMATIC", ...VOID_BACKGROUNDS.map((b) => b.name.toUpperCase())];
    return items.map((label, i) => {
      const idx = i - 1, on = idx === bgIndex; // i=0 → Automatic (idx -1)
      return `<b class="${i === 0 ? "auto" : ""} ${on ? "on" : ""}" data-bg="${idx}">${on && i !== 0 ? "◉ " : ""}${label}</b>`;
    }).join("");
  }

  function modalHTML() {
    if (!modal) return "";
    const h = roster.find((c) => c.id === modal), tree = UPGRADES[h.id] || {};
    const rows = Object.entries(tree).map(([id, def]) => {
      const rank = upgradeRank(blob, h.id, id), cost = nextCost(blob, h.id, id);
      const pips = "●".repeat(rank) + "○".repeat(def.maxRank - rank), can = cost !== null && blob.credits >= cost;
      const btn = cost === null ? `<span class="buy no">MAX</span>` : `<span class="buy${can ? "" : " no"}" data-buy="${id}">${cost} cr</span>`;
      return `<div class="urow"><div><div class="un">${def.name}</div><div class="ub">${def.blurb}</div></div><div><span class="pip">${pips}</span>${btn}</div></div>`;
    }).join("");
    return `<div class="modal" data-closebg><div class="mpanel"><span class="cr">${blob.credits} cr</span><h3>${h.name}</h3>${rows}<div class="mclose" data-closemodal>U / Esc / click out to close</div></div></div>`;
  }

  function render() {
    root.innerHTML = `
      <div class="hdr"><div class="title">SELECT <em>YOUR</em> CREW<small>MERRITON HIGH · DAY ${blob.campaign.day} · 3:00 PM</small></div>
        <div class="rhead">ROSTER <b>0${roster.length}</b><br>CREW <b>${String(party.length).padStart(2, "0")}</b><br>FALLEN <b>${String(dead.size).padStart(2, "0")}</b></div></div>
      <div class="body"><div class="grid">${roster.map(cardHTML).join("")}</div>
        <div class="rail"><div class="doss">${dossHTML()}</div><div class="arena">${arenaHTML()}</div></div></div>
      <div class="foot"><div class="conga">${congaHTML()}</div>
        <div class="bgrow${zone === "bg" ? " focus" : ""}"><span class="clab">VOID FEED</span><div class="bgs">${bgHTML()}</div></div></div>
      ${modalHTML()}`;
    const arenaEl = root.querySelector(".arena"); // re-home the persistent preview canvas + refocus the sim
    if (arenaEl) {
      arenaEl.insertBefore(previewCanvas, arenaEl.firstChild);
      if (gridSel !== lastPreviewSel) { preview.setHero(roster[gridSel], roleOf(roster[gridSel].id)); lastPreviewSel = gridSel; }
    }
  }

  function act(i) {
    const c = roster[i]; gridSel = i; zone = "grid";
    if (isDead(c.id) || !unlocked(c)) { render(); return; }
    const at = party.indexOf(c.id);
    if (at > 0) { party.splice(at, 1); party.unshift(c.id); sfx.play("uiSelect"); }
    else if (at < 0 && canEnlist(c)) { party.push(c.id); sfx.play("uiSelect"); }
    render();
  }
  function buy(id) { blob = save(purchaseUpgrade(blob, modal, id)); sfx.play("uiSelect"); render(); }
  function startWalk() {
    if (!party.length) return;
    chosenBg = resolveBg();
    blob.campaign.crew = party.slice(); save(blob);
    teardown(); confirmed = true; sfx.play("uiSelect");
  }

  // pointer (delegated)
  root.addEventListener("mouseover", (e) => {
    const card = e.target.closest("[data-i]"); if (!card) return;
    const i = +card.dataset.i; if (!navigable(i)) return; // locked/fallen aren't selectable
    if (i !== gridSel || zone !== "grid") { gridSel = i; zone = "grid"; sfx.play("uiMove"); render(); }
  });
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-start]")) return startWalk();
    if (e.target.closest("[data-upg]")) { modal = roster[gridSel].id; sfx.play("uiSelect"); return render(); }
    if (e.target.closest("[data-buy]")) return buy(e.target.closest("[data-buy]").dataset.buy);
    if (e.target.closest("[data-closemodal]")) { modal = null; sfx.play("uiBack"); return render(); }
    const bg = e.target.closest("[data-bg]"); if (bg) { bgIndex = +bg.dataset.bg; zone = "bg"; sfx.play("uiMove"); return render(); }
    if (e.target.closest("[data-closebg]") && !e.target.closest(".mpanel")) { modal = null; return render(); }
    const card = e.target.closest("[data-i]"); if (card) return act(+card.dataset.i);
  });

  // keyboard: ENTER starts anywhere, SPACE enlists a focused hero, arrows move across zones
  const N = VOID_BACKGROUNDS.length;
  const onKey = (e) => {
    if (!armed) return;
    if (modal) { if (e.code === "Escape" || e.code === "KeyU") { modal = null; render(); }
      else { const n = ["Digit1","Digit2","Digit3","Digit4"].indexOf(e.code); const ids = Object.keys(UPGRADES[modal] || {}); if (n >= 0 && ids[n]) buy(ids[n]); }
      return; }
    if (e.code === "Enter") return startWalk();
    if (e.code === "KeyA") { bgIndex = -1; zone = "bg"; return render(); }
    // Selectable cards (crew + reserves) form a linear list; arrows step over locked/fallen
    // cards and fall through to Start, then the void feed.
    const list = roster.map((_, i) => i).filter(navigable);
    const fwd = e.code === "ArrowRight" || e.code === "ArrowDown";
    const back = e.code === "ArrowLeft" || e.code === "ArrowUp";
    if (zone === "grid") {
      const cur = list.indexOf(gridSel);
      if (fwd) {
        if (cur < 0) { gridSel = list[0]; render(); }                    // from a hovered locked card
        else if (cur < list.length - 1) { gridSel = list[cur + 1]; render(); }
        else { zone = "start"; render(); }                               // past the last hero → Start
      } else if (back) {
        if (cur > 0) { gridSel = list[cur - 1]; render(); }
        else if (cur < 0) { gridSel = list[list.length - 1]; render(); }  // at the first hero → stay
      } else if (e.code === "Space") act(gridSel);
      else if (e.code === "KeyU" && unlocked(roster[gridSel]) && UPGRADES[roster[gridSel].id]) { modal = roster[gridSel].id; render(); }
    } else if (zone === "start") {
      if (back) { zone = "grid"; gridSel = list[list.length - 1]; render(); }
      else if (fwd) { zone = "bg"; render(); }
      else if (e.code === "Space") startWalk();
    } else if (zone === "bg") {
      if (e.code === "ArrowUp") { zone = "start"; render(); }
      else if (e.code === "ArrowRight") { bgIndex = bgIndex + 1 >= N ? -1 : bgIndex + 1; sfx.play("uiMove"); render(); }
      else if (e.code === "ArrowLeft") { bgIndex = bgIndex - 1 < -1 ? N - 1 : bgIndex - 1; sfx.play("uiMove"); render(); }
      else if (e.code === "Space") startWalk();
    }
  };
  const onUp = (e) => { if (e.code === "Space" || e.code === "Enter") armed = true; };
  addEventListener("keydown", onKey); addEventListener("keyup", onUp);
  setTimeout(() => (armed = true), 160);
  function teardown() { removeEventListener("keydown", onKey); removeEventListener("keyup", onUp); }

  render();
  mountOverlay(root);
  return {
    update(dt) { preview.update(dt); },   // drive the live battle preview each frame
    render() { preview.render(); },
    get done() { return confirmed; },
    get party() { return party.slice(); },
    get bgId() { return chosenBg || resolveBg(); },
    seed,
  };
}
