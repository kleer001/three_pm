#!/usr/bin/env python3
"""Generate three_pm visual look-bible key art via local ComfyUI.

Target look (docs/14 cartoon-terror, art-direction call): flat, near-monochrome
silhouettes in a very limited but bright saturated palette, identity carried by
profile and shape — Baba Is You / Rain World register, not rendered cartoon.

Two interchangeable style backends so the look can be probed before committing:
  - minimalist_vector : SDXL Pony + Minimalist_vector_art LoRA (flat vector shapes)
  - milton_glaser     : Flux.1-dev + MiltonGlaser LoRA (bold flat poster shapes)

Each panel is an independent gen; the shared LoRA + suffix carry the look across
them. Writes PNGs to art-test/look-bible/img/<style>/<id>.png. The HTML bible is
assembled separately.

Requires the image_gen stack up (`imggen`, ComfyUI :8188). Run with the ComfyUI
venv:
  /media/menser/fauna/image_gen/comfyui/.venv/bin/python tools/gen_lookbible.py \
      --style minimalist_vector [id ...]

With no ids, generates every panel; pass ids to limit (probe). Seeds are fixed
per panel so reruns are stable.
"""
import argparse
import io
import json
import time
from pathlib import Path

import requests
from PIL import Image

BASE = "http://127.0.0.1:8188"
WF_DIR = Path("/media/menser/fauna/image_gen/workflows")
REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "art-test" / "look-bible" / "img"

# Flat-silhouette descriptors shared by every style; the style backend adds its
# own trigger words + palette/medium framing on top.
SHAPE_CHAR = ("flat bold simple shape, expressive silhouette, profile pose, minimal interior detail, "
              "very limited bright saturated palette, plain solid background")
SHAPE_ENV = ("flat bold simple shapes, limited bright saturated palette, minimal detail, "
             "clean graphic composition")
NEG = ("realistic, photo, 3d render, photorealistic, gradient, soft shading, detailed texture, "
       "busy background, clutter, blurry, gore, blood, watermark, text")

# `loras`: list of (filename, strength) chained in order. `chunk`: short-side px
# to downscale to (then nearest-neighbour up for crisp blocks) — None = full res.
STYLES = {
    "minimalist_vector": {
        "backend": "sdxl",
        "ckpt": "pony-diffusion-xl-v6.safetensors",
        "loras": [("Minimalist_vector_art.safetensors", 1.3)],
        "prefix": "score_9, score_8_up, score_7_up, ArsMJStyle, Minimalist Vector Art, ",
        "chunk": None,
    },
    "milton_glaser": {
        "backend": "flux",
        "loras": [("MiltonGlaser-Flux.safetensors", 0.85)],
        "prefix": "in the style of milton-glaser, ",
        "chunk": None,
    },
    # chosen direction: Glaser flat-bold shapes + pixel LoRA's flat hard-edge
    # blocks, then resize-down → nearest-up for Baba-style chunk.
    "glaser_chunky": {
        "backend": "flux",
        "loras": [("MiltonGlaser-Flux.safetensors", 0.7),
                  ("pixel_art_style_v1.0.safetensors", 0.9)],
        "prefix": "pixel_art_style, in the style of milton-glaser, ",
        "chunk": 72,
    },
}

P, L = 832, 1216   # portrait short/long sides

# id -> (group, label, subject prompt, w, h, kind)
PANELS = [
    ("marvin", "Heroes", "Marvin Merrick, the Median",
     "an average nervous teenage boy in a hoodie with a school backpack and a wrist smartwatch, standing", P, L, "char"),
    ("chad", "Heroes", "Chad 'Tank' Brawnson, the Varsity",
     "a big burly confident teenage wrestler in a letterman jacket, flexing", P, L, "char"),
    ("wendolyn", "Heroes", "Wendolyn Crowe, the Occultist",
     "a deadpan goth teenage girl in black holding a candle and a spellbook", P, L, "char"),
    ("dash", "Heroes", "Dash Velocity, the Track Star",
     "a lean teenage track sprinter in a running singlet, mid-stride sprinting pose", P, L, "char"),
    ("eugene", "Heroes", "Eugene 'Sparkplug' Okafor, the Robotics Nerd",
     "a teenage robotics nerd in goggles deploying a small turret", P, L, "char"),
    ("shambler", "Enemies", "Shambler (zombie family)",
     "a lurching zombie monster with droopy arms and a menacing grin", P, L, "char"),
    ("imp", "Enemies", "Imp (demon family)",
     "a small scuttling imp demon with little horns and tiny wings", P, L, "char"),
    ("cultist", "Enemies", "Cultist family",
     "a hooded cultist holding a glowing orb in a casting pose", P, L, "char"),
    ("brute", "Enemies", "Ghoul-Brute family",
     "a hulking lumbering monster brute with enormous arms and a tiny head swinging a club", P, L, "char"),
    ("street", "Environment", "Ruined suburb street (the descent)",
     "a ruined post-apocalyptic suburban street, cracked road running downhill, broken houses, overgrown lawns, empty", L, P, "env"),
    ("poof", "FX", "Bloodless death 'poof'",
     "a comic poof cloud of dust with cartoon stars and a tiny x-eyed ghost puff, bloodless", P, P, "char"),
]

