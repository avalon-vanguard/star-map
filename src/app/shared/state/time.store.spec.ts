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

  it('runs the date backwards at a negative rate', () => {
    time.setRate(-86_400);
    const before = time.julianDate();
    vi.advanceTimersByTime(1000);

    expect(time.julianDate() - before).toBeCloseTo(-1, 9);
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

  it('jumps to a date and carries on from it at the rate it was running at', () => {
    vi.advanceTimersByTime(5000); // five seconds before the jump, which it must not add on
    expect(time.setDate(new Date('2020-12-21T18:00Z'))).toBe(true);
    // Away from now although still at real time: the rate never changed, the date did.
    expect(time.atNow()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(time.date().toISOString()).toBe('2020-12-21T18:00:01.000Z');

    time.setRate(3600);
    vi.advanceTimersByTime(1000);
    expect(time.date().toISOString()).toBe('2020-12-21T19:00:01.000Z');
  });

  it('stops a running clock at either end of the window, at real time turned back into it', () => {
    time.setDate(new Date('0001-01-10T00:00Z'));
    time.setRate(-2_629_800); // a month a second, backwards
    vi.advanceTimersByTime(60_000);
    expect(time.date().toISOString()).toBe('0001-01-01T00:00:00.000Z');
    expect(time.rate()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(time.date().toISOString()).toBe('0001-01-01T00:00:01.000Z');

    time.setDate(new Date('2999-12-01T00:00Z'));
    time.setRate(2_629_800);
    vi.advanceTimersByTime(60_000);
    expect(time.date().toISOString()).toBe('3000-01-01T00:00:00.000Z');
    expect(time.rate()).toBe(-1);
  });

  it('refuses a date the planets’ elements were never fitted for, and stays where it was', () => {
    const before = time.date().toISOString();

    expect(time.setDate(new Date('3000-01-01T00:01Z'))).toBe(false);
    expect(time.setDate(new Date(Date.UTC(-100, 0, 1)))).toBe(false); // 101 BC
    expect(time.setDate(new Date('not a date'))).toBe(false);
    expect(time.date().toISOString()).toBe(before);
    expect(time.atNow()).toBe(true);

    // Both ends are in: the first day a date input can hold, and the end of Standish's fit.
    expect(time.setDate(new Date('0001-01-01T00:00Z'))).toBe(true);
    expect(time.date().toISOString()).toBe('0001-01-01T00:00:00.000Z');
    expect(time.setDate(new Date('3000-01-01T00:00Z'))).toBe(true);
  });
});
