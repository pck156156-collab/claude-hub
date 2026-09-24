"""Convert AI concept art (pixel-look images on a flat magenta background) into game-size sprites.

Steps per source image:
  1. key out the magenta background
  2. split multi-pose sheets into single poses (empty-row / empty-column gaps)
  3. scale every pose by ONE shared factor so the reference pose is `--height` px tall
  4. downsample by majority colour per block, snap to the palette, clean alpha, outline
  5. place in a WxH cell: feet on the bottom row, body centre on x = W/2

Usage:
  python3 tools/import_concepts.py <config.json>

config.json:
  { "src": "<dir>", "out": "<dir>", "frame": [40, 44], "height": 36, "reference": "idle_0",
    "poses": { "idle_0": "ray-idle-generated-v1.png", "run_0": ["ray-run-8-concept.png", 0], ... } }
  A list value [file, index] picks the index-th pose (reading order) from a sheet.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

PALETTE = [
    '#1b1b22',  # outline
    '#f2c79b', '#c98e62', '#8a5a3c',  # skin
    '#7a5236', '#5a3a22', '#3a2616',  # hair / boots
    '#e8604c', '#c8392b', '#8e2219',  # bandana
    '#7a8a4e', '#5b6b3a', '#3f4a28',  # vest
    '#b09c62', '#8a7a4a', '#6a5c36',  # shirt / pants
    '#9aa3ab', '#7c8290', '#4a4e57', '#2c2f36',  # gun / metal
    '#ffffff', '#dfe6ee',  # steel highlight, slash arc
    '#fff3b0', '#ffb23f', '#e5542c',  # muzzle flash
]
# Off-palette shades the concept art uses for the same material -> the palette colour they stand for.
ALIASES = {
    '#eabd6f': '#f2c79b', '#fcc775': '#f2c79b', '#fbd79d': '#f2c79b', '#e78b4c': '#c98e62',  # skin
    '#ddbd52': '#b09c62', '#d4b159': '#b09c62',  # yellowish khaki pants
    '#bca14c': '#8a7a4a', '#af965b': '#8a7a4a',
    '#8f7a34': '#6a5c36',
    '#693416': '#5a3a22', '#6a4b2a': '#5a3a22', '#6b4538': '#5a3a22',  # hair
    '#61722a': '#5b6b3a', '#747136': '#5b6b3a', '#737a37': '#7a8a4e',  # vest
}
MATCH = PALETTE + list(ALIASES)
OUT = PALETTE + [ALIASES[k] for k in ALIASES]
hexrgb = lambda c: [int(c[i:i + 2], 16) for i in (1, 3, 5)]
PAL = np.array([hexrgb(c) for c in OUT], dtype=np.int32)
MATCH_RGB = np.array([hexrgb(c) for c in MATCH], dtype=np.int32)
OUTLINE = PAL[0]


def key_magenta(img):
    a = np.asarray(img.convert('RGB')).astype(np.int32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mag = np.minimum(r, b) - g
    bg = (mag > 70) & (r > 140) & (b > 140)
    return a, ~bg


def split_poses(mask, min_gap=6, min_size=40):
    """Return bounding boxes (x0, y0, x1, y1) of poses in reading order."""
    def runs(profile, gap):
        out, start, empty = [], None, 0
        for i, v in enumerate(profile):
            if v:
                if start is None:
                    start = i
                empty = 0
            elif start is not None:
                empty += 1
                if empty >= gap:
                    out.append((start, i - empty + 1))
                    start, empty = None, 0
        if start is not None:
            out.append((start, len(profile) - empty))
        return out

    boxes = []
    for y0, y1 in runs(mask.any(axis=1), min_gap * 3):
        band = mask[y0:y1]
        for x0, x1 in runs(band.any(axis=0), min_gap):
            sub = band[:, x0:x1]
            ys = np.where(sub.any(axis=1))[0]
            if x1 - x0 >= min_size and len(ys):
                boxes.append((x0, y0 + ys[0], x1, y0 + ys[-1] + 1))
    return boxes


def to_lab(rgb):
    c = rgb.astype(np.float64) / 255
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ m.T / np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], axis=1)


PAL_LAB = to_lab(MATCH_RGB)


def snap(colors):
    """Nearest palette colour in CIELAB (keeps browns brown instead of drifting to red)."""
    uniq, inv = np.unique(colors, axis=0, return_inverse=True)
    d = ((to_lab(uniq)[:, None, :] - PAL_LAB[None, :, :]) ** 2).sum(-1)
    return PAL[d.argmin(1)][inv.reshape(-1)]


def downsample(rgb, mask, scale):
    """Majority colour (after palette snap) in each source block."""
    h, w = mask.shape
    oh, ow = max(1, round(h * scale)), max(1, round(w * scale))
    out = np.zeros((oh, ow, 4), dtype=np.uint8)
    flat = snap(rgb.reshape(-1, 3)).reshape(h, w, 3)
    for oy in range(oh):
        sy0, sy1 = int(oy / scale), max(int(oy / scale) + 1, int((oy + 1) / scale))
        for ox in range(ow):
            sx0, sx1 = int(ox / scale), max(int(ox / scale) + 1, int((ox + 1) / scale))
            m = mask[sy0:sy1, sx0:sx1]
            if m.mean() < 0.45:
                continue
            cols = flat[sy0:sy1, sx0:sx1][m]
            keys, counts = np.unique(cols, axis=0, return_counts=True)
            # prefer outline when it is a strong minority, so thin outlines survive
            dark = np.all(keys == OUTLINE, axis=1)
            if dark.any() and counts[dark][0] >= 0.3 * counts.sum():
                c = OUTLINE
            else:
                c = keys[counts.argmax()]
            out[oy, ox, :3] = c
            out[oy, ox, 3] = 255
    return out


def add_outline(px):
    a = px[..., 3] > 0
    grow = np.zeros_like(a)
    grow[1:, :] |= a[:-1, :]
    grow[:-1, :] |= a[1:, :]
    grow[:, 1:] |= a[:, :-1]
    grow[:, :-1] |= a[:, 1:]
    ring = grow & ~a
    # only where the neighbouring pixel is not already outline colour
    px = px.copy()
    px[ring, :3] = OUTLINE
    px[ring, 3] = 255
    return px


def body_center_x(px):
    a = px[..., 3] > 0
    ys, xs = np.where(a)
    top, bot = ys.min(), ys.max()
    h = bot - top + 1
    band = (ys >= top + 0.45 * h) & (ys <= top + 0.8 * h)
    return float(np.median(xs[band])) if band.any() else float(np.median(xs))


def main():
    cfg = json.load(open(sys.argv[1]))
    src, out = cfg['src'], cfg['out']
    fw, fh = cfg.get('frame', [40, 44])
    os.makedirs(os.path.join(out, 'frames'), exist_ok=True)

    # cut every pose out of its source
    cache, poses = {}, {}
    for name, spec in cfg['poses'].items():
        file, idx = (spec, 0) if isinstance(spec, str) else spec
        if file not in cache:
            rgb, mask = key_magenta(Image.open(os.path.join(src, file)))
            cache[file] = (rgb, mask, split_poses(mask))
        rgb, mask, boxes = cache[file]
        x0, y0, x1, y1 = boxes[idx]
        poses[name] = (rgb[y0:y1, x0:x1], mask[y0:y1, x0:x1])

    ref_h = poses[cfg['reference']][1].shape[0]
    scale = cfg.get('height', 36) / ref_h
    # Sheets are drawn at their own size: scale each so its tallest pose matches a height.
    sheet_scale = {}
    for file, target in cfg.get('sheet_heights', {}).items():
        _rgb, _mask, boxes = cache[file]
        sheet_scale[file] = target / max(b[3] - b[1] for b in boxes)
    pose_file = {n: (s if isinstance(s, str) else s[0]) for n, s in cfg['poses'].items()}
    report = {'scale': scale, 'frames': {}}
    sheet_imgs = []
    for name, (rgb, mask) in poses.items():
        px = add_outline(downsample(rgb, mask, sheet_scale.get(pose_file[name], scale)))
        h, w = px.shape[:2]
        cx = body_center_x(px)
        cell = np.zeros((fh, fw, 4), dtype=np.uint8)
        ox = int(round(fw / 2 - cx))
        oy = fh - h  # feet on the bottom row
        # paste with clipping
        sx0, sy0 = max(0, -ox), max(0, -oy)
        dx0, dy0 = max(0, ox), max(0, oy)
        cw, ch = min(w - sx0, fw - dx0), min(h - sy0, fh - dy0)
        cell[dy0:dy0 + ch, dx0:dx0 + cw] = px[sy0:sy0 + ch, sx0:sx0 + cw]
        clipped = w > fw or h > fh or ox < 0 or ox + w > fw
        Image.fromarray(cell).save(os.path.join(out, 'frames', f'{name}.png'))
        Image.fromarray(px).save(os.path.join(out, 'frames', f'{name}_full.png'))
        report['frames'][name] = {'size': [int(w), int(h)], 'clipped': bool(clipped)}
        sheet_imgs.append((name, cell))

    sheet = Image.new('RGBA', (fw * len(sheet_imgs), fh))
    atlas = {'frames': {}, 'meta': {'image': 'sheet.png', 'size': {'w': fw * len(sheet_imgs), 'h': fh}, 'scale': '1'}}
    for i, (name, cell) in enumerate(sheet_imgs):
        sheet.paste(Image.fromarray(cell), (i * fw, 0))
        atlas['frames'][name] = {'frame': {'x': i * fw, 'y': 0, 'w': fw, 'h': fh}, 'rotated': False, 'trimmed': False,
                                 'spriteSourceSize': {'x': 0, 'y': 0, 'w': fw, 'h': fh}, 'sourceSize': {'w': fw, 'h': fh}}
    sheet.save(os.path.join(out, 'sheet.png'))
    json.dump(atlas, open(os.path.join(out, 'sheet.json'), 'w'), indent=1)
    json.dump(report, open(os.path.join(out, 'report.json'), 'w'), indent=1)
    print(json.dumps(report))


if __name__ == '__main__':
    main()
