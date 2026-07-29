import os
import sys
from collections import deque

import numpy as np
from PIL import Image

SRC = "/Users/mansoorsamim/Developer/cardioapp/assets/mascot/fox.png"
DARK = "/Users/mansoorsamim/Developer/cardioapp/assets/mascot/fox-dark.png"
AVATAR = "/Users/mansoorsamim/Developer/cardioapp/assets/mascot/fox-avatar.png"

BG = np.array([10, 10, 15], dtype=np.float32)  # #0A0A0F
TOL = float(sys.argv[1]) if len(sys.argv) > 1 else 60.0

# Always start from the pristine dark-bg original so retuning is idempotent.
if not os.path.exists(DARK):
    Image.open(SRC).convert("RGBA").save(DARK)

img = Image.open(DARK).convert("RGBA")

rgb = np.asarray(img, dtype=np.float32)[:, :, :3]
h, w = rgb.shape[:2]

dist = np.sqrt(((rgb - BG) ** 2).sum(axis=2))
near_bg = dist < TOL

# BFS flood-fill from all border pixels; only remove background-connected pixels
transparent = np.zeros((h, w), dtype=bool)
visited = np.zeros((h, w), dtype=bool)
q = deque()

for x in range(w):
    for y in (0, h - 1):
        if near_bg[y, x] and not visited[y, x]:
            visited[y, x] = True
            q.append((y, x))
for y in range(h):
    for x in (0, w - 1):
        if near_bg[y, x] and not visited[y, x]:
            visited[y, x] = True
            q.append((y, x))

while q:
    y, x = q.popleft()
    transparent[y, x] = True
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and near_bg[ny, nx]:
            visited[ny, nx] = True
            q.append((ny, nx))

alpha = np.where(transparent, 0, 255).astype(np.uint8)

# Feather the edge 1px: soften alpha where a kept pixel neighbours a removed one
soft = alpha.astype(np.float32)
for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
    shifted = np.roll(transparent, (dy, dx), axis=(0, 1))
    edge = (~transparent) & shifted
    soft[edge] = 140.0
alpha = soft.astype(np.uint8)

out = np.dstack([np.asarray(img)[:, :, :3], alpha]).astype(np.uint8)
result = Image.fromarray(out, "RGBA")

# Auto-crop to opaque bounding box
bbox = result.getbbox()
if bbox:
    result = result.crop(bbox)

result.save(SRC)

# Square avatar version
side = max(result.size)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(result, ((side - result.width) // 2, (side - result.height) // 2))
square.thumbnail((512, 512), Image.LANCZOS)
square.save(AVATAR)

print("size", result.size, "avatar", square.size, "removed_px", int(transparent.sum()))
