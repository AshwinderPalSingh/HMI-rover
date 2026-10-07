"""Pick a target with generous clearance on the static map, 2.5-4 m from (x, y)."""
import os, sys, math
import numpy as np
from PIL import Image
import cv2
img = np.array(Image.open(os.path.join(os.environ.get('WS', os.path.expanduser('~/dev_ws')), 'src/basic_mobile_robot/maps/smalltown_world.pgm')))
res, ox, oy = 0.05, -51.224998, -51.224998
h = img.shape[0]
free = img > 250                      # 254 = free in map_saver trinary
dist = cv2.distanceTransform(free.astype(np.uint8), cv2.DIST_L2, 5) * res   # metres to nearest non-free cell
x0, y0 = float(sys.argv[1]), float(sys.argv[2])
best = None
for r in np.arange(2.5, 4.01, 0.25):
    for a in np.linspace(-math.pi, math.pi, 72, endpoint=False):
        x, y = x0 + r * math.cos(a), y0 + r * math.sin(a)
        col = int((x - ox) / res); row = h - 1 - int((y - oy) / res)
        if 0 <= row < h and 0 <= col < img.shape[1]:
            c = dist[row, col]
            if c >= 1.8 and (best is None or c > best[0]):
                best = (c, x, y)
print(f"{best[1]:.2f} {best[2]:.2f} clearance {best[0]:.2f}" if best else "none")
