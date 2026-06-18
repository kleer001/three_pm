// Portrait variant of the renderer for the four 3A studies. Same data + zones as
// uv-render.js, but each card carries the hero's cutout portrait (placement set by the
// #grid.mode-* class) and the dossier shows the larger full-body when selected. The arena
// is drawn without scanlines.
(function(){
  const $ = id => document.getElementById(id);
  const sel = ROSTER[SELECTED];
  const MODE = window.CARD_MODE || 'right';
  const file = h => 'portraits/' + h.n.toLowerCase() + '.png';

  if ($('grid')){
    $('grid').className = 'mode-' + MODE;
    $('grid').innerHTML = ROSTER.map((h,i)=>{
      const inP = PARTY.indexOf(i), lk = h.lock>0, ac = i===SELECTED ? 'var(--uv)' : h.c;
      const fig = MODE==='avatar'
        ? `<div class="av"><img src="${file(h)}" alt=""></div>`
        : `<img class="por" src="${file(h)}" alt=""><div class="scrim"></div>`;
      return `<div class="card ${i===SELECTED?'sel':''} ${inP>=0?'inparty':''} ${lk?'lock':''}">
        ${fig}
        <div class="slot">${inP>=0?inP+1:''}</div>
        <div class="no">${String(i+1).padStart(2,'0')}</div>
        <div class="nm">${h.n}</div>
        <div class="gn" style="color:${h.c}">${h.g}</div>
        <div class="sig" style="color:${ac}">✦ ${h.s}</div>
        ${lk?`<div class="lk">⟳ RUN ${h.lock}</div>`:''}</div>`;
    }).join('');
  }

  if ($('doss')) $('doss').innerHTML = `
    <div class="tag">SELECTED · UNIT 0${SELECTED+1} · SLOT 3</div>
    <h2>${sel.n}</h2>
    <div class="gn" style="color:${sel.c}">${sel.g}</div>
    <div class="sigbox"><small>SIGNATURE</small><b>${sel.s}</b></div>
    <div class="wbox"><small>WEAPON</small><b>${sel.w}</b></div>
    <div class="dstats">${STATS.map(([l,k])=>`<div class="ds"><i>${l}</i><div class="t">${Array.from({length:10},(_,j)=>`<b style="${j<sel[k]?`background:${sel.c};box-shadow:0 0 6px ${sel.c}`:''}"></b>`).join('')}</div><div class="nn">${sel[k]}</div></div>`).join('')}</div>
    <img class="bodyshot" src="${file(sel)}" alt="">`;

  if ($('arena')) $('arena').innerHTML = `
    <div class="alab"><span class="dotlive"></span>LIVE ▸ SIG: ${sel.s.toUpperCase()}</div>
    <div class="nova" style="left:50%;top:34%;width:72%;height:0;padding-bottom:72%"></div>
    <div class="ent dummy" style="left:32%;top:62%;width:18px;height:18px"></div>
    <div class="hp" style="left:32%;top:54%;width:24px"><span style="width:46%"></span></div>
    <div class="dmg" style="left:32%;top:46%">19</div>
    <div class="ent dummy" style="left:70%;top:56%;width:18px;height:18px"></div>
    <div class="hp" style="left:70%;top:48%;width:24px"><span style="width:62%"></span></div>
    <div class="dmg" style="left:70%;top:40%">19</div>
    <div class="ent hero" style="left:50%;top:34%;width:22px;height:22px;color:${sel.c};background:${sel.c}"></div>
    <div class="cd" style="left:50%;top:34%;width:9px;height:9px"></div>
    <div class="hp" style="left:50%;top:24%;width:30px"><span style="width:38%;background:#82c91e"></span></div>`;

  if ($('conga')) $('conga').innerHTML = `<span class="clab">CONGA ▸ HEAD→TAIL</span>` +
    PARTY.map((idx,o)=>{const x=ROSTER[idx];
      return `<div class="chip"><span class="sn">${o+1}</span><span class="d" style="background:${x.c};box-shadow:0 0 8px ${x.c}"></span><b>${x.n}</b></div>`+(o<PARTY.length-1?'<span class="arr">▸</span>':'');
    }).join('') + `<div class="start">▶ START THE WALK [${PARTY.length}]</div>`;

  if ($('bgrow')){
    const items = ['Automatic', ...BGS];
    $('bgrow').innerHTML = `<span class="clab">VOID FEED</span><div class="bgs">` +
      items.map((b,i)=>{const isAuto=i===0,on=(i-1)===BG;
        return `<b class="${isAuto?'auto':''} ${on?'on':''}">${isAuto?'⟳ ':(on?'◉ ':'')}${b.toUpperCase()}</b>`;}).join('') + `</div>`;
  }
})();
