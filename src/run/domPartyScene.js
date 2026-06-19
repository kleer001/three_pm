// Hero picker — the approved "UV-Rave / Console" comp (art-test/picker-redesign/3-uv-rave.html)
// ported to a live DOM-overlay scene and wired to the campaign crew. Same return contract as
// the old canvas picker so main.js's FSM is unchanged: { update, render, done, party, bgId, seed }.
// update/render are no-ops — the DOM manages itself; the fixed-timestep loop just ticks past it.
//
// Campaign semantics (matches the crew model in save.js): the standing crew walks every day,
// head first. Enlist a reserve (unlocked, alive, not yet in) to add firepower + risk; click an
// enlisted hero to promote them to head. The fallen show ✝ and can't be picked. Start persists
// the crew order and begins the day.
import { BALANCE } from "./balance.js";
import { isHeroUnlocked, save, purchaseUpgrade, UPGRADES, upgradeRank, nextCost } from "../meta/save.js";
import { VOID_BACKGROUNDS } from "./voidBackgrounds.js";
import { mountOverlay } from "../ui/overlay.js";
import { sfx } from "../audio/sfx.js";

const STATS = [["SPD", "speed"], ["CON", "constitution"], ["STR", "strength"], ["MAG", "magic"]];

// Scoped port of the comp's CSS (prefixed to the overlay so it can't touch game styles). Injected once.
const CSS = `
#ui-overlay .uvp{--uv:#ccff00;--mag:#ff2d95;--cyan:#00e5ff;--ink:#f2f4f0;--dim:#6f7566;
  width:800px;height:600px;position:relative;overflow:hidden;background:#050505;color:var(--ink);font-family:"Oswald",sans-serif}
#ui-overlay .uvp::before{content:"";position:absolute;width:520px;height:520px;right:-150px;top:-150px;border-radius:50%;
  background:conic-gradient(from 0deg,transparent 0 8deg,rgba(255,45,149,.10) 8deg 16deg,transparent 16deg 24deg);
  -webkit-mask:radial-gradient(circle,transparent 38%,#000 39%,#000 100%);mask:radial-gradient(circle,transparent 38%,#000 39%,#000 100%)}
#ui-overlay .uvp::after{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(204,255,0,.05) 1px,transparent 1.4px);background-size:7px 7px;pointer-events:none}
#ui-overlay .uvp .ring{position:absolute;right:-110px;top:-110px;width:440px;height:440px;border-radius:50%;border:1px solid rgba(0,229,255,.18)}
#ui-overlay .uvp .ring.b{width:300px;height:300px;right:-40px;top:-40px;border-color:rgba(204,255,0,.16)}
#ui-overlay .uvp header{position:absolute;top:0;left:0;right:0;height:76px;display:flex;align-items:flex-end;justify-content:space-between;padding:0 22px 12px;border-bottom:2px solid var(--uv)}
#ui-overlay .uvp .title{font-family:"Anton",sans-serif;font-size:38px;line-height:.82;letter-spacing:.01em;text-transform:uppercase}
#ui-overlay .uvp .title em{font-style:normal;color:var(--uv);text-shadow:0 0 18px rgba(204,255,0,.55)}
#ui-overlay .uvp .title small{display:block;font-family:"Space Mono",monospace;font-size:10px;letter-spacing:.42em;color:var(--cyan);margin-top:5px}
#ui-overlay .uvp .rhead{font-family:"Space Mono",monospace;font-size:10px;color:var(--dim);text-align:right;line-height:1.7;letter-spacing:.06em}
#ui-overlay .uvp .rhead b{color:var(--mag)}
#ui-overlay .uvp .body{position:absolute;top:88px;left:22px;right:22px;bottom:104px;display:grid;grid-template-columns:1fr 224px;gap:14px}
#ui-overlay .uvp .grid{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:9px}
#ui-overlay .uvp .card{position:relative;border:1px solid #1c1f18;background:linear-gradient(180deg,#0b0c09,#070806);padding:9px 11px;overflow:hidden;cursor:pointer}
#ui-overlay .uvp .card .no{position:absolute;right:8px;top:6px;font-family:"Anton";font-size:26px;color:#15170f;line-height:1}
#ui-overlay .uvp .card .nm{font-family:"Anton";font-size:19px;text-transform:uppercase;letter-spacing:.01em;line-height:1;color:#fff}
#ui-overlay .uvp .card .gn{font-family:"Space Mono",monospace;font-size:9px;letter-spacing:.22em;margin-top:5px;text-transform:uppercase}
#ui-overlay .uvp .card .wpn{font-size:11px;font-weight:500;color:var(--dim);margin-top:8px;text-transform:uppercase;letter-spacing:.04em}
#ui-overlay .uvp .card .sig{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.02em;margin-top:1px}
#ui-overlay .uvp .eq{position:absolute;left:11px;right:11px;bottom:9px;display:flex;gap:3px;align-items:flex-end;height:18px}
#ui-overlay .uvp .eq i{flex:1;background:#1a1d14;position:relative;height:100%}
#ui-overlay .uvp .eq i span{position:absolute;left:0;right:0;bottom:0;display:block}
#ui-overlay .uvp .badge{position:absolute;left:8px;top:7px;width:18px;height:18px;border-radius:50%;display:none;align-items:center;justify-content:center;font-family:"Anton";font-size:11px;color:#050505}
#ui-overlay .uvp .card.inparty .badge{display:flex}
#ui-overlay .uvp .card.sel{border-color:var(--uv);box-shadow:0 0 0 1px var(--uv),inset 0 0 30px rgba(204,255,0,.08)}
#ui-overlay .uvp .card.sel .no{color:rgba(204,255,0,.18)}
#ui-overlay .uvp .card.lock,#ui-overlay .uvp .card.dead{opacity:.4;cursor:default}
#ui-overlay .uvp .card .lk{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:"Space Mono";font-size:10px;letter-spacing:.2em;color:var(--cyan)}
#ui-overlay .uvp .card.dead .lk{color:var(--mag)}
#ui-overlay .uvp .doss{border:1px solid #1c1f18;background:linear-gradient(180deg,#0a0b08,#060705);padding:14px 15px;display:flex;flex-direction:column;position:relative;overflow:hidden}
#ui-overlay .uvp .doss::before{content:"";position:absolute;right:-60px;bottom:-60px;width:180px;height:180px;border-radius:50%;border:1px solid rgba(255,45,149,.2)}
#ui-overlay .uvp .doss .tag{font-family:"Space Mono";font-size:9px;letter-spacing:.3em;color:var(--cyan)}
#ui-overlay .uvp .doss h2{font-family:"Anton";font-size:36px;text-transform:uppercase;line-height:.86;margin-top:7px;color:#fff}
#ui-overlay .uvp .doss .gn{font-family:"Space Mono";font-size:10px;letter-spacing:.24em;margin-top:7px;text-transform:uppercase}
#ui-overlay .uvp .doss .sigbox{margin-top:13px;border-left:3px solid var(--mag);padding:3px 0 3px 11px}
#ui-overlay .uvp .doss .sigbox small{font-family:"Space Mono";font-size:8px;letter-spacing:.2em;color:var(--dim);display:block}
#ui-overlay .uvp .doss .sigbox b{font-family:"Anton";font-size:20px;text-transform:uppercase;color:var(--mag);text-shadow:0 0 16px rgba(255,45,149,.5)}
#ui-overlay .uvp .doss .wbox{margin-top:10px;font-size:13px}
#ui-overlay .uvp .doss .wbox small{font-family:"Space Mono";font-size:8px;letter-spacing:.2em;color:var(--dim);display:block}
#ui-overlay .uvp .doss .wbox b{font-family:"Oswald";font-weight:600;font-size:16px;text-transform:uppercase;letter-spacing:.02em}
#ui-overlay .uvp .status{margin-top:10px;font-family:"Space Mono";font-size:9px;letter-spacing:.16em;text-transform:uppercase}
#ui-overlay .uvp .upg{margin-top:8px;font-family:"Space Mono";font-size:9px;letter-spacing:.18em;color:var(--cyan);cursor:pointer;text-transform:uppercase}
#ui-overlay .uvp .upg:hover{text-shadow:0 0 12px rgba(0,229,255,.7)}
#ui-overlay .uvp .dstats{margin-top:auto;display:flex;flex-direction:column;gap:6px}
#ui-overlay .uvp .ds{display:grid;grid-template-columns:30px 1fr 16px;gap:8px;align-items:center}
#ui-overlay .uvp .ds i{font-family:"Space Mono";font-style:normal;font-size:9px;color:var(--dim);letter-spacing:.06em}
#ui-overlay .uvp .ds .t{height:7px;background:#15170f;display:flex;gap:2px}
#ui-overlay .uvp .ds .t b{flex:1;background:#22261a}
#ui-overlay .uvp .ds .nn{font-family:"Anton";font-size:13px;text-align:right}
#ui-overlay .uvp footer{position:absolute;left:0;right:0;bottom:0;height:92px;border-top:2px solid var(--uv);background:#060604;display:grid;grid-template-rows:1fr 1fr}
#ui-overlay .uvp .conga{display:flex;align-items:center;padding:0 22px;border-bottom:1px solid #16180f;overflow:hidden}
#ui-overlay .uvp .clab{font-family:"Space Mono";font-size:9px;letter-spacing:.2em;color:var(--dim);margin-right:14px;white-space:nowrap}
#ui-overlay .uvp .chip{display:flex;align-items:center;gap:7px;padding:4px 10px;border:1px solid #1c1f18;margin-right:6px;white-space:nowrap}
#ui-overlay .uvp .chip .d{width:9px;height:9px;border-radius:50%}
#ui-overlay .uvp .chip b{font-family:"Oswald";font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.02em}
#ui-overlay .uvp .arr{color:#2a2d22;margin:0 2px}
#ui-overlay .uvp .start{margin-left:auto;font-family:"Anton";font-size:16px;text-transform:uppercase;letter-spacing:.04em;color:#050505;background:var(--uv);padding:7px 16px;white-space:nowrap;box-shadow:0 0 22px rgba(204,255,0,.45);cursor:pointer}
#ui-overlay .uvp .start.off{background:#2a2d22;color:#6f7566;box-shadow:none;cursor:default}
#ui-overlay .uvp .bgrow{display:flex;align-items:center;padding:0 22px;overflow:hidden}
#ui-overlay .uvp .bgs{display:flex;gap:17px;align-items:center}
#ui-overlay .uvp .bgs b{font-family:"Space Mono";font-size:11px;letter-spacing:.14em;color:#33372a;text-transform:uppercase;white-space:nowrap;cursor:pointer}
#ui-overlay .uvp .bgs b.on{color:var(--cyan);text-shadow:0 0 14px rgba(0,229,255,.6)}
#ui-overlay .uvp .modal{position:absolute;inset:0;background:rgba(2,3,1,.82);display:flex;align-items:center;justify-content:center;z-index:5}
#ui-overlay .uvp .mpanel{width:440px;border:1px solid var(--uv);background:#0a0b08;padding:18px 20px}
#ui-overlay .uvp .mpanel h3{font-family:"Anton";font-size:22px;text-transform:uppercase;color:#fff}
#ui-overlay .uvp .mpanel .cr{font-family:"Space Mono";font-size:11px;color:var(--uv);float:right;margin-top:6px}
#ui-overlay .uvp .urow{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;border-top:1px solid #16180f;padding:9px 0}
#ui-overlay .uvp .urow .un{font-weight:600;font-size:13px;text-transform:uppercase}
#ui-overlay .uvp .urow .ub{font-size:10px;color:var(--dim)}
#ui-overlay .uvp .urow .pip{font-family:"Space Mono";font-size:11px;color:var(--cyan);margin-right:10px}
#ui-overlay .uvp .urow .buy{font-family:"Space Mono";font-size:11px;letter-spacing:.08em;color:#050505;background:var(--uv);padding:4px 10px;cursor:pointer}
#ui-overlay .uvp .urow .buy.no{background:#2a2d22;color:#6f7566;cursor:default}
#ui-overlay .uvp .mclose{margin-top:14px;font-family:"Space Mono";font-size:10px;color:var(--dim);cursor:pointer;text-align:center}
`;