# --- roster portraits (docs/19): full-body, relaxed, no weapon, expressive ---
PORTRAIT = ("full body head to toe, standing in a relaxed neutral pose, arms down at the sides, "
            "hands empty, holding nothing, no weapon, bold flat shapes, thick clean outlines, "
            "very limited bright saturated palette, plain solid {bg} background")

# id -> (signature-clothes + expressive description, background color)
ROSTER = [
    ("eugene",   "Eugene, a teenage robotics-club nerd, dark skin, short cropped hair, safety goggles "
                 "pushed up on his forehead, a utility tool-vest over a tee, cargo pants with many pockets, sneakers", "steel-blue"),
    ("chad",     "Chad, a big burly teenage wrestling jock, short buzzed hair, varsity letterman jacket over a "
                 "singlet, gym shorts, wrestling shoes, confident stance", "rust-orange"),
    ("dash",     "Dash, a lean teenage track sprinter, short fade haircut, holographic spiral sunglasses pushed up "
                 "on his head, sleeveless running singlet, track shorts, running spikes", "magenta"),
    ("wendolyn", "Wendolyn, a goth teenage girl, long straight black hair, pale skin, dark lipstick and eye makeup, "
                 "layered black dress with fishnet sleeves, chunky black boots", "deep-teal"),
    ("marvin",   "Marvin, an average teenage boy, messy brown hair, ordinary friendly face, red hoodie, jeans, "
                 "sneakers, a chunky kids GPS smartwatch on his wrist", "warm-yellow"),
    ("jess",     "Jess, a stylish popular teenage clubkid girl, sleek long hair with colorful streaks, trendy crop "
                 "top and cargo pants, platform shoes, glowstick bracelets", "hot-pink"),
    ("zigzag",   "ZigZag, a quirky art-class teenager, wild messy colorful hair, doodle tattoos on the arms, "
                 "paint-splattered tie-dye hoodie, mismatched socks, beat-up sneakers", "acid-green"),
    ("jasper",   "Jasper, a calm dreamy teenage philosophy nerd, soft tousled hair, serene expression, loose "
                 "earth-tone clothes, an open cardigan, a crystal pendant necklace, sandals", "soft-lavender"),
    ("valentine","Valentine, a retro-80s fashion-plate teenager, big voluminous 80s hair, a neon windbreaker, "
                 "high-waisted jeans, a fanny pack, chunky retro sneakers", "neon-purple"),
]


def _node(wf, class_type):
    return next(k for k, v in wf.items() if v.get("class_type") == class_type)


def gen_flux(style, prompt, seed, w, h):
    wf = json.loads((WF_DIR / "flux_txt2img.json").read_text())
    unet, msf = _node(wf, "UNETLoader"), _node(wf, "ModelSamplingFlux")
    txt, noise, latent = _node(wf, "CLIPTextEncode"), _node(wf, "RandomNoise"), _node(wf, "EmptySD3LatentImage")
    src = [unet, 0]
    for i, (name, strength) in enumerate(style["loras"]):       # chain model-only LoRAs
        nid = str(100 + i)
        wf[nid] = {"class_type": "LoraLoaderModelOnly",
                   "inputs": {"model": src, "lora_name": name, "strength_model": strength}}
        src = [nid, 0]
    wf[msf]["inputs"]["model"] = src
    wf[txt]["inputs"]["text"] = prompt
    wf[noise]["inputs"]["noise_seed"] = seed
    for n in (msf, latent):
        wf[n]["inputs"]["width"], wf[n]["inputs"]["height"] = w, h
    return wf


