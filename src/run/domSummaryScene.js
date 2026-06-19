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

const CSS = `
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
  const partnerId = headId === "jess" ? "marvin" : "jess"; // the friend you walk with
  const dist = Math.round(result.distanceFraction * 1200);
  const day = before.campaign.day;
  const justFell = new Set(result.died || []);
  const family = C.causeFamily[result.cause] || (result.cause ? "enemy" : "generic");
  const band = result.distanceFraction < 0.25 ? "barely" : result.distanceFraction < 0.75 ? "halfway" : "soClose";

  if (!document.getElementById("msn-css")) {
    const s = document.createElement("style"); s.id = "msn-css"; s.textContent = CSS; document.head.appendChild(s);
  }

  // --- chat log lines ---
  const lines = [];
  const sys = (html, cls = "") => lines.push(`<p class="line"><span class="sys ${cls}">${html}</span></p>`);
  const them = (html) => lines.push(`<p class="line"><span class="nk them">${handle(partnerId)}</span> says: ${html}</p>`);
  sys(`♪ <b>${handle(partnerId)}</b> has been added to the conversation.`);
  them("MARVIN. omg. it's me — chem class, 4th period??");
  them("i see it too. the street. the <i>things</i>. you're NOT crazy 🙂");
  them("we walk home together now. don't be weird about it");
  lines.push(`<p class="line"><span class="wink">${handle(partnerId)} just sent you a Nudge! 〰️</span></p>`);
  sys(`———  <b>3:00 PM. the bell rang.</b>  ———`);
  sys(fill(result.won ? C.system.distanceWon : C.system.distance, { dist: dist.toLocaleString() }));
  sys(fill(C.system.haul, { cash: result.cashDiscarded || 0, kills: result.kills }));
  for (const id of justFell) sys(fill(pick(C.heroFell), { handle: handle(id) }), "fell");
  sys(fill(result.won ? C.system.dayWon : C.system.dayAgain, { day }));

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
      <div class="tb"><span class="ti" style="background:#fff">👋</span><span class="t">${nameOf(partnerId)} - Instant Message</span>
        <span class="ctrls"><span class="cb">_</span><span class="cb">□</span><span class="cb x">×</span></span></div>
      <div class="cvbar"><div class="ab"><span class="g">✉️</span>Invite</div><div class="ab"><span class="g">📁</span>Send Files</div>
        <div class="ab"><span class="g">🎙️</span>Voice</div><div class="ab"><span class="g">🎲</span>Activities</div><div class="ab"><span class="g">🎮</span>Games</div>
        <span class="sp"></span><span class="logo"><b>BUDDY</b>👋</span></div>
      <div class="cvbody"><div class="cvmain">
        <div class="toline">To: <b>${handle(partnerId)}</b> &lt;${partnerId}_lives4thedrop@hotmail.com&gt;</div>
        <div class="infobar"><span>ⓘ</span><span>${handle(partnerId)} might not reply right away — she's still walking home.</span></div>
        <div class="safety"><span>🔑</span><span>Never tell anyone the way home, even if they say they're your friend.</span></div>
        <div class="log">${lines.join("")}</div>
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
      <div class="tasks"><div class="tk">👋 BUDDY</div><div class="tk active">👋 ${nameOf(partnerId)} - Instant Message</div></div>
      <div class="tray"><span>🔊</span><span>👋</span><span class="clock">3:00 PM</span></div></div>
    <div class="hint">▸ click / SPACE — ${wipe ? "…" : result.won ? "head to tomorrow" : "try another day"}</div>`;

  let armed = false, done = false;
  const finish = () => { if (done) return; done = true; sfx.play("uiSelect"); teardown(); };
  root.addEventListener("click", finish);
  const onKey = (e) => { if (armed && (e.code === "Space" || e.code === "Enter")) finish(); };
  const onUp = (e) => { if (e.code === "Space" || e.code === "Enter") armed = true; };
  addEventListener("keydown", onKey);
  addEventListener("keyup", onUp);
  setTimeout(() => (armed = true), 200); // ignore a confirm key held from the run's death-fire
  function teardown() { removeEventListener("keydown", onKey); removeEventListener("keyup", onUp); }

  mountOverlay(root);
  return { update() {}, render() {}, get done() { return done; }, get wipe() { return wipe; }, nextSeed, bgId };
}
