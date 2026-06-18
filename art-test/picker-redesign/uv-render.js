// Fills whichever zones a layout defines (#grid #doss #arena #conga #bgrow) so the four
// UV-Rave variations share one renderer. Party order is shown with recessed dark-grey
// numerals (no colored badges); the background menu leads with an "Automatic" option.
(function(){
  const $ = id => document.getElementById(id);
  const sel = ROSTER[SELECTED];

  if ($('grid')) $('grid').innerHTML = ROSTER.map((h,i)=>{
    const inP = PARTY.indexOf(i), lk = h.lock>0, ac = i===SELECTED ? 'var(--uv)' : h.c;
    return `<div class="card ${i===SELECTED?'sel':''} ${inP>=0?'inparty':''} ${lk?'lock':''}">
      <div class="slot">${inP>=0?inP+1:''}</div>
      <div class="no">${String(i+1).padStart(2,'0')}</div>
      <div class="nm">${h.n}</div>
      <div class="gn" style="color:${h.c}">${h.g}</div>
      <div class="wpn">${h.w}</div>
      <div class="sig" style="color:${ac}">✦ ${h.s}</div>
      <div class="eq">${STATS.map(([l,k])=>`<i><span style="height:${h[k]/10*100}%;background:${ac}"></span></i>`).join('')}</div>
      ${lk?`<div class="lk">⟳ RUN ${h.lock}</div>`:''}</div>`;
  }).join('');

  if ($('doss')) $('doss').innerHTML = `
    <div class="tag">SELECTED · UNIT 0${SELECTED+1} · SLOT 3</div>
    <h2>${sel.n}</h2>
    <div class="gn" style="color:${sel.c}">${sel.g}</div>
    <div class="sigbox"><small>SIGNATURE</small><b>${sel.s}</b></div>
    <div class="wbox"><small>WEAPON</small><b>${sel.w}</b></div>
    <div class="dstats">${STATS.map(([l,k])=>`<div class="ds"><i>${l}</i><div class="t">${Array.from({length:10},(_,j)=>`<b style="${j<sel[k]?`background:${sel.c};box-shadow:0 0 6px ${sel.c}`:''}"></b>`).join('')}</div><div class="nn">${sel[k]}</div></div>`).join('')}</div>`;

  // LIVE arena — Jess unloading The Drop: nova ring, two dummies taking the hit, hero w/ cooldown.
  if ($('arena')) $('arena').innerHTML = `
    <div class="alab"><span class="dotlive"></span>LIVE ▸ SIG: ${sel.s.toUpperCase()}</div>
    <div class="scan"></div>
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
    const items = ['Automatic', ...BGS]; // Automatic leads the void-feed menu
    $('bgrow').innerHTML = `<span class="clab">VOID FEED</span><div class="bgs">` +
      items.map((b,i)=>{
        const isAuto = i===0, on = (i-1)===BG; // Truchet selected; Automatic shown as the alt
        return `<b class="${isAuto?'auto':''} ${on?'on':''}">${isAuto?'⟳ ':(on?'◉ ':'')}${b.toUpperCase()}</b>`;
      }).join('') + `</div>`;
  }
})();
