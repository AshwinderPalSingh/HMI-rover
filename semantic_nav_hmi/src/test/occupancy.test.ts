import { describe, expect, it } from 'vitest';
import { buildLut, decodeOccupancy, MAP_PALETTE } from '../map/occupancy';

function rgba(px: Uint8ClampedArray, i: number) {
  return [px[i * 4], px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3]];
}

describe('occupancy decoding', () => {
  it('maps unknown, free and occupied cells', () => {
    const { pixels, known, occupied } = decodeOccupancy(Int8Array.from([-1, 0, 100, 50]), 2, 2);
    expect(rgba(pixels, 0)).toEqual([...MAP_PALETTE.unknown, 255]);
    expect(rgba(pixels, 1)).toEqual([...MAP_PALETTE.free, 255]);
    expect(rgba(pixels, 2)).toEqual([...MAP_PALETTE.occupied, 255]);
    expect(known).toBe(3);
    expect(occupied).toBe(1);
  });

  it('treats JSON number arrays the same as typed arrays', () => {
    const a = decodeOccupancy([-1, 0, 100, 7], 4, 1).pixels;
    const b = decodeOccupancy(Int8Array.from([-1, 0, 100, 7]), 4, 1).pixels;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('reports bounds of known cells in grid order (row 0 = bottom)', () => {
    // 4x3 grid, known cells only at (col 1..2, row 1)
    const data = [-1, -1, -1, -1, -1, 0, 100, -1, -1, -1, -1, -1];
    const { knownCells } = decodeOccupancy(data, 4, 3);
    expect(knownCells).toEqual({ minCol: 1, minRow: 1, maxCol: 2, maxRow: 1 });
    expect(decodeOccupancy([-1, -1], 2, 1).knownCells).toBeNull();
  });

  it('pads short messages as unknown', () => {
    const { pixels } = decodeOccupancy([0], 2, 1);
    expect(rgba(pixels, 1)).toEqual([...MAP_PALETTE.unknown, 255]);
  });

  it('LUT is monotone from free to occupied', () => {
    const lut = buildLut();
    const red = (v: number) => (lut[v] & 0xff) >>> 0;
    expect(red(100)).toBeGreaterThan(red(50));
    expect(red(50)).toBeGreaterThan(red(0));
  });
});
