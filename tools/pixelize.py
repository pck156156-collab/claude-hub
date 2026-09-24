"""Turn Blender ID + lighting passes into palette-locked pixel art.

For every 4x4 block of the high-res render:
  material = the ID colour (flat pass), shade = light / mid / dark from the lit clay pass,
  then the block takes the most common (material, shade) and gets a 1px outline.

Usage: python3 tools/pixelize.py <raw_dir> <out_dir> [--scale 4]
Writes <out_dir>/<frame>.png, <out_dir>/sheet.png and <out_dir>/sheet.json (frame rects).
"""
import json
import os
import sys
from collections import Counter

from PIL import Image

# ID colour (0-255) -> palette ramp [light, mid, dark]. Keep in sync with chibi_ray.py ID.
MATERIALS = {
    (255, 0, 0): ('skin', ['#f2c79b', '#c98e62', '#8a5a3c']),
    (0, 255, 0): ('hair', ['#7a5236', '#5a3a22', '#3a2616']),
    (0, 0, 255): ('band', ['#e8604c', '#c8392b', '#8e2219']),
    (255, 255, 0): ('shirt', ['#b09c62', '#8a7a4a', '#6a5c36']),
    (255, 0, 255): ('vest', ['#7a8a4e', '#5b6b3a', '#3f4a28']),
    (0, 255, 255): ('pants', ['#8a7a4a', '#6a5c36', '#4a3f24']),
    (128, 0, 0): ('boot', ['#5a3a22', '#3a2616', '#231710']),
    (0, 128, 0): ('gun', ['#7c8290', '#4a4e57', '#2c2f36']),
    (0, 0, 128): ('belt', ['#6a5c36', '#4a3f24', '#2e2716']),
    (128, 128, 0): ('eye', ['#1b1b22', '#1b1b22', '#1b1b22']),
    (128, 0, 128): ('metal', ['#4a4e57', '#2c2f36', '#1b1b22']),
}
OUTLINE = '#1b1b22'
LIGHT, MID = 0.66, 0.42  # luminance thresholds


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def nearest_material(rgb):
    return min(MATERIALS, key=lambda k: sum((a - b) ** 2 for a, b in zip(k, rgb)))


def pixelize(id_path, lum_path, s):
    idp = Image.open(id_path).convert('RGBA')
    lum = Image.open(lum_path).convert('L')
    W, H = idp.size[0] // s, idp.size[1] // s
    ipx, lpx = idp.load(), lum.load()
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    opx = out.load()
    for by in range(H):
        for bx in range(W):
            votes = Counter()
            eye = 0
            opaque = 0
            for y in range(by * s, by * s + s):
                for x in range(bx * s, bx * s + s):
                    r, g, b, a = ipx[x, y]
                    if a < 128:
                        continue
                    opaque += 1
                    m = nearest_material((r, g, b))
                    if MATERIALS[m][0] == 'eye':
                        eye += 1
                    L = lpx[x, y] / 255
                    shade = 0 if L > LIGHT else 1 if L > MID else 2
                    votes[(m, shade)] += 1
            if opaque < 6:
                continue
            if eye >= 2:
                col = MATERIALS[(128, 128, 0)][1][0]
            else:
                (m, shade), _ = votes.most_common(1)[0]
                col = MATERIALS[m][1][shade]
            opx[bx, by] = (*hex_rgb(col), 255)
    # denoise: a pixel whose shade disagrees with 3+ same-material neighbours takes theirs
    ramp_of = {}
    for _, (_, ramp) in MATERIALS.items():
        for i, c in enumerate(ramp):
            ramp_of.setdefault(hex_rgb(c), (tuple(ramp), i))
    for _ in range(2):
        snap = out.copy().load()
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                p = snap[x, y]
                if not p[3] or p[:3] not in ramp_of:
                    continue
                ramp, _i = ramp_of[p[:3]]
                votes = Counter()
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    q = snap[x + dx, y + dy]
                    if q[3] and q[:3] in ramp_of and ramp_of[q[:3]][0] == ramp:
                        votes[q[:3]] += 1
                if votes:
                    c, n = votes.most_common(1)[0]
                    if n >= 3 and c != p[:3]:
                        opx[x, y] = (*c, 255)
    # outline
    src = out.copy().load()
    oc = (*hex_rgb(OUTLINE), 255)
    for y in range(H):
        for x in range(W):
            if src[x, y][3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and src[nx, ny][3]:
                    opx[x, y] = oc
                    break
    return out


def main():
    raw, out_dir = sys.argv[1], sys.argv[2]
    s = int(sys.argv[sys.argv.index('--scale') + 1]) if '--scale' in sys.argv else 4
    os.makedirs(out_dir, exist_ok=True)
    names = sorted({f[:-7] for f in os.listdir(raw) if f.endswith('_id.png')},
                   key=lambda n: (['idle', 'run', 'shoot', 'up'].index(n.split('_')[0]) if n.split('_')[0] in ['idle', 'run', 'shoot', 'up'] else 9, int(n.split('_')[-1])))
    frames = []
    for n in names:
        im = pixelize(os.path.join(raw, f'{n}_id.png'), os.path.join(raw, f'{n}_lum.png'), s)
        im.save(os.path.join(out_dir, f'{n}.png'))
        frames.append((n, im))
    fw, fh = frames[0][1].size
    sheet = Image.new('RGBA', (fw * len(frames), fh), (0, 0, 0, 0))
    meta = {}
    for i, (n, im) in enumerate(frames):
        sheet.paste(im, (i * fw, 0))
        meta[n] = {'x': i * fw, 'y': 0, 'w': fw, 'h': fh}
    sheet.save(os.path.join(out_dir, 'sheet.png'))
    with open(os.path.join(out_dir, 'sheet.json'), 'w') as f:
        json.dump({'frameWidth': fw, 'frameHeight': fh, 'frames': meta}, f, indent=1)
    print(f'{len(frames)} frames -> {out_dir}/sheet.png')


if __name__ == '__main__':
    main()
