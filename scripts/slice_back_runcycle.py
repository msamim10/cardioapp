import os
import sys
from collections import deque

import numpy as np
from PIL import Image

STRIP = "/Users/mansoorsamim/.cursor/projects/Users-mansoorsamim-Developer-cardioapp/assets/fox-back-runcycle-v2.png"
OUT_DIR = "/Users/mansoorsamim/Developer/cardioapp/assets/mascot"

BG = np.array([10, 10, 15], dtype=np.float32)  # #0A0A0F
TOL = float(sys.argv[1]) if len(sys.argv) > 1 else 38.0
BRIDGE = int(sys.argv[2]) if len(sys.argv) > 2 else 16
CORE_TOL = 18.0
EDGE_GROW = 2
FRAMES = 4
# The generated characters extend slightly beyond their nominal equal-width
# cells. Include neighbouring pixels while grouping only fragments connected
# to the current fox, which keeps the right-shifted tail from being clipped.
CELL_OVERLAP = 96
CANVAS_WIDTH = 360
CANVAS_HEIGHT = 630
BASELINE = 622


def cutout(cell: Image.Image):
    """Remove only near-background pixels connected to a cell border."""
    image = cell.convert("RGBA")
    rgb = np.asarray(image, dtype=np.float32)[:, :, :3]
    height, width = rgb.shape[:2]
    distance = np.sqrt(((rgb - BG) ** 2).sum(axis=2))
    near_bg = distance < TOL
    core_bg = distance < min(CORE_TOL, TOL)

    # Flood only the unambiguous background through the full image. The wider
    # tolerance is limited to a short edge cleanup so it cannot travel through
    # black outlines and hollow out either pant leg or shoe.
    transparent = np.zeros((height, width), dtype=bool)
    visited = np.zeros((height, width), dtype=bool)
    queue = deque()

    for x in range(width):
        for y in (0, height - 1):
            if core_bg[y, x] and not visited[y, x]:
                visited[y, x] = True
                queue.append((y, x))
    for y in range(height):
        for x in (0, width - 1):
            if core_bg[y, x] and not visited[y, x]:
                visited[y, x] = True
                queue.append((y, x))

    while queue:
        y, x = queue.popleft()
        transparent[y, x] = True
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if (
                0 <= ny < height
                and 0 <= nx < width
                and not visited[ny, nx]
                and core_bg[ny, nx]
            ):
                visited[ny, nx] = True
                queue.append((ny, nx))

    for _ in range(EDGE_GROW):
        adjacent = np.zeros_like(transparent)
        adjacent[1:, :] |= transparent[:-1, :]
        adjacent[:-1, :] |= transparent[1:, :]
        adjacent[:, 1:] |= transparent[:, :-1]
        adjacent[:, :-1] |= transparent[:, 1:]
        transparent |= adjacent & near_bg

    alpha = np.where(transparent, 0, 255).astype(np.float32)
    # One-pixel feather on the retained side of the cutout boundary.
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        shifted = np.roll(transparent, (dy, dx), axis=(0, 1))
        alpha[(~transparent) & shifted] = 140

    rgba = np.dstack([np.asarray(image)[:, :, :3], alpha.astype(np.uint8)])
    return rgba.astype(np.uint8), ~transparent


def label_components(mask: np.ndarray):
    height, width = mask.shape
    labels = np.zeros((height, width), dtype=np.int32)
    sizes = [0]
    current = 0

    for start_y in range(height):
        for start_x in range(width):
            if not mask[start_y, start_x] or labels[start_y, start_x] != 0:
                continue
            current += 1
            size = 0
            queue = deque([(start_y, start_x)])
            labels[start_y, start_x] = current
            while queue:
                y, x = queue.popleft()
                size += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if (
                        0 <= ny < height
                        and 0 <= nx < width
                        and mask[ny, nx]
                        and labels[ny, nx] == 0
                    ):
                        labels[ny, nx] = current
                        queue.append((ny, nx))
            sizes.append(size)
    return labels, sizes


def dilate(mask: np.ndarray, radius: int):
    expanded = mask.copy()
    for _ in range(radius):
        next_mask = expanded.copy()
        next_mask[1:, :] |= expanded[:-1, :]
        next_mask[:-1, :] |= expanded[1:, :]
        next_mask[:, 1:] |= expanded[:, :-1]
        next_mask[:, :-1] |= expanded[:, 1:]
        expanded = next_mask
    return expanded


def group_fox(mask: np.ndarray, bridge: int):
    """Merge nearby fox fragments while excluding distant cell debris."""
    labels, sizes = label_components(mask)
    seed = labels == int(np.argmax(sizes[1:]) + 1)
    grouped = seed.copy()

    while True:
        reachable = dilate(grouped, bridge) & mask
        touched = set(np.unique(labels[reachable])) - {0}
        merged = np.isin(labels, list(touched))
        if merged.sum() == grouped.sum():
            return grouped
        grouped = merged


def content_bbox(mask: np.ndarray):
    ys, xs = np.where(mask)
    if len(xs) == 0:
        raise ValueError("No foreground content found")
    return int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)


def main():
    strip = Image.open(STRIP).convert("RGBA")
    width, height = strip.size
    if width % FRAMES:
        raise ValueError(f"Strip width {width} is not divisible by {FRAMES}")
    cell_width = width // FRAMES

    cuts = []
    for index in range(FRAMES):
        cell_left = max(0, index * cell_width - CELL_OVERLAP)
        cell_right = min(width, (index + 1) * cell_width + CELL_OVERLAP)
        cell = strip.crop((cell_left, 0, cell_right, height))
        rgba, mask = cutout(cell)
        kept = group_fox(mask, BRIDGE)
        rgba[~kept, 3] = 0
        bbox = content_bbox(kept)
        crop = Image.fromarray(rgba, "RGBA").crop(bbox)
        cuts.append((crop, bbox[2] - bbox[0], bbox[3] - bbox[1]))
        print(
            f"frame {index + 1}: bbox={bbox} "
            f"crop_x=({cell_left}, {cell_right}) "
            f"crop_margins=({bbox[0]}, {cell_right - cell_left - bbox[2]})"
        )

    # Keep the established run canvas and registration so MascotHero can swap
    # the v2 frames without changing its dimensions or aspect handling.
    canvas_width = CANVAS_WIDTH
    canvas_height = CANVAS_HEIGHT
    baseline = BASELINE
    print(f"shared canvas={canvas_width}x{canvas_height} baseline_y={baseline}")

    os.makedirs(OUT_DIR, exist_ok=True)
    for index, (crop, crop_width, crop_height) in enumerate(cuts):
        if crop_width > canvas_width or crop_height > baseline:
            raise ValueError(
                f"frame {index + 1} content {crop_width}x{crop_height} does not fit "
                f"{canvas_width}x{canvas_height} canvas at baseline {baseline}"
            )
        canvas = Image.new("RGBA", (canvas_width, canvas_height), (0, 0, 0, 0))
        paste_x = (canvas_width - crop_width) // 2
        paste_y = baseline - crop_height
        canvas.paste(crop, (paste_x, paste_y), crop)
        path = os.path.join(OUT_DIR, f"run-back-{index + 1}.png")
        canvas.save(path)
        alpha = np.asarray(canvas)[:, :, 3]
        print(
            f"saved {path} size={canvas.size} feet_at={paste_y + crop_height} "
            f"margins=({paste_x}, {canvas_width - paste_x - crop_width}, "
            f"{paste_y}, {canvas_height - paste_y - crop_height}) "
            f"opaque_px={int((alpha > 200).sum())}"
        )


if __name__ == "__main__":
    main()
