#!/usr/bin/env python3
# Poach curated cartoon/realistic foley candidates from the sample library into a flat
# preview pool, and emit a manifest the sfx-candidates.html page reads. Not game wiring —
# this is a scouting tool so the human can pick by ear which sample backs each event.
import json, os, re, shutil, sys

LIB = "/media/menser/larg/Music/samples"
F   = "SamplesOnNirvana/loopSounds/foleyStolen"
TF2 = "TF2Sounds"
OUT = os.path.dirname(os.path.abspath(__file__))
POOL = os.path.join(OUT, "sfx-preview", "pool")

# event -> (group, when-it-plays, [candidate source paths])
EVENTS = {
  "shoot":      ("Combat — outgoing", "You / an ally fires a projectile.",
    [f"{F}/loadGun_01-2.wav", f"{F}/loadGun_03-2.wav", f"{F}/wooshCrispy_01-2.wav",
     f"{TF2}/SFX_DemomanGun1-2.wav", f"{TF2}/SFX_MedicGun1-2.wav", f"{TF2}/SFX_SniperGun1-2.wav"]),
  "swing":      ("Combat — outgoing", "Melee arc connects.",
    [f"{F}/woosh_01-2.wav", f"{F}/wooshCrispy_01-2.wav", f"{F}/monkWoosh_01-2.wav",
     f"{F}/air_01-2.wav", f"{F}/blade_03-2.wav", f"{TF2}/SFX_ScoutMelee-2.wav"]),
  "nova":       ("Combat — outgoing", "Charge / nova release.",
    [f"{F}/orchestraHit_01-2.wav", f"{F}/bladeOrchHit_01-2.wav", f"{F}/rumbleHit_01-2.wav",
     f"{F}/slam_01-2.wav", f"{F}/airAndBassHit_02-2.wav", f"{F}/rocketAccelerate_01-2.wav"]),
  "field":      ("Combat — outgoing", "A lingering field is deployed (ticks, doesn't blast).",
    [f"{F}/electricLab_01-2.wav", f"{F}/windingMachine_01-2.wav", f"{F}/electric_01-2.wav",
     f"{F}/bassShortRumble_01-2.wav", f"{TF2}/SFX_ElectroGround-2.wav", f"{F}/unBreakElectric-2.wav"]),
  "explode":    ("Combat — outgoing", "Bomb / big detonation — the bassiest, longest hit.",
    [f"{TF2}/SFX_Explode-2.wav", f"{TF2}/SFX_Bang1-2.wav", f"{TF2}/SFX_Boulder-2.wav",
     f"{F}/breakBigWall-2.wav", f"{F}/smashAndDust_01-2.wav", f"{F}/slam_02-2.wav"]),

  "hit":        ("Combat — impacts", "An enemy takes damage. Highest-density sound in the game.",
    [f"{F}/slap_01-2.wav", f"{F}/bitchSlap-2.wav", f"{F}/metalHit_01-2.wav",
     f"{F}/hitDing_01-2.wav", f"{F}/punchSand-2.wav", f"{F}/ceramicClink_01-2.wav"]),
  "freeze":     ("Combat — impacts", "An enemy freezes (the freeze-slingshot kill stand-in).",
    [f"{F}/ceramicClink_01-2.wav", f"{F}/breakGlassAndAugh_01-2.wav", f"{F}/hitDing_01-2.wav",
     f"{F}/dingWoosh_01-2.wav", f"{TF2}/SFX_Ding-2.wav", f"{F}/clickBeep_01-2.wav"]),
  "death":      ("Combat — impacts", "An enemy dies. Crunch / squish.",
    [f"{F}/bassHitAndSquish_01-2.wav", f"{F}/smash_01-2.wav", f"{F}/smashAndCrumble_01-2.wav",
     f"{F}/wetRip_01-2.wav", f"{F}/gloppy_1-2.wav", f"{F}/DIEandStuff_01-2.wav"]),
  "enemyShoot": ("Combat — impacts", "An enemy fires at you. Should read distinct from your shots.",
    [f"{TF2}/SFX_Laser2-2.wav", f"{TF2}/SFX_ElectroGround-2.wav", f"{TF2}/SFX_DrillBit-2.wav",
     f"{F}/electric_02-2.wav", f"{F}/angryBuzz_01-2.wav", f"{F}/crazyBeep_01-2.wav"]),
  "hurt":       ("Combat — impacts", "You / an ally takes damage.",
    [f"{TF2}/SFX_ScoutHurt-2.wav", f"{TF2}/SFX_HeavyHurt-2.wav", f"{TF2}/SFX_MedicHurt-2.wav",
     f"{F}/gasp_01-2.wav", f"{F}/huaugh_01-2.wav", f"{F}/hitAndGasp_01-2.wav"]),
  "scream":     ("Combat — impacts", "A hero dies. (Current synth is an explicit placeholder.)",
    [f"{F}/scream_01-2.wav", f"{F}/scream_02-2.wav", f"{F}/scream_03-2.wav",
     f"{F}/scream_04-2.wav", f"{F}/groupScream_01-2.wav", f"{F}/yellingStruggle_01-2.wav"]),

  "pickup":     ("Rewards & run end", "Powerup collected.",
    [f"{TF2}/SFX_Ding-2.wav", f"{TF2}/SFX_Capture-2.wav", f"{TF2}/SFX_Success-2.wav",
     f"{TF2}/SFX_Selected-2.wav", f"{F}/hitDing_01-2.wav", f"{F}/dingWoosh_01-2.wav"]),
  "win":        ("Rewards & run end", "Run won — you reached home.",
    [f"{TF2}/SFX_HeavyWin-2.wav", f"{TF2}/SFX_SoldierWin-2.wav", f"{TF2}/SFX_SpyWin-2.wav",
     f"{TF2}/SFX_DemomanWin-2.wav", f"{TF2}/SFX_Success-2.wav", f"{F}/yeeHaww_01-2.wav"]),
  "lose":       ("Rewards & run end", "Run lost.",
    [f"{TF2}/SFX_HeavyDie-2.wav", f"{TF2}/SFX_SpyDie-2.wav", f"{F}/evilLaugh_01-2.wav",
     f"{F}/readyToDie-2.wav", f"{F}/deathRolling-2.wav", f"{F}/sliceShudder-2.wav"]),

  "uiMove":     ("UI / menu", "Cursor navigation tick.",
    [f"{F}/clickBeep_01-2.wav", f"{F}/clickBeep_02-2.wav", f"{F}/clickSqueek_01-2.wav",
     f"{F}/squeek_01-2.wav", f"{TF2}/SFX_Select-2.wav", f"{F}/beepAlarm_01-2.wav"]),
  "uiSelect":   ("UI / menu", "Confirm / pick.",
    [f"{TF2}/SFX_Selected-2.wav", f"{TF2}/SFX_Ding-2.wav", f"{TF2}/SFX_Continue-2.wav",
     f"{F}/hitDing_01-2.wav", f"{F}/clickBeep_02-2.wav", f"{F}/dingWoosh_01-2.wav"]),
  "uiBack":     ("UI / menu", "Cancel / close.",
    [f"{F}/clickSqueek_02-2.wav", f"{F}/squeek_01-2.wav", f"{TF2}/SFX_Select-2.wav",
     f"{F}/clickBeep_01-2.wav", f"{F}/doorClose_01-2.wav", f"{F}/zipStrange_01-2.wav"]),
}

def slug(p):
    base = os.path.splitext(os.path.basename(p))[0]
    return re.sub(r"[^a-zA-Z0-9]+", "_", base).strip("_").lower() + ".wav"

if os.path.isdir(POOL):
    shutil.rmtree(POOL)
os.makedirs(POOL)

copied, missing, manifest = {}, [], []
for name, (group, desc, paths) in EVENTS.items():
    samples = []
    for p in paths:
        full = os.path.join(LIB, p)
        if not os.path.exists(full):
            missing.append(p)
            continue
        fn = slug(p)
        if fn not in copied:
            shutil.copy2(full, os.path.join(POOL, fn))
            copied[fn] = True
        samples.append({"file": f"pool/{fn}", "label": os.path.basename(p)})
    manifest.append({"name": name, "group": group, "desc": desc, "samples": samples})

with open(os.path.join(OUT, "sfx-preview", "manifest.json"), "w") as f:
    json.dump(manifest, f, indent=2)

print(f"Copied {len(copied)} unique files into {POOL}")
if missing:
    print(f"MISSING ({len(missing)}):", file=sys.stderr)
    for m in missing:
        print("  " + m, file=sys.stderr)
