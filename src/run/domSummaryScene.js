// Post-run summary — the approved MSN/BUDDY comp (art-test/msn-mock/final-comp.html) ported
// to a live DOM-overlay scene. Same return contract as the old canvas summary so main.js is
// unchanged: { update, render, done, wipe, nextSeed, bgId }. It commits the run once on enter
// (bank payout, cull the fallen from the crew, advance the day or flag a wipe) and folds the
// between-days tally into the chat log here, so there's no separate META scene.
//
// Buddy list = the roster's status: alive heroes Online (crew + reserves), the fallen Offline
// with ✝, locked heroes Offline. Chat copy is result-aware, pulled from summaryCopy.js.
import { BALANCE } from "./balance.js";
import { load, save, recordRun, computePayout, applyRunDeaths, isWipe, advanceDay, isHeroUnlocked } from "../meta/save.js";
import { summaryCopy as C } from "./summaryCopy.js";
import { mountOverlay } from "../ui/overlay.js";
import { sfx } from "../audio/sfx.js";

const pick = (a) => a[(Math.random() * a.length) | 0];
const fill = (s, p) => s.replace(/\{(\w+)\}/g, (_, k) => p[k] ?? "");
const handle = (id) => C.handles[id] || id;
const nameOf = (id) => (BALANCE.roster.find((c) => c.id === id) || {}).name || id;

// The run totals no longer live in the chat — they pop as a garish early-2000s ad window over the
// desktop. One template is picked at random per run so colors / copy vary. The two numbers that
// matter are money gained + enemies destroyed (the big `ad-stat` blocks); distance/day are fluff
// in the headline/footer. No call-to-action button. Each `body`/`foot` takes {dist,kills,cash,day,won}.
// Exported so the layout-proxy tool (art-test/popup-layout.html) renders the real templates.
const adStat = (num, cap) => `<div class="ad-stat"><div class="ad-num">${num}</div><div class="ad-cap">${cap}</div></div>`;
const adStats = (...cells) => `<div class="ad-stats">${cells.join("")}</div>`;
export const POPUPS = [
  { cls: "prize", icon: "★", title: "★ CONGRATULATIONS!!! ★",
    vars: "--ad-bg:#fffdf0;--ad-edge:#d4a017;--ad-tb:linear-gradient(#f7b500,#c8860a);--ad-ink:#6a4a00;--ad-hl:#b8000f;--ad-pop:#cf8a00",
    body: (s) => `<div class="ad-h"><span class="ad-blink">YOU WON</span> day ${s.day}'s grand prize!</div>`
      + adStats(adStat(`$${s.cash}`, "lunch money"), adStat(s.kills, "enemies KO'd")),
    foot: (s) => `*${s.dist}m walked. Merriton residents only. No purchase necessary.` },
  { cls: "virus", icon: "⚠", title: "SystemSecurity 2003 — Alert",
    vars: "--ad-bg:#fff8e1;--ad-edge:#c01010;--ad-tb:linear-gradient(#d83232,#9c0c0c);--ad-ink:#5a1010;--ad-hl:#c01010;--ad-pop:#0a7d2c",
    body: (s) => `<div class="ad-h">⚠ <span class="ad-blink">WALK-HOME SCAN COMPLETE</span> ⚠</div>`
      + adStats(adStat(s.kills, "threats removed"), adStat(`$${s.cash}`, "$ recovered")),
    foot: (s) => `Day ${s.day} · exposed for ${s.dist}m. Not a real antivirus.` },
  { cls: "offer", icon: "🌐", title: "Special Offer — before you go!",
    vars: "--ad-bg:#f0f8ff;--ad-edge:#1f6ff0;--ad-tb:linear-gradient(#2f86f5,#0a52d6);--ad-ink:#1a3a6a;--ad-hl:#0a3aa0;--ad-pop:#ff8a00",
    body: (s) => `<div class="ad-h">Did you know you cleared <b>THIS</b> much today?</div>`
      + adStats(adStat(s.kills, "obstacles cleared"), adStat(`$${s.cash}`, "cash earned")),
    foot: (s) => `Day ${s.day} · ${s.dist}m traveled. Ask about a faster route!` },
  { cls: "cash", icon: "💲", title: "Rates are at HISTORIC lows!",
    vars: "--ad-bg:#f3fbf3;--ad-edge:#1f9a2f;--ad-tb:linear-gradient(#3bbf4a,#138a22);--ad-ink:#13491e;--ad-hl:#0a7d2c;--ad-pop:#138a22",
    body: (s) => `<div class="ad-h">Your walk home <b>PAID OFF</b>!</div>`
      + adStats(adStat(`$${s.cash}`, "cash back"), adStat(s.kills, "flattened")),
    foot: (s) => `Day ${s.day}. Offer void where the dark catches you.` },
];

