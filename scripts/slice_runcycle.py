import os
import sys
from collections import deque

import numpy as np
from PIL import Image

STRIP = "/Users/mansoorsamim/.cursor/projects/Users-mansoorsamim-Developer-cardioapp/assets/fox-runcycle-strip.png"
OUT_DIR = "/Users/mansoorsamim/Developer/cardioapp/assets/mascot"

BG = np.array([10, 10, 15], dtype=np.float32)  # #0A0A0F
TOL = float(sys.argv[1]) if len(sys.argv) > 1 else 38.0
BRIDGE = int(sys.argv[2]) if len(sys.argv) > 2 else 12
FRAMES = 4


def cutout(cell: Image.Image):
    """Border BFS flood-fill against BG; preserves interior dark pixels.
    Returns (rgba_uint8, content_mask) where content_mask is True for kept pixels."""
    img = cell.convert("RGBA")
    rgb = np.asarray(img, dtype=np.float32)[:, :, :3]
    h, w = rgb.shape[:2]

    dist = np.sqrt(((rgb - BG) ** 2).sum(axis=2))
    near_bg = dist < TOL

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

    # Feather 1px: soften alpha where a kept pixel neighbours a removed one.
    soft = alpha.astype(np.float32)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        shifted = np.roll(transparent, (dy, dx), axis=(0, 1))
        edge = (~transparent) & shifted
        soft[edge] = 140.0
    alpha = soft.astype(np.uint8)

    out = np.dstack([np.asarray(img)[:, :, :3], alpha]).astype(np.uint8)
    return out, (~transparent)


def label_components(mask: np.ndarray):
    """4-connected labelling. Returns (labels, sizes) with 0 = background."""
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    sizes = [0]
    current = 0
    for sy in range(h):
        for sx in range(w):
            if mask[sy, sx] and labels[sy, sx] == 0:
                current += 1
                size = 0
                q = deque([(sy, sx)])
                labels[sy, sx] = current
                while q:
                    y, x = q.popleft()
                    size += 1
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and labels[ny, nx] == 0:
                            labels[ny, nx] = current
                            q.append((ny, nx))
                sizes.append(size)
    return labels, sizes


def dilate(mask: np.ndarray, r: int) -> np.ndarray:
    """Binary dilation by r 4-connected steps (numpy roll based)."""
    out = mask.copy()
    for _ in range(r):
        nxt = out.copy()
        nxt[1:, :] |= out[:-1, :]
        nxt[:-1, :] |= out[1:, :]
        nxt[:, 1:] |= out[:, :-1]
        nxt[:, :-1] |= out[:, 1:]
        out = nxt
    return out


def group_fox(mask: np.ndarray, bridge: int) -> np.ndarray:
    """Keep the fox: seed from the largest raw component (its torso), then merge
    every fragment reachable within `bridge` px (bridges the transparent seams
    the flood-fill opens between running limbs) while dropping neighbour spillover
    that sits farther away."""
    labels, sizes = label_components(mask)
    seed_label = int(np.argmax(sizes[1:]) + 1)
    seed = labels == seed_label

    grouped = seed.copy()
    while True:
        reach = dilate(grouped, bridge) & mask
        touched = set(np.unique(labels[reach])) - {0}
        merged = np.isin(labels, list(touched))
        if merged.sum() == grouped.sum():
            break
        grouped = merged
    return grouped


def content_bbox(mask: np.ndarray):
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def main():
    strip = Image.open(STRIP).convert("RGBA")
    W, H = strip.size
    cell_w = W // FRAMES

    rgbas = []
    boxes = []
    for i in range(FRAMES):
        left = i * cell_w
        right = (i + 1) * cell_w if i < FRAMES - 1 else W
        cell = strip.crop((left, 0, right, H))
        rgba, mask = cutout(cell)
        mask = group_fox(mask, BRIDGE)
        # Zero out alpha for pixels outside the kept fox (neighbour spillover).
        rgba[~mask, 3] = 0
        box = content_bbox(mask)
        rgbas.append(rgba)
        boxes.append(box)
        # Report how close the fox is to the cell edges to detect clipping.
        cw = right - left
        print(f"frame {i+1}: cell_w={cw} bbox={box} left_margin={box[0]} right_margin={cw - box[2]}")

    # Shared union bbox so every frame stays registered in the same position.
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[2] for b in boxes)
    y1 = max(b[3] for b in boxes)
    print(f"shared bbox = ({x0}, {y0}, {x1}, {y1}) size={x1 - x0}x{y1 - y0}")

    os.makedirs(OUT_DIR, exist_ok=True)
    for i, rgba in enumerate(rgbas):
        frame = Image.fromarray(rgba, "RGBA").crop((x0, y0, x1, y1))
        path = os.path.join(OUT_DIR, f"run-{i+1}.png")
        frame.save(path)
        print(f"saved {path} size={frame.size}")


if __name__ == "__main__":
    main()
