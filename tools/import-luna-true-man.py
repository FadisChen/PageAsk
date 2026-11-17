"""Build the true-man (Luna) avatar assets from Deskmate's realistic Luna, with the head straightened.

<raw dir>/upright.png is Deskmate's edit input (the reference at 0.9216x on light grey, 179px top offset, 1024x1536)
with Luna's head tilt removed by a Codex edit. The base is that image matted (flood fill from the border) and scaled
to the 1163x1353 canvas. The variants are Codex edits of upright.png; each is re-aligned to it (outside the
expression band), mapped onto the canvas and written as an opaque full-frame WebP.

Usage: uv run --with pillow --with numpy --with scipy python tools/import-luna-true-man.py <raw dir>
Raw names: upright, blink, look_left, look_right, sad, surprised, happy, angry, aa, ih, ee, oh, ou (.png)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "avatars/true-man/assets"
OUT = ASSETS / "variants-luna"
W, H = 1163, 1353
IN_W, IN_TOP, IN_H = 1024, 179, 1292  # edit input: width, top offset and height of the figure
F = H / IN_H  # edit input -> canvas
OX = (W - round(IN_W * F)) // 2
GREY = (224, 224, 224)
HAZE_ROWS = 590  # rows of the cropped figure above the shoulders
NAMES = {
    "blink": "blink.webp", "look_left": "gaze-left-soft.webp", "look_right": "gaze-right-soft.webp",
    "sad": "emotion-sad.webp", "surprised": "emotion-surprised.webp", "happy": "emotion-happy.webp",
    "angry": "emotion-angry.webp", "aa": "mouth-aa.webp", "ih": "mouth-ih.webp", "ee": "mouth-ee.webp",
    "oh": "mouth-oh.webp", "ou": "mouth-ou.webp",
}
# Edit-input rows that contain expression changes (eyebrows to chin); everything else must match the input.
BAND = (330, 760)


def matte(image):
    """RGBA from a figure on a flat light grey: flood fill the grey (and its low-chroma haze around the hair) from
    the border, then soften and decontaminate the edge."""
    pixels = np.asarray(image, dtype=np.float32)
    dist = np.abs(pixels - np.array(GREY, dtype=np.float32)).max(axis=2)
    chroma = pixels.max(axis=2) - pixels.min(axis=2)
    # Above the shoulders only hair and background exist, so grey-ish haze may be taken as background; below it the
    # cream sweater is nearly as grey as the backdrop, so the test stays strict.
    haze = np.zeros(dist.shape, bool)
    haze[:HAZE_ROWS] = True
    labels, _ = ndimage.label(np.where(haze, (dist < 30) & (chroma < 18), dist < 8))
    border = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))) - {0}
    background = np.isin(labels, list(border))
    near = ndimage.binary_dilation(background, iterations=3)
    alpha = np.where(near, np.clip((dist - np.where(haze, 12, 4)) / np.where(haze, 28, 24), 0, 1), 1.0)
    alpha[background] = 0
    safe = np.maximum(alpha, 0.05)[..., None]
    clean = np.where(near[..., None], (pixels - (1 - safe) * np.array(GREY, dtype=np.float32)) / safe, pixels)
    rgba = np.dstack([np.clip(clean, 0, 255), alpha * 255]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def base_image(reference):
    figure = matte(reference.crop((0, IN_TOP, IN_W, IN_TOP + IN_H)))
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    canvas.alpha_composite(figure.resize((round(IN_W * F), H), Image.LANCZOS), (OX, 0))
    return canvas


def align(raw, ref, mask):
    """Best (zoom, dx, dy) mapping raw onto ref outside the expression band; returns (params, mae)."""
    ref_a = np.asarray(ref, dtype=np.float32)
    best = None
    for zoom in (0.99, 0.995, 1.0, 1.005, 1.01):
        zoomed = raw.resize((round(raw.width * zoom), round(raw.height * zoom)), Image.LANCZOS)
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                frame = Image.new("RGB", raw.size, GREY)
                frame.paste(zoomed, (dx, dy))
                err = np.abs(np.asarray(frame, dtype=np.float32) - ref_a)[mask].mean()
                if best is None or err < best[1]:
                    best = ((zoom, dx, dy), err)
    return best


def to_canvas(raw, params, base):
    zoom, dx, dy = params
    frame = Image.new("RGB", raw.size, GREY)
    frame.paste(raw.resize((round(raw.width * zoom), round(raw.height * zoom)), Image.LANCZOS), (dx, dy))
    f = F
    scaled = frame.resize((round(frame.width * f), round(frame.height * f)), Image.LANCZOS)
    out = Image.new("RGB", (W, H), GREY)
    out.paste(base.convert("RGB"), (0, 0), base.getchannel("A"))
    out.paste(scaled, (OX, -round(IN_TOP * f)))
    return out


def main(raw_dir):
    ref = Image.open(Path(raw_dir) / "upright.png").convert("RGB")
    base = base_image(ref)
    ASSETS.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    base.save(ASSETS / "luna-base-alpha.webp", lossless=True)
    alpha = np.asarray(matte(ref).getchannel("A"))
    mask = alpha > 250
    mask[:IN_TOP] = False
    mask[BAND[0]:BAND[1], :] = False
    mask[:, :8] = mask[:, -8:] = False
    for name, target in NAMES.items():
        path = Path(raw_dir) / f"{name}.png"
        if not path.exists():
            print(f"{name}: missing")
            continue
        raw = Image.open(path).convert("RGB")
        params, mae = align(raw, ref, mask)
        out = to_canvas(raw, params, base)
        out.save(OUT / target, quality=92, method=6)
        print(f"{name} -> {target} zoom={params[0]} dx={params[1]} dy={params[2]} MAE={mae:.1f}")


if __name__ == "__main__":
    main(sys.argv[1])
