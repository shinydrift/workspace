#!/usr/bin/env python3
"""Source of truth for the AgentOS brand mark — halftone sphere with
Lambertian shading. Emits the two SVG variants:

  - agentos/resources/agentos-logo.svg       (dark dots on cream, primary)
  - agentos/resources/agentos-logo-dark.svg  (light dots on dark, for dark bgs)

After running this, regenerate PNG/.icns assets via:
  node agentos/scripts/generate-icons.js

Run from the project root:  python3 agentos/scripts/sketch-sphere.py
"""
import math
import sys
from pathlib import Path

SIZE = 320
RESOURCES = Path("agentos/resources")

DARK_BG, LIGHT_FG = "#0B0B14", "#F4F2EE"
LIGHT_BG, DARK_FG = "#F0EFED", "#0E0A28"

CX, CY, R = SIZE // 2, SIZE // 2, 110

def halftone_sphere_dots(radius=R, grid=12, light_dir=(-0.5, -0.7, 0.5),
                         max_dot=5.5, min_dot=0.4, ambient=0.18):
    """Hex-grid dots clipped to a circle, radii driven by Lambertian shading."""
    lx, ly, lz = light_dir
    lm = math.sqrt(lx * lx + ly * ly + lz * lz)
    lx, ly, lz = lx / lm, ly / lm, lz / lm
    dots = []
    step_x = grid
    step_y = grid * math.sqrt(3) / 2
    rows = int(2 * radius / step_y) + 2
    cols = int(2 * radius / step_x) + 2
    for r in range(-rows // 2, rows // 2 + 1):
        offset = (step_x / 2) if r % 2 else 0
        for c in range(-cols // 2, cols // 2 + 1):
            x = c * step_x + offset
            y = r * step_y
            if x * x + y * y > radius * radius:
                continue
            nz_sq = radius * radius - x * x - y * y
            if nz_sq <= 0:
                continue
            nz = math.sqrt(nz_sq)
            nx, ny, nz_n = x / radius, y / radius, nz / radius
            d = max(0.0, nx * lx + ny * ly + nz_n * lz)
            shade = ambient + (1 - ambient) * d
            dot_r = min_dot + (max_dot - min_dot) * (shade ** 1.4)
            dots.append((CX + x, CY + y, dot_r))
    return dots

def emit_svg(dots, bg, fg):
    L = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">',
        f'  <rect width="100%" height="100%" fill="{bg}"/>',
        f'  <g fill="{fg}">',
    ]
    for x, y, r in dots:
        L.append(f'    <circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.2f}"/>')
    L.append("  </g>")
    L.append("</svg>")
    return "\n".join(L) + "\n"

def main():
    if not RESOURCES.exists():
        print(f"error: run from project root (cannot find {RESOURCES})", file=sys.stderr)
        sys.exit(1)
    dots = halftone_sphere_dots()
    (RESOURCES / "agentos-logo.svg").write_text(emit_svg(dots, LIGHT_BG, DARK_FG))
    print(f"  wrote {RESOURCES / 'agentos-logo.svg'}")
    (RESOURCES / "agentos-logo-dark.svg").write_text(emit_svg(dots, DARK_BG, LIGHT_FG))
    print(f"  wrote {RESOURCES / 'agentos-logo-dark.svg'}")
    print()
    print("Next: regenerate PNG/.icns assets")
    print("  node agentos/scripts/generate-icons.js")

if __name__ == "__main__":
    main()