// Exported so the layout-proxy tool (art-test/popup-layout.html) can render the real desktop + ad.
export const CSS = `
#ui-overlay .msn{width:800px;height:600px;position:relative;overflow:hidden;font:11px "Tahoma","Segoe UI",sans-serif;color:#000;cursor:pointer;
  background:radial-gradient(120% 70% at 50% 118%,#6aa12e 0%,#5c9a2b 18%,transparent 40%),radial-gradient(80% 38% at 30% 92%,#8cc63f 0%,transparent 55%),linear-gradient(#2f7bd6 0%,#4f9ae6 26%,#8fcdf2 46%,#bfe3c0 56%,#7cb342 64%,#5a9e2f 100%)}
#ui-overlay .msn *{box-sizing:border-box;margin:0;padding:0}
#ui-overlay .msn .iconfield{position:absolute;left:4px;top:3px;width:277px;height:564px;overflow:hidden;display:grid;grid-template-columns:repeat(3,86px);grid-auto-rows:78px;gap:4px;z-index:1}
#ui-overlay .msn .ic{width:84px;text-align:center;color:#fff;padding:4px 2px;text-shadow:0 1px 2px rgba(0,0,0,.85)}
#ui-overlay .msn .ic .g{font-size:30px;line-height:1}
#ui-overlay .msn .ic .l{display:block;margin-top:3px;font-size:11px;line-height:1.15}
#ui-overlay .msn .win{position:absolute;background:#ece9d8;border:1px solid #0049b0;border-radius:7px 7px 0 0;display:flex;flex-direction:column;z-index:5;overflow:hidden}
#ui-overlay .msn .tb{background:linear-gradient(#0058e6,#3a93ff 8%,#2f86f5 46%,#0a52d6);color:#fff;font-weight:bold;padding:4px 5px 5px;display:flex;align-items:center;gap:6px;text-shadow:0 1px 1px #003}
#ui-overlay .msn .tb .ti{width:15px;height:15px;border-radius:3px;display:grid;place-items:center;font-size:11px}
#ui-overlay .msn .tb .t{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ui-overlay .msn .tb .ctrls{display:flex;gap:2px}
#ui-overlay .msn .tb .cb{width:21px;height:18px;border-radius:3px;border:1px solid #fff;background:linear-gradient(#7db4ff,#2f86f5 60%,#1f6ff0);color:#fff;text-align:center;line-height:15px;font:bold 11px Tahoma}
#ui-overlay .msn .tb .cb.x{background:linear-gradient(#ff9d8c,#e8492c 55%,#c9341a)}
#ui-overlay .msn .mbar{display:flex;gap:13px;padding:2px 9px;background:#ece9d8;border-bottom:1px solid #aca899;font-size:11px}
#ui-overlay .msn .cvbar{display:flex;align-items:flex-end;gap:2px;padding:4px 6px 3px;background:linear-gradient(#eef4fb,#cdd9ec);border-bottom:1px solid #9fb3d0}
#ui-overlay .msn .cvbar .ab{display:flex;flex-direction:column;align-items:center;gap:1px;padding:2px 7px;border-radius:4px;color:#234;font-size:10px}
#ui-overlay .msn .cvbar .ab .g{font-size:17px;line-height:1}
#ui-overlay .msn .cvbar .sp{flex:1}
#ui-overlay .msn .cvbar .logo{font:italic bold 14px Tahoma;color:#1f6ff0;padding-right:4px}
#ui-overlay .msn .cvbar .logo b{color:#ff8a00;font-style:normal}
#ui-overlay .msn .cvbody{display:flex;background:#fff;flex:1;min-height:0}
#ui-overlay .msn .cvmain{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
#ui-overlay .msn .toline{padding:5px 9px;border-bottom:1px solid #e3ecff;color:#333}
#ui-overlay .msn .toline b{color:#0a2c6e}
#ui-overlay .msn .infobar{display:flex;gap:6px;padding:5px 9px;background:#fffbe0;border-bottom:1px solid #efe3a0;color:#5a4a1a}
#ui-overlay .msn .safety{display:flex;gap:6px;padding:5px 9px;color:#7a8aa8;border-bottom:1px solid #eef2f8}
#ui-overlay .msn .log{flex:1;overflow:auto;padding:9px 11px;background:#fff;background-image:repeating-linear-gradient(#fff,#fff 21px,#fbfdff 21px,#fbfdff 42px)}
#ui-overlay .msn .line{margin:0 0 6px;line-height:1.45}
#ui-overlay .msn .nk{font-weight:bold}
#ui-overlay .msn .nk.them{color:#c0392b}
#ui-overlay .msn .sys{color:#6a7894;font-style:italic}
#ui-overlay .msn .sys b{color:#0a7d2c;font-style:normal}
#ui-overlay .msn .sys.fell b{color:#a33}
#ui-overlay .msn .wink{color:#9a7;font-style:italic}
#ui-overlay .msn .cvdps{width:78px;flex:0 0 auto;border-left:1px solid #e3ecff;display:flex;flex-direction:column;align-items:center;gap:8px;padding:9px 0;background:#f7faff}
#ui-overlay .msn .cvdps .d{width:62px;height:62px;border:3px solid #b9c9ee;border-radius:3px;display:grid;place-items:center;font-size:30px;background:#eef}
#ui-overlay .msn .cvdps .d.you{background:#fdeef6}
#ui-overlay .msn .cvfmt{display:flex;align-items:center;gap:10px;padding:4px 9px;background:#ece9d8;border-top:1px solid #aca899;border-bottom:1px solid #fff;color:#0046b8;font-weight:bold}
#ui-overlay .msn .cvfmt .em{font-weight:normal}
#ui-overlay .msn .cvfmt .vc{color:#c0392b}
#ui-overlay .msn .cventry{display:flex;gap:6px;padding:6px;background:#ece9d8}
#ui-overlay .msn .cventry .box{flex:1;height:50px;border:1px solid #9db4dd;border-radius:2px;padding:6px;background:#fff;color:#333}
#ui-overlay .msn .cventry .sendbig{width:84px;border:1px solid #7a96c8;border-radius:3px;background:linear-gradient(#fbfdff,#dbe7ff 55%,#c2d6f6);display:grid;place-items:center;font-weight:bold;color:#33507a}
#ui-overlay .msn .self{display:flex;gap:8px;padding:8px;background:linear-gradient(#eaf2ff,#d3e3ff);border-bottom:1px solid #aac;align-items:center}
#ui-overlay .msn .self .dp{width:42px;height:42px;border-radius:3px;border:2px solid #9db4dd;background:#eef;display:grid;place-items:center;font-size:22px}
#ui-overlay .msn .self .nm b{color:#0a2c6e}
#ui-overlay .msn .self .nm small{display:block;color:#5a7;font-style:italic}
#ui-overlay .msn .self .bfly{margin-left:auto;font-size:18px}
#ui-overlay .msn .adlink{padding:6px 9px;color:#1f6ff0;text-decoration:underline;font-size:11px;background:#fff;border-bottom:1px solid #eef;line-height:1.3}
#ui-overlay .msn .clbody{background:#fff;flex:1;overflow:auto;padding:4px 0}
#ui-overlay .msn .grp{padding:3px 8px;font-weight:bold;color:#0046b8}
#ui-overlay .msn .grp:before{content:"▾ ";color:#888}
#ui-overlay .msn .bud{display:flex;align-items:center;gap:7px;padding:3px 8px 3px 18px}
#ui-overlay .msn .bud .st{width:13px;text-align:center}
#ui-overlay .msn .bud.on .st{color:#3a9a2f}
#ui-overlay .msn .bud.away .st{color:#d99a00}
#ui-overlay .msn .bud.off .st{color:#9aa}
#ui-overlay .msn .bud.off .nm{color:#9aa}
#ui-overlay .msn .bud.dead .st{color:#a55}
#ui-overlay .msn .bud.dead .nm{color:#a77;font-style:italic}
#ui-overlay .msn .bud .nm small{color:#8a98b0;font-style:italic}
#ui-overlay .msn .clmark{display:flex;align-items:center;justify-content:center;gap:5px;padding:7px;background:linear-gradient(#f3f7ff,#e2ebfa);border-top:1px solid #cdd9ec;font:italic bold 14px Tahoma;color:#1f6ff0}
#ui-overlay .msn .clmark b{color:#ff8a00;font-style:normal}
#ui-overlay .msn .clmark small{color:#8a98b0;font:normal 9px Tahoma}
#ui-overlay .msn .taskbar{position:absolute;left:0;right:0;bottom:0;height:30px;background:linear-gradient(#3168d5 0%,#4993e6 8%,#2f86f5 40%,#2a7bef 88%,#1c52c4);display:flex;align-items:center;z-index:8}
#ui-overlay .msn .start{height:30px;padding:0 16px 2px 10px;display:flex;align-items:center;gap:6px;background:radial-gradient(120% 140% at 30% 30%,#7ec850,#4faf37 45%,#2f8a22);color:#fff;font:italic bold 14px Tahoma;border-radius:0 11px 11px 0;text-shadow:0 1px 2px #1a4a0a}
#ui-overlay .msn .start .o{font-style:normal}
#ui-overlay .msn .tasks{display:flex;gap:4px;padding:0 6px;flex:1;overflow:hidden}
#ui-overlay .msn .tk{height:22px;padding:0 9px;display:flex;align-items:center;gap:5px;max-width:170px;background:linear-gradient(#5ba0ee,#2f7bef);color:#fff;border:1px solid #2a66c8;border-radius:3px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ui-overlay .msn .tk.active{background:linear-gradient(#1f5fc8,#3a86ef)}
#ui-overlay .msn .tray{display:flex;align-items:center;gap:7px;height:22px;padding:0 8px;margin-left:auto;background:linear-gradient(#1f63cf,#3a8bf0 40%,#2f86f5);color:#fff;font-size:11px}
#ui-overlay .msn .tray .clock{font-weight:bold}
#ui-overlay .msn .hint{position:absolute;left:50%;bottom:36px;transform:translateX(-50%);background:rgba(0,0,0,.7);color:#cfe0ff;padding:4px 12px;border-radius:11px;font-size:11px;letter-spacing:.04em;white-space:nowrap;z-index:9}
/* the sketchy run-totals popup — a garish early-2000s ad window. Two numbers matter (money
   gained + enemies destroyed); everything else is fluff. --ad-s = resting scale (baked from the
   layout proxy); the pop-in animates around it so there's no scale snap. */
#ui-overlay .msn .adpop{position:absolute;width:320px;z-index:12;--ad-s:1;border:2px solid var(--ad-edge);border-radius:3px;background:var(--ad-bg);
  box-shadow:0 8px 24px rgba(0,0,0,.5),0 0 0 1px #fff inset;font-family:"Tahoma","Segoe UI",sans-serif;
  transform-origin:0 0;transform:scale(var(--ad-s));animation:adPop .34s cubic-bezier(.2,1.5,.4,1)}
#ui-overlay .msn .adpop.out{animation:adOut .22s ease forwards}
#ui-overlay .msn .adpop .ad-tb{display:flex;align-items:center;gap:5px;padding:3px 4px;background:var(--ad-tb);color:#fff;font:bold 11px Tahoma;text-shadow:0 1px 1px rgba(0,0,0,.5)}
#ui-overlay .msn .adpop .ad-ti{font-size:12px;line-height:1}
#ui-overlay .msn .adpop .ad-t{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ui-overlay .msn .adpop .ad-x{width:18px;height:16px;border:1px solid #fff;border-radius:2px;display:grid;place-items:center;background:rgba(255,255,255,.25);cursor:pointer;animation:adJit 1.8s ease-in-out infinite}
#ui-overlay .msn .adpop .ad-x:hover{background:rgba(255,255,255,.5)}
#ui-overlay .msn .adpop .ad-body{padding:8px 12px 5px;text-align:center;color:var(--ad-ink)}
#ui-overlay .msn .adpop .ad-h{font:bold 13px Tahoma;line-height:1.15;color:var(--ad-hl)}
#ui-overlay .msn .adpop .ad-h b{color:var(--ad-pop)}
#ui-overlay .msn .adpop .ad-stats{display:flex;gap:8px;justify-content:center;margin-top:6px}
#ui-overlay .msn .adpop .ad-stat{flex:1;background:rgba(255,255,255,.5);border:1px solid var(--ad-edge);border-radius:4px;padding:4px 2px 3px}
#ui-overlay .msn .adpop .ad-num{font:italic bold 25px Georgia,serif;color:var(--ad-pop);line-height:1;text-shadow:1px 1px 0 #fff}
#ui-overlay .msn .adpop .ad-cap{font-size:9px;text-transform:uppercase;letter-spacing:.03em;opacity:.85;margin-top:3px}
#ui-overlay .msn .adpop .ad-foot{padding:4px 12px 7px;font-size:9px;opacity:.6;text-align:center;line-height:1.25}
#ui-overlay .msn .adpop .ad-blink{animation:adBlink .8s steps(1) infinite}
@keyframes adPop{0%{transform:scale(calc(var(--ad-s)*.55));opacity:0}70%{transform:scale(calc(var(--ad-s)*1.06))}100%{transform:scale(var(--ad-s));opacity:1}}
@keyframes adOut{to{transform:scale(calc(var(--ad-s)*.6));opacity:0}}
@keyframes adJit{0%,90%,100%{transform:translate(0,0)}93%{transform:translate(-1px,1px)}96%{transform:translate(1px,-1px)}98%{transform:translate(-1px,0)}}
@keyframes adBlink{50%{opacity:.15}}
`;

