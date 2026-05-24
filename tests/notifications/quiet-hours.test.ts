import { describe, it, expect } from 'vitest';
import { isWithinQuietHours } from '../../src/modules/notifications/service.js';

function at(h: number, m: number = 0): Date {
  const d = new Date(2026, 4, 24, h, m, 0, 0);
  return d;
}

describe('isWithinQuietHours', () => {
  it('returns false when start === end (disabled window)', () => {
    expect(isWithinQuietHours(at(2), '00:00', '00:00')).toBe(false);
    expect(isWithinQuietHours(at(23), '07:00', '07:00')).toBe(false);
  });

  it('handles same-day windows (start < end)', () => {
    // 08:00 → 17:00
    expect(isWithinQuietHours(at(8), '08:00', '17:00')).toBe(true);
    expect(isWithinQuietHours(at(12, 30), '08:00', '17:00')).toBe(true);
    expect(isWithinQuietHours(at(16, 59), '08:00', '17:00')).toBe(true);
    expect(isWithinQuietHours(at(17), '08:00', '17:00')).toBe(false); // exclusive end
    expect(isWithinQuietHours(at(7, 59), '08:00', '17:00')).toBe(false);
  });

  it('handles wrap-midnight windows (start > end)', () => {
    // 22:00 → 07:00 — the most common quiet config
    expect(isWithinQuietHours(at(22), '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours(at(23, 30), '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours(at(0), '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours(at(6, 59), '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours(at(7), '22:00', '07:00')).toBe(false);
    expect(isWithinQuietHours(at(12), '22:00', '07:00')).toBe(false);
    expect(isWithinQuietHours(at(21, 59), '22:00', '07:00')).toBe(false);
  });

  it('returns false when input strings are malformed', () => {
    expect(isWithinQuietHours(at(12), 'invalid', '07:00')).toBe(false);
    expect(isWithinQuietHours(at(12), '08:00', '25:00')).toBe(false);
  });
});
