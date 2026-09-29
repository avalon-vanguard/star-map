import { Injectable, signal } from '@angular/core';

import { dateToJulianDate } from '../astro/constants';

/**
 * How fast the map's clock runs, in seconds of sky per second of wall clock.
 *
 * The map is built on propagated orbits and published rotation periods, both of which are
 * functions of a date — so the only thing standing between it and a working orrery is the number
 * on this list. At real time nothing appears to move: Earth turns 15 degrees an hour and takes a
 * year to go round, and a reader watching for a minute sees a still picture.
 *
 * An hour a second is the rate at which rotation reads — Jupiter turns once every ten seconds of
 * watching. A day a second is the rate at which the inner planets read. A month a second carries
 * the outer ones, at which point the inner four are a blur, which is honest: that is what the
 * solar system does.
 */
export const TIME_RATES = [
  { label: 'Real time', secondsPerSecond: 1 },
  { label: '1 h/s', secondsPerSecond: 3600 },
  { label: '1 d/s', secondsPerSecond: 86_400 },
  { label: '1 mo/s', secondsPerSecond: 2_629_800 },
] as const;

const MS_PER_DAY = 86_400_000;
const JULIAN_DATE_AT_EPOCH = 2440587.5;

/**
 * The dates the clock can be set to, as `datetime-local` values read as UTC.
 *
 * The end is where Standish's Table 2, the mean elements that carry the planets, stops being
 * fitted: it covers 3000 BC to AD 3000, and every planet was within 0.29 degrees of Horizons at
 * each date measured out to 3000. The start is not the fit's but the date input's, which cannot
 * go before 0001-01-01. Both are proleptic Gregorian, as a `Date` is, so before 1582 they part from
 * the Julian-calendar dates history gives: two days behind them at AD 1, level from AD 200 to 300,
 * ten days ahead by 1582. The moons and dwarf planets hold for far less of it: each card says how
 * far its orbit strays from Horizons from 1950 to 2100 (Ceres 7.1 degrees there, 11.6 by 2200 and
 * 39 by 1600).
 */
export const CLOCK_WINDOW = { min: '0001-01-01T00:00', max: '3000-01-01T00:00' } as const;
const WINDOW_MS = {
  min: Date.parse(`${CLOCK_WINDOW.min}Z`),
  max: Date.parse(`${CLOCK_WINDOW.max}Z`),
};
const WINDOW_JD = {
  min: WINDOW_MS.min / MS_PER_DAY + JULIAN_DATE_AT_EPOCH,
  max: WINDOW_MS.max / MS_PER_DAY + JULIAN_DATE_AT_EPOCH,
};

/**
 * The date the map is drawn for.
 *
 * Read every frame rather than held in a signal: it changes continuously, and a signal that
 * changed sixty times a second would ask the whole HUD to re-render for a number nothing is
 * watching. The rate *is* a signal, since a reader sets it and the controls read it back.
 *
 * Changing the rate re-anchors instead of rewinding: the date carries on from where it had got
 * to, so speeding up and slowing down never jumps the sky. A negative rate runs the same clock
 * backwards: every orbit and every rotation is a function of the date, so going back is the same
 * sum with the sign turned.
 */
@Injectable({ providedIn: 'root' })
export class TimeStore {
  readonly rate = signal<number>(TIME_RATES[0].secondsPerSecond);
  /**
   * Whether the map is drawn for the present. Not the same as a rate of one: after an excursion at
   * a month a second, real time carries on from months ahead, and the map is still away from now.
   */
  readonly atNow = signal(true);

  private anchorJd = dateToJulianDate();
  private anchorWallMs = Date.now();

  /**
   * Julian date for this instant, at the rate the reader chose, held to {@link CLOCK_WINDOW}: a
   * clock run past either end stops there, at real time turned back into the window, as if the
   * reader had set that date. Unheld, a month a second carried it past AD 3000, where the planets'
   * elements were never fitted, and before AD 1, where `toISOString` writes a six-digit year the
   * date strip, the note and the date field cut in the wrong places ("-000001-12-01 00 UTC").
   */
  julianDate(): number {
    const jd = this.anchorJd + ((Date.now() - this.anchorWallMs) * this.rate()) / MS_PER_DAY;
    if (jd >= WINDOW_JD.min && jd <= WINDOW_JD.max) {
      return jd;
    }
    this.anchorJd = jd < WINDOW_JD.min ? WINDOW_JD.min : WINDOW_JD.max;
    this.anchorWallMs = Date.now();
    this.rate.set(jd < WINDOW_JD.min ? 1 : -1);
    return this.anchorJd;
  }

  /**
   * The same instant as a date, for anything that prints it.
   *
   * Rounded to the millisecond, which is all a `Date` holds: a Julian date near 2 461 000 has
   * about a twentieth of a millisecond of resolution left in a double, and `new Date` truncates
   * what is left rather than rounding it, so ten seconds came back as 9.999.
   */
  date(): Date {
    return new Date(Math.round((this.julianDate() - JULIAN_DATE_AT_EPOCH) * MS_PER_DAY));
  }

  setRate(secondsPerSecond: number): void {
    this.anchorJd = this.julianDate();
    this.anchorWallMs = Date.now();
    this.rate.set(secondsPerSecond);
    if (secondsPerSecond !== 1) {
      this.atNow.set(false);
    }
  }

  /**
   * Jumps the clock to a date, from which it carries on at whatever rate it was running at.
   * Refuses one outside {@link CLOCK_WINDOW}, rather than draw planets where elements that were
   * never fitted there put them.
   */
  setDate(date: Date): boolean {
    const ms = date.getTime();
    // Written so that NaN, an unparsable field, fails it too.
    if (!(ms >= WINDOW_MS.min && ms <= WINDOW_MS.max)) {
      return false;
    }
    this.anchorJd = dateToJulianDate(date);
    this.anchorWallMs = Date.now();
    this.atNow.set(false);
    return true;
  }

  /** Back to now, at real time — the state the map opens in. */
  reset(): void {
    this.anchorJd = dateToJulianDate();
    this.anchorWallMs = Date.now();
    this.rate.set(TIME_RATES[0].secondsPerSecond);
    this.atNow.set(true);
  }
}
