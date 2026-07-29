import os
import sys
from collections import deque

import numpy as np
from PIL import Image

SRC_DIR = "/Users/mansoorsamim/.cursor/projects/Users-mansoorsamim-Developer-cardioapp/assets"
OUT_DIR = "/Users/mansoorsamim/Developer/cardioapp/assets/mascot"

POSES = [
    ("fox-idle.png", "pose-idle.png"),
    ("fox-jump-arms-down.png", "pose-jump.png"),
]

BG = np.array([10, 10, 15], dtype=np.float32)  # #0A0A0F
TOL = float(sys.argv[1]) if len(sys.argv) > 1 else 38.0
BRIDGE = int(sys.argv[2]) if len(sys.argv) > 2 else 14
CORE_TOL = 18.0
# Generated black outlines can be up to ~10 px wide. Closing at 12 px seals
# those internal channels before hole filling while preserving the much wider
# real gaps between the standing legs and between the jumping shoes.
CORE_CLOSE = 12

CANVAS_WIDTH = 923
CANVAS_HEIGHT = 1008
BASELINE = 978


def cutout(img: Image.Image):
    """Extract a solid fox silhouette without keying its black clothing."""
    image = img.convert("RGBA")
    rgb = np.asarray(image, dtype=np.float32)[:, :, :3]
    distance = np.sqrt(((rgb - BG) ** 2).sum(axis=2))

    # Stage 1: flood only the unambiguous background from the image border.
    # Keeping this threshold conservative prevents the flood from entering black
    # outlines, joggers, or shoes.
    external_core_background = flood_from_border(distance < min(CORE_TOL, TOL))

    # Stage 2: tolerance 38 identifies high-confidence non-background pixels.
    # Nearby-component grouping deliberately rejoins dark-outline-separated
    # torso, legs, and shoes without globally treating black as transparent.
    foreground_core = (~external_core_background) & (distance >= TOL)
    grouped_core = group_fox(foreground_core, BRIDGE)

    # Stage 2: close only narrow breaks in the grouped core, then fill enclosed
    # regions. This converts internal near-black seams back into solid clothing
    # while leaving the external near-black background outside the silhouette.
    silhouette = erode(dilate(grouped_core, CORE_CLOSE), CORE_CLOSE)
    silhouette = fill_holes(silhouette)

    alpha = np.where(silhouette, 255, 0).astype(np.uint8)
    outer_edge = boundary_inside(silhouette)
    alpha[outer_edge] = 140

    rgba = np.dstack([np.asarray(image)[:, :, :3], alpha]).astype(np.uint8)
    return rgba, silhouette


def flood_from_border(passable: np.ndarray) -> np.ndarray:
    """Return passable pixels connected to an image border."""
    h, w = passable.shape
    flooded = np.zeros_like(passable)
    queue = deque()

    for x in range(w):
        for y in (0, h - 1):
            if passable[y, x] and not flooded[y, x]:
                flooded[y, x] = True
                queue.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if passable[y, x] and not flooded[y, x]:
                flooded[y, x] = True
                queue.append((y, x))

    while queue:
        y, x = queue.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if (
                0 <= ny < h
                and 0 <= nx < w
                and passable[ny, nx]
                and not flooded[ny, nx]
            ):
                flooded[ny, nx] = True
                queue.append((ny, nx))
    return flooded


def label_components(mask: np.ndarray):
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
    out = mask.copy()
    for _ in range(r):
        nxt = out.copy()
        nxt[1:, :] |= out[:-1, :]
        nxt[:-1, :] |= out[1:, :]
        nxt[:, 1:] |= out[:, :-1]
        nxt[:, :-1] |= out[:, 1:]
        out = nxt
    return out


def erode(mask: np.ndarray, radius: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(radius):
        nxt = out.copy()
        nxt[:-1, :] &= out[1:, :]
        nxt[1:, :] &= out[:-1, :]
        nxt[:, :-1] &= out[:, 1:]
        nxt[:, 1:] &= out[:, :-1]
        nxt[0, :] = False
        nxt[-1, :] = False
        nxt[:, 0] = False
        nxt[:, -1] = False
        out = nxt
    return out


def fill_holes(mask: np.ndarray) -> np.ndarray:
    """Fill only background regions enclosed by the grouped fox silhouette."""
    h, w = mask.shape
    outside = np.zeros_like(mask)
    queue = deque()

    for x in range(w):
        for y in (0, h - 1):
            if not mask[y, x] and not outside[y, x]:
                outside[y, x] = True
                queue.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not mask[y, x] and not outside[y, x]:
                outside[y, x] = True
                queue.append((y, x))

    while queue:
        y, x = queue.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if (
                0 <= ny < h
                and 0 <= nx < w
                and not mask[ny, nx]
                and not outside[ny, nx]
            ):
                outside[ny, nx] = True
                queue.append((ny, nx))
    return ~outside


def boundary_inside(mask: np.ndarray) -> np.ndarray:
    """Return the one-pixel inner boundary of the outer silhouette."""
    interior = erode(mask, 1)
    return mask & ~interior


def group_fox(mask: np.ndarray, bridge: int) -> np.ndarray:
    """Keep the fox: seed from the largest raw component (its torso), then merge
    every fragment reachable within `bridge` px, while dropping far spillover."""
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
    cuts = []
    for src_name, out_name in POSES:
        img = Image.open(os.path.join(SRC_DIR, src_name))
        rgba, mask = cutout(img)
        kept = group_fox(mask, BRIDGE)
        rgba[~kept, 3] = 0
        box = content_bbox(kept)
        x0, y0, x1, y1 = box
        cw, ch = x1 - x0, y1 - y0
        crop = Image.fromarray(rgba, "RGBA").crop(box)
        cuts.append((out_name, crop, cw, ch))
        print(f"{src_name}: bbox={box} content={cw}x{ch}")

    # Fixed established registration: all hero poses use this canvas and ground.
    CW, CH = CANVAS_WIDTH, CANVAS_HEIGHT
    baseline = BASELINE
    print(f"shared canvas = {CW}x{CH} baseline_y={baseline}")

    os.makedirs(OUT_DIR, exist_ok=True)
    for out_name, crop, cw, ch in cuts:
        if cw > CW or ch > baseline:
            raise ValueError(
                f"{out_name} content {cw}x{ch} does not fit "
                f"{CW}x{CH} canvas at baseline {baseline}"
            )
        canvas = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
        px = (CW - cw) // 2
        py = baseline - ch  # bottom-align feet to the shared baseline
        # Do not pass the RGBA crop as a paste mask: doing so squares partial
        # edge alpha (140 -> 77). The crop already contains the intended alpha.
        canvas.paste(crop, (px, py))
        path = os.path.join(OUT_DIR, out_name)
        canvas.save(path)
        # sanity: report alpha coverage + edge margins to catch clipping/halo
        a = np.asarray(canvas)[:, :, 3]
        print(
            f"saved {out_name} size={canvas.size} feet_at={py + ch} "
            f"top_margin={py} bottom_margin={CH - (py + ch)} opaque_px={int((a > 200).sum())}"
        )


if __name__ == "__main__":
    main()
