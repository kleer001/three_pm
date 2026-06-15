// Director — spec 06's spawn budget. Reads how far the hero has descended and
// keeps a depth-scaled amount of live threat on the board, spawning new enemies
// off-screen on the home-ward (south) side so threat materializes around the
// player, never popping in on camera. Pure helpers below are node-testable; the
// stateful spawner owns no level geometry, only a tick accumulator.
import { isWalkable } from "./levelgen.js";
import { randomWalkableTile } from "../ai/ai.js";

// Distance fraction f along the southward descent: 0 at the start edge, 1 at the
// home band. Spec: f = (player.y - start.y) / (home.y - start.y), clamped.
export function distanceFraction(hero, level, ts) {
  const startY = level.start.y * ts + ts / 2;
  // homeBand rows are uniform y; take the first as the south target line.
  const homeY = level.homeBand[0][1] * ts + ts / 2;
  const span = homeY - startY || 1;
  const f = (hero.y - startY) / span;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

// Target live-threat budget at distance f. Monotonic, peaks near home.
export function budget(f, cfg) {
  return cfg.baseThreat + f * cfg.threatSlope;
}

// Adaptive difficulty multiplier on the budget. `strength` is the party's current
// aggregate HP divided by the head's max HP: solo-at-full = 1 (the tuned baseline),
// a larger/healthier party > 1, an injured or dwindling one < 1. Threat leans in when
// the party is doing well and eases off when it's hurting — and since dead followers
// and lost HP both pull `strength` down, it also breaks death spirals. Floored so a
// near-dead run is still pressured, not a walkover.
export function threatMult(strength, cfg) {
  return Math.max(cfg.partyThreatFloor, 1 + (strength - 1) * cfg.partyThreatScale);
}

// Defs spawnable at distance f: deeper bands unlock higher tiers and the
// ranged/charger families. `defs` is an array of enemy defs.
export function eligible(defs, f) {
  return defs.filter((d) => d.distanceBand <= f);
}

// Stateful director. `defs` is the enemy-def array; `cam`/`viewH` give the live
// camera rect (cam.y mutates each frame); `cfg` is BALANCE.director; `ts` the
// tile size. `update` runs each frame with the live `enemies` array and a
// `spawnEnemy(def, tx, ty)` callback that builds and pushes the entity.
export function makeDirector({ level, rng, defs, cam, viewH, cfg, ts, partyStrength }) {
  let acc = 0;

  function update(dt, hero, enemies, spawnEnemy) {
    acc += dt;
    if (acc < cfg.tickInterval) return;
    acc = 0;

    const f = distanceFraction(hero, level, ts);
    let live = 0, liveThreat = 0;
    for (const e of enemies) if (!e.dead) { live++; liveThreat += e.def.threatValue; }
    const mult = threatMult(partyStrength ? partyStrength() : 1, cfg);
    let spend = budget(f, cfg) * mult - liveThreat;

    const pool = eligible(defs, f);
    if (!pool.length) return;
    // Spawn in a south band just below the camera bottom — off-screen, home-ward.
    const bandTop = Math.floor((cam.y + viewH) / ts);
    const bandBot = bandTop + cfg.spawnBandTiles;

    while (spend > 0 && live < cfg.maxLive) {
      const affordable = pool.filter((d) => d.threatValue <= spend);
      if (!affordable.length) break;
      const def = rng.pick(affordable);
      const [tx, ty] = southBandTile(level, rng, bandTop, bandBot);
      spawnEnemy(def, tx, ty);
      spend -= def.threatValue;
      live++;
    }
  }

  return { update };
}

// Pick a walkable tile in the off-screen south band [bandTop, bandBot]. Falls
// back to any walkable tile if the band is exhausted (e.g. dense rubble there).
function southBandTile(level, rng, bandTop, bandBot) {
  const lo = Math.max(bandTop, 0), hi = Math.min(bandBot, level.h - 1);
  for (let i = 0; i < 60; i++) {
    const x = rng.int(level.w);
    const y = lo + rng.int(Math.max(1, hi - lo + 1));
    if (isWalkable(level, x, y)) return [x, y];
  }
  return randomWalkableTile(level, rng);
}
