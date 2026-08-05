import { describe, expect, it } from 'vitest';

import { BodyRecord } from '../models/body.model';
import { ExoplanetRecord } from '../models/exoplanet.model';
import { appearanceForBody, appearanceForExoplanet, heliocentricDistanceAu } from './body-appearance';
import { DEFAULT_EPOCH_JD } from './constants';

const ORBIT = { eccentricity: 0, inclinationDeg: 0, longitudeOfAscendingNodeDeg: 0, argumentOfPeriapsisDeg: 0, meanAnomalyAtEpochDeg: 0, epochJd: DEFAULT_EPOCH_JD };

const JUPITER: BodyRecord = { id: 'jupiter', systemStarId: 0, name: 'Jupiter', kind: 'planet', radiusKm: 69911, orbit: { ...ORBIT, semiMajorAxisAu: 5.204 } };
/** Europa's own orbit is around Jupiter: 671,000 km, which is 0.00449 AU. */
const EUROPA: BodyRecord = { id: 'europa', systemStarId: 0, name: 'Europa', kind: 'moon', radiusKm: 1560, parentBodyId: 'jupiter', orbit: { ...ORBIT, semiMajorAxisAu: 0.00449 } };
const EARTH: BodyRecord = { id: 'earth', systemStarId: 0, name: 'Earth', kind: 'planet', radiusKm: 6371, orbit: { ...ORBIT, semiMajorAxisAu: 1 } };
const ORPHAN: BodyRecord = { ...EUROPA, id: 'orphan', parentBodyId: 'nowhere' };

const BODIES = [JUPITER, EUROPA, EARTH, ORPHAN];

describe('heliocentricDistanceAu', () => {
  it('uses a planet own orbit', () => {
    expect(heliocentricDistanceAu(JUPITER, BODIES)).toBeCloseTo(5.204, 6);
  });

  it('uses a moon parent orbit, not the moon own', () => {
    // The load-bearing case: Europa's own semi-major axis is 0.0045 AU. Fed to an equilibrium
    // temperature it would put Europa closer to the Sun than Mercury and boil it.
    expect(heliocentricDistanceAu(EUROPA, BODIES)).toBeCloseTo(5.204, 6);
  });

  it('has no answer for a moon whose parent is missing', () => {
    expect(heliocentricDistanceAu(ORPHAN, BODIES)).toBeUndefined();
  });
});

describe('appearanceForBody', () => {
  it('derives an ice world for a moon of Jupiter, at Jupiter distance', () => {
    const europa = appearanceForBody(EUROPA, BODIES, 1);

    expect(europa.equilibriumTemperatureK).toBeCloseTo(112, -0.5);
    expect(europa.planetClass).toBe('icy');
  });

  it('would have melted that same moon if it used the moon own orbit', () => {
    // Pinning the bug the parent lookup exists to avoid, so it cannot come back silently.
    const wrong = appearanceForBody({ ...EUROPA, parentBodyId: undefined }, BODIES, 1);
    expect(wrong.equilibriumTemperatureK!).toBeGreaterThan(2000);
    expect(wrong.planetClass).not.toBe('icy');
  });

  it('derives Earth as temperate with a polar cap', () => {
    const earth = appearanceForBody(EARTH, BODIES, 1);

    expect(earth.planetClass).toBe('temperate');
    expect(earth.equilibriumTemperatureK).toBeCloseTo(255, -0.5);
    expect(earth.polarCapExtentDeg).toBeGreaterThan(0);
  });

  it('has no density for a solar-system body, since Horizons publishes no masses', () => {
    expect(appearanceForBody(EARTH, BODIES, 1).bulkDensityGramsPerCm3).toBeNull();
  });

  it('still classifies a body when the host luminosity is unknown', () => {
    const earth = appearanceForBody(EARTH, BODIES, null);
    expect(earth.equilibriumTemperatureK).toBeNull();
    expect(earth.planetClass).toBe('rocky');
  });
});

describe('appearanceForExoplanet', () => {
  const KEPLER_186F: ExoplanetRecord = { id: 'Kepler-186 f', hostStarId: 1, hostStarName: 'Kepler-186', name: 'Kepler-186 f', radiusEarth: 1.17, orbit: { semiMajorAxisAu: 0.432 } };

  it('derives a temperature from the host star output and the published orbit', () => {
    // A quarter of a solar luminosity at 0.432 AU: cool, but not frozen.
    const derived = appearanceForExoplanet(KEPLER_186F, 0.04);
    expect(derived.equilibriumTemperatureK).toBeGreaterThan(150);
    expect(derived.equilibriumTemperatureK).toBeLessThan(250);
  });

  it('derives a density where both a radius and a mass are published', () => {
    const withMass = appearanceForExoplanet({ ...KEPLER_186F, massEarth: 1.4 }, 0.04);
    expect(withMass.bulkDensityGramsPerCm3).toBeCloseTo((5.51 * 1.4) / Math.pow(1.17, 3), 4);
  });

  it('falls back to size alone for a host that never cross-referenced to the catalogue', () => {
    // 5685 of the 6319 archive records have no matching HYG star. None of them is rendered in a
    // system, but any of them can still be opened from search.
    const derived = appearanceForExoplanet({ ...KEPLER_186F, hostStarId: null }, null);
    expect(derived.equilibriumTemperatureK).toBeNull();
    expect(derived.planetClass).toBe('rocky');
  });

  it('is stable per planet, so a world keeps its face between visits', () => {
    expect(appearanceForExoplanet(KEPLER_186F, 0.04).seed).toBe(appearanceForExoplanet(KEPLER_186F, 0.04).seed);
  });
});
