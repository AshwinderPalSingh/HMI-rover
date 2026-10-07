import { describe, expect, it } from 'vitest';
import { cameraBasis, clampView, groundPoint, orbitView, panView, project, zoomView, type OrbitView } from '../camera/orbit';

const ASPECT = 1280 / 720;
const view = (over: Partial<OrbitView> = {}): OrbitView => ({
  azimuth: 0,
  elevation: 0.3,
  distance: 2.8,
  offset: { x: 0, y: 0, z: 0.8 },
  follow_heading: true,
  horizontal_fov: Math.PI / 2,
  ...over,
});

describe('orbit camera', () => {
  it('places the camera behind and above the target, like the Gazebo plugin', () => {
    const b = cameraBasis(view());
    expect(b.pos.x).toBeCloseTo(-2.8 * Math.cos(0.3));
    expect(b.pos.y).toBeCloseTo(0);
    expect(b.pos.z).toBeCloseTo(0.8 + 2.8 * Math.sin(0.3));
  });

  it('sees the target at the centre of the picture', () => {
    const v = view({ azimuth: 1.1, elevation: 0.7, offset: { x: 3, y: -2, z: 0.8 } });
    const c = project(v, v.offset, ASPECT)!;
    expect(c.x).toBeCloseTo(0.5);
    expect(c.y).toBeCloseTo(0.5);
  });

  it('casts image points to the ground and back', () => {
    const v = view({ azimuth: -0.6, elevation: 0.5 });
    for (const at of [{ x: 0.2, y: 0.8 }, { x: 0.5, y: 0.6 }, { x: 0.9, y: 0.95 }]) {
      const g = groundPoint(v, at, ASPECT)!;
      expect(g).not.toBeNull();
      expect(g.z).toBe(0);
      const back = project(v, g, ASPECT)!;
      expect(back.x).toBeCloseTo(at.x);
      expect(back.y).toBeCloseTo(at.y);
    }
  });

  it('finds no ground above the horizon', () => {
    expect(groundPoint(view(), { x: 0.5, y: 0.05 }, ASPECT)).toBeNull();
  });

  it('pans so the grabbed ground point follows the pointer', () => {
    const v0 = view({ azimuth: 0.8, elevation: 0.45 });
    const from = { x: 0.4, y: 0.7 };
    const to = { x: 0.65, y: 0.55 };
    const grabbed = groundPoint(v0, from, ASPECT)!;
    const now = project(panView(v0, from, to, ASPECT)!, grabbed, ASPECT)!;
    expect(now.x).toBeCloseTo(to.x);
    expect(now.y).toBeCloseTo(to.y);
  });

  it('pans along the ground when the sky is grabbed', () => {
    const v0 = view();
    const v1 = panView(v0, { x: 0.5, y: 0.05 }, { x: 0.7, y: 0.05 }, ASPECT)!;
    // dragging right moves the view left (the robot's +y side)
    expect(v1.offset.y).toBeGreaterThan(0);
    expect(v1.offset.z).toBe(v0.offset.z);
  });

  it('holds the view while the pointer is dragged above the horizon', () => {
    expect(panView(view(), { x: 0.5, y: 0.8 }, { x: 0.5, y: 0.05 }, ASPECT)).toBeNull();
  });

  it('zooms toward the point under the pointer, keeping it there', () => {
    const v0 = view({ azimuth: 0.4, elevation: 0.5 });
    for (const [at, factor] of [[{ x: 0.8, y: 0.75 }, 0.5], [{ x: 0.2, y: 0.95 }, 1.6], [{ x: 0.5, y: 0.5 }, 0.7]] as const) {
      const g = groundPoint(v0, at, ASPECT)!;
      const v1 = zoomView(v0, factor, at, ASPECT);
      expect(v1.distance).toBeCloseTo(2.8 * factor);
      expect(v1.offset.z).toBe(0.8);
      const p = project(v1, g, ASPECT)!;
      expect(p.x).toBeCloseTo(at.x);
      expect(p.y).toBeCloseTo(at.y);
    }
  });

  it('zooms about the centre over the sky and respects the distance limits', () => {
    const v0 = view();
    const v1 = zoomView(v0, 0.5, { x: 0.5, y: 0.02 }, ASPECT);
    expect(v1.offset).toEqual(v0.offset);
    expect(v1.distance).toBeCloseTo(1.4);
    expect(zoomView(v0, 1e-3, null, ASPECT).distance).toBe(0.4);
    expect(zoomView(v0, 1e3, null, ASPECT).distance).toBe(60);
  });

  it('orbits within the elevation limits and never below the ground', () => {
    expect(orbitView(view(), 0, 5).elevation).toBe(1.5);
    const low = orbitView(view({ distance: 40 }), 0, -5);
    expect(cameraBasis(low).pos.z).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(orbitView(view(), 4, 0).azimuth).toBeCloseTo(4 - 2 * Math.PI);
  });

  it('clamps like the plugin', () => {
    const v = clampView(view({ distance: 0.01, offset: { x: 500, y: -500, z: 0.6 } }));
    expect(v.distance).toBe(0.4);
    expect(v.offset.x).toBe(80);
    expect(v.offset.y).toBe(-80);
  });
});
