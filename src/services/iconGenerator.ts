// Pure TypeScript / Browser & Node compatible PNG generator for extension icons
// Generates standard 2x2 Bandcamp parallelograms icon without Node 'Buffer' or 'zlib' dependencies.

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function updateCrc(crc: number, buf: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
  }
  return c >>> 0;
}

function writeUInt32BE(buf: Uint8Array, offset: number, value: number) {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function makeChunk(typeStr: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    typeBytes[i] = typeStr.charCodeAt(i);
  }
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  writeUInt32BE(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);

  let crc = 0xffffffff;
  crc = updateCrc(crc, typeBytes);
  crc = updateCrc(crc, data);
  crc = (crc ^ 0xffffffff) >>> 0;
  writeUInt32BE(chunk, 8 + data.length, crc);
  return chunk;
}

function adler32(data: Uint8Array): number {
  let s1 = 1;
  let s2 = 0;
  for (let i = 0; i < data.length; i++) {
    s1 = (s1 + data[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  return ((s2 << 16) | s1) >>> 0;
}

function deflateUncompressed(data: Uint8Array): Uint8Array {
  const BLOCK_SIZE = 65535;
  const numBlocks = Math.ceil(data.length / BLOCK_SIZE) || 1;
  // 2 bytes zlib header (0x78, 0x01)
  // For each block: 5 bytes header + block data
  // 4 bytes adler32 checksum
  const totalSize = 2 + numBlocks * 5 + data.length + 4;
  const result = new Uint8Array(totalSize);

  result[0] = 0x78; // CMF: deflate, 32k window
  result[1] = 0x01; // FLG: check bits ((0x78 * 256 + 0x01) % 31 == 0)

  let offset = 2;
  for (let i = 0; i < numBlocks; i++) {
    const start = i * BLOCK_SIZE;
    const end = Math.min(start + BLOCK_SIZE, data.length);
    const blockLen = end - start;
    const isLast = (i === numBlocks - 1) ? 1 : 0;

    result[offset++] = isLast ? 0x01 : 0x00; // BFINAL, BTYPE=00
    result[offset++] = blockLen & 0xff;
    result[offset++] = (blockLen >>> 8) & 0xff;
    const nlen = (~blockLen) & 0xffff;
    result[offset++] = nlen & 0xff;
    result[offset++] = (nlen >>> 8) & 0xff;

    result.set(data.subarray(start, end), offset);
    offset += blockLen;
  }

  const checksum = adler32(data);
  writeUInt32BE(result, offset, checksum);
  return result;
}

export function createPng(
  width: number,
  height: number,
  renderFn: (x: number, y: number, w: number, h: number) => [number, number, number, number]
): Uint8Array {
  const rowSize = width * 4 + 1;
  const raw = new Uint8Array(height * rowSize);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    raw[rowOffset] = 0; // Filter type: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = renderFn(x, y, width, height);
      const pxOffset = rowOffset + 1 + x * 4;
      raw[pxOffset] = r;
      raw[pxOffset + 1] = g;
      raw[pxOffset + 2] = b;
      raw[pxOffset + 3] = a;
    }
  }

  const compressed = deflateUncompressed(raw);

  const ihdr = new Uint8Array(13);
  writeUInt32BE(ihdr, 0, width);
  writeUInt32BE(ihdr, 4, height);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA color type
  ihdr[10] = 0; // Deflate compression
  ihdr[11] = 0; // Filter method
  ihdr[12] = 0; // Interlace method (none)

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', new Uint8Array(0));

  const totalLen = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(totalLen);
  let pos = 0;
  png.set(sig, pos); pos += sig.length;
  png.set(ihdrChunk, pos); pos += ihdrChunk.length;
  png.set(idatChunk, pos); pos += idatChunk.length;
  png.set(iendChunk, pos); pos += iendChunk.length;

  return png;
}

// 2x2 Bandcamp parallelogram icons on dark rounded square background
export function renderBandcamp2x2(
  x: number,
  y: number,
  w: number,
  h: number
): [number, number, number, number] {
  const nx = x / w;
  const ny = y / h;

  // Background: dark slate #0b0f17 with rounded corners
  const rBg = 0.16;
  const inCorner =
    (nx < rBg && ny < rBg && Math.hypot(nx - rBg, ny - rBg) > rBg) ||
    (nx > 1 - rBg && ny < rBg && Math.hypot(nx - (1 - rBg), ny - rBg) > rBg) ||
    (nx < rBg && ny > 1 - rBg && Math.hypot(nx - rBg, ny - (1 - rBg)) > rBg) ||
    (nx > 1 - rBg && ny > 1 - rBg && Math.hypot(nx - (1 - rBg), ny - (1 - rBg)) > rBg);
  if (inCorner) return [0, 0, 0, 0];

  function inParallelogram(
    px: number,
    py: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    slant: number
  ): boolean {
    if (py < y0 || py > y1) return false;
    const progress = (py - y0) / (y1 - y0);
    const left = x0 + progress * slant;
    const right = x1 + progress * slant;
    return px >= left && px <= right;
  }

  // Row 1 (Top)
  // Col 1: Cyan #00b4d8
  if (inParallelogram(nx, ny, 0.18, 0.14, 0.44, 0.44, -0.09)) {
    return [0, 180, 216, 255];
  }
  // Col 2: Sky Blue #38bdf8
  if (inParallelogram(nx, ny, 0.58, 0.14, 0.84, 0.44, -0.09)) {
    return [56, 189, 248, 255];
  }

  // Row 2 (Bottom)
  // Col 1: Sky Blue #38bdf8
  if (inParallelogram(nx, ny, 0.18, 0.56, 0.44, 0.86, -0.09)) {
    return [56, 189, 248, 255];
  }
  // Col 2: Emerald Green #10b981
  if (inParallelogram(nx, ny, 0.58, 0.56, 0.84, 0.86, -0.09)) {
    return [16, 185, 129, 255];
  }

  return [11, 15, 23, 255]; // #0b0f17
}

export function getExtensionIconBuffers(): {
  icon16: Uint8Array;
  icon48: Uint8Array;
  icon128: Uint8Array;
  iconSvg: string;
} {
  const icon16 = createPng(16, 16, renderBandcamp2x2);
  const icon48 = createPng(48, 48, renderBandcamp2x2);
  const icon128 = createPng(128, 128, renderBandcamp2x2);

  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="24" fill="#0b0f17"/>
  <!-- 2x2 Bandcamp Bulk Download Logos -->
  <!-- Top Left (Cyan) -->
  <path d="M23 56 L34 18 H56 L45 56 Z" fill="#00b4d8"/>
  <!-- Top Right (Sky Blue) -->
  <path d="M74 56 L85 18 H107 L96 56 Z" fill="#38bdf8"/>
  <!-- Bottom Left (Sky Blue) -->
  <path d="M23 110 L34 72 H56 L45 110 Z" fill="#38bdf8"/>
  <!-- Bottom Right (Emerald Green) -->
  <path d="M74 110 L85 72 H107 L96 110 Z" fill="#10b981"/>
</svg>`;

  return { icon16, icon48, icon128, iconSvg };
}
