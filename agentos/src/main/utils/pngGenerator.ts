import { deflateSync } from 'zlib';

// ── Minimal PNG generator ────────────────────────────────────────────────────

const crcTable: number[] = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

export function encodePng(rgba: Buffer, size: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter: None
    rgba.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function makeDotPng(r: number, g: number, b: number, alpha = 255): Buffer {
  const size = 16;
  const cx = 7.5,
    cy = 7.5,
    radius = 5.5;
  const rgba = Buffer.alloc(size * size * 4, 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx,
        dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        const i = (y * size + x) * 4;
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = alpha;
      }
    }
  }
  return encodePng(rgba, size);
}

// Staircase grid — 16×16 black template icon matching the logo's 4×4 block grid.
// 3×3 blocks on a 4px step: row i, col j occupies pixels [j*4, j*4+2] × [i*4, i*4+2].
export function makeBlockGridPng(): Buffer {
  const size = 16;
  const bsize = 3,
    step = 4;
  // (row, col) pairs forming the diagonal staircase
  const blocks: [number, number][] = [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 2],
    [2, 3],
    [3, 3],
  ];
  const rgba = Buffer.alloc(size * size * 4, 0);
  for (const [row, col] of blocks) {
    const bx = col * step;
    const by = row * step;
    for (let dy = 0; dy < bsize; dy++) {
      for (let dx = 0; dx < bsize; dx++) {
        const i = ((by + dy) * size + (bx + dx)) * 4;
        rgba[i + 3] = 255; // black (R=G=B=0 by alloc), full alpha
      }
    }
  }
  return encodePng(rgba, size);
}

// Two rotation states of the staircase logo (same as LogoTextAnimation):
//   STATE1 = top-right (original), STATE3 = bottom-left (180°)
const STATE1: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0, 1],
  [0, 2],
  [1, 1],
  [1, 2],
  [1, 3],
  [2, 2],
  [2, 3],
  [3, 3],
];
const STATE3: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [2, 0],
  [2, 1],
  [2, 2],
  [3, 1],
  [3, 2],
  [3, 3],
];

// 2-phase cycle timing as fractions (HOLD=400ms, FADE=400ms, PHASE=800ms, CYCLE=1600ms)
const H1 = 1 / 4; // 400ms
const F1 = 2 / 4; // 800ms
const H3 = 3 / 4; // 1200ms

function smoothstep(x: number): number {
  const c = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}

function state1OpacityAt(t: number): number {
  if (t <= H1) return 1;
  if (t <= F1) return 1 - smoothstep((t - H1) / (F1 - H1));
  if (t <= H3) return 0;
  return smoothstep((t - H3) / (1 - H3));
}

function state3OpacityAt(t: number): number {
  if (t <= H1) return 0;
  if (t <= F1) return smoothstep((t - H1) / (F1 - H1));
  if (t <= H3) return 1;
  return 1 - smoothstep((t - H3) / (1 - H3));
}

// One frame of the 2-phase rotation animation for the tray icon.
// frame: 0..totalFrames-1
export function makeAnimFramePng(frame: number, totalFrames: number): Buffer {
  const size = 16;
  const bsize = 3;
  const step = 4;
  const t = frame / totalFrames;
  const a1 = Math.round(state1OpacityAt(t) * 255);
  const a3 = Math.round(state3OpacityAt(t) * 255);
  const rgba = Buffer.alloc(size * size * 4, 0);

  function paint(row: number, col: number, alpha: number): void {
    if (alpha === 0) return;
    const bx = col * step;
    const by = row * step;
    for (let dy = 0; dy < bsize; dy++) {
      for (let dx = 0; dx < bsize; dx++) {
        const idx = ((by + dy) * size + (bx + dx)) * 4;
        rgba[idx + 3] = Math.max(rgba[idx + 3], alpha);
      }
    }
  }

  for (const [r, c] of STATE1) paint(r, c, a1);
  for (const [r, c] of STATE3) paint(r, c, a3);

  return encodePng(rgba, size);
}

// logoRgba: 14×14 RGBA buffer with background stripped (transparent)
export function makeLogoWithDotPng(logoRgba: Buffer, dotR: number, dotG: number, dotB: number, dotAlpha = 255): Buffer {
  const size = 20;
  const logoSize = 14;
  if (logoRgba.length !== logoSize * logoSize * 4) {
    throw new Error(
      `makeLogoWithDotPng: logoRgba must be ${logoSize * logoSize * 4} bytes (14×14 RGBA), got ${logoRgba.length}`
    );
  }
  const dotCx = 16.5,
    dotCy = 16.5,
    dotRadius = 3.5;
  const rgba = Buffer.alloc(size * size * 4, 0);

  // Blit logo at (1,1) offset at 60% opacity
  for (let y = 0; y < logoSize; y++) {
    for (let x = 0; x < logoSize; x++) {
      const src = (y * logoSize + x) * 4;
      const a = logoRgba[src + 3];
      if (a === 0) continue;
      const dst = ((y + 1) * size + (x + 1)) * 4;
      rgba[dst] = logoRgba[src];
      rgba[dst + 1] = logoRgba[src + 1];
      rgba[dst + 2] = logoRgba[src + 2];
      rgba[dst + 3] = a;
    }
  }

  // Draw status dot in bottom-right corner (skipped when dotAlpha=0 to keep logo intact)
  if (dotAlpha > 0) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - dotCx,
          dy = y - dotCy;
        if (dx * dx + dy * dy <= dotRadius * dotRadius) {
          const i = (y * size + x) * 4;
          rgba[i] = dotR;
          rgba[i + 1] = dotG;
          rgba[i + 2] = dotB;
          rgba[i + 3] = dotAlpha;
        }
      }
    }
  }

  return encodePng(rgba, size);
}
