import { describe, expect, it } from 'vitest';

import { BodyRecord, OrbitalElements } from '../../shared/models/body.model';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { StarRecord, SUN_STAR_ID } from '../../shared/models/star.model';
import { buildBodyViewModel, heliocentricPeriodDays } from './body-view-model';

const orbit = (overrides: Partial<OrbitalElements> = {}): OrbitalElements => ({
  semiMajorAxisAu: 1,
  eccentricity: 0.0167,
  inclinationDeg: 0,
  longitudeOfAscendingNodeDeg: 0,
  argumentOfPeriapsisDeg: 0,
  meanAnomalyAtEpochDeg: 0,
  epochJd: 2451545,
  ...overrides,
});

const sun: StarRecord = {
  id: SUN_STAR_ID,
  name: 'Sol',
  x: 0,
  y: 0,
  z: 0,
  magnitude: -26.7,
  spectralType: 'G2V',
  colorIndex: 0.65,
};

const earth: BodyRecord = {
  id: 'earth',
  systemStarId: SUN_STAR_ID,
  name: 'Earth',
  kind: 'planet',
  radiusKm: 6371,
  orbit: orbit(),
};
const luna: BodyRecord = {
  id: 'luna',
  systemStarId: SUN_STAR_ID,
  name: 'Moon',
  kind: 'moon',
  radiusKm: 1737,
  parentBodyId: 'earth',
  orbit: orbit({ semiMajorAxisAu: 0.00257 }),
};

describe('heliocentricPeriodDays', () => {
  it('recovers a known period from the semi-major axis alone', () => {
    // P² = a³ in these units, so Earth must come back a year.
    expect(heliocentricPeriodDays(earth)).toBeCloseTo(365.25, 1);
  });

  it('scales as the three-halves power', () => {
    const jupiter: BodyRecord = {
      ...earth,
      id: 'jupiter',
      name: 'Jupiter',
      orbit: orbit({ semiMajorAxisAu: 5.2044 }),
    };
    // Jupiter's real sidereal period is 4332.6 days.
    expect(heliocentricPeriodDays(jupiter)).toBeCloseTo(4335, -1);
  });

  it('refuses to compute a period for a moon', () => {
    // A moon's elements are relative to its planet, whose mass is not in the catalogue — the
    // same arithmetic would be wrong by the ratio of that planet's mass to the Sun's.
    expect(heliocentricPeriodDays(luna)).toBeUndefined();
  });
});

describe('buildBodyViewModel', () => {
  const catalogues = { bodies: [earth, luna], exoplanets: [] as ExoplanetRecord[], stars: [sun] };

  it('marks a period computed from the semi-major axis as derived', () => {
    const model = buildBodyViewModel('earth', catalogues);
    expect(model?.orbitalPeriodSource).toBe('derived');
    expect(model?.orbitalPeriodDays).toBeCloseTo(365.25, 1);
  });

  it('leaves a moon without a period rather than inventing one', () => {
    const model = buildBodyViewModel('luna', catalogues);
    expect(model?.orbitalPeriodDays).toBeUndefined();
    expect(model?.orbitalPeriodSource).toBeUndefined();
  });

  it('marks a published exoplanet period as measured, not derived', () => {
    const exoplanet: ExoplanetRecord = {
      id: 'kepler-22-b',
      hostStarId: null,
      hostStarName: 'Kepler-22',
      name: 'Kepler-22 b',
      periodDays: 289.9,
      orbit: { semiMajorAxisAu: 0.849 },
    };
    const model = buildBodyViewModel('kepler-22-b', {
      bodies: [],
      exoplanets: [exoplanet],
      stars: [],
    });
    expect(model?.orbitalPeriodSource).toBe('measured');
    expect(model?.orbitalPeriodDays).toBe(289.9);
  });

  it('leaves an exoplanet with no published period undefined rather than assuming a solar-mass host', () => {
    const exoplanet: ExoplanetRecord = {
      id: 'x',
      hostStarId: null,
      hostStarName: 'X',
      name: 'X b',
      orbit: { semiMajorAxisAu: 0.05 },
    };
    const model = buildBodyViewModel('x', { bodies: [], exoplanets: [exoplanet], stars: [] });
    expect(model?.orbitalPeriodDays).toBeUndefined();
  });

  it('returns undefined for an id in neither catalogue', () => {
    expect(buildBodyViewModel('nowhere', catalogues)).toBeUndefined();
  });

  it('reads the same body identically however it is reached', () => {
    // The whole point of the shared builder: the card and the detail route must not drift.
    expect(buildBodyViewModel('earth', catalogues)).toEqual(buildBodyViewModel('earth', catalogues));
  });
});
