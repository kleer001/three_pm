// Diegetic copy for the BUDDY post-run summary (the MSN/AIM-styled summary overlay).
// Voice: 200X teen IM — lowercase-default, ASCII emoticons only, no smartphone emoji in
// body text (the ✝ / ❖ / 💀 / ♪ glyphs live only in the gray system/offline chrome).
// Narrator = marv™ (the account holder). Voice source of truth: writing/voices.md,
// writing/copy.md; the hero handles are that bible's locked set.
//
// Wiring: resolve a loss `cause` → bucket via `causeFamily[cause]` (truthy-but-unmapped →
// "enemy", null → "generic", "left behind by the dark" → "crush"). Distance bands pick a
// `distanceMilestone` line. `heroFell`/system lines take {handle}/{dist}/{kills}/{cash}/{day}.
export const summaryCopy = {
  handles: {
    marvin:    "marv™",
    chad:      "TANK²⁰⁰²",
    dash:      "»Dash«",
    wendolyn:  "x_raven_x",
    eugene:    "sparkplug",
    jess:      "♥jess♥",
    zigzag:    "z1gz4g",
    jasper:    "jasper_",
    valentine: "x0_valentine_0x",
  },

  // A newly-met survivor signing in for the first time (the run-count unlock — they "come in"
  // to the chat). Generic per hero, lowercase teen IM; the old comp's Jess intro vibe.
  joined: [
    "ok i saw your away message. so the street really is... yeah. yeah it is.",
    "added you. flagpole after the bell — we go together from now on.",
    "hey, heard you made it back. ...is it always that bad out there?",
    "found your screenname carved in the bus stop. im in. lets get home.",
    "signing in. dunno how much help i'll be but. i'm here now.",
  ],

  // Surviving crew checking in, one after another, after the run totals land. Generic enough
  // for any hero (attributed to their handle), lowercase teen IM.
  crewCheckIn: [
    "made it. that was way too close.",
    "still here. dont ask how.",
    "present. exhausted. present.",
    "ok we are NOT doing that again. (we are.)",
    "im fine. im totally fine. my legs are not fine.",
    "that street is so wrong. but we're back.",
    "home. everyone count off. i'll start.",
    "checking in. barely. but in.",
    "we keep doing this. tomorrow then.",
  ],

  won: [
    "porch light. front door. mom didnt even notice i was gone.",
    "made it. dropping my bag right here. not moving til tomorrow.",
    "home. the street let go of us this time. weird how you can just. walk in the door :)",
    "we made it. all the way. dont make it a thing ok",
    "south side of the cul de sac and then. home. like nothing happened. like always lol",
    "key in the lock. thats the best sound there is. ill take it.",
  ],

  lost: {
    crush: [
      "the dark caught up. one second behind. always one second.",
      "got boxed in. couldnt move. then it was just. dark. anyway.",
      "i stopped for half a second and the street took it back. dont stop. ever.",
      "the crush line got me. it doesnt slow down. i keep forgetting that part.",
    ],
    shamblers: [
      "the slow ones got me. you'd think slow is fine. its not, its just patient.",
      "didnt run, figured i had time. the dead ones dont need to hurry. lol. ow.",
      "one of the shambling ones. i SAW it coming. saw it the whole time. still here we are.",
    ],
    imps: [
      "too many little ones. they dont hit hard, they just dont stop. like a swarm of bad ideas.",
      "the small fast ones swarmed the lawn. i couldnt count fast enough.",
      "the quick little things. one isnt scary. forty is a different worksheet.",
    ],
    cultists: [
      "the ones that stand back and CHANT got me. cowards. effective cowards.",
      "got picked off from range. couldnt close the gap. they just kept singing.",
      "the chanting ones. wendolyn warned us about those. should write that down somewhere.",
    ],
    brutes: [
      "the big one lunged. i blinked. thats the whole story.",
      "one of the huge ones charged. i did not out-run a charging refrigerator. noted.",
      "the big charger caught me mid-stride. its fine. im sure ill be fine tomorrow.",
    ],
    enemy: [
      "something out there got me. i didnt get a good look. probably for the best.",
      "one of them got through. there's always one that gets through.",
      "caught me out in the open. should've stuck to the houses.",
    ],
    generic: [
      "didnt make it. not today. tomorrow then.",
      "the street won this round. it usually does. ill try again. i always do.",
      "thats it. thats the day. see you tomorrow i guess. ...again.",
    ],
  },

  // Named-enemy `cause` → lost-copy family bucket.
  causeFamily: {
    "left behind by the dark": "crush",
    "Shambler": "shamblers", "Ghoul": "shamblers", "Revenant": "shamblers",
    "Imp": "imps", "Hellpup": "imps",
    "Acolyte": "cultists", "Zealot": "cultists", "Hierophant": "cultists",
    "Brute": "brutes", "Behemoth": "brutes",
  },

  // Loss distance bands: <0.25 / 0.25–0.75 / >0.75 of the way home.
  distanceMilestone: {
    barely:  "barely off the steps. the street didnt even let me get going today.",
    halfway: "made it about halfway. i could almost see the corner of our block.",
    soClose: "i could SEE the house. i could see the porch light. so close. so so close.",
  },

  // A crew member died this run. {handle} = that hero's screen-name.
  heroFell: [
    "{handle} went offline. ✝ last seen 3:00 PM.",
    "{handle} didnt sign back in. ...i keep refreshing the list. i know. i know.",
    "{handle} ✝. nobody's saying anything in the chat. nobody knows what to say.",
    "the little dot next to {handle} went gray. it doesnt do that. it's not supposed to do that.",
    "{handle} dropped off the walk home today. we leave the screen name up. we always leave it up.",
  ],

  // Gray-italic system lines (the "3:00 PM. the bell rang." chrome). Stat params substituted.
  system: {
    bell:        "———  3:00 PM. the bell rang.  ———",
    distance:    "❖ you made it {dist}m before the dark caught up",
    distanceWon: "❖ you made it the whole way — {dist}m, front door to front door",
    haul:        "❖ ${cash} in lunch money recovered · 💀 {kills} flattened",
    dayAgain:    "❖ Day {day}. see you tomorrow (again).",
    dayWon:      "❖ Day {day}. ...and we did it. write it down.",
    addedToConvo:"♪ {handle} has been added to the conversation.",
    walkingHome: "{handle} might not reply right away — they're still walking home.",
  },

  // Player's «personal message» (the marv™ tagline). neutral = default/pre-result.
  selfStatus: {
    neutral: [
      "«this is fine.»",
      "«this is a completely normal Tuesday.»",
      "«good vibes only — i mean that medically.»",
      "«im sure its fine. its probably fine. lol»",
      "«brb walking home. like always.»",
    ],
    won: [
      "«made it. dont make it a thing.»",
      "«home. see, i told you it was fine.»",
      "«another normal day survived. youre welcome.»",
      "«key in the lock = best sound there is :)»",
    ],
    lost: [
      "«ok so that one was NOT fine.»",
      "«try another day. (away)»",
      "«brb. respawning. metaphorically. ...mostly.»",
      "«this is fine. this is still, somehow, fine.»",
      "«gtg. the bell rings again tomorrow.»",
    ],
  },
};
