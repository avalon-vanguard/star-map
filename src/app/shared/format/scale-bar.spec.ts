import { describe, expect, it } from 'vitest';

import { distanceRings, formatRoundLength, roundLengthAtMost, scaleBar } from './scale-bar';

describe('roundLengthAtMost', () => {
  it('rounds down to 1, 2 or 5 times a power of ten', () => {
    expect(roundLengthAtMost(51)).toBe(50);
    expect(roundLengthAtMost(3.3)).toBe(2);
    expect(roundLengthAtMost(0.7)).toBe(0.5);
    expect(roundLengthAtMost(1999)).toBe(1000);
  });

  it('keeps a length that is already round, including at a decade', () => {
    expect(roundLengthAtMost(1000)).toBe(1000);
    expect(roundLengthAtMost(100)).toBe(100);
    expect(roundLengthAtMost(5)).toBe(5);
    expect(roundLengthAtMost(0.2)).toBe(0.2);
  });

  it('has no length for nothing', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(roundLengthAtMost(value)).toBeNull();
    }
  });
});

describe('distanceRings', () => {
  // The opening view sits about 307 pc from the Sun: the rings the map always had, with the
  // survey edge at the fifth, and on out past the camera for the stars now drawn beyond it.
  it('reaches past the camera from the opening view', () => {
    expect(distanceRings(0, 307, 5, 250)).toEqual([50, 100, 150, 200, 250, 300, 350]);
  });

  it('closes in with the camera', () => {
    expect(distanceRings(0, 20, 5, 250)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(distanceRings(0, 1, 5, 250)).toEqual([0.2, 0.4, 0.6, 0.8, 1]);
  });

  // Near Mirfak the camera is 155 pc out; rounding the step down to 20 pc must not leave the
  // rings stopping at 100.
  it('covers the whole distance whatever the rounding', () => {
    expect(distanceRings(0, 155, 5, 250)).toEqual([20, 40, 60, 80, 100, 120, 140, 160]);
  });

  // A star 190 pc out seen from 20 pc away: the frame is a band about 19 pc either side of it and
  // the Sun is nowhere in it. Sized to the 210 pc it reaches, the step would be 20 pc and the
  // nearest rings — 180 and 200 — would both miss the frame.
  it('spaces the rings for a frame that does not hold the Sun', () => {
    const radii = distanceRings(171, 210, 5, 250);

    expect(radii).toEqual([170, 175, 180, 185, 190, 195, 200, 205, 210]);
    expect(radii.some((radius) => Math.abs(radius - 190) < 19)).toBe(true);
  });

  it('marks the callout among rings the step does not land on', () => {
    expect(distanceRings(0, 1000, 5, 250)).toEqual([200, 250, 400, 600, 800, 1000]);
  });

  it('leaves the callout out when it is past the last ring, or behind the first', () => {
    expect(distanceRings(0, 100, 5, 250)).toEqual([20, 40, 60, 80, 100]);
    expect(distanceRings(400, 440, 5, 250)).toEqual([400, 405, 410, 415, 420, 425, 430, 435, 440]);
  });

  it('draws no rings for a camera with no distance', () => {
    expect(distanceRings(0, 0, 5, 250)).toEqual([]);
  });
});

describe('scaleBar', () => {
  it('picks the longest round length that fits, and the width it spans', () => {
    // A tenth of a parsec a pixel and 120 px of room: 12 pc would fit, and the round length
    // under it is 10 pc, which spans 100 px.
    expect(scaleBar(0.1, 120, 'pc')).toEqual({ label: '10 pc', widthPx: 100 });
  });

  it('draws nothing for a view with no extent', () => {
    expect(scaleBar(0, 120, 'pc')).toBeNull();
  });
});

describe('formatRoundLength', () => {
  it('reads without trailing zeros, in kiloparsecs past a thousand', () => {
    expect(formatRoundLength(2000, 'pc')).toBe('2 kpc');
    expect(formatRoundLength(500, 'pc')).toBe('500 pc');
    expect(formatRoundLength(0.2, 'pc')).toBe('0.2 pc');
    expect(formatRoundLength(0.05, 'AU')).toBe('0.05 AU');
  });

  // Ring radii are multiples of a round step rather than round themselves; a one-digit format
  // printed the 250 pc survey edge as "300 pc".
  it('keeps every digit of a ring radius', () => {
    expect(formatRoundLength(250, 'pc')).toBe('250 pc');
    expect(formatRoundLength(150, 'pc')).toBe('150 pc');
    expect(formatRoundLength(2500, 'pc')).toBe('2.5 kpc');
  });
});