def gen_sdxl(style, prompt, seed, w, h):
    wf = json.loads((WF_DIR / "lora_basic.json").read_text())
    ckpt = _node(wf, "CheckpointLoaderSimple")
    lora = _node(wf, "LoraLoader")
    ks = _node(wf, "KSampler")
    latent = _node(wf, "EmptyLatentImage")
    pos, neg = sorted(k for k, v in wf.items() if v.get("class_type") == "CLIPTextEncode")
    name, strength = style["loras"][0]
    wf[ckpt]["inputs"]["ckpt_name"] = style["ckpt"]
    wf[lora]["inputs"].update(lora_name=name, strength_model=strength, strength_clip=strength)
    wf[pos]["inputs"]["text"] = prompt
    wf[neg]["inputs"]["text"] = NEG
    wf[ks]["inputs"].update(seed=seed, steps=28, cfg=6.5,
                            sampler_name="dpmpp_2m", scheduler="karras")
    wf[latent]["inputs"].update(width=w, height=h)
    return wf


def chunkify(im, short_px, view=480):
    """Resize down (averaging) then nearest-up → crisp Baba-style chunky blocks."""
    w, h = im.size
    if w <= h:
        tw, th = short_px, round(short_px * h / w)
    else:
        tw, th = round(short_px * w / h), short_px
    small = im.resize((tw, th), Image.BILINEAR)
    scale = view / min(tw, th)
    return small.resize((round(tw * scale), round(th * scale)), Image.NEAREST)


def render(wf):
    pid = requests.post(f"{BASE}/prompt", json={"prompt": wf}, timeout=30).json()["prompt_id"]
    deadline = time.time() + 300
    while time.time() < deadline:
        h = requests.get(f"{BASE}/history/{pid}", timeout=10).json().get(pid)
        if h and h.get("outputs"):
            img = next(o["images"][0] for o in h["outputs"].values() if o.get("images"))
            r = requests.get(f"{BASE}/view", params={
                "filename": img["filename"], "subfolder": img.get("subfolder", ""),
                "type": img.get("type", "output")}, timeout=30)
            return Image.open(io.BytesIO(r.content)).convert("RGB")
        time.sleep(1)
    raise TimeoutError(f"job {pid} timed out")


def portraits(style, ids, variants):
    out = OUT / "portraits"
    out.mkdir(parents=True, exist_ok=True)
    roster = [r for r in ROSTER if not ids or r[0] in ids]
    builder = gen_flux if style["backend"] == "flux" else gen_sdxl
    for hi, (pid, subject, bg) in enumerate(roster):
        for v in range(variants):
            prompt = f"{style['prefix']}{subject}, " + PORTRAIT.format(bg=bg)
            seed = 7000 + ROSTER.index(next(r for r in ROSTER if r[0] == pid)) * 10 + v
            print(f"[{hi+1}/{len(roster)}] {pid} variant {v+1}/{variants} ...", flush=True)
            render(builder(style, prompt, seed, P, L)).save(out / f"{pid}_{v+1}.png")
    print(f"wrote portraits ({len(roster)}x{variants}) to {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--style", choices=STYLES, default="milton_glaser")
    ap.add_argument("--portraits", action="store_true", help="generate roster portraits (3 variants each)")
    ap.add_argument("--variants", type=int, default=3)
    ap.add_argument("ids", nargs="*")
    args = ap.parse_args()
    style = STYLES[args.style]
    if args.portraits:
        portraits(style, args.ids, args.variants)
        return
    out = OUT / args.style
    out.mkdir(parents=True, exist_ok=True)
    panels = [p for p in PANELS if not args.ids or p[0] in args.ids]
    builder = gen_flux if style["backend"] == "flux" else gen_sdxl
    for i, (pid, group, label, subject, w, h, kind) in enumerate(panels):
        shape = SHAPE_CHAR if kind == "char" else SHAPE_ENV
        prompt = f"{style['prefix']}{subject}, {shape}"
        seed = 5000 + next(j for j, q in enumerate(PANELS) if q[0] == pid)
        print(f"[{i+1}/{len(panels)}] {args.style}/{pid} ({group}) ...", flush=True)
        im = render(builder(style, prompt, seed, w, h))
        if style.get("chunk"):
            im = chunkify(im, style["chunk"])
        im.save(out / f"{pid}.png")
    print(f"wrote {len(panels)} panel(s) to {out}")


if __name__ == "__main__":
    main()
