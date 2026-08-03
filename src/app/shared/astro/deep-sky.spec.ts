import { describe, expect, it } from 'vitest';

import {
  classifyOpenNgcType,
  estimateDeepSkyDistancePc,
  HUBBLE_CONSTANT_KM_S_PER_MPC,
  isNotableDeepSkyObject,
  NOTABLE_MAGNITUDE_LIMIT,
  redshiftToDistancePc,
  SPEED_OF_LIGHT_KM_S
} from './deep-sky';

describe('classifyOpenNgcType', () => {
  it('groups every galaxy-ish type as a galaxy', () => {
    for (const type of ['G', 'GPair', 'GTrpl', 'GGroup']) {
      expect(classifyOpenNgcType(type)).toBe('galaxy');
    }
  });

  it('groups nebulae, remnants and cluster-with-nebulosity as nebulae', () => {
    for (const type of ['PN', 'HII', 'EmN', 'RfN', 'Neb', 'DrkN', 'SNR', 'Cl+N']) {
      expect(classifyOpenNgcType(type)).toBe('nebula');
    }
  });

  it('groups open, globular and stellar-association types as clusters', () => {
    for (const type of ['OCl', 'GCl', '*Ass']) {
      expect(classifyOpenNgcType(type)).toBe('cluster');
    }
  });

  it('rejects catalog rows that are not deep-sky objects', () => {
    // Duplicates, non-existent entries, plain and double stars, novae, and the catch-all.
    for (const type of ['Dup', 'NonEx', '*', '**', 'Nova', 'Other']) {
      expect(classifyOpenNgcType(type)).toBeNull();
    }
  });

  it('rejects missing or unknown types', () => {
    for (const type of ['', '   ', 'wat', undefined, null]) {
      expect(classifyOpenNgcType(type)).toBeNull();
    }
  });

  it('ignores surrounding whitespace', () => {
    expect(classifyOpenNgcType(' G ')).toBe('galaxy');
  });
});

describe('redshiftToDistancePc', () => {
  it('applies the Hubble law', () => {
    const redshift = 0.02286;
    const expectedMpc = (SPEED_OF_LIGHT_KM_S * redshift) / HUBBLE_CONSTANT_KM_S_PER_MPC;
    expect(redshiftToDistancePc(redshift)).toBeCloseTo(expectedMpc * 1e6, 0);
  });

  it('scales linearly with redshift', () => {
    const near = redshiftToDistancePc(0.01)!;
    const far = redshiftToDistancePc(0.02)!;
    expect(far / near).toBeCloseTo(2, 9);
  });

  it('rejects a blueshift, which carries no distance information', () => {
    // M31 approaches us at ~300 km/s.
    expect(redshiftToDistancePc(-0.001)).toBeNull();
  });

  it('rejects redshifts too small to be dominated by cosmological expansion', () => {
    // The Small Magellanic Cloud: a real positive redshift that yields a 33x-wrong distance.
    expect(redshiftToDistancePc(0.000527)).toBeNull();
  });

  it('rejects null and non-finite input', () => {
    expect(redshiftToDistancePc(null)).toBeNull();
    expect(redshiftToDistancePc(Number.NaN)).toBeNull();
    expect(redshiftToDistancePc(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('estimateDeepSkyDistancePc', () => {
  it('prefers parallax for a galactic object', () => {
    // The Helix Nebula, ~200 pc away.
    const estimate = estimateDeepSkyDistancePc({ kind: 'nebula', redshift: 0.05, parallaxMas: 4.98 });
    expect(estimate?.method).toBe('parallax');
    expect(estimate?.distancePc).toBeCloseTo(200.8, 1);
  });

  it('refuses parallax for a galaxy, because the catalog value is a foreground star', () => {
    // OpenNGC lists 6 mas for M31 — that would put a 780 kpc galaxy at 167 pc.
    const estimate = estimateDeepSkyDistancePc({ kind: 'galaxy', redshift: -0.001, parallaxMas: 6 });
    expect(estimate).toBeNull();
  });

  it('falls back to redshift for a distant galaxy', () => {
    const estimate = estimateDeepSkyDistancePc({ kind: 'galaxy', redshift: 0.00365, parallaxMas: null });
    expect(estimate?.method).toBe('redshift');
    expect(estimate!.distancePc).toBeGreaterThan(1e7);
  });

  it('falls back to redshift when a galactic object has no usable parallax', () => {
    for (const parallaxMas of [null, 0, -3]) {
      const estimate = estimateDeepSkyDistancePc({ kind: 'cluster', redshift: 0.01, parallaxMas });
      expect(estimate?.method).toBe('redshift');
    }
  });

  it('rejects a parallax implying a distance beyond the Milky Way', () => {
    // 0.000001 mas would imply a billion parsecs — noise, not a measurement.
    const estimate = estimateDeepSkyDistancePc({ kind: 'cluster', redshift: null, parallaxMas: 1e-6 });
    expect(estimate).toBeNull();
  });

  it('returns null when neither source is usable', () => {
    expect(estimateDeepSkyDistancePc({ kind: 'nebula', redshift: null, parallaxMas: null })).toBeNull();
    expect(estimateDeepSkyDistancePc({ kind: 'galaxy', redshift: null, parallaxMas: null })).toBeNull();
  });
});

describe('isNotableDeepSkyObject', () => {
  it('keeps anything in the Messier catalog, however faint', () => {
    expect(isNotableDeepSkyObject({ messier: 'M76', commonName: null, magnitude: 12 })).toBe(true);
  });

  it('keeps anything with a common name', () => {
    expect(isNotableDeepSkyObject({ messier: null, commonName: 'Helix Nebula', magnitude: 20 })).toBe(true);
  });

  it('keeps an anonymous object that is bright enough', () => {
    expect(isNotableDeepSkyObject({ messier: null, commonName: null, magnitude: NOTABLE_MAGNITUDE_LIMIT })).toBe(true);
  });

  it('drops an anonymous object fainter than the limit', () => {
    expect(isNotableDeepSkyObject({ messier: null, commonName: null, magnitude: NOTABLE_MAGNITUDE_LIMIT + 0.1 })).toBe(false);
  });

  it('drops an anonymous object with no measured magnitude', () => {
    // Guards the `Number('') === 0` trap: an unphotometered object must not be treated as
    // magnitude 0, which would make it brighter than every star in the sky.
    expect(isNotableDeepSkyObject({ messier: null, commonName: null, magnitude: null })).toBe(false);
  });
});
