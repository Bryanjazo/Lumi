#!/usr/bin/env python3
"""Lumi · regenerate Luna mood GIFs + their skin recolors.

Usage:
    python3 scripts/regen-luna-moods.py <mood> <source.gif> [pitch]

    mood    walk | lick | idle | happy | sad | sleep
    source  the new art GIF (any resolution on a uniform pixel grid)
    pitch   pixel-cell size in the source (default: auto-detect)

What it does:
  1. Downscales the source to its native pixel grid (samples cell
     centers) and crops to the content bounding box across frames.
  2. Recovers each skin's exact base→skin color mapping EMPIRICALLY
     from the existing (base idle, skin idle) GIF pair — no hand-kept
     palette tables to drift out of date. Colors the base idle doesn't
     contain (e.g. the grooming tongue red) pass through unchanged on
     every skin.
  3. Writes assets/luna-<mood>.gif plus
     assets/skins/luna-<skin>-<mood>.gif for every skin, preserving
     per-frame durations, transparency, and loop.

Requires Pillow. Run from the repo root.
"""

import math
import sys
from collections import Counter

from PIL import Image

SKINS = ["cream", "plum", "moss", "terra", "mist", "midnight"]


def frames_rgba(path):
    im = Image.open(path)
    out = []
    for f in range(getattr(im, "n_frames", 1)):
        im.seek(f)
        out.append((im.convert("RGBA"), im.info.get("duration", 100)))
    return out


def detect_pitch(path):
    """Smallest common run-length of identical pixels ≈ the cell size."""
    im = Image.open(path).convert("RGBA")
    px = im.load()
    w, h = im.size
    runs = []
    for y in range(0, h, max(1, h // 40)):
        run = 1
        for x in range(1, w):
            if px[x, y] == px[x - 1, y]:
                run += 1
            else:
                if run < 200:
                    runs.append(run)
                run = 1
    g = 0
    for r, _ in Counter(runs).most_common(12):
        g = math.gcd(g, r)
    return max(1, g)


def downscale(frames, pitch):
    out = []
    for im, dur in frames:
        w, h = im.size
        small = Image.new("RGBA", (w // pitch, h // pitch))
        px, sp = im.load(), small.load()
        for y in range(h // pitch):
            for x in range(w // pitch):
                sp[x, y] = px[x * pitch + pitch // 2, y * pitch + pitch // 2]
        out.append((small, dur))
    return out


def crop_all(frames, pad=1):
    l = t = 10**9
    r = b = -1
    for im, _ in frames:
        bbox = im.getbbox()
        if bbox:
            l = min(l, bbox[0])
            t = min(t, bbox[1])
            r = max(r, bbox[2])
            b = max(b, bbox[3])
    w, h = frames[0][0].size
    l, t = max(0, l - pad), max(0, t - pad)
    r, b = min(w, r + pad), min(h, b + pad)
    return [(im.crop((l, t, r, b)), dur) for im, dur in frames]


def recover_skin_maps():
    base_idle = frames_rgba("assets/luna-idle.gif")
    maps = {}
    for skin in SKINS:
        votes = {}
        skin_idle = frames_rgba(f"assets/skins/luna-{skin}-idle.gif")
        for (bf, _), (sf, _) in zip(base_idle, skin_idle):
            for bc, sc in zip(bf.getdata(), sf.getdata()):
                if bc[3] > 0 and sc[3] > 0:
                    votes.setdefault(bc[:3], Counter())[sc[:3]] += 1
        maps[skin] = {b: c.most_common(1)[0][0] for b, c in votes.items()}
    return maps


def recolor(frames, mapping):
    out = []
    for im, dur in frames:
        n = Image.new("RGBA", im.size)
        np_, px = n.load(), im.load()
        for y in range(im.size[1]):
            for x in range(im.size[0]):
                c = px[x, y]
                if c[3] == 0:
                    np_[x, y] = (0, 0, 0, 0)
                else:
                    np_[x, y] = (*mapping.get(c[:3], c[:3]), 255)
        out.append((n, dur))
    return out


def save_gif(frames, path):
    cols = []
    for im, _ in frames:
        for c in im.getdata():
            if c[3] > 0 and c[:3] not in cols:
                cols.append(c[:3])
    assert len(cols) <= 255, f"too many colors: {len(cols)}"
    pal = [(1, 2, 3)] + cols  # index 0 = transparent
    flat = []
    for c in pal:
        flat.extend(c)
    flat.extend([0, 0, 0] * (256 - len(pal)))
    idx = {c: i + 1 for i, c in enumerate(cols)}
    pframes, durs = [], []
    for im, dur in frames:
        p = Image.new("P", im.size, 0)
        p.putpalette(flat)
        pp, px = p.load(), im.load()
        for y in range(im.size[1]):
            for x in range(im.size[0]):
                c = px[x, y]
                pp[x, y] = idx[c[:3]] if c[3] > 0 else 0
        pframes.append(p)
        durs.append(dur)
    pframes[0].save(
        path,
        save_all=True,
        append_images=pframes[1:],
        duration=durs,
        loop=0,
        transparency=0,
        disposal=2,
        optimize=False,
    )
    print("wrote", path)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    mood, src = sys.argv[1], sys.argv[2]
    pitch = int(sys.argv[3]) if len(sys.argv) > 3 else detect_pitch(src)
    print(f"mood={mood} pitch={pitch}")
    frames = crop_all(downscale(frames_rgba(src), pitch))
    print("native size:", frames[0][0].size, "frames:", len(frames))
    save_gif(frames, f"assets/luna-{mood}.gif")
    for skin, mapping in recover_skin_maps().items():
        save_gif(recolor(frames, mapping), f"assets/skins/luna-{skin}-{mood}.gif")


if __name__ == "__main__":
    main()
