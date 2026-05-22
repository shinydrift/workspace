#!/usr/bin/env node
// Generates DMG installer background images for light and dark mode.
// Run: node scripts/generate-dmg-background.js
//
// Outputs (660×400 @1x, 1320×800 @2x — appdmg picks up @2x automatically):
//   resources/dmg-background.png
//   resources/dmg-background@2x.png
//   resources/dmg-background-dark.png
//   resources/dmg-background-dark@2x.png

'use strict';

const path = require('path');
const { writePng, hexToRgb } = require('./lib/png');
const { parseSvg } = require('./lib/svg');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function blendPixel(pixels, idx, fgR, fgG, fgB, alpha) {
  pixels[idx + 0] = Math.round(pixels[idx + 0] * (1 - alpha) + fgR * alpha);
  pixels[idx + 1] = Math.round(pixels[idx + 1] * (1 - alpha) + fgG * alpha);
  pixels[idx + 2] = Math.round(pixels[idx + 2] * (1 - alpha) + fgB * alpha);
}

// ---------------------------------------------------------------------------
// Polygon fill (scanline, even-odd)
// ---------------------------------------------------------------------------
function fillPolygon(pixels, width, height, polygon, [r, g, b], alpha) {
  const ys = polygon.map(p => p[1]);
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...ys)));

  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < polygon.length; i++) {
      const [x1, y1] = polygon[i];
      const [x2, y2] = polygon[(i + 1) % polygon.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = Math.max(0, Math.ceil(xs[i]));
      const x1 = Math.min(width - 1, Math.floor(xs[i + 1]));
      for (let x = x0; x <= x1; x++) {
        blendPixel(pixels, (y * width + x) * 4, r, g, b, alpha);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Draw staircase rect decoration (rects from the logo SVG)
// ---------------------------------------------------------------------------
function drawRectDecoration(pixels, width, height, rects, scale, offsetX, offsetY, dotR, dotG, dotB, alpha) {
  for (const { x, y, w, h } of rects) {
    const rx0 = x * scale + offsetX;
    const ry0 = y * scale + offsetY;
    const rx1 = rx0 + w * scale;
    const ry1 = ry0 + h * scale;

    const px0 = Math.max(0, Math.floor(rx0));
    const px1 = Math.min(width - 1, Math.ceil(rx1) - 1);
    const py0 = Math.max(0, Math.floor(ry0));
    const py1 = Math.min(height - 1, Math.ceil(ry1) - 1);
    if (px0 > px1 || py0 > py1) continue;

    for (let py = py0; py <= py1; py++) {
      for (let px = px0; px <= px1; px++) {
        blendPixel(pixels, (py * width + px) * 4, dotR, dotG, dotB, alpha);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Curved arrow — quadratic Bezier stroke + filled arrowhead.
// Smile shape: starts and ends at the same y, control point dips below.
// ---------------------------------------------------------------------------
function drawCurvedArrow(pixels, width, height, p0, ctrl, p2, strokeHw, headLen, headWidth, r, g, b, alpha) {
  const steps = Math.ceil(Math.hypot(p2[0] - p0[0], p2[1] - p0[1]) * 3);
  const sw2 = strokeHw * strokeHw;
  const painted = new Uint8Array(width * height);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const cx = mt * mt * p0[0] + 2 * mt * t * ctrl[0] + t * t * p2[0];
    const cy = mt * mt * p0[1] + 2 * mt * t * ctrl[1] + t * t * p2[1];
    const x0 = Math.max(0, Math.floor(cx - strokeHw - 1));
    const x1 = Math.min(width - 1, Math.ceil(cx + strokeHw + 1));
    const y0 = Math.max(0, Math.floor(cy - strokeHw - 1));
    const y1 = Math.min(height - 1, Math.ceil(cy + strokeHw + 1));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px - cx, dy = py - cy;
        if (dx * dx + dy * dy <= sw2) {
          const idx = py * width + px;
          if (!painted[idx]) {
            painted[idx] = 1;
            blendPixel(pixels, idx * 4, r, g, b, alpha);
          }
        }
      }
    }
  }

  // Arrowhead at p2 pointing along the end tangent (2*(p2 - ctrl))
  const tx = 2 * (p2[0] - ctrl[0]), ty = 2 * (p2[1] - ctrl[1]);
  const tlen = Math.sqrt(tx * tx + ty * ty);
  const ux = tx / tlen, uy = ty / tlen;
  const nx = -uy, ny = ux;
  const base = [p2[0] - ux * headLen, p2[1] - uy * headLen];
  fillPolygon(pixels, width, height,
    [p2, [base[0] + nx * headWidth, base[1] + ny * headWidth], [base[0] - nx * headWidth, base[1] - ny * headWidth]],
    [r, g, b], alpha);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const BASE_W = 660;
const BASE_H = 400;
const resources = path.join(__dirname, '..', 'resources');

const { rects } = parseSvg(path.join(resources, 'agentos-logo.svg'));

// Decoration: top-right corner at scale=0.68. The staircase spans the full
// 320×320 viewBox diagonally; at this scale the bottom-right blocks land near
// canvas (655, 175), fading in from the corner.
const DEC_SCALE = 0.68;
const DEC_OX = 440;
const DEC_OY = -38;
const DEC_ALPHA = 0.13;

function generateBackground(bgHex, dotHex, width, height, outPath) {
  const [bgR, bgG, bgB] = hexToRgb(bgHex);
  const [dR, dG, dB] = hexToRgb(dotHex);
  const scale = width / BASE_W; // 1 for @1x, 2 for @2x

  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4 + 0] = bgR;
    pixels[i * 4 + 1] = bgG;
    pixels[i * 4 + 2] = bgB;
    pixels[i * 4 + 3] = 255;
  }

  drawRectDecoration(
    pixels, width, height, rects,
    DEC_SCALE * scale, DEC_OX * scale, DEC_OY * scale,
    dR, dG, dB, DEC_ALPHA,
  );

  const s = scale;
  drawCurvedArrow(
    pixels, width, height,
    [235 * s, 190 * s], [330 * s, 220 * s], [425 * s, 190 * s],
    1.5 * s, 10 * s, 5 * s,
    dR, dG, dB, 0.28,
  );

  writePng(width, height, pixels, outPath);
  console.log(`✓  ${outPath}  (${width}×${height})`);
}

// Light: #F0EFED bg, #0E0A28 dots (matches agentos-logo.svg)
generateBackground('#F0EFED', '#0E0A28', BASE_W,     BASE_H,     path.join(resources, 'dmg-background.png'));
generateBackground('#F0EFED', '#0E0A28', BASE_W * 2, BASE_H * 2, path.join(resources, 'dmg-background@2x.png'));

// Dark: #0B0B14 bg, #F4F2EE dots (matches agentos-logo-dark.svg)
generateBackground('#0B0B14', '#F4F2EE', BASE_W,     BASE_H,     path.join(resources, 'dmg-background-dark.png'));
generateBackground('#0B0B14', '#F4F2EE', BASE_W * 2, BASE_H * 2, path.join(resources, 'dmg-background-dark@2x.png'));
