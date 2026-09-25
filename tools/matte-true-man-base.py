"""Bake a real alpha matte into the 真人 Avatar base photo.

The generated portrait has a fake checkerboard "transparent" background.
A strict flood fill leaves checker pockets between hair strands and grey
fringes on every strand. This script:
  1. flood-fills pixels that are clearly checkerboard from the border, then
     adds enclosed checker pockets between strands near that background;
  2. in a band next to that background, where the nearby foreground is dark
     hair, unmixes each pixel against the two checker greys (least squares,
     P = a*F + (1-a)*B) to recover a soft alpha and the hair colour.

Usage: python tools/matte-true-man-base.py <checker-input.png> <output.png>
The original checker input is avatars/true-man/assets/avatar-base-v5.png in
commit 714c1b4.
"""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

BAND_RADIUS = 6
POCKET_RADIUS = 60
HAIR_WINDOW = 21
HAIR_LUMA_MAX = 140
CHECKER_GREYS = (np.array([253.0, 253.0, 253.0]), np.array([192.0, 192.0, 192.0]))


def is_checker(rgb, max_spread=14, min_value=150):
    spread = rgb.max(axis=2) - rgb.min(axis=2)
    return (spread <= max_spread) & (rgb.min(axis=2) >= min_value)


def main(source, target):
    rgb = np.asarray(Image.open(source).convert("RGB")).astype(np.float64)
    height, width, _ = rgb.shape
    checker = is_checker(rgb)
    labels, _ = ndimage.label(checker)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    background = np.isin(labels, border[border > 0])
    luma = rgb @ np.array([0.299, 0.587, 0.114])
    # Pockets trapped between strands are not connected to the border; they are
    # surrounded by dark strands, unlike light clothing near the background.
    between_strands = ndimage.uniform_filter((luma < HAIR_LUMA_MAX).astype(np.float64), 9) > 0.2
    near_background = ndimage.distance_transform_edt(~background) <= POCKET_RADIUS
    background |= is_checker(rgb, 22, 135) & near_background & between_strands

    hair = ~background & (luma < HAIR_LUMA_MAX)
    # Local mean colour of dark hair pixels: the foreground F for unmixing.
    weight = ndimage.uniform_filter(hair.astype(np.float64), HAIR_WINDOW)
    hair_colour = np.stack([ndimage.uniform_filter(rgb[..., c] * hair, HAIR_WINDOW) for c in range(3)], axis=2)
    has_hair = weight > 0.08
    hair_colour[has_hair] /= weight[has_hair, None]

    distance = ndimage.distance_transform_edt(~background)
    band = ~background & (distance <= BAND_RADIUS) & has_hair

    alpha = np.where(background, 0.0, 1.0)
    colour = rgb.copy()
    pixels = rgb[band]
    fg = hair_colour[band]
    best_alpha = np.ones(len(pixels))
    best_error = np.full(len(pixels), np.inf)
    best_grey = np.zeros_like(pixels)
    for grey in CHECKER_GREYS:
        direction = fg - grey
        a = np.clip(((pixels - grey) * direction).sum(axis=1) / np.maximum((direction ** 2).sum(axis=1), 1e-6), 0, 1)
        error = np.linalg.norm(pixels - grey - a[:, None] * direction, axis=1)
        better = error < best_error
        best_alpha[better] = a[better]
        best_error[better] = error[better]
        best_grey[better] = grey
    # Pixels the linear model cannot explain are real detail (highlights); keep them.
    unexplained = best_error > 55
    best_alpha[unexplained] = 1.0
    alpha[band] = best_alpha
    # Recover the strand colour; nearly transparent pixels just take the local hair colour.
    safe = np.maximum(best_alpha, 1e-3)[:, None]
    unmixed = np.clip((pixels - (1 - safe) * best_grey) / safe, 0, 255)
    unmixed[unexplained] = pixels[unexplained]
    colour[band] = np.where(best_alpha[:, None] < 0.35, fg, unmixed)
    colour[background] = 0

    rgba = np.dstack([colour, alpha * 255]).round().clip(0, 255).astype(np.uint8)
    Image.fromarray(rgba).save(target, optimize=True)
    print(f"background {background.mean():.1%}, band {band.sum()} px -> {target}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
