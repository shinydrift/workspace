#!/usr/bin/env node
/**
 * Generates agentos-logo-*.png and agentos-logo.icns from agentos-logo.svg using only Node.js built-ins.
 * Run: node scripts/generate-icons.js
 *
 * For macOS packaged builds you still need agentos-logo.icns (use iconutil on macOS):
 *   mkdir -p agentos-logo.iconset
 *   sips -z 16 16 agentos-logo-512.png --out agentos-logo.iconset/icon_16x16.png
 *   ... (repeat for 32,128,256,512) ...
 *   iconutil -c icns agentos-logo.iconset -o resources/agentos-logo.icns
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { writePng, hexToRgb } = require('./lib/png');
const { parseSvg } = require('./lib/svg');

// ---------------------------------------------------------------------------
// Renderer: rects onto square canvas with padding, supersampled edges
// ---------------------------------------------------------------------------
function renderIcon(svgData, size, outPath) {
  const { vw, vh, bgHex, dotHex, rects } = svgData;
  const [dotR, dotG, dotB] = hexToRgb(dotHex);
  const transparent = bgHex === null;

  // Fit the logo into the square with 10% padding on each side
  const pad = size * 0.10;
  const displayW = size - pad * 2;
  const scale = displayW / vw;
  const displayH = vh * scale;
  const offX = pad;
  const offY = (size - displayH) / 2;

  // Fill background (transparent when no <rect> background in SVG)
  const pixels = Buffer.alloc(size * size * 4);
  if (!transparent) {
    const [bgR, bgG, bgB] = hexToRgb(bgHex);
    for (let i = 0; i < size * size; i++) {
      pixels[i * 4 + 0] = bgR;
      pixels[i * 4 + 1] = bgG;
      pixels[i * 4 + 2] = bgB;
      pixels[i * 4 + 3] = 255;
    }
  }

  const SS = 4;
  const SS2 = SS * SS;
  for (const { x, y, w, h } of rects) {
    const rx0 = offX + x * scale;
    const ry0 = offY + y * scale;
    const rx1 = rx0 + w * scale;
    const ry1 = ry0 + h * scale;

    const px0 = Math.max(0, Math.floor(rx0 - 1));
    const px1 = Math.min(size - 1, Math.ceil(rx1 + 1));
    const py0 = Math.max(0, Math.floor(ry0 - 1));
    const py1 = Math.min(size - 1, Math.ceil(ry1 + 1));

    for (let py = py0; py <= py1; py++) {
      for (let px = px0; px <= px1; px++) {
        let hits = 0;
        for (let sy = 0; sy < SS; sy++) {
          const fy = py + (sy + 0.5) / SS;
          for (let sx = 0; sx < SS; sx++) {
            const fx = px + (sx + 0.5) / SS;
            if (fx >= rx0 && fx < rx1 && fy >= ry0 && fy < ry1) hits++;
          }
        }
        if (hits === 0) continue;
        const alpha = hits / SS2;
        const idx = (py * size + px) * 4;
        if (transparent) {
          pixels[idx + 0] = dotR;
          pixels[idx + 1] = dotG;
          pixels[idx + 2] = dotB;
          pixels[idx + 3] = Math.round(alpha * 255);
        } else {
          pixels[idx + 0] = Math.round(pixels[idx + 0] * (1 - alpha) + dotR * alpha);
          pixels[idx + 1] = Math.round(pixels[idx + 1] * (1 - alpha) + dotG * alpha);
          pixels[idx + 2] = Math.round(pixels[idx + 2] * (1 - alpha) + dotB * alpha);
          pixels[idx + 3] = 255;
        }
      }
    }
  }

  writePng(size, size, pixels, outPath);
  console.log(`✓  ${outPath}  (${size}×${size})`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const resources = path.join(__dirname, '..', 'resources');
const lightSvgData = parseSvg(path.join(resources, 'agentos-logo.svg'));

renderIcon(lightSvgData, 512, path.join(resources, 'agentos-logo-512.png'));
renderIcon(lightSvgData, 256, path.join(resources, 'agentos-logo-256.png'));
renderIcon(lightSvgData, 128, path.join(resources, 'agentos-logo-128.png'));

// ---------------------------------------------------------------------------
// ICNS writer — packages the rendered PNGs into a macOS icon bundle
// ---------------------------------------------------------------------------
function writeIcns(entries, outPath) {
  // entries: [{ ostype: Buffer(4), pngPath: string }, ...]
  const chunks = entries.map(({ ostype, pngPath }) => {
    const data = fs.readFileSync(pngPath);
    const hdr = Buffer.alloc(8);
    ostype.copy(hdr, 0);
    hdr.writeUInt32BE(8 + data.length, 4);
    return Buffer.concat([hdr, data]);
  });
  const body = Buffer.concat(chunks);
  const hdr = Buffer.alloc(8);
  Buffer.from('icns', 'ascii').copy(hdr, 0);
  hdr.writeUInt32BE(8 + body.length, 4);
  fs.writeFileSync(outPath, Buffer.concat([hdr, body]));
  console.log(`✓  ${outPath}  (ICNS — ${entries.length} sizes)`);
}

// Render the remaining sizes needed for a complete iconset
renderIcon(lightSvgData, 1024, path.join(resources, 'agentos-logo-1024.png'));
renderIcon(lightSvgData, 64,   path.join(resources, 'agentos-logo-64.png'));
renderIcon(lightSvgData, 32,   path.join(resources, 'agentos-logo-32.png'));
renderIcon(lightSvgData, 16,   path.join(resources, 'agentos-logo-16.png'));

writeIcns([
  { ostype: Buffer.from('ic04'), pngPath: path.join(resources, 'agentos-logo-16.png') },
  { ostype: Buffer.from('ic05'), pngPath: path.join(resources, 'agentos-logo-32.png') },
  { ostype: Buffer.from('ic07'), pngPath: path.join(resources, 'agentos-logo-128.png') },
  { ostype: Buffer.from('ic08'), pngPath: path.join(resources, 'agentos-logo-256.png') },
  { ostype: Buffer.from('ic09'), pngPath: path.join(resources, 'agentos-logo-512.png') },
  { ostype: Buffer.from('ic10'), pngPath: path.join(resources, 'agentos-logo-1024.png') },
], path.join(resources, 'agentos-logo.icns'));
