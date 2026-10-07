import { describe, expect, it } from 'vitest';
import { fmtDuration, fmtHeading, fmtNum, fmtSigned } from '../lib/format';

describe('format', () => {
  it('never shows negative zero', () => {
    expect(fmtNum(-0.0001)).toBe('0.00');
    expect(fmtNum(-1.234)).toBe('-1.23');
    expect(fmtNum(null)).toBe('—');
  });
  it('signs values', () => {
    expect(fmtSigned(0.5)).toBe('+0.50');
    expect(fmtSigned(-0.5)).toBe('-0.50');
    expect(fmtSigned(0.0001)).toBe('0.00');
  });
  it('wraps headings to 0-360', () => {
    expect(fmtHeading(-Math.PI / 2)).toBe('270.0°');
    expect(fmtHeading(0)).toBe('0.0°');
  });
  it('formats durations', () => {
    expect(fmtDuration(75)).toBe('1:15');
    expect(fmtDuration(3725)).toBe('1:02:05');
    expect(fmtDuration(-1)).toBe('—');
  });
});
