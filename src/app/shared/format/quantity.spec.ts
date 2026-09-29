import { describe, expect, it } from 'vitest';

import { formatAu, formatDensity, formatDistance, formatLuminosity, formatMassEarth, formatParsecs, formatPeriod, formatRadiusKm, formatTemperature } from './quantity';

describe('formatParsecs', () => {
  it('switches to kiloparsecs past a thousand parsecs', () => {
    expect(formatParsecs(8180)).toBe('8.2 kpc');
  });

  it('keeps two decimals only while they carry information', () => {
    expect(formatParsecs(1.3)).toBe('1.30 pc');
    expect(formatParsecs(250)).toBe('250 pc');
  });
});

describe('formatDistance', () => {
  it('gives the error to the digits the distance is shown to', () => {
    expect(formatDistance(117.3, 0.1)).toBe('117 ± 12 pc');
    expect(formatDistance(4.2, 0.05)).toBe('4.20 ± 0.21 pc');
    expect(formatDistance(1830, 0.15)).toBe('1.8 ± 0.3 kpc');
  });

  it('leaves off an error of a per cent or less, or one too small to show', () => {
    expect(formatDistance(117.3, 0.01)).toBe('117 pc');
    expect(formatDistance(12, 0.03)).toBe('12 pc');
    expect(formatDistance(117.3, undefined)).toBe('117 pc');
  });

  it("gives a range once the error is a fifth of the parallax, and no upper end past all of it", () => {
    // Alnilam: 1.65 ± 0.45 mas in Hipparcos.
    expect(formatDistance(606.06, 0.45 / 1.65)).toBe('476 pc to 833 pc');
    expect(formatDistance(250, 1)).toBe('125 pc or more');
  });

  it('keeps an error on the distance itself symmetric, however large', () => {
    // AT2021ueyL: 1 040 +740 −440 pc in the archive, whose mean is 57 % of it.
    expect(formatDistance(1040, 0.567, true)).toBe('1.0 ± 0.6 kpc');
    expect(formatDistance(134, 0.319, true)).toBe('134 ± 43 pc');
    expect(formatDistance(134, 0.005, true)).toBe('134 pc');
  });
});

describe('formatAu', () => {
  it('holds four decimals for close-in orbits', () => {
    // 0.0026 AU is a real published semi-major axis; two decimals would render it — and every
    // other hot Jupiter — as a flat 0.00.
    expect(formatAu(0.0026)).toBe('0.0026 AU');
  });

  it('drops to whole units past 100 AU', () => {
    expect(formatAu(120)).toBe('120 AU');
    expect(formatAu(5.53)).toBe('5.53 AU');
  });
});

describe('formatPeriod', () => {
  it('uses hours below a day', () => {
    expect(formatPeriod(0.5)).toBe('12.0 h');
  });

  it('uses days through the short end and years beyond', () => {
    expect(formatPeriod(88)).toBe('88.0 d');
    expect(formatPeriod(365.25)).toBe('365.3 d');
    expect(formatPeriod(4332.6)).toBe('11.9 yr');
  });

  it('drops the decimal for periods of centuries', () => {
    expect(formatPeriod(90_560)).toBe('248 yr');
  });
});

describe('formatRadiusKm', () => {
  it('groups thousands on both sides of the decimal threshold', () => {
    // Not just above it: 69,911 km beside a bare 6371 km reads as two different conventions.
    expect(formatRadiusKm(69_911)).toBe('69,911 km');
    expect(formatRadiusKm(6371)).toBe('6,371 km');
  });

  it('keeps a decimal only for small bodies', () => {
    expect(formatRadiusKm(11.3)).toBe('11.3 km');
    expect(formatRadiusKm(1737)).toBe('1,737 km');
  });
});

describe('formatMassEarth', () => {
  it('scales precision to magnitude', () => {
    expect(formatMassEarth(0.815)).toBe('0.815 M⊕');
    expect(formatMassEarth(17.15)).toBe('17.15 M⊕');
    expect(formatMassEarth(317.8)).toBe('318 M⊕');
  });
});

describe('formatTemperature and formatDensity', () => {
  it('rounds temperature to a whole kelvin', () => {
    expect(formatTemperature(254.6)).toBe('255 K');
  });

  it('holds two decimals of density', () => {
    expect(formatDensity(5.514)).toBe('5.51 g/cm³');
  });
});

describe('formatLuminosity', () => {
  it('stays decimal across the ordinary range', () => {
    expect(formatLuminosity(1)).toBe('1.00 L☉');
    expect(formatLuminosity(0.0017)).toBe('0.002 L☉');
  });

  it('goes to powers of ten at the extremes', () => {
    expect(formatLuminosity(126_000)).toBe('1.3×10⁵ L☉');
    expect(formatLuminosity(0.00004)).toBe('4.0×10⁻⁵ L☉');
  });
});
