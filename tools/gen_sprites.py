#!/usr/bin/env python3
"""Generate the three_pm sprite atlas from Flux.1-dev via the local ComfyUI API.

Reproducible art pipeline: one prompt per sprite, background-keyed and packed into
assets/sprites.png + assets/sprites.json (the docs/09 descriptor format). Re-run to
regenerate; seeds are fixed per sprite so output is stable.

Requires the image_gen stack up (`imggen` on :8188). Run with the ComfyUI venv:
  /media/menser/fauna/image_gen/comfyui/.venv/bin/python tools/gen_sprites.py
"""
import json
import math
import time
from pathlib import Path

import requests
from PIL import Image, ImageDraw

BASE = "http://127.0.0.1:8188"
WORKFLOW = Path("/media/menser/fauna/image_gen/workflows/flux_txt2img.json")
REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "assets"
RAW = Path("/tmp/3pm_sprites")           # intermediate full-res gens (inspectable)
CELL = 48                                 # atlas cell px == tile size (24*2)
GEN = 768                                 # Flux render resolution (square)

# Cartoon-terror house style. Actors keyed off a flat chroma background.
ACTOR_STYLE = (
    "cartoon-terror video game character sprite, top-down three-quarter view from above, "
    "bold black outlines, flat cel shading, vibrant saturated colors, expressive, "
    "menacing yet comedic, no gore, full body centered, standing on nothing, no shadow, "
    "on a solid flat chroma-green background"
)
TILE_STYLE = (
    "top-down game floor tile texture, flat orthographic view straight down, no perspective, "
    "seamless repeating, bold readable, slightly grungy post-apocalyptic suburban, fills the frame"
)

# id -> (kind, prompt). kind: "actor" (keyed, transparent) | "tile" (opaque fill).
SPRITES = {
    # --- actors (match runScene KIND keys + the hero) ---
    "marvin":   ("actor", "a brave nervous middle-school boy in a red hoodie with a school backpack, sneakers, determined worried face"),
    "melee":    ("actor", "a hulking lumbering zombie brute with torn clothes, huge arms, dim menacing grin, orange-tan rotten skin, holding a wooden plank"),
    "ranged":   ("actor", "a hooded cultist caster in a green robe holding a glowing green orb in both hands, casting pose, shadowed face"),
    "wanderer": ("actor", "a small mischievous purple imp demon with little horns, beady eyes, tiny wings, scuttling pose"),
    # --- tiles (keys are docs/02 TILE type ids) ---
    "tile_street":   ("tile", "cracked gray asphalt road surface with faded lane paint"),
    "tile_sidewalk": ("tile", "light gray concrete sidewalk pavement with seams and small cracks"),
    "tile_yard":     ("tile", "overgrown green grass lawn, patchy and weedy"),
    "tile_alley":    ("tile", "dark dirty wet asphalt alley ground with grime stains"),
    "tile_floor":    ("tile", "warm brown wooden house floorboards, worn planks"),
    "tile_wall":     ("tile", "very dark charcoal house wall siding, weathered boards"),
    "tile_rubble":   ("tile", "pile of broken gray-tan rubble, shattered concrete and debris"),
}

# docs/02 TILE enum -> sprite id (consumed by the renderer's tile pass).
TILE_MAP = {0: "tile_street", 1: "tile_sidewalk", 2: "tile_yard", 3: "tile_alley",
            4: "tile_floor", 5: "tile_wall", 6: "tile_rubble"}

BG_THRESH = 70          # flood-fill tolerance for keying the chroma background
SENTINEL = (255, 0, 255)


def generate(prompt: str, seed: int) -> Image.Image:
    wf = json.loads(WORKFLOW.read_text())
    wf["6"]["inputs"]["text"] = prompt
    wf["25"]["inputs"]["noise_seed"] = seed
    wf["30"]["inputs"]["width"] = GEN
    wf["30"]["inputs"]["height"] = GEN
    wf["27"]["inputs"]["width"] = GEN
    wf["27"]["inputs"]["height"] = GEN
    pid = requests.post(f"{BASE}/prompt", json={"prompt": wf}, timeout=30).json()["prompt_id"]
    deadline = time.time() + 300
    while time.time() < deadline:
        h = requests.get(f"{BASE}/history/{pid}", timeout=10).json().get(pid)
        if h and h.get("outputs"):
            img = next(o["images"][0] for o in h["outputs"].values() if o.get("images"))
            r = requests.get(f"{BASE}/view", params={
                "filename": img["filename"], "subfolder": img.get("subfolder", ""),
                "type": img.get("type", "output")}, timeout=30)
            return Image.open(__import__("io").BytesIO(r.content)).convert("RGB")
        time.sleep(1)
    raise TimeoutError(f"flux job {pid} timed out")


def key_actor(im: Image.Image) -> Image.Image:
    """Flood-fill the chroma background from the corners, trim, fit into a CELL cell."""
    flat = im.copy()
    w, h = flat.size
    for c in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(flat, c, SENTINEL, thresh=BG_THRESH)
    px = flat.load()
    rgba = im.convert("RGBA")
    out = rgba.load()
    for y in range(h):
        for x in range(w):
            if px[x, y] == SENTINEL:
                out[x, y] = (0, 0, 0, 0)
    bbox = rgba.split()[3].getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
    rgba.thumbnail((CELL, CELL), Image.LANCZOS)
    cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    cell.paste(rgba, ((CELL - rgba.width) // 2, (CELL - rgba.height) // 2), rgba)
    return cell


def key_tile(im: Image.Image) -> Image.Image:
    """Center-crop to square and resize to a CELL opaque tile."""
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2))
    return im.resize((CELL, CELL), Image.LANCZOS).convert("RGBA")


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)
    cells = {}
    for i, (sid, (kind, prompt)) in enumerate(SPRITES.items()):
        style = ACTOR_STYLE if kind == "actor" else TILE_STYLE
        print(f"[{i+1}/{len(SPRITES)}] {sid} ...", flush=True)
        raw = generate(f"{prompt}. {style}", seed=1000 + i)
        raw.save(RAW / f"{sid}.png")
        cells[sid] = key_actor(raw) if kind == "actor" else key_tile(raw)

    # Pack into a square-ish grid atlas.
    ids = list(cells)
    cols = math.ceil(math.sqrt(len(ids)))
    rows = math.ceil(len(ids) / cols)
    sheet = Image.new("RGBA", (cols * CELL, rows * CELL), (0, 0, 0, 0))
    frames = {}
    for idx, sid in enumerate(ids):
        cx, cy = (idx % cols) * CELL, (idx // cols) * CELL
        sheet.paste(cells[sid], (cx, cy), cells[sid])
        frames[sid] = {"x": cx, "y": cy, "w": CELL, "h": CELL}
    sheet.save(ASSETS / "sprites.png")

    anims = {sid: {"idle": {"frames": [sid], "fps": 1, "loop": True}}
             for sid, (kind, _) in SPRITES.items() if kind == "actor"}
    descriptor = {
        "sheet": "assets/sprites.png",
        "frames": frames,
        "anims": anims,
        "tiles": {str(k): v for k, v in TILE_MAP.items()},
    }
    (ASSETS / "sprites.json").write_text(json.dumps(descriptor, indent=2))
    print(f"wrote {ASSETS/'sprites.png'} ({sheet.width}x{sheet.height}) and sprites.json")


if __name__ == "__main__":
    main()
