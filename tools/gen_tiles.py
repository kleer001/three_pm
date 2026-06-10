#!/usr/bin/env python3
"""Generate a dual-grid directional tileset for three_pm.

Per material: one seamless interior texture from Flux, then the 16 dual-grid tiles
derived procedurally. Each display tile is keyed by a 4-corner bitmask
(TL=1, TR=2, BR=4, BL=8); the material region is the >=0.5 isocontour of the
bilinear field over those 4 corner values, so inner corners, outer corners, edges,
and the 2-diagonal saddle all fall out of one interpolation. A per-material rim +
dark outline draw the border. Writes assets/tiles.png + assets/tiles.json.

Run with the ComfyUI venv (stack up):
  /media/menser/fauna/image_gen/comfyui/.venv/bin/python tools/gen_tiles.py
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

from gen_sprites import generate  # reuse the Flux driver

REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "assets"
RAW = Path("/tmp/3pm_tiles")
CELL = 48
SS = 2            # supersample factor for anti-aliased contours
N = CELL * SS

TILE_STYLE = ("seamless tileable top-down texture, flat orthographic view straight down, "
              "no perspective, no shadows, evenly lit, fills the entire frame edge to edge")

# material -> (interior prompt, rim color, outline color). Rim reads as the raised
# border (hedge highlight, brick mortar cap, crater dirt rim, road curb).
MATERIALS = {
    "hedge":  ("dense leafy green boxwood hedge shrub foliage, small bright and dark green leaves",
               (150, 200, 90), (20, 50, 20)),
    "brick":  ("dark red brick masonry wall seen from above, regular brick courses, gray mortar",
               (200, 195, 185), (40, 25, 22)),
    "crater": ("dark scorched dirt and rubble crater pit, charred earth, small debris",
               (170, 140, 100), (25, 18, 12)),
    "road":   ("gray cracked asphalt road surface with faint lane grit",
               (205, 205, 200), (30, 30, 32)),
}
GROUND = ("overgrown green grass lawn, patchy weedy turf", )  # base fill, not autotiled

OUT_BAND = 0.07   # |f-0.5| < this -> dark outline
RIM_BAND = 0.24   # material side within this of the edge -> rim color


def corner_field():
    """16 signed-distance fields, one per 4-corner config (TL=1,TR=2,BR=4,BL=8).

    The material region is f >= 0.5. Boundaries are circular arcs (quarter-circles
    of radius 0.5 centered on a corner) rather than the bilinear hyperbola, so
    corners read rounded, not pointy. Every config still crosses a tile edge at its
    midpoint when that edge's two corners differ, which is what keeps neighboring
    dual-grid tiles aligned. f = 0.5 + signed distance to the boundary (clamped)."""
    u = np.linspace(0, 1, N)[None, :].repeat(N, 0)
    w = np.linspace(0, 1, N)[:, None].repeat(N, 1)
    pos = {1: (0.0, 0.0), 2: (1.0, 0.0), 4: (1.0, 1.0), 8: (0.0, 1.0)}  # bit -> (u,w)
    dist = lambda b: np.hypot(u - pos[b][0], w - pos[b][1])
    fields = []
    for c in range(16):
        bits = [b for b in (1, 2, 4, 8) if c & b]
        n = len(bits)
        if n == 0:
            f = np.zeros((N, N))
        elif n == 4:
            f = np.ones((N, N))
        elif n == 1:                                   # outer corner: quarter-disc at the corner
            sdf = 0.5 - dist(bits[0])
        elif n == 3:                                   # inner corner: rounded notch at the empty corner
            empty = next(b for b in (1, 2, 4, 8) if not c & b)
            sdf = dist(empty) - 0.5
        else:                                          # n == 2
            s = set(bits)
            if s == {1, 2}:    sdf = 0.5 - w           # top edge
            elif s == {4, 8}:  sdf = w - 0.5           # bottom edge
            elif s == {1, 8}:  sdf = 0.5 - u           # left edge
            elif s == {2, 4}:  sdf = u - 0.5           # right edge
            else:                                      # diagonal: two rounded corners
                sdf = 0.5 - np.minimum(dist(bits[0]), dist(bits[1]))
        if n in (1, 2, 3):
            f = np.clip(0.5 + sdf, 0.0, 1.0)
        fields.append(f)
    return fields


def make_tile(f, tex, rim, outline):
    """Compose one dual-grid tile: interior texture, rim band, dark outline, alpha."""
    rgb = tex.astype(np.float32).copy()
    inside = f >= 0.5
    rimband = inside & (f < 0.5 + RIM_BAND)
    rgb[rimband] = 0.5 * rgb[rimband] + 0.5 * np.array(rim, np.float32)
    edge = np.abs(f - 0.5) < OUT_BAND
    rgb[edge] = np.array(outline, np.float32)
    alpha = np.where(inside | edge, 255, 0).astype(np.uint8)
    # the outline straddles the contour, so include its outer half in the alpha
    alpha[edge] = 255
    out = np.dstack([rgb.clip(0, 255).astype(np.uint8), alpha])
    return Image.fromarray(out, "RGBA").resize((CELL, CELL), Image.LANCZOS)


def compose(bases):
    """Build tiles.png + tiles.json from base interior textures.
    `bases` maps "ground" and every MATERIALS key to a PIL image (any size)."""
    ASSETS.mkdir(parents=True, exist_ok=True)
    fields = corner_field()
    cols, rows = 16, len(MATERIALS) + 1
    sheet = Image.new("RGBA", (cols * CELL, rows * CELL), (0, 0, 0, 0))
    g = bases["ground"].convert("RGBA").resize((CELL, CELL), Image.LANCZOS)
    sheet.paste(g, (0, (rows - 1) * CELL))
    frames = {"ground": {"x": 0, "y": (rows - 1) * CELL, "w": CELL, "h": CELL}}
    materials = {}

    for row, (name, (_prompt, rim, outline)) in enumerate(MATERIALS.items()):
        tex = np.asarray(bases[name].convert("RGB").resize((N, N), Image.LANCZOS))
        masks = {}
        for c in range(16):
            tile = make_tile(fields[c], tex, rim, outline)
            sheet.paste(tile, (c * CELL, row * CELL), tile)
            fid = f"{name}_{c:02d}"
            frames[fid] = {"x": c * CELL, "y": row * CELL, "w": CELL, "h": CELL}
            masks[str(c)] = fid
        materials[name] = masks

    sheet.save(ASSETS / "tiles.png")
    desc = {"sheet": "tiles.png", "cell": CELL, "ground": "ground",
            "cornerBits": {"TL": 1, "TR": 2, "BR": 4, "BL": 8},
            "frames": frames, "materials": materials}
    (ASSETS / "tiles.json").write_text(json.dumps(desc, indent=2))
    print(f"wrote {ASSETS/'tiles.png'} ({sheet.width}x{sheet.height}) and tiles.json")


def material_prompt(name):
    prompt = GROUND[0] if name == "ground" else MATERIALS[name][0]
    return f"{prompt}. {TILE_STYLE}"


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    bases = {}
    for i, name in enumerate(["ground", *MATERIALS]):
        print(f"[{name}] ...", flush=True)
        b = generate(material_prompt(name), seed=3000 + i)
        b.convert("RGB").save(RAW / f"{name}.png")
        bases[name] = b
    compose(bases)


if __name__ == "__main__":
    main()
