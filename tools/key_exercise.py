#!/usr/bin/env python3
"""Exercise: kill the green background on the green-skinned brute and green-robed
caster. Color-keying fails when subject and background share a hue, so we re-shoot
these two on a MAGENTA chroma (a color neither wears) and key that. Writes a
before/after comparison to /tmp for inspection. Throwaway enemies — does not touch
the committed atlas.

Run with the ComfyUI venv (stack must be up):
  /media/menser/fauna/image_gen/comfyui/.venv/bin/python tools/key_exercise.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

from gen_sprites import generate, GEN  # reuse the generator

OUT = Path("/tmp/3pm_key_exercise")
OLD_ATLAS = Path(__file__).resolve().parent.parent / "assets" / "sprites.png"

# Magenta chroma — absent from both green subjects, so the key is unambiguous.
MAGENTA_STYLE = (
    "cartoon-terror video game character sprite, top-down three-quarter view from above, "
    "bold black outlines, flat cel shading, vibrant saturated colors, expressive, "
    "menacing yet comedic, no gore, full body centered, no shadow, "
    "on a solid flat chroma magenta background"
)
SUBJECTS = {
    "melee":  "a hulking lumbering zombie brute with torn clothes, huge arms, dim menacing grin, sickly green rotten skin, holding a wooden plank",
    "ranged": "a hooded cultist caster in a green robe holding a glowing green orb in both hands, casting pose, shadowed face",
}
# atlas cell origins (from sprites.json) for the OLD green-keyed versions
OLD_CELLS = {"melee": (48, 0), "ranged": (96, 0)}
CELL = 48


def key_magenta(im, thresh=45):
    """Key by global magenta channel-distance (min(R,B)-G), not connectivity, so
    the drop-shadow is removed too. Despill pulls the magenta fringe toward neutral.
    Then trim and fit into a CELL cell (same framing as gen_sprites.key_actor)."""
    arr = np.asarray(im.convert("RGB")).astype(np.int16)
    R, G, B = arr[..., 0], arr[..., 1], arr[..., 2]
    score = np.minimum(R, B) - G                       # high on magenta, negative on green
    alpha = np.where(score > thresh, 0, 255).astype(np.uint8)
    band = (score > thresh - 20) & (score <= thresh)   # soft edge feather
    alpha[band] = np.clip((thresh - score[band]) / 20 * 255, 0, 255).astype(np.uint8)
    spill = (R > G) & (B > G)                           # magenta tint on kept pixels
    R, B = np.where(spill, G, R), np.where(spill, G, B)
    rgba = Image.fromarray(np.dstack([R, G, B, alpha]).astype(np.uint8), "RGBA")
    bbox = rgba.split()[3].getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
    rgba.thumbnail((CELL, CELL), Image.LANCZOS)
    cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    cell.paste(rgba, ((CELL - rgba.width) // 2, (CELL - rgba.height) // 2), rgba)
    return cell


def checker(size, sq=8):
    bg = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    px = bg.load()
    for y in range(size):
        for x in range(size):
            if (x // sq + y // sq) % 2:
                px[x, y] = (224, 224, 224, 255)
    return bg


def on_checker(rgba):
    bg = checker(max(rgba.size))
    bg.alpha_composite(rgba)
    return bg


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    old_sheet = Image.open(OLD_ATLAS).convert("RGBA")
    Z, pad = CELL * 4, 14
    panel = Image.new("RGBA", (Z * 2 + pad * 3, (Z + pad) * 2 + pad), (250, 250, 250, 255))
    for row, (sid, subject) in enumerate(SUBJECTS.items()):
        ox, oy = OLD_CELLS[sid]
        old = old_sheet.crop((ox, oy, ox + CELL, oy + CELL))

        raw = generate(f"{subject}. {MAGENTA_STYLE}", seed=2000 + len(sid))
        raw.save(OUT / f"{sid}_magenta_raw.png")
        new = key_magenta(raw)
        new.save(OUT / f"{sid}_keyed.png")

        y = pad + row * (Z + pad)
        panel.alpha_composite(on_checker(old).resize((Z, Z), Image.NEAREST), (pad, y))
        panel.alpha_composite(on_checker(new).resize((Z, Z), Image.NEAREST), (Z + pad * 2, y))
    panel.convert("RGB").save(OUT / "before_after.png")
    print(f"wrote {OUT/'before_after.png'} (left = OLD green-key, right = NEW magenta-key)")


if __name__ == "__main__":
    main()
