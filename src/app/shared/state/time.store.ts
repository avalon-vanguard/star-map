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
 * The date the map is drawn for.
 *
 * Read every frame rather than held in a signal: it changes continuously, and a signal that
 * changed sixty times a second would ask the whole HUD to re-render for a number nothing is
 * watching. The rate *is* a signal, since a reader sets it and the controls read it back.
 *
 * Changing the rate re-anchors instead of rewinding: the date carries on from where it had got
 * to, so speeding up and slowing down never jumps the sky.
 */
@Injectable({ providedIn: 'root' })
export class TimeStore {
  readonly rate = signal<number>(TIME_RATES[0].secondsPerSecond);

  private anchorJd = dateToJulianDate();
  private anchorWallMs = Date.now();

  /** Julian date for this instant, at the rate the reader chose. */
  julianDate(): number {
    return this.anchorJd + ((Date.now() - this.anchorWallMs) * this.rate()) / MS_PER_DAY;
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
  }

  /** Back to now, at real time — the state the map opens in. */
  reset(): void {
    this.anchorJd = dateToJulianDate();
    this.anchorWallMs = Date.now();
    this.rate.set(TIME_RATES[0].secondsPerSecond);
  }
}
