/**
 * Tests for utils/pngGenerator.ts — crc32, pngChunk, makeDotPng.
 * All functions inlined — no Electron or native deps needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';

// ── Inlined from pngGenerator.ts ─────────────────────────────────────────────

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makeDotPng(r, g, b, alpha = 255) {
  const size = 16;
  const cx = 7.5, cy = 7.5, radius = 5.5;
  const rgba = Buffer.alloc(size * size * 4, 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        const i = (y * size + x) * 4;
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = alpha;
      }
    }
  }
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

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0;
    rgba.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeLogoWithDotPng(logoRgba, dotR, dotG, dotB, dotAlpha = 255) {
  const size = 20;
  const logoSize = 14;
  if (logoRgba.length !== logoSize * logoSize * 4) {
    throw new Error(`makeLogoWithDotPng: logoRgba must be ${logoSize * logoSize * 4} bytes (14×14 RGBA), got ${logoRgba.length}`);
  }
  const dotCx = 16.5, dotCy = 16.5, dotRadius = 3.5;
  const rgba = Buffer.alloc(size * size * 4, 0);
  for (let y = 0; y < logoSize; y++) {
    for (let x = 0; x < logoSize; x++) {
      const src = (y * logoSize + x) * 4;
      const a = logoRgba[src + 3];
      if (a === 0) continue;
      const dst = ((y + 1) * size + (x + 1)) * 4;
      rgba[dst] = logoRgba[src];
      rgba[dst + 1] = logoRgba[src + 1];
      rgba[dst + 2] = logoRgba[src + 2];
      rgba[dst + 3] = Math.round(a * 0.6);
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - dotCx, dy = y - dotCy;
      if (dx * dx + dy * dy <= dotRadius * dotRadius) {
        const i = (y * size + x) * 4;
        rgba[i] = dotR;
        rgba[i + 1] = dotG;
        rgba[i + 2] = dotB;
        rgba[i + 3] = dotAlpha;
      }
    }
  }
  return encodePng(rgba, size);
}

// ── crc32 ─────────────────────────────────────────────────────────────────────

test('crc32: empty buffer returns known value', () => {
  // CRC32 of empty = 0x00000000
  assert.equal(crc32(Buffer.alloc(0)), 0x00000000);
});

test('crc32: known value for "123456789"', () => {
  // standard CRC32 test vector
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('crc32: returns unsigned 32-bit integer', () => {
  const result = crc32(Buffer.from('hello'));
  assert.ok(result >= 0 && result <= 0xffffffff);
  assert.equal(result, result >>> 0);
});

test('crc32: same input always produces same output', () => {
  const buf = Buffer.from('agentos-png-test');
  assert.equal(crc32(buf), crc32(buf));
});

test('crc32: different inputs produce different results', () => {
  const a = crc32(Buffer.from('foo'));
  const b = crc32(Buffer.from('bar'));
  assert.notEqual(a, b);
});

// ── pngChunk ──────────────────────────────────────────────────────────────────

test('pngChunk: layout is [4-byte len][4-byte type][data][4-byte crc]', () => {
  const data = Buffer.from('hello');
  const chunk = pngChunk('TEST', data);
  assert.equal(chunk.length, 4 + 4 + data.length + 4);
});

test('pngChunk: length field encodes data byte count', () => {
  const data = Buffer.from('abcde');
  const chunk = pngChunk('TEST', data);
  assert.equal(chunk.readUInt32BE(0), data.length);
});

test('pngChunk: type field encoded as ascii', () => {
  const chunk = pngChunk('IEND', Buffer.alloc(0));
  assert.equal(chunk.slice(4, 8).toString('ascii'), 'IEND');
});

test('pngChunk: crc covers type + data (not length)', () => {
  const data = Buffer.from('test-data');
  const chunk = pngChunk('ABCD', data);
  const typeBuf = Buffer.from('ABCD', 'ascii');
  const expected = crc32(Buffer.concat([typeBuf, data]));
  const actual = chunk.readUInt32BE(4 + 4 + data.length);
  assert.equal(actual, expected);
});

test('pngChunk: empty data produces 12-byte chunk', () => {
  const chunk = pngChunk('IEND', Buffer.alloc(0));
  assert.equal(chunk.length, 12);
  assert.equal(chunk.readUInt32BE(0), 0);
});

// ── makeDotPng ────────────────────────────────────────────────────────────────

test('makeDotPng: starts with PNG magic bytes', () => {
  const png = makeDotPng(255, 0, 0);
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(png.slice(0, 8), magic);
});

test('makeDotPng: IHDR chunk follows magic bytes', () => {
  const png = makeDotPng(0, 255, 0);
  assert.equal(png.slice(8, 12).readUInt32BE(0), 13); // IHDR data is 13 bytes
  assert.equal(png.slice(12, 16).toString('ascii'), 'IHDR');
});

test('makeDotPng: IHDR encodes 16x16 dimensions', () => {
  const png = makeDotPng(0, 0, 255);
  const ihdrData = png.slice(16, 29); // 13 bytes of IHDR data
  assert.equal(ihdrData.readUInt32BE(0), 16); // width
  assert.equal(ihdrData.readUInt32BE(4), 16); // height
});

test('makeDotPng: IHDR encodes bit depth 8 and RGBA color type 6', () => {
  const png = makeDotPng(128, 128, 128);
  const ihdrData = png.slice(16, 29);
  assert.equal(ihdrData[8], 8); // bit depth
  assert.equal(ihdrData[9], 6); // RGBA
});

test('makeDotPng: ends with IEND chunk', () => {
  const png = makeDotPng(255, 255, 0);
  const iend = png.slice(png.length - 12);
  assert.equal(iend.readUInt32BE(0), 0); // IEND has no data
  assert.equal(iend.slice(4, 8).toString('ascii'), 'IEND');
});

test('makeDotPng: alpha defaults to 255', () => {
  const withDefault = makeDotPng(255, 0, 0);
  const withExplicit = makeDotPng(255, 0, 0, 255);
  assert.deepEqual(withDefault, withExplicit);
});

test('makeDotPng: different colors produce different output', () => {
  const red = makeDotPng(255, 0, 0);
  const blue = makeDotPng(0, 0, 255);
  assert.notDeepEqual(red, blue);
});

test('makeDotPng: alpha 0 produces different output than alpha 255', () => {
  const opaque = makeDotPng(255, 0, 0, 255);
  const transparent = makeDotPng(255, 0, 0, 0);
  assert.notDeepEqual(opaque, transparent);
});

test('makeDotPng: returns a Buffer', () => {
  const png = makeDotPng(100, 150, 200);
  assert.ok(Buffer.isBuffer(png));
});

// ── makeLogoWithDotPng ────────────────────────────────────────────────────────

function makeLogo14() {
  // 14×14 RGBA, all opaque dark pixels (simulates stripped logo)
  return Buffer.alloc(14 * 14 * 4, 0x10);
}

test('makeLogoWithDotPng: returns a Buffer', () => {
  assert.ok(Buffer.isBuffer(makeLogoWithDotPng(makeLogo14(), 60, 120, 255)));
});

test('makeLogoWithDotPng: starts with PNG magic bytes', () => {
  const png = makeLogoWithDotPng(makeLogo14(), 60, 120, 255);
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(png.slice(0, 8), magic);
});

test('makeLogoWithDotPng: IHDR encodes 20×20 dimensions', () => {
  const png = makeLogoWithDotPng(makeLogo14(), 60, 120, 255);
  const ihdrData = png.slice(16, 29);
  assert.equal(ihdrData.readUInt32BE(0), 20); // width
  assert.equal(ihdrData.readUInt32BE(4), 20); // height
});

test('makeLogoWithDotPng: IHDR encodes bit depth 8 and RGBA color type 6', () => {
  const png = makeLogoWithDotPng(makeLogo14(), 60, 120, 255);
  const ihdrData = png.slice(16, 29);
  assert.equal(ihdrData[8], 8); // bit depth
  assert.equal(ihdrData[9], 6); // RGBA
});

test('makeLogoWithDotPng: ends with IEND chunk', () => {
  const png = makeLogoWithDotPng(makeLogo14(), 60, 120, 255);
  const iend = png.slice(png.length - 12);
  assert.equal(iend.readUInt32BE(0), 0);
  assert.equal(iend.slice(4, 8).toString('ascii'), 'IEND');
});

test('makeLogoWithDotPng: different dot colors produce different output', () => {
  const logo = makeLogo14();
  assert.notDeepEqual(makeLogoWithDotPng(logo, 255, 0, 0), makeLogoWithDotPng(logo, 0, 0, 255));
});

test('makeLogoWithDotPng: different dot alphas produce different output', () => {
  const logo = makeLogo14();
  assert.notDeepEqual(makeLogoWithDotPng(logo, 60, 120, 255, 255), makeLogoWithDotPng(logo, 60, 120, 255, 90));
});

test('makeLogoWithDotPng: all-transparent logo produces different output than opaque logo', () => {
  const transparent = Buffer.alloc(14 * 14 * 4, 0); // all alpha=0
  const opaque = makeLogo14();
  assert.notDeepEqual(makeLogoWithDotPng(transparent, 60, 120, 255), makeLogoWithDotPng(opaque, 60, 120, 255));
});

test('makeLogoWithDotPng: throws when logoRgba is wrong size', () => {
  const wrongSize = Buffer.alloc(16 * 16 * 4); // 16×16 instead of 14×14
  assert.throws(() => makeLogoWithDotPng(wrongSize, 60, 120, 255), /14×14 RGBA/);
});
