#!/usr/bin/env python3
"""Builds shots/phase2/before-after.png from the real before/after captures (stock rig vs upgraded soldier)."""
import os
import sys
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'shots', 'phase2')
poses = [
    ('idle front', 'raw-idle-a5-front.png', ['team0-idle-a5-front.png', 'team1-idle-a5-front.png']),
    ('run', 'raw-run-a5-three.png', ['team0-run-a5-three.png', 'team1-run-a5-three.png']),
    ('crouch', 'raw-crouch-a5-three.png', ['team0-crouch-a5-three.png']),
    ('fire (upper-body overlay)', 'raw-fire-a5-three.png', ['team0-fire-a5-three.png']),
    ('reload (upper-body overlay)', 'raw-reload-a5-three.png', ['team0-reload-a5-three.png']),
    ('death', 'raw-die-a5-three.png', ['team0-die-a5-three.png']),
]
CW, CH = 420, 520          # crop size per cell
cols = 3
sheet = Image.new('RGB', (CW * cols, (CH + 28) * len(poses) + 60), (24, 26, 30))
d = ImageDraw.Draw(sheet)
heads = ['BEFORE: stock Toolbench figure', 'AFTER: Vanguard', 'AFTER: Garrison']
for c, h in enumerate(heads):
    d.text((c * CW + 12, 20), h, fill=(235, 235, 235))
for r, (label, before, afters) in enumerate(poses):
    y0 = 60 + r * (CH + 28)
    d.text((8, y0 + 4), label, fill=(160, 200, 255))
    files = [os.path.join(ROOT, 'before', before)] + [os.path.join(ROOT, 'after', a) for a in afters]
    for c, f in enumerate(files):
        if not os.path.exists(f):
            continue
        im = Image.open(f).convert('RGB')
        w, h = im.size
        # crop around the figure, which is centred
        box = (w // 2 - 300, 40, w // 2 + 300, 40 + 740 if h >= 780 else h)
        im = im.crop((w // 2 - 330, 60, w // 2 + 330, 740)).resize((CW, CH), Image.LANCZOS)
        sheet.paste(im, (c * CW, y0 + 24))
out = os.path.join(ROOT, 'before-after.png')
sheet.save(out)
print('wrote', out, sheet.size)
