import { describe, expect, it } from 'vitest';
import { quatFromYaw, yawFromQuat } from '../lib/math';
import { TfTree } from '../ros/tf';

function stamped(parent: string, child: string, x: number, y: number, yaw: number) {
  return {
    header: { frame_id: parent, stamp: { sec: 0, nanosec: 0 } },
    child_frame_id: child,
    transform: { translation: { x, y, z: 0 }, rotation: quatFromYaw(yaw) },
  };
}

describe('TfTree', () => {
  it('composes map -> odom -> base_footprint', () => {
    let now = 1000;
    const tree = new TfTree(() => now);
    tree.ingest({ transforms: [stamped('map', 'odom', 1, 1, Math.PI / 2)] }, false);
    tree.ingest({ transforms: [stamped('/odom', 'base_footprint', 1, 0, 0)] }, false);
    tree.ingest({ transforms: [stamped('base_footprint', 'base_link', 0, 0, 0), stamped('base_link', 'lidar_link', 0.2, 0, 0)] }, true);
    const r = tree.lookup('map', 'base_footprint');
    expect(r).not.toBeNull();
    expect(r!.tf.t.x).toBeCloseTo(1, 10);
    expect(r!.tf.t.y).toBeCloseTo(2, 10);
    expect(yawFromQuat(r!.tf.q)).toBeCloseTo(Math.PI / 2, 10);
    // lidar is 0.2 m ahead of the base, i.e. +y in map
    const l = tree.lookup('map', 'lidar_link')!;
    expect(l.tf.t.x).toBeCloseTo(1, 10);
    expect(l.tf.t.y).toBeCloseTo(2.2, 10);
    // age tracks the oldest dynamic edge
    now = 1600;
    expect(tree.lookup('map', 'base_footprint')!.age).toBeCloseTo(600, 6);
  });

  it('looks up the inverse direction', () => {
    const tree = new TfTree(() => 0);
    tree.ingest({ transforms: [stamped('map', 'odom', 2, 0, 0)] }, false);
    const r = tree.lookup('odom', 'map')!;
    expect(r.tf.t.x).toBeCloseTo(-2, 10);
  });

  it('returns null for disconnected frames and handles leading slashes', () => {
    const tree = new TfTree(() => 0);
    tree.ingest({ transforms: [stamped('/odom', '/base_footprint', 0, 0, 0)] }, false);
    expect(tree.lookup('map', 'base_footprint')).toBeNull();
    expect(tree.lookup('odom', '/base_footprint')).not.toBeNull();
  });

  it('ignores self-referencing transforms', () => {
    const tree = new TfTree(() => 0);
    tree.ingest({ transforms: [stamped('a', 'a', 1, 0, 0)] }, false);
    expect(tree.frames()).toEqual([]);
  });
});
