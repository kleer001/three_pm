// Real roster + backgrounds from src/run/balance.js — so every mockup is an accurate
// redesign, not lorem. selected/locked drive the still's "state".
window.ROSTER = [
  { n:"Marvin",    g:"House",     c:"#f5c518", w:"Slingshot", s:"Good Vibes",   spd:5, con:5, str:5, mag:5, lock:0 },
  { n:"Chad",      g:"Industrial",c:"#e8743b", w:"Cleave",    s:"Mosh Pit",     spd:5, con:8, str:8, mag:2, lock:0 },
  { n:"Dash",      g:"Psytrance", c:"#d6336c", w:"Spear",     s:"Redline",      spd:9, con:3, str:5, mag:3, lock:0 },
  { n:"Wendolyn",  g:"Dubtechno", c:"#0b7285", w:"Hex",       s:"Deep Freeze",  spd:5, con:3, str:2, mag:9, lock:0 },
  { n:"Eugene",    g:"Techno",    c:"#4dabf7", w:"Bomb",      s:"Drum Machine", spd:4, con:5, str:3, mag:7, lock:0 },
  { n:"Jess",      g:"Trance",    c:"#e64980", w:"Nova",      s:"The Drop",     spd:5, con:5, str:4, mag:7, lock:1 },
  { n:"ZigZag",    g:"Acid",      c:"#82c91e", w:"Beam",      s:"Bad Trip",     spd:6, con:4, str:3, mag:7, lock:2 },
  { n:"Jasper",    g:"Ambient",   c:"#b197fc", w:"Hex Field", s:"Chill Zone",   spd:4, con:6, str:3, mag:6, lock:3 },
  { n:"Valentine", g:"Synthwave", c:"#cc5de8", w:"Whirl",     s:"Flashback",    spd:6, con:5, str:4, mag:6, lock:4 },
];
window.BGS = ["Starfield","Datamosh","Code Soup","Moiré","Pink Tubes","Perlin","Flow","Truchet","Lightning"];
window.STATS = [["SPD","spd"],["CON","con"],["STR","str"],["MAG","mag"]];
// the highlighted pick + the chosen party order (head first) + the chosen background.
// RUN = days completed; a hero is unlocked once lock <= RUN. At RUN 2 that leaves Jasper &
// Valentine locked (greyed), and unlocked-but-unpicked heroes (Dash, ZigZag) merely dimmed.
window.SELECTED = 5;            // Jess
window.PARTY = [0,1,5,4,3];     // Marvin, Chad, Jess, Eugene, Wendolyn (head → tail)
window.BG = 7;                  // Truchet
window.RUN = 2;
