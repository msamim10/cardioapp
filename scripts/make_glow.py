import numpy as np
from PIL import Image

# Soft ambient lime radial glow, transparent background. Rendered behind the
# welcome-screen fox so the mascot reads as lit from within rather than sitting
# on a flat dark plate. Smooth Gaussian falloff -> no visible rings/bands.

SIZE = 600
LIME = (198, 255, 61)  # #C6FF3D
PEAK_ALPHA = 0.55       # opacity at the very centre (0..1)
SIGMA = SIZE * 0.30     # spread of the glow relative to canvas
OUT = "/Users/mansoorsamim/Developer/cardioapp/assets/mascot/glow-lime.png"

cx = cy = (SIZE - 1) / 2.0
y, x = np.ogrid[0:SIZE, 0:SIZE]
dist2 = (x - cx) ** 2 + (y - cy) ** 2

# Gaussian falloff for a naturally soft core, then a smooth cosine window so the
# alpha reaches exactly zero at the edge (avoids a hard clipped boundary).
gauss = np.exp(-dist2 / (2.0 * SIGMA ** 2))
r = np.sqrt(dist2) / cx
window = np.clip(0.5 * (1.0 + np.cos(np.pi * np.clip(r, 0.0, 1.0))), 0.0, 1.0)

alpha = (gauss * window * PEAK_ALPHA * 255.0).astype(np.uint8)

rgb = np.zeros((SIZE, SIZE, 3), dtype=np.uint8)
rgb[..., 0] = LIME[0]
rgb[..., 1] = LIME[1]
rgb[..., 2] = LIME[2]

out = np.dstack([rgb, alpha])
Image.fromarray(out, "RGBA").save(OUT)
print("wrote", OUT, "size", (SIZE, SIZE), "peak_alpha", int(alpha.max()))
