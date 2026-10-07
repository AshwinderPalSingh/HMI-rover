import { describe, expect, it } from 'vitest';
import { navProgress, phaseFromStatus, pickCurrentGoal, uuidToHex } from '../ros/navstate';

const goal = (byte: number, status: number, sec: number) => ({
  goal_info: { goal_id: { uuid: Array.from({ length: 16 }, () => byte) }, stamp: { sec, nanosec: 0 } },
  status,
});

describe('nav state', () => {
  it('normalizes goal UUID encodings', () => {
    const bytes = Uint8Array.from([0, 1, 2, 255, ...Array(12).fill(0)]);
    const hex = '000102ff' + '00'.repeat(12);
    expect(uuidToHex(bytes)).toBe(hex);
    expect(uuidToHex(Array.from(bytes))).toBe(hex);
    expect(uuidToHex(btoa(String.fromCharCode(...bytes)))).toBe(hex);
  });

  it('prefers the newest active goal, else the newest goal', () => {
    const list = [goal(1, 4, 100), goal(2, 2, 50), goal(3, 6, 200)];
    expect(pickCurrentGoal(list)!.id.startsWith('02')).toBe(true);
    const finished = [goal(1, 4, 100), goal(3, 6, 200)];
    expect(pickCurrentGoal(finished)!.id.startsWith('03')).toBe(true);
    expect(pickCurrentGoal([])).toBeNull();
  });

  it('maps statuses to phases', () => {
    expect(phaseFromStatus(1)).toBe('active');
    expect(phaseFromStatus(3)).toBe('canceling');
    expect(phaseFromStatus(4)).toBe('succeeded');
    expect(phaseFromStatus(5)).toBe('canceled');
    expect(phaseFromStatus(6)).toBe('aborted');
  });

  it('computes progress only with a meaningful initial distance', () => {
    expect(navProgress(5, 10)).toBeCloseTo(0.5, 10);
    expect(navProgress(0, 10)).toBe(1);
    expect(navProgress(12, 10)).toBe(0);
    expect(navProgress(1, 0)).toBeNull();
    expect(navProgress(null, 10)).toBeNull();
  });
});
