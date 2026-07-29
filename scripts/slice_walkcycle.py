"""Split the generated four-pose fox strip into aligned transparent frames."""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

FRAME_COUNT = 4
OUTPUT_SIZE = (430, 720)
BASELINE = 694
SIDE_PADDING = 10


def cyan_alpha(rgb: np.ndarray) -> np.ndarray:
    """Estimate foreground alpha from the bright cyan generation background."""
    pixels = rgb.astype(np.float32)
    red, green, blue = (pixels[:, :, channel] for channel in range(3))

    # Pure background is bright and strongly cyan. Requiring all four signals
    # protects the fox's white, orange, and near-black details.
    cyan_strength = np.minimum.reduce(
        [
            (green - red - 80.0) / 60.0,
            (blue - red - 100.0) / 60.0,
            (green - 100.0) / 70.0,
            (blue - 130.0) / 70.0,
        ]
    )
    background_alpha = np.clip(cyan_strength, 0.0, 1.0)
    foreground_alpha = 1.0 - background_alpha

    # Commit nearly certain pixels to fully transparent/opaque while retaining
    # a narrow antialiased edge.
    foreground_alpha[foreground_alpha < 0.035] = 0.0
    foreground_alpha[foreground_alpha > 0.94] = 1.0
    return foreground_alpha


def main_component(mask: np.ndarray) -> np.ndarray:
    """Keep the largest connected subject and discard neighboring-frame spill."""
    height, width = mask.shape
    seen = np.zeros_like(mask)
    components: list[list[tuple[int, int]]] = []
    for start_y, start_x in zip(*np.where(mask & ~seen)):
        if seen[start_y, start_x]:
            continue
        queue = deque([(int(start_y), int(start_x))])
        seen[start_y, start_x] = True
        component: list[tuple[int, int]] = []
        while queue:
            y, x = queue.popleft()
            component.append((y, x))
            for dy, dx in ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < height and 0 <= nx < width and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    queue.append((ny, nx))
        components.append(component)

    kept = np.zeros_like(mask)
    for y, x in max(components, key=len):
        kept[y, x] = True
    return kept


def despill_edges(rgba: np.ndarray) -> np.ndarray:
    """Extend solid subject colors through antialiased pixels to remove cyan."""
    alpha = rgba[:, :, 3]
    colors = rgba[:, :, :3].astype(np.float32)
    cyan = (
        (colors[:, :, 1] > colors[:, :, 0] + 42)
        & (colors[:, :, 2] > colors[:, :, 0] + 55)
        & (colors[:, :, 2] > 90)
    )
    partial = (alpha > 0) & ((alpha < 245) | cyan)
    resolved = (alpha >= 245) & ~cyan

    for _ in range(24):
        sums = np.zeros_like(colors)
        counts = np.zeros(alpha.shape, dtype=np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            shifted_resolved = np.roll(resolved, (dy, dx), axis=(0, 1))
            shifted_colors = np.roll(colors, (dy, dx), axis=(0, 1))
            sums += shifted_colors * shifted_resolved[:, :, None]
            counts += shifted_resolved
        fill = partial & ~resolved & (counts > 0)
        if not fill.any():
            break
        colors[fill] = sums[fill] / counts[fill, None]
        resolved[fill] = True

    alpha[partial & ~resolved] = 0
    rgba[:, :, :3] = np.clip(colors, 0, 255).astype(np.uint8)
    rgba[alpha == 0, :3] = 0
    return rgba


def cutout(cell: Image.Image) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    rgb = np.asarray(cell.convert("RGB"))
    alpha = cyan_alpha(rgb)

    # Remove cyan fringe by solving the compositing equation against the median
    # strip background. Fully opaque colors are unchanged.
    certain_bg = alpha < 0.04
    background = np.median(rgb[certain_bg], axis=0) if certain_bg.any() else np.array([6, 216, 250])
    safe_alpha = np.maximum(alpha[:, :, None], 0.08)
    foreground = (rgb - (1.0 - alpha[:, :, None]) * background) / safe_alpha
    foreground = np.clip(foreground, 0, 255).astype(np.uint8)

    rgba = np.dstack([foreground, np.round(alpha * 255).astype(np.uint8)])
    visible = main_component(alpha > 0.04)
    alpha[~visible] = 0
    rgba[:, :, 3] = np.round(alpha * 255).astype(np.uint8)
    rgba = despill_edges(rgba)
    ys, xs = np.where(visible)
    if not len(xs):
        raise ValueError("No foreground found in sprite cell")
    bbox = (int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1))
    return rgba, bbox


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "assets" / "mascot",
    )
    args = parser.parse_args()

    strip = Image.open(args.source).convert("RGB")
    # The generator packed adjacent poses tightly enough that their horizontal
    # bounds overlap. Overlapping windows plus component isolation preserve
    # extremities that a naive equal-width split would clip.
    centers = np.linspace(strip.width / 8, strip.width * 7 / 8, FRAME_COUNT)
    half_window = strip.width * 0.155
    cuts: list[tuple[Image.Image, int, int]] = []
    for index, center in enumerate(centers):
        left = max(0, round(center - half_window))
        right = min(strip.width, round(center + half_window))
        cell = strip.crop((left, 0, right, strip.height))
        rgba, bbox = cutout(cell)
        crop = Image.fromarray(rgba, "RGBA").crop(bbox)
        cuts.append((crop, crop.width, crop.height))
        print(f"frame {index + 1}: source_bbox={bbox} content={crop.size}")

    max_width = OUTPUT_SIZE[0] - SIDE_PADDING * 2
    max_height = BASELINE
    scale = min(max_width / max(width for _, width, _ in cuts), max_height / max(height for _, _, height in cuts))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for index, (crop, width, height) in enumerate(cuts, start=1):
        size = (round(width * scale), round(height * scale))
        resized = crop.resize(size, Image.Resampling.LANCZOS)
        resized = Image.fromarray(despill_edges(np.array(resized)), "RGBA")
        canvas = Image.new("RGBA", OUTPUT_SIZE, (0, 0, 0, 0))
        position = ((OUTPUT_SIZE[0] - size[0]) // 2, BASELINE - size[1])
        canvas.paste(resized, position)
        output = args.output_dir / f"walk-{index}.png"
        canvas.save(output, optimize=True)
        alpha = np.asarray(canvas)[:, :, 3]
        print(
            f"saved {output.name}: size={canvas.size} content={size} "
            f"baseline={BASELINE} transparent={int((alpha == 0).sum())}"
        )


if __name__ == "__main__":
    main()