const ICONS = [["🖥️","My Computer"],["🗑️","Recycle Bin"],["📂","My Documents"],["🪟","Internet Explorer"],
  ["💾","Local Disk (C:)"],["🐸","LimeWire"],["🎵","Winamp"],["🗒️","diary.txt"],["🔑","passwords.txt"],
  ["🎮","runescape.lnk"],["💑","me_n_jess.jpg"],["🎧","My Music"]];

export function createSummaryScene(ctx, input, result, nextSeed, bgId) {
  // Commit-once on enter: bank payout + bump runCount/unlocks, cull the fallen, advance the
  // day unless that wiped the crew. Deltas/day come off the pre-commit blob.
  const before = load();
  const payout = computePayout(result);
  let blob = applyRunDeaths(recordRun(before, result), result.died || []);
  const wipe = isWipe(blob);
  if (!wipe) blob = advanceDay(blob);
  const after = save(blob);

  const roster = BALANCE.roster;
  const headId = result.heroId;
  const newUnlocks = after.unlockedHeroes.filter((id) => !before.unlockedHeroes.includes(id)); // heroes who "sign in" this run
  const dist = Math.round(result.distanceFraction * 1200);
  const day = before.campaign.day;
  const justFell = new Set(result.died || []);
  const family = C.causeFamily[result.cause] || (result.cause ? "enemy" : "generic");
  const band = result.distanceFraction < 0.25 ? "barely" : result.distanceFraction < 0.75 ? "halfway" : "soClose";

  if (!document.getElementById("msn-css")) {
    const s = document.createElement("style"); s.id = "msn-css"; s.textContent = CSS; document.head.appendChild(s);
  }

  // --- chat log lines (the crew group chat: totals land, the fallen go offline, newly-met
  // survivors sign in, then the surviving crew check in). No placeholder partner. ---
  // Events: 'sys' status lines pop in whole; 'msg' buddy lines show the handle, then type out.
  const events = [];
  const sys = (html, cls = "") => events.push({ kind: "sys", html: `<p class="line"><span class="sys ${cls}">${html}</span></p>` });
  const says = (id, msg) => { const c = roster.find((x) => x.id === id) || {}; events.push({ kind: "msg", prefix: `<span class="nk" style="color:${c.color || "#c0392b"}">${handle(id)}</span> says: `, body: msg }); };
  // Totals (distance/kills/cash/day) are no longer chat lines — they pop as the ad below.
  // The chat keeps only the human content: the bell, the fallen, sign-ins, crew check-ins.
  sys(`———  <b>3:00 PM. the bell rang.</b>  ———`);
  for (const id of justFell) sys(fill(pick(C.heroFell), { handle: handle(id) }), "fell");
  for (const id of newUnlocks) { sys(fill(C.system.addedToConvo, { handle: handle(id) })); says(id, pick(C.joined)); } // a new survivor comes in
  for (const id of (result.survived || [])) says(id, pick(C.crewCheckIn)); // the crew check in, in conga order

  const reflection = result.won ? pick(C.won) : pick(C.lost[family]);
  const milestone = result.won ? "" : "  " + C.distanceMilestone[band];
  const selfMsg = pick(result.won ? C.selfStatus.won : C.selfStatus.lost);

  // --- buddy list (roster status) ---
  const bud = (h, cls, st, small) =>
    `<div class="bud ${cls}"><span class="st">${st}</span><span class="nm">${handle(h.id)} <small>${small}</small></span></div>`;
  const online = [], offline = [];
  for (const h of roster) {
    const dead = after.campaign.dead.includes(h.id);
    const crew = after.campaign.crew.includes(h.id);
    const unlk = isHeroUnlocked(after, h.id);
    if (dead) offline.push(bud(h, "dead", "✝", justFell.has(h.id) ? "just went offline" : "last seen 3:00 PM"));
    else if (crew) online.push(bud(h, "on", "●", "on the walk home"));
    else if (unlk) online.push(bud(h, "away", "●", "(Away) — in reserve"));
    else offline.push(bud(h, "off", "○", "(Offline)"));
  }

  const root = document.createElement("div");
  root.className = "msn";
  root.innerHTML = `
    <div class="iconfield">${ICONS.map(([g, l]) => `<div class="ic"><span class="g">${g}</span><span class="l">${l}</span></div>`).join("")}</div>
    <div class="win" style="left:32px;top:25px;width:487px;height:500px">
      <div class="tb"><span class="ti" style="background:#fff">👋</span><span class="t">the walk home — Group</span>
        <span class="ctrls"><span class="cb">_</span><span class="cb">□</span><span class="cb x">×</span></span></div>
      <div class="cvbar"><div class="ab"><span class="g">✉️</span>Invite</div><div class="ab"><span class="g">📁</span>Send Files</div>
        <div class="ab"><span class="g">🎙️</span>Voice</div><div class="ab"><span class="g">🎲</span>Activities</div><div class="ab"><span class="g">🎮</span>Games</div>
        <span class="sp"></span><span class="logo"><b>BUDDY</b>👋</span></div>
      <div class="cvbody"><div class="cvmain">
        <div class="toline">To: <b>the walk home</b> &lt;merriton_high_survivors@hotmail.com&gt;</div>
        <div class="infobar"><span>ⓘ</span><span>some of the crew might not reply right away — they're still walking home.</span></div>
        <div class="safety"><span>🔑</span><span>Never tell anyone the way home, even if they say they're your friend.</span></div>
        <div class="log"></div>${/* filled in progressively by step() */ ""}
      </div><div class="cvdps"><div class="d">🎧</div><div class="d you">🙂</div></div></div>
      <div class="cvfmt"><span class="em">A</span><span class="em">😊</span><span class="vc">🎤 Voice Clip</span><span class="em">🎁</span><span class="em">〰️</span></div>
      <div class="cventry"><div class="box">${reflection}${milestone}</div><div class="sendbig">Send</div></div>
    </div>
    <div class="win" style="left:559px;top:13px;width:234px;height:537px">
      <div class="tb"><span class="ti" style="background:#fff">👋</span><span class="t">BUDDY</span>
        <span class="ctrls"><span class="cb">_</span><span class="cb">□</span><span class="cb x">×</span></span></div>
      <div class="mbar"><span><u>F</u>ile</span><span><u>C</u>ontacts</span><span><u>A</u>ctions</span><span><u>T</u>ools</span><span><u>H</u>elp</span></div>
      <div class="self"><div class="dp">🙂</div><div class="nm"><b>${handle(headId)} (Online) ▾</b><small>${selfMsg}</small></div><span class="bfly">👋</span></div>
      <div class="adlink">Click here to learn about the Merriton High Attendance Improvement Program.</div>
      <div class="clbody">
        <div class="grp">Online (${online.length})</div>${online.join("")}
        <div class="grp">Offline (${offline.length})</div>${offline.join("")}
      </div>
      <div class="clmark"><b>BUDDY</b>👋 <small>a Mesa product</small></div>
    </div>
    <div class="taskbar"><div class="start"><span class="o">⊞</span> start</div>
      <div class="tasks"><div class="tk">👋 BUDDY</div><div class="tk active">👋 the walk home — Group</div></div>
      <div class="tray"><span>🔊</span><span>👋</span><span class="clock">3:00 PM</span></div></div>
    <div class="hint">▸ click / SPACE — ${wipe ? "…" : result.won ? "head to tomorrow" : "try another day"}</div>`;

  let armed = false, done = false;
  mountOverlay(root);

  // The run-totals ad: pops over the desktop a beat after the chat opens. Any click on it (the
  // tiny ×, the CTA, the body) dismisses it — same skippable contract as the rest of the scene.
  const stats = { dist: dist.toLocaleString(), kills: result.kills, cash: result.cashDiscarded || 0, day, won: result.won };
  const ad = pick(POPUPS); // template colors/copy vary per run; geometry jitters a touch around the
  const rand = (a, b) => a + Math.random() * (b - a); // proxy-tuned anchor (187/8, scale .72) for funsies
  const adL = Math.round(187 + rand(-16, 16)), adT = Math.round(8 + rand(-5, 11));
  const adS = (0.72 * rand(0.94, 1.08)).toFixed(3), adRad = Math.round(rand(1, 7));
  const popEl = document.createElement("div");
  popEl.className = `adpop ${ad.cls}`;
  popEl.setAttribute("style", `${ad.vars};left:${adL}px;top:${adT}px;--ad-s:${adS};border-radius:${adRad}px`);
  popEl.innerHTML = `
    <div class="ad-tb"><span class="ad-ti">${ad.icon}</span><span class="ad-t">${ad.title}</span><span class="ad-x">×</span></div>
    <div class="ad-body">${ad.body(stats)}</div>
    <div class="ad-foot">${ad.foot(stats)}</div>`;
  let popTimer = setTimeout(() => { root.appendChild(popEl); sfx.play("uiMove"); popTimer = null; }, 550);
  const closePopup = (e) => {
    if (e) e.stopPropagation();
    if (popTimer) { clearTimeout(popTimer); popTimer = null; return; }
    if (!popEl.isConnected || popEl.classList.contains("out")) return;
    popEl.classList.add("out"); sfx.play("uiSelect");
    setTimeout(() => popEl.remove(), 220);
  };
  popEl.addEventListener("click", closePopup);

  // Progressive reveal driven by the loop: status lines pop, buddy messages type out fast.
  // The crew comes in one after another like a real IM thread. One input skips it all.
  const logEl = root.querySelector(".log");
  const hintEl = root.querySelector(".hint");
  const CPS = 62, MSG_GAP = 0.3, SYS_GAP = 0.38; // chars/sec, post-message + post-status pauses
  const finishHint = `▸ click / SPACE — ${wipe ? "…" : result.won ? "head to tomorrow" : "try another day"}`;
  let ei = 0, typing = null, pause = 0.4;
  const fullyShown = () => ei >= events.length && !typing;
  const bottom = () => (logEl.scrollTop = logEl.scrollHeight);
  function step(dt) {
    if (fullyShown()) return;
    if (typing) {                                  // mid-message: advance the cursor
      typing.pos += CPS * dt;
      const n = Math.min(typing.text.length, Math.floor(typing.pos));
      typing.span.textContent = typing.text.slice(0, n); bottom();
      if (n >= typing.text.length) { typing = null; pause = MSG_GAP; if (fullyShown()) hintEl.textContent = finishHint; }
      return;
    }
    if (pause > 0) { pause -= dt; return; }
    const ev = events[ei++];
    if (ev.kind === "sys") { logEl.insertAdjacentHTML("beforeend", ev.html); pause = SYS_GAP; bottom(); if (fullyShown()) hintEl.textContent = finishHint; }
    else { // buddy line: handle shows, body types
      logEl.insertAdjacentHTML("beforeend", `<p class="line">${ev.prefix}<span class="typed"></span></p>`);
      typing = { span: logEl.lastElementChild.querySelector(".typed"), text: ev.body, pos: 0 };
      sfx.play("uiMove"); bottom();
    }
  }
  function revealAll() {
    logEl.innerHTML = "";
    for (const ev of events) {
      if (ev.kind === "sys") logEl.insertAdjacentHTML("beforeend", ev.html);
      else { const p = document.createElement("p"); p.className = "line"; p.innerHTML = `${ev.prefix}<span class="typed"></span>`; p.querySelector(".typed").textContent = ev.body; logEl.appendChild(p); }
    }
    ei = events.length; typing = null; bottom(); hintEl.textContent = finishHint;
  }

  // First input skips to the full thread; a second advances.
  const finish = () => {
    if (done) return;
    if (!fullyShown()) { revealAll(); sfx.play("uiSelect"); return; }
    done = true; sfx.play("uiSelect"); teardown();
  };
  root.addEventListener("click", finish);
  const onKey = (e) => { if (armed && (e.code === "Space" || e.code === "Enter")) finish(); };
  const onUp = (e) => { if (e.code === "Space" || e.code === "Enter") armed = true; };
  addEventListener("keydown", onKey);
  addEventListener("keyup", onUp);
  setTimeout(() => (armed = true), 200); // ignore a confirm key held from the run's death-fire
  function teardown() { removeEventListener("keydown", onKey); removeEventListener("keyup", onUp); }

  hintEl.textContent = "▸ click / SPACE — skip";
  return { update(dt) { step(dt); }, render() {}, get done() { return done; }, get wipe() { return wipe; }, nextSeed, bgId };
}
