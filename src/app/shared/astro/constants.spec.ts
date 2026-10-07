import { describe, expect, it } from 'vitest';

import { tdbFromUtc, ttMinusUtSeconds } from './constants';

const jd = (year: number, month = 1, day = 1): number => Date.UTC(year, month - 1, day) / 86400000 + 2440587.5;

describe('ttMinusUtSeconds', () => {
  it('follows the historical record before 1972: within 1 per cent of Horizons at AD 1, 6 per cent at AD 1000, 0.2 s in 1950', () => {
    // Horizons' TDB - UT (observer quantity 30) on JD 1721600, 2086455 and 2433282.5.
    expect(Math.abs(ttMinusUtSeconds(1721600) - 10465.73)).toBeLessThan(105);
    expect(Math.abs(ttMinusUtSeconds(2086455) - 1658.0)).toBeLessThan(100);
    expect(Math.abs(ttMinusUtSeconds(2433282.5) - 28.93)).toBeLessThan(0.2);
  });

  it('counts the leap seconds from 1972, and holds the last from 2017 on', () => {
    expect(ttMinusUtSeconds(jd(1972, 6, 30))).toBe(42.184);
    expect(ttMinusUtSeconds(jd(1972, 7, 1))).toBe(43.184);
    expect(ttMinusUtSeconds(jd(2016, 12, 31))).toBe(68.184);
    expect(ttMinusUtSeconds(jd(2017, 1, 1))).toBe(69.184);
    expect(ttMinusUtSeconds(jd(2999, 1, 1))).toBe(69.184);
  });

  it('joins its polynomials without a jump of more than 0.3 s, the 0.25 s at 1600 the worst', () => {
    for (const year of [500, 1600, 1700, 1800, 1860, 1900, 1920, 1941, 1961]) {
      const at = 2451544.5 + (year - 2000) * 365.2425;
      expect(Math.abs(ttMinusUtSeconds(at + 0.01) - ttMinusUtSeconds(at - 0.01))).toBeLessThan(0.3);
    }
  });

  it('hands over from the polynomial to the leap seconds at the start of 1972, 0.07 s apart', () => {
    // The switch is placed by the calendar, not by a 365.2425-day year, so it is sampled on either
    // side of midnight; the last day of 1971 must still be the polynomial's 42.25 s, not the table's
    // 42.184, or the switch has moved earlier; and midnight itself must already be the table's, or it
    // has moved later, which the step alone cannot see once both samples fall on the polynomial.
    const start = jd(1972);
    expect(ttMinusUtSeconds(start)).toBe(42.184);
    expect(Math.abs(ttMinusUtSeconds(start) - ttMinusUtSeconds(start - 1e-6))).toBeLessThan(0.1);
    expect(Math.abs(ttMinusUtSeconds(jd(1971, 12, 31)) - 42.2485)).toBeLessThan(0.01);
  });
});

describe('tdbFromUtc', () => {
  it('puts the clock’s date that far on', () => {
    expect((tdbFromUtc(jd(2025)) - jd(2025)) * 86400).toBeCloseTo(69.184, 3);
    expect((tdbFromUtc(2086455) - 2086455) * 86400).toBeCloseTo(ttMinusUtSeconds(2086455), 3);
  });
});
