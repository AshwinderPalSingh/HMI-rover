import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  circlePolygon,
  compose,
  invert,
  isSimplePolygon,
  normalizeAngle,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  quatFromYaw,
  transformToPose2D,
  yawFromQuat,
  type Transform,
} from '../lib/math';

const tf = (x: number, y: number, yaw: number): Transform => ({ t: { x, y, z: 0 }, q: quatFromYaw(yaw) });

describe('quaternions', () => {
  it('round-trips yaw', () => {
    for (const yaw of [-3, -1.2, 0, 0.5, 1.57, 3.1]) {
      expect(yawFromQuat(quatFromYaw(yaw))).toBeCloseTo(yaw, 10);
    }
  });
  it('normalizes angles into (-pi, pi]', () => {
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 10);
    expect(normalizeAngle(-Math.PI / 2 - 2 * Math.PI)).toBeCloseTo(-Math.PI / 2, 10);
  });
});

describe('rigid transforms', () => {
  it('compose applies the right transform first', () => {
    // robot at (2, 0) facing +y; a point 1 m ahead of the robot is at (2, 1)
    const mapBase = tf(2, 0, Math.PI / 2);
    const p = applyTransform(mapBase, { x: 1, y: 0, z: 0 });
    expect(p.x).toBeCloseTo(2, 10);
    expect(p.y).toBeCloseTo(1, 10);
    // chain map->odom->base
    const mapOdom = tf(1, 1, Math.PI / 2);
    const odomBase = tf(1, 0, 0);
    const pose = transformToPose2D(compose(mapOdom, odomBase));
    expect(pose.x).toBeCloseTo(1, 10);
    expect(pose.y).toBeCloseTo(2, 10);
    expect(pose.yaw).toBeCloseTo(Math.PI / 2, 10);
  });
  it('invert undoes a transform', () => {
    const a = tf(3.2, -1.4, 0.7);
    const id = compose(a, invert(a));
    expect(id.t.x).toBeCloseTo(0, 10);
    expect(id.t.y).toBeCloseTo(0, 10);
    expect(yawFromQuat(id.q)).toBeCloseTo(0, 10);
  });
});

describe('polygons', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ];
  it('point in polygon', () => {
    expect(pointInPolygon(1, 1, square)).toBe(true);
    expect(pointInPolygon(3, 1, square)).toBe(false);
  });
  it('area and centroid', () => {
    expect(Math.abs(polygonArea(square))).toBeCloseTo(4, 10);
    const c = polygonCentroid(square);
    expect(c.x).toBeCloseTo(1, 10);
    expect(c.y).toBeCloseTo(1, 10);
  });
  it('detects self-intersection', () => {
    expect(isSimplePolygon(square)).toBe(true);
    const bowtie = [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
    ];
    expect(isSimplePolygon(bowtie)).toBe(false);
  });
  it('circlePolygon matches the executor octagon', () => {
    // navigation_executor_node: x + r*cos(2*pi*i/8), y + r*sin(2*pi*i/8)
    const pts = circlePolygon(1, 2, 1.5, 8);
    expect(pts).toHaveLength(8);
    expect(pts[0].x).toBeCloseTo(2.5, 10);
    expect(pts[0].y).toBeCloseTo(2, 10);
    expect(pts[2].x).toBeCloseTo(1, 10);
    expect(pts[2].y).toBeCloseTo(3.5, 10);
  });
});
