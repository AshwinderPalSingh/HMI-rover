/**
 * OccupancyGrid → RGBA pixels via a 256-entry lookup table.
 *
 * Cell values: -1 unknown, 0 free, 1..100 occupancy probability.
 * `value & 0xff` maps int8 -1 → 255, so typed Int8Array (CBOR) and plain
 * number[] (JSON) index the same table without branching.
 * Pixels are written as packed 32-bit words; one pass, no per-cell math.
 */

export const MAP_PALETTE = {
  unknown: [13, 16, 21] as const, // #0d1015
  free: [26, 31, 40] as const, // #1a1f28 — validated overlay surface
  occupied: [200, 208, 220] as const, // #c8d0dc
};

const littleEndian = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;

function pack(r: number, g: number, b: number, a = 255): number {
  return littleEndian
    ? ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

export function buildLut(): Uint32Array {
  const lut = new Uint32Array(256);
  const { unknown, free, occupied } = MAP_PALETTE;
  for (let i = 0; i < 256; i++) {
    const v = i > 127 ? i - 256 : i; // reinterpret as int8
    if (v < 0) {
      lut[i] = pack(unknown[0], unknown[1], unknown[2]);
    } else {
      // Ease-in so low probabilities stay close to "free" and walls pop
      const t = Math.min(1, v / 100) ** 0.75;
      lut[i] = pack(
        Math.round(free[0] + (occupied[0] - free[0]) * t),
        Math.round(free[1] + (occupied[1] - free[1]) * t),
        Math.round(free[2] + (occupied[2] - free[2]) * t),
      );
    }
  }
  return lut;
}

const LUT = buildLut();

export interface DecodedGrid {
  pixels: Uint8ClampedArray<ArrayBuffer>;
  known: number;
  occupied: number;
  /** Cell-index bounds of known cells (inclusive), or null if nothing is known */
  knownCells: { minCol: number; minRow: number; maxCol: number; maxRow: number } | null;
}

/** Decode cells into RGBA. Rows stay in ROS order (row 0 = bottom edge of the map). */
export function decodeOccupancy(data: ArrayLike<number>, width: number, height: number): DecodedGrid {
  const n = width * height;
  const buf = new ArrayBuffer(n * 4);
  const out = new Uint32Array(buf);
  const len = Math.min(n, data.length);
  let known = 0;
  let occupied = 0;
  let minRow = height;
  let maxRow = -1;
  let minCol = width;
  let maxCol = -1;
  for (let row = 0, i = 0; row < height && i < len; row++) {
    let rowKnown = false;
    for (let col = 0; col < width && i < len; col++, i++) {
      const v = data[i];
      out[i] = LUT[v & 0xff];
      if (v >= 0) {
        known++;
        if (v >= 65) occupied++;
        if (col < minCol) minCol = col;
        if (col > maxCol) maxCol = col;
        rowKnown = true;
      }
    }
    if (rowKnown) {
      if (row < minRow) minRow = row;
      maxRow = row;
    }
  }
  // Cells missing from a short message read as unknown
  if (len < n) out.fill(LUT[255], len);
  return {
    pixels: new Uint8ClampedArray(buf),
    known,
    occupied,
    knownCells: maxRow >= 0 ? { minCol, minRow, maxCol, maxRow } : null,
  };
}
