'use strict';

const fs = require('fs');

/**
 * Parse the agentos-logo SVG structure.
 * Returns { vw, vh, bgHex, dotHex, rects } where rects is the array of
 * { x, y, w, h } shapes that make up the logo mark.
 */
function parseSvg(svgPath) {
  let src;
  try {
    src = fs.readFileSync(svgPath, 'utf8');
  } catch (e) {
    throw new Error(`Could not read SVG: ${svgPath}\n${e.message}`);
  }

  const vbMatch = src.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  if (!vbMatch) throw new Error(`No viewBox found in ${svgPath}`);
  const vw = parseFloat(vbMatch[1]);
  const vh = parseFloat(vbMatch[2]);

  const bgMatch = src.match(/<rect[^>]+fill="([^"]+)"/);
  const bgHex = bgMatch ? bgMatch[1] : null;

  const gMatch = src.match(/<g fill="([^"]+)">/);
  const dotHex = gMatch ? gMatch[1] : '#000000';

  const rects = [];
  const re = /<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"\/>/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    rects.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), w: parseFloat(m[3]), h: parseFloat(m[4]) });
  }

  return { vw, vh, bgHex, dotHex, rects };
}

module.exports = { parseSvg };
