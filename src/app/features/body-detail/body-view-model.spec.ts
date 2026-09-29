import { describe, expect, it } from 'vitest';

import { BodyRecord, OrbitalElements } from '../../shared/models/body.model';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { StarRecord, SUN_STAR_ID } from '../../shared/models/star.model';
import { bodyReadouts } from './body-readouts';
import { buildBodyViewModel } from './body-view-model';

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
  // Standish's mean longitude rate, 35 999.373 degrees a century.
  rates: { meanMotionDegPerDay: 35999.37306329 / 36525, longitudeOfAscendingNodeDegPerDay: 0, argumentOfPeriapsisDegPerDay: 0 },
  orbitSource: 'JPL approximate mean elements (Standish), fit for 3000 BC to AD 3000',
};
const luna: BodyRecord = {
  id: 'luna',
  systemStarId: SUN_STAR_ID,
  name: 'Moon',
  kind: 'moon',
  radiusKm: 1737,
  parentBodyId: 'earth',
  orbit: orbit({ semiMajorAxisAu: 0.00257 }),
  // JPL SSD's sidereal mean motion for the Moon.
  rates: { meanMotionDegPerDay: 13.176358, longitudeOfAscendingNodeDegPerDay: -0.05299, argumentOfPeriapsisDegPerDay: 0.16435 },
  orbitSource: 'JPL SSD satellite mean elements, epoch 2000 Jan 1',
};

describe('buildBodyViewModel', () => {
  const catalogues = { bodies: [earth, luna], exoplanets: [] as ExoplanetRecord[], stars: [sun] };

  it('gives a planet the sidereal year its published mean motion goes round in', () => {
    const model = buildBodyViewModel('earth', catalogues);
    expect(model?.orbitalPeriodSource).toBe('measured');
    expect(model?.orbitalPeriodDays).toBeCloseTo(365.2564, 4);
  });

  it('gives a moon its period too, from the same mean motion that carries it round', () => {
    // The card used to refuse, while the scene turned the Moon round the Earth all the same.
    const model = buildBodyViewModel('luna', catalogues);
    expect(model?.orbitalPeriodSource).toBe('measured');
    expect(model?.orbitalPeriodDays).toBeCloseTo(27.32166, 5);
  });

  it('prints the size of an inclination fitted below zero, as the same orbit with its node turned half round', () => {
    const tilted: BodyRecord = { ...earth, orbit: orbit({ inclinationDeg: -0.00054346 }) };
    const model = buildBodyViewModel('earth', { ...catalogues, bodies: [tilted] })!;
    expect(bodyReadouts(model).measured.find((row) => row.label === 'Inclination')?.value).toBe('0.00°');
  });

  it('prints the eccentricity measured for a moon whose orbit keeps an older one', () => {
    const hyperion: BodyRecord = { ...luna, id: 'hyperion', orbit: orbit({ eccentricity: 0.0232 }), measuredEccentricity: 0.105 };
    const model = buildBodyViewModel('hyperion', { ...catalogues, bodies: [earth, hyperion] })!;
    expect(bodyReadouts(model).measured.find((row) => row.label === 'Eccentricity')?.value).toBe('0.105');
  });

  it('says where the orbit comes from, in the card’s provenance', () => {
    expect(bodyReadouts(buildBodyViewModel('luna', catalogues)!).provenance).toContain('Orbit: JPL SSD satellite mean elements, epoch 2000 Jan 1.');
  });

  it('says a moon without a map is illustrated, without saying it was never imaged', () => {
    // luna has no map under that id. Voyager and Cassini photographed every moon drawn this way.
    const provenance = bodyReadouts(buildBodyViewModel('luna', catalogues)!).provenance;
    expect(provenance).toContain('Not an observation — no global map of this world is used here.');
    expect(provenance).not.toContain('no image of this world exists');
  });

  it('says an exoplanet has never been imaged', () => {
    const exoplanet: ExoplanetRecord = { id: 'x', hostStarId: SUN_STAR_ID, hostStarName: 'Sol', name: 'X b', orbit: { semiMajorAxisAu: 0.05 } };
    const model = buildBodyViewModel('x', { bodies: [], exoplanets: [exoplanet], stars: [sun] })!;
    expect(bodyReadouts(model).provenance).toContain('Not an observation — no image of this world exists.');
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

  it('carries the host star id, so callers need not rescan the catalogues for it', () => {
    expect(buildBodyViewModel('earth', catalogues)?.hostStarId).toBe(SUN_STAR_ID);
  });
});
