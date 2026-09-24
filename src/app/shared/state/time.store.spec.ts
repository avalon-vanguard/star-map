import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimeStore } from './time.store';

const MS_PER_DAY = 86_400_000;
const START = new Date('2026-09-22T12:00:00Z');

describe('TimeStore', () => {
  let time: TimeStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    time = new TimeStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the world’s own time until asked otherwise', () => {
    const opened = time.julianDate();
    vi.advanceTimersByTime(10_000);

    expect(time.julianDate() - opened).toBeCloseTo(10_000 / MS_PER_DAY, 9);
    expect(time.date().toISOString()).toBe('2026-09-22T12:00:10.000Z');
  });

  it('runs the sky faster without moving where it starts from', () => {
    const opened = time.julianDate();
    time.setRate(3600);
    vi.advanceTimersByTime(1000);

    // A second of watching is an hour of sky, and the date did not jump when the rate changed.
    expect(time.julianDate() - opened).toBeCloseTo(1 / 24, 9);
  });

  it('carries on from where it had got to when the rate changes again', () => {
    time.setRate(86_400);
    vi.advanceTimersByTime(2000); // two days of sky
    const afterTwoDays = time.julianDate();

    time.setRate(1);
    vi.advanceTimersByTime(1000);

    // Slowing down keeps the two days: it does not rewind to the wall clock.
    expect(time.julianDate() - afterTwoDays).toBeCloseTo(1000 / MS_PER_DAY, 9);
    expect(time.julianDate() - afterTwoDays).toBeLessThan(1 / 24);
  });

  it('knows the map is away from now even once it is back at real time', () => {
    expect(time.atNow()).toBe(true);
    time.setRate(2_629_800);
    vi.advanceTimersByTime(5000);
    time.setRate(1);

    // Real time, months ahead: the rate says nothing about where the clock stands.
    expect(time.atNow()).toBe(false);
    time.reset();
    expect(time.atNow()).toBe(true);
  });

  it('comes back to now, at real time', () => {
    time.setRate(2_629_800);
    vi.advanceTimersByTime(5000); // months away
    expect(time.date().getUTCFullYear()).toBeGreaterThan(START.getUTCFullYear());

    time.reset();

    expect(time.rate()).toBe(1);
    // Now, not the moment the store was built: five seconds of wall clock have passed.
    expect(time.date().toISOString()).toBe(new Date(START.getTime() + 5000).toISOString());
  });
});
