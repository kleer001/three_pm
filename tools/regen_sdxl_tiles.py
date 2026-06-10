#!/usr/bin/env python3
"""Regenerate ALL tile interior textures truly seamless on SDXL with circular-padding
tiling (spinagon/ComfyUI-seamless-tiling), then recompose tiles.png.

Circular padding patches the UNet + VAE conv2d to wrap, so opposite edges are
generated continuous — no vignette seam, and regular grids (brick) align across
the boundary. This is the reliable route for Flux's DiT can't be conv-patched, and
a texture LoRA only biases content without enforcing edge match. Requires the
seamless-tiling node loaded (restart ComfyUI after installing it).

Run with the ComfyUI venv (stack up, node loaded):
  /media/menser/fauna/image_gen/comfyui/.venv/bin/python tools/regen_sdxl_tiles.py
"""
import io
import time
from pathlib import Path

import requests
from PIL import Image

from gen_tiles import compose, MATERIALS, GROUND

BASE = "http://127.0.0.1:8188"
SEAM = Path("/tmp/3pm_tiles_seamless")
CKPT = "sd_xl_base_1.0.safetensors"
STYLE = ("seamless tileable texture, top-down orthographic view straight down, "
         "flat even lighting, no shadows, no vignette, fills the entire frame")
NEG = "text, watermark, signature, people, perspective, vignette, dark edges, border, frame"

# SDXL-friendly interior prompts (plainer than the cartoon sprite prompts)
PROMPTS = {
    "ground": "lush green grass lawn turf, short blades",
    "hedge":  "dense green boxwood hedge foliage, small leaves",
    "crater": "dark scorched dirt and rubble, charred cracked earth, small debris",
    "road":   "gray cracked asphalt road surface, fine grit",
    "brick":  "red brick wall, regular even brick courses, light gray mortar",
}


def sdxl_seamless(prompt, seed):
    wf = {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "20": {"class_type": "SeamlessTile",
               "inputs": {"model": ["4", 0], "tiling": "enable", "copy_model": "Make a copy"}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["4", 1], "text": f"{prompt}, {STYLE}"}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["4", 1], "text": NEG}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 1024, "height": 1024, "batch_size": 1}},
        "3": {"class_type": "KSampler",
              "inputs": {"model": ["20", 0], "positive": ["6", 0], "negative": ["7", 0],
                         "latent_image": ["5", 0], "seed": seed, "steps": 28, "cfg": 7,
                         "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1}},
        "21": {"class_type": "CircularVAEDecode",
               "inputs": {"samples": ["3", 0], "vae": ["4", 2], "tiling": "enable"}},
        "19": {"class_type": "SaveImage", "inputs": {"images": ["21", 0], "filename_prefix": "tile_seamless"}},
    }
    pid = requests.post(f"{BASE}/prompt", json={"prompt": wf}, timeout=30).json()["prompt_id"]
    deadline = time.time() + 300
    while time.time() < deadline:
        h = requests.get(f"{BASE}/history/{pid}", timeout=10).json().get(pid)
        if h and h.get("outputs"):
            o = next(x["images"][0] for x in h["outputs"].values() if x.get("images"))
            r = requests.get(f"{BASE}/view", params={
                "filename": o["filename"], "subfolder": o.get("subfolder", ""),
                "type": o.get("type", "output")}, timeout=30)
            return Image.open(io.BytesIO(r.content)).convert("RGB")
        time.sleep(1)
    raise TimeoutError(f"sdxl-seamless {pid} timed out")


def main():
    if "SeamlessTile" not in requests.get(f"{BASE}/object_info/SeamlessTile", timeout=5).json():
        raise SystemExit("SeamlessTile node not loaded — restart ComfyUI after installing it.")
    SEAM.mkdir(parents=True, exist_ok=True)
    for i, name in enumerate(["ground", *MATERIALS]):
        print(f"[sdxl {name}] ...", flush=True)
        img = sdxl_seamless(PROMPTS[name], seed=6000 + i)
        img.save(SEAM / f"{name}.png")
    bases = {n: Image.open(SEAM / f"{n}.png") for n in ["ground", *MATERIALS]}
    compose(bases)
    print(f"all 5 reseamed on SDXL; recomposed tiles.png from {SEAM}")


if __name__ == "__main__":
    main()
