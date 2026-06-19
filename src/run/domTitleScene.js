// Campaign endcaps — the Title (New Game / Continue) and Game Over (crew wiped) screens,
// designed in the picker's UV-rave language since no comp exists for them. Both are DOM-overlay
// scenes with the canvas/menu contract ({ update, render, done, ... }). Title exposes `choice`
// ("new" | "continue"); main.js resets the campaign for "new" and resumes for "continue".
import { BALANCE } from "./balance.js";
import { summaryCopy as C } from "./summaryCopy.js";
import { mountOverlay } from "../ui/overlay.js";
import { sfx } from "../audio/sfx.js";

const handle = (id) => C.handles[id] || id;
const nameOf = (id) => (BALANCE.roster.find((c) => c.id === id) || {}).name || id;

const CSS = `
#ui-overlay .uvend{--uv:#ccff00;--mag:#ff2d95;--cyan:#00e5ff;--dim:#6f7566;
  width:800px;height:600px;position:relative;overflow:hidden;background:#050505;color:#f2f4f0;font-family:"Oswald",sans-serif;
  display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
#ui-overlay .uvend::before{content:"";position:absolute;width:680px;height:680px;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:50%;
  background:conic-gradient(from 0deg,transparent 0 8deg,rgba(255,45,149,.07) 8deg 16deg,transparent 16deg 24deg);
  -webkit-mask:radial-gradient(circle,transparent 30%,#000 31%,#000 70%,transparent 71%);mask:radial-gradient(circle,transparent 30%,#000 31%,#000 70%,transparent 71%)}
#ui-overlay .uvend::after{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(204,255,0,.05) 1px,transparent 1.4px);background-size:7px 7px;pointer-events:none}
#ui-overlay .uvend .kick{font-family:"Space Mono",monospace;font-size:12px;letter-spacing:.5em;color:var(--cyan);text-transform:uppercase;position:relative}
#ui-overlay .uvend h1{font-family:"Anton",sans-serif;font-size:108px;line-height:.84;text-transform:uppercase;margin:8px 0;position:relative}
#ui-overlay .uvend h1 em{font-style:normal;color:var(--uv);text-shadow:0 0 28px rgba(204,255,0,.6)}
#ui-overlay .uvend h1.over{font-size:78px;color:#fff}
#ui-overlay .uvend h1.over em{color:var(--mag);text-shadow:0 0 28px rgba(255,45,149,.6)}
#ui-overlay .uvend .sub{font-family:"Space Mono",monospace;font-size:13px;letter-spacing:.22em;color:var(--dim);text-transform:uppercase;position:relative;margin-bottom:6px}
#ui-overlay .uvend .roll{position:relative;max-width:560px;margin:14px 0 4px;color:#a77;font-style:italic;font-size:13px;line-height:1.7}
#ui-overlay .uvend .roll b{color:var(--mag);font-style:normal}
#ui-overlay .uvend .btns{position:relative;display:flex;gap:16px;margin-top:30px}
#ui-overlay .uvend .b{font-family:"Anton",sans-serif;font-size:20px;text-transform:uppercase;letter-spacing:.04em;padding:11px 26px;cursor:pointer;border:1px solid var(--uv);color:var(--uv);background:transparent}
#ui-overlay .uvend .b.go{background:var(--uv);color:#050505;box-shadow:0 0 26px rgba(204,255,0,.5)}
#ui-overlay .uvend .b:hover{box-shadow:0 0 26px rgba(204,255,0,.5)}
#ui-overlay .uvend .foot{position:absolute;bottom:18px;font-family:"Space Mono",monospace;font-size:10px;letter-spacing:.2em;color:#33372a;text-transform:uppercase}
`;

function ensureCSS() {
  if (!document.getElementById("uvend-css")) {
    const s = document.createElement("style"); s.id = "uvend-css"; s.textContent = CSS; document.head.appendChild(s);
  }
}

// Shared scaffolding: build the root, wire click + keyboard, resolve on a choice.
function scene(buildHTML, onAction, keymap) {
  ensureCSS();
  const root = document.createElement("div");
  root.className = "uvend";
  root.innerHTML = buildHTML();
  let armed = false, done = false, choice = null;
  const finish = (c) => { if (done) return; done = true; choice = c; sfx.play("uiSelect"); teardown(); };
  root.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) onAction(b.dataset.act, finish); });
  const onKey = (e) => { if (armed) keymap(e.code, finish); };
  const onUp = () => (armed = true);
  addEventListener("keydown", onKey); addEventListener("keyup", onUp);
  setTimeout(() => (armed = true), 200);
  function teardown() { removeEventListener("keydown", onKey); removeEventListener("keyup", onUp); }
  mountOverlay(root);
  return { update() {}, render() {}, get done() { return done; }, get choice() { return choice; } };
}

export function createTitleScene(ctx, input, blob) {
  const cmp = blob.campaign;
  const inProgress = blob.runCount > 0 || cmp.day > 1 || cmp.dead.length > 0;
  const build = () => `
    <div class="kick">Merriton High · 3:00 PM</div>
    <h1>3:<em>00</em> PM</h1>
    <div class="sub">the walk home</div>
    ${inProgress ? `<div class="roll">Day ${cmp.day} · ${cmp.crew.length} still walking${cmp.dead.length ? ` · ${cmp.dead.length} lost` : ""}</div>` : ""}
    <div class="btns">
      ${inProgress ? `<div class="b go" data-act="continue">▶ Continue</div><div class="b" data-act="new">New Crew</div>`
                   : `<div class="b go" data-act="new">▶ New Game</div>`}
    </div>
    <div class="foot">${inProgress ? "ENTER continue · N new crew" : "ENTER / SPACE begin"}</div>`;
  const act = (a, finish) => finish(a);
  const keys = (code, finish) => {
    if (code === "KeyN") finish("new");
    else if (code === "Enter" || code === "Space") finish(inProgress ? "continue" : "new");
    else if (code === "KeyC" && inProgress) finish("continue");
  };
  return scene(build, act, keys);
}

export function createGameOverScene(ctx, input, blob) {
  const days = blob.campaign.day;
  const fallen = blob.campaign.dead;
  const build = () => `
    <div class="kick" style="color:var(--mag)">Game Over · the dark won</div>
    <h1 class="over">EVERYONE'S <em>GONE</em></h1>
    <div class="sub">you lasted ${days} day${days === 1 ? "" : "s"} · ${fallen.length} never made it home</div>
    <div class="roll">${fallen.map((id) => `<b>✝</b> ${handle(id)} <span style="color:#6f7566">(${nameOf(id)})</span>`).join("&nbsp;&nbsp;·&nbsp;&nbsp;")}</div>
    <div class="btns"><div class="b go" data-act="new">▶ Start a New Crew</div></div>
    <div class="foot">ENTER / SPACE / click</div>`;
  const act = (a, finish) => finish("new");
  const keys = (code, finish) => { if (code === "Enter" || code === "Space") finish("new"); };
  const s = scene(build, act, keys);
  // Game Over advances on any click too (not just the button).
  return s;
}
