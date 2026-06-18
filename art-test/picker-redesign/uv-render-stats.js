// V4 avatar + stat studies. Place-in-line replaces the cardinal numbering; three states
// (in-party / dim / greyed-locked); stat treatment chosen by window.STAT_MODE.
(function(){
  const $ = id => document.getElementById(id);
  const sel = ROSTER[SELECTED];
  const SM = window.STAT_MODE || 'bars';
  const file = h => 'portraits/' + h.n.toLowerCase() + '.png';            // full body (dossier)
  const bust = h => 'portraits/busts/' + h.n.toLowerCase() + '.png';      // head + shoulders (avatar)

  function statHTML(h){
    if (SM==='num')
      return STATS.map(([l,k])=>`<span class="stat">${l}<b>${h[k]}</b></span>`).join('');
    if (SM==='big')
      return STATS.map(([l,k])=>`<div class="stat"><b style="color:${h.c}">${h[k]}</b><i>${l}</i></div>`).join('');
    if (SM==='eq')
      return STATS.map(([l,k])=>{const on=Math.round(h[k]/10*6);
        return `<div class="stat"><div class="eqs">${Array.from({length:6},(_,j)=>`<i><span style="${j<on?`display:block;height:100%;background:${h.c};box-shadow:0 0 5px ${h.c}`:''}"></span></i>`).join('')}</div><i class="lab">${l}</i></div>`;}).join('');
    // bars (default)
    return STATS.map(([l,k])=>`<div class="stat"><i>${l}</i><div class="pbar"><span style="width:${h[k]/10*100}%;background:${h.c}"></span></div></div>`).join('');
  }

  if ($('grid')){
    $('grid').className = 'mode-v4s smode-' + SM;
    $('grid').innerHTML = ROSTER.map((h,i)=>{
      const inP = PARTY.indexOf(i), locked = h.lock > RUN, ac = i===SELECTED ? 'var(--uv)' : h.c;
      // Not-yet-earned: fully redacted. No name, genre, sig or stats — just a flat grey
      // silhouette on black, censored blocks, and the run you unlock them on.
      if (locked) return `<div class="card lock">
        <div class="av"><div class="silhouette"></div></div>
        <div class="lockt">⟳ RUN ${h.lock}</div>
        <div class="redact rname"></div>
        <div class="redact rsub"></div>
        <div class="redact rstat"></div>
      </div>`;
      const state = inP>=0 ? '' : 'dim';
      return `<div class="card ${i===SELECTED?'sel':''} ${inP>=0?'inparty':''} ${state}">
        <div class="av"><img src="${bust(h)}" alt=""></div>
        <div class="place"><i>IN LINE</i><b>${inP>=0?inP+1:''}</b></div>
        <div class="nm">${h.n}</div>
        <div class="info"><div class="gn" style="color:${h.c}">${h.g}</div><div class="sig" style="color:${ac}">✦ ${h.s}</div></div>
        <div class="stats">${statHTML(h)}</div>
      </div>`;
    }).join('');
  }

  if ($('doss')) $('doss').innerHTML = `
    <div class="tag">SELECTED · IN LINE 3 OF ${PARTY.length}</div>
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

  if ($('conga')) $('conga').innerHTML =
    PARTY.map((idx,o)=>{const x=ROSTER[idx];
      return `<div class="chip"><span class="sn">${o+1}</span><span class="d" style="background:${x.c};box-shadow:0 0 8px ${x.c}"></span><b>${x.n}</b></div>`+(o<PARTY.length-1?'<span class="arr">▸</span>':'');
    }).join('') + `<div class="start">▶ START THE WALK</div>`;

  if ($('bgrow')){
    // Compact coverflow for the right-side slot: the Automatic option, then the selected
    // backdrop framed by carets with its neighbour (it scrolls in-game).
    const cur = BGS[BG].toUpperCase(), next = BGS[(BG+1)%BGS.length].toUpperCase();
    $('bgrow').innerHTML = `<span class="clab">BACKDROP</span><div class="bgs">`
      + `<b class="auto">⟳ AUTO</b><span class="sep">·</span>`
      + `<b class="nb">‹</b><b class="on">◉ ${cur}</b><b>${next}</b><b class="nb">›</b></div>`;
  }
})();
