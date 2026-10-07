import { describe, expect, it } from 'vitest';
import { fitBounds, gridStep, niceScale, panBy, screenToWorld, worldToScreen, zoomAt } from '../map/viewport';

const size = { w: 800, h: 600 };

describe('viewport', () => {
  it('flips Y between world and screen', () => {
    const v = { cx: 0, cy: 0, ppm: 10 };
    expect(worldToScreen(v, size, 0, 0)).toEqual({ x: 400, y: 300 });
    expect(worldToScreen(v, size, 1, 1)).toEqual({ x: 410, y: 290 });
    const w = screenToWorld(v, size, 410, 290);
    expect(w.x).toBeCloseTo(1, 10);
    expect(w.y).toBeCloseTo(1, 10);
  });

  it('zoomAt keeps the world point under the cursor fixed', () => {
    const v = { cx: 3, cy: -2, ppm: 20 };
    const before = screenToWorld(v, size, 123, 456);
    const z = zoomAt(v, size, 123, 456, 1.7);
    const after = screenToWorld(z, size, 123, 456);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(z.ppm).toBeCloseTo(34, 9);
  });

  it('panBy moves content with the pointer', () => {
    const v = { cx: 0, cy: 0, ppm: 10 };
    const p = panBy(v, 50, -20);
    // the world origin should now be drawn 50 px right and 20 px up
    expect(worldToScreen(p, size, 0, 0)).toEqual({ x: 450, y: 280 });
  });

  it('fitBounds contains the bounds', () => {
    const b = { minX: -10, minY: -5, maxX: 30, maxY: 15 };
    const v = fitBounds(b, size, 20);
    const tl = worldToScreen(v, size, b.minX, b.maxY);
    const br = worldToScreen(v, size, b.maxX, b.minY);
    expect(tl.x).toBeGreaterThanOrEqual(19.99);
    expect(tl.y).toBeGreaterThanOrEqual(19.99);
    expect(br.x).toBeLessThanOrEqual(780.01);
    expect(br.y).toBeLessThanOrEqual(580.01);
  });

  it('niceScale and gridStep pick round numbers', () => {
    expect(niceScale(10, 90).meters).toBe(5);
    expect(niceScale(100, 90).label).toBe('50 cm');
    expect(gridStep(40)).toBe(1);
    expect(gridStep(4)).toBe(10);
  });
});