export function createPartySelectScene(ctx, input, seed, blob) {
  if (!document.getElementById("uvp-css")) {
    const s = document.createElement("style"); s.id = "uvp-css"; s.textContent = CSS;
    document.head.appendChild(s);
  }
  const roster = BALANCE.roster;
  const dead = new Set(blob.campaign.dead);
  const unlocked = (c) => isHeroUnlocked(blob, c.id);
  const isDead = (id) => dead.has(id);
  const isIn = (id) => party.includes(id);
  const canEnlist = (c) => unlocked(c) && !isDead(c.id) && !isIn(c.id);
  const wName = (h) => BALANCE.weapons[h.weaponId].name;
  const sName = (h) => (BALANCE.signatures[h.signatureId] || {}).name || "—";
  const accent = (h, sel) => (sel ? "#ccff00" : h.color);

  let party = blob.campaign.crew.slice();
  let sel = Math.max(0, roster.findIndex((c) => c.id === party[0]));
  let bgIndex = 0, modal = null, confirmed = false, armed = false;

  const root = document.createElement("div");
  root.className = "uvp";

  function cardHTML(h, i) {
    const slot = party.indexOf(h.id), lk = !unlocked(h), dd = isDead(h.id), a = accent(h, i === sel);
    const cls = ["card", i === sel ? "sel" : "", slot >= 0 ? "inparty" : "", lk ? "lock" : "", dd ? "dead" : ""].join(" ");
    const eq = STATS.map(([, k]) => `<i><span style="height:${h.stats[k] / 10 * 100}%;background:${a}"></span></i>`).join("");
    const veil = dd ? `<div class="lk">✝ FELL</div>` : lk ? `<div class="lk">⟳ RUN ${h.unlockAtRuns}</div>` : "";
    return `<div class="${cls}" data-i="${i}">
      <div class="badge" style="background:${a}">${slot >= 0 ? slot + 1 : ""}</div>
      <div class="no">${String(i + 1).padStart(2, "0")}</div>
      <div class="nm">${h.name}</div>
      <div class="gn" style="color:${h.color}">${h.genre}</div>
      <div class="wpn">${wName(h)}</div>
      <div class="sig" style="color:${a}">✦ ${sName(h)}</div>
      <div class="eq">${eq}</div>${veil}</div>`;
  }

  function dossHTML() {
    const h = roster[sel], slot = party.indexOf(h.id);
    const bars = STATS.map(([lab, k]) =>
      `<div class="ds"><i>${lab}</i><div class="t">${Array.from({ length: 10 }, (_, j) =>
        `<b style="${j < h.stats[k] ? `background:${h.color};box-shadow:0 0 6px ${h.color}` : ""}"></b>`).join("")}</div><div class="nn">${h.stats[k]}</div></div>`).join("");
    let status, scol;
    if (isDead(h.id)) { status = "✝ fell — gone for good"; scol = "var(--mag)"; }
    else if (!unlocked(h)) { status = `locked · unlocks run ${h.unlockAtRuns}`; scol = "var(--dim)"; }
    else if (slot === 0) { status = "on the walk · head"; scol = "var(--uv)"; }
    else if (slot > 0) { status = `on the walk · slot ${slot + 1} — click to lead`; scol = "var(--uv)"; }
    else { status = "reserve — click to enlist"; scol = "var(--cyan)"; }
    const upg = (unlocked(h) && UPGRADES[h.id]) ? `<div class="upg" data-upg>▸ upgrades (${blob.credits} cr)</div>` : "";
    return `<div class="tag">SELECTED · UNIT ${String(sel + 1).padStart(2, "0")}</div>
      <h2>${h.name}</h2>
      <div class="gn" style="color:${h.color}">${h.genre}${slot >= 0 ? " · SLOT " + (slot + 1) : ""}</div>
      <div class="sigbox"><small>SIGNATURE</small><b>${sName(h)}</b></div>
      <div class="wbox"><small>WEAPON</small><b>${wName(h)}</b></div>
      <div class="status" style="color:${scol}">${status}</div>${upg}
      <div class="dstats">${bars}</div>`;
  }

  function congaHTML() {
    const chips = party.map((id, o) => {
      const x = roster.find((c) => c.id === id);
      const arr = o < party.length - 1 ? '<span class="arr">▸</span>' : "";
      return `<div class="chip"><span class="d" style="background:${x.color};box-shadow:0 0 8px ${x.color}"></span><b>${x.name}</b></div>${arr}`;
    }).join("");
    const off = party.length ? "" : " off";
    return `<span class="clab">CONGA ▸ HEAD→TAIL</span>${chips}<div class="start${off}" data-start>▶ START THE WALK [${party.length}]</div>`;
  }

  function modalHTML() {
    if (!modal) return "";
    const h = roster.find((c) => c.id === modal), tree = UPGRADES[h.id] || {};
    const rows = Object.entries(tree).map(([id, def]) => {
      const rank = upgradeRank(blob, h.id, id), cost = nextCost(blob, h.id, id);
      const pips = "●".repeat(rank) + "○".repeat(def.maxRank - rank);
      const can = cost !== null && blob.credits >= cost;
      const btn = cost === null ? `<span class="buy no">MAX</span>` : `<span class="buy${can ? "" : " no"}" data-buy="${id}">${cost} cr</span>`;
      return `<div class="urow"><div><div class="un">${def.name}</div><div class="ub">${def.blurb}</div></div><div><span class="pip">${pips}</span>${btn}</div></div>`;
    }).join("");
    return `<div class="modal" data-closebg><div class="mpanel"><span class="cr">${blob.credits} cr</span><h3>${h.name}</h3>${rows}<div class="mclose" data-closemodal>U / Esc / click out to close</div></div></div>`;
  }

  function render() {
    const unlockedN = roster.filter(unlocked).length;
    root.innerHTML = `<div class="ring"></div><div class="ring b"></div>
      <header><div class="title">SELECT <em>YOUR</em> CREW<small>MERRITON HIGH · DAY ${blob.campaign.day} · 3:00 PM</small></div>
        <div class="rhead">ROSTER <b>0${roster.length}</b><br>CREW <b>${String(party.length).padStart(2, "0")}</b><br>FALLEN <b>${String(dead.size).padStart(2, "0")}</b></div></header>
      <div class="body"><div class="grid">${roster.map(cardHTML).join("")}</div><div class="doss">${dossHTML()}</div></div>
      <footer><div class="conga">${congaHTML()}</div>
        <div class="bgrow"><span class="clab">VOID FEED</span><div class="bgs">${VOID_BACKGROUNDS.map((b, i) => `<b class="${i === bgIndex ? "on" : ""}" data-bg="${i}">${i === bgIndex ? "◉ " : ""}${b.name}</b>`).join("")}</div></div></footer>
      ${modalHTML()}`;
  }

  function act(i) {
    const c = roster[i]; sel = i;
    if (isDead(c.id) || !unlocked(c)) { render(); return; } // dead/locked: inspect only
    const at = party.indexOf(c.id);
    if (at > 0) { party.splice(at, 1); party.unshift(c.id); sfx.play("uiSelect"); }       // promote to head
    else if (at < 0 && canEnlist(c)) { party.push(c.id); sfx.play("uiSelect"); }           // enlist a reserve
    render();
  }
  function buy(id) { blob = save(purchaseUpgrade(blob, modal, id)); sfx.play("uiSelect"); render(); }
  function startWalk() {
    if (!party.length) return;
    blob.campaign.crew = party.slice(); save(blob);
    teardown(); confirmed = true; sfx.play("uiSelect");
  }

  // --- input: pointer (delegated) + keyboard ---
  root.addEventListener("mouseover", (e) => {
    const card = e.target.closest("[data-i]"); if (!card) return;
    const i = +card.dataset.i; if (i !== sel) { sel = i; sfx.play("uiMove"); render(); }
  });
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-start]")) return startWalk();
    if (e.target.closest("[data-upg]")) { modal = roster[sel].id; sfx.play("uiSelect"); return render(); }
    if (e.target.closest("[data-buy]")) return buy(e.target.closest("[data-buy]").dataset.buy);
    if (e.target.closest("[data-closemodal]")) { modal = null; sfx.play("uiBack"); return render(); }
    const bg = e.target.closest("[data-bg]"); if (bg) { bgIndex = +bg.dataset.bg; sfx.play("uiMove"); return render(); }
    if (e.target.closest("[data-closebg]") && !e.target.closest(".mpanel")) { modal = null; return render(); }
    const card = e.target.closest("[data-i]"); if (card) return act(+card.dataset.i);
  });

  const onKey = (e) => {
    if (modal) { if (e.code === "Escape" || e.code === "KeyU") { modal = null; render(); }
      else { const n = "Digit1Digit2Digit3Digit4".indexOf(e.code); if (n >= 0) { const ids = Object.keys(UPGRADES[modal] || {}); if (ids[n / 5]) buy(ids[n / 5]); } }
      return; }
    const col = sel % 3, row = (sel / 3) | 0;
    if (e.code === "ArrowRight") { sel = row * 3 + (col + 1) % 3; render(); }
    else if (e.code === "ArrowLeft") { sel = row * 3 + (col + 2) % 3; render(); }
    else if (e.code === "ArrowDown") { sel = (sel + 3) % roster.length; render(); }
    else if (e.code === "ArrowUp") { sel = (sel + roster.length - 3) % roster.length; render(); }
    else if (e.code === "Enter") act(sel);
    else if (e.code === "KeyU" && unlocked(roster[sel]) && UPGRADES[roster[sel].id]) { modal = roster[sel].id; render(); }
    else if (e.code === "Space") { if (armed) startWalk(); }
  };
  const onKeyUp = (e) => { if (e.code === "Space" || e.code === "Enter") armed = true; };
  addEventListener("keydown", onKey);
  addEventListener("keyup", onKeyUp);
  setTimeout(() => (armed = true), 160); // ignore a held confirm carried in from the prior screen
  function teardown() { removeEventListener("keydown", onKey); removeEventListener("keyup", onKeyUp); }

  render();
  mountOverlay(root);

  return {
    update() {}, render() {},
    get done() { return confirmed; },
    get party() { return party.slice(); },
    get bgId() { return VOID_BACKGROUNDS[bgIndex].id; },
    seed,
  };
}
