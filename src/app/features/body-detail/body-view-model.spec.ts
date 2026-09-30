import { describe, expect, it } from 'vitest';

import { BodyRecord, OrbitalElements } from '../../shared/models/body.model';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { StarRecord, SUN_STAR_ID } from '../../shared/models/star.model';
import { buildBodyViewModel, heliocentricPeriodDays, luminosityOf, publishedTemperaturesK, starSurfaceOf } from './body-view-model';

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

  it('carries the host star id, so callers need not rescan the catalogues for it', () => {
    expect(buildBodyViewModel('earth', catalogues)?.hostStarId).toBe(SUN_STAR_ID);
  });
});

describe('luminosityOf', () => {
  // KMT-2016-BLG-1107L as the ETL adds it from the archive: no V, no G, so the stand-in 15.
  const lens: StarRecord = { id: 1070000536, name: 'KMT-2016-BLG-1107L', x: 6651, y: 0, z: 0, magnitude: 15, spectralType: 'Unknown', colorIndex: null, source: 'exoplanet-archive' };
  const lensB: ExoplanetRecord = { id: 'lens-b', hostStarId: lens.id, hostStarName: lens.name, name: 'KMT-2016-BLG-1107L b', orbit: { semiMajorAxisAu: 0.342 } };

  it('has none from a magnitude no survey measured, and gives its planets no temperature from it', () => {
    expect(luminosityOf(lens)).toBeNull();
    expect(buildBodyViewModel('lens-b', { bodies: [], exoplanets: [lensB], stars: [lens] })?.appearance.equilibriumTemperatureK).toBeNull();
    // The same figure measured in V is a star, 37 L☉ at that distance.
    expect(luminosityOf({ ...lens, magnitudeBand: 'V' })).toBeCloseTo(36.8, 0);
  });

  it('is 1 for the Sun, whatever its magnitude is filed under', () => {
    expect(luminosityOf(sun)).toBe(1);
  });
});

describe('starSurfaceOf', () => {
  // Proxima Centauri as HYG describes it, and one of its planets' archive rows.
  const proxima: StarRecord = { id: 70666, name: 'Proxima Centauri', x: 1.2959, y: 0, z: 0, magnitude: 11.01, magnitudeBand: 'V', spectralType: 'M5Ve', colorIndex: 1.807, colorSystem: 'B-V' };
  const proximaB: ExoplanetRecord = { id: 'proxima-cen-b', hostStarId: 70666, hostStarName: 'Proxima Cen', name: 'Proxima Cen b', orbit: { semiMajorAxisAu: 0.0485 } };

  it("is the Sun's own for the Sun, and not derived", () => {
    expect(starSurfaceOf(sun, [])).toEqual({ radiusSolar: 1, radiusDerived: false, temperatureK: 5772, luminositySolar: 1, luminosityDerived: false });
  });

  it("takes a host's radius, temperature and luminosity from the archive", () => {
    const surface = starSurfaceOf(proxima, [{ ...proximaB, hostStarRadiusSolar: 0.141, hostStarTemperatureK: 2900, hostStarLuminositySolar: 0.00151 }]);
    expect(surface).toEqual({ radiusSolar: 0.141, radiusDerived: false, temperatureK: 2900, luminositySolar: 0.00151, luminosityDerived: false });
  });

  it('warms a planet by the luminosity the archive gives its host, on its own page as in its system', () => {
    // 8.9×10⁻⁴ L☉ from Proxima's V and B−V, which put b at 200 K; the archive's 1.51×10⁻³ at 228 K.
    const b = { ...proximaB, hostStarLuminositySolar: 0.00151 };
    const catalogues = { bodies: [], exoplanets: [b, { ...proximaB, id: 'proxima-cen-d', name: 'Proxima Cen d', orbit: { semiMajorAxisAu: 0.02881 } }], stars: [proxima] };
    expect(buildBodyViewModel('proxima-cen-b', catalogues)?.appearance.equilibriumTemperatureK).toBeCloseTo(228, 0);
    // d's own row gives none; its host's luminosity is still the archive's, from b's.
    expect(buildBodyViewModel('proxima-cen-d', catalogues)?.appearance.equilibriumTemperatureK).toBeCloseTo(296, 0);
  });

  it("gives the star field the temperature the disc is drawn at, where a host's planets give it different ones", () => {
    // 193 hosts do: host 1070876212's three rows give 4 094, 4 094 and 3 640 K. The field is tinted
    // from one map of every host and the disc from the host's own planets, so both must take the same row.
    const rows = [
      { ...proximaB, id: 'd', hostStarTemperatureK: undefined },
      { ...proximaB, id: 'b', hostStarTemperatureK: 4094 },
      { ...proximaB, id: 'c', hostStarTemperatureK: 3640 },
    ];
    const other = { ...proximaB, id: 'other', hostStarId: 1, hostStarTemperatureK: 5000 };
    expect(starSurfaceOf(proxima, rows).temperatureK).toBe(4094);
    expect(publishedTemperaturesK([...rows, other]).get(proxima.id)).toBe(starSurfaceOf(proxima, rows).temperatureK);
  });

  it('derives both otherwise, and says the radius is derived', () => {
    const surface = starSurfaceOf(proxima, [proximaB]);
    expect(surface.radiusDerived).toBe(true);
    expect(surface.luminosityDerived).toBe(true);
    expect(surface.luminositySolar).toBeCloseTo(0.00088, 5);
    // Its colour reads as an M5 dwarf: 3 068 K and 0.105 R☉, against 2 900 K and 0.154 R☉
    // measured (Kervella et al. 2017). B−V barely changes along the late M dwarfs.
    expect(surface.temperatureK).toBeCloseTo(3068, -1);
    expect(surface.radiusSolar).toBeCloseTo(0.105, 2);
  });

  it('has no radius for a star with neither a colour nor a type', () => {
    expect(starSurfaceOf({ ...proxima, colorIndex: null, spectralType: 'Unknown' }, []).radiusSolar).toBeNull();
  });

  it('has none from a magnitude no survey measured', () => {
    // No band: the magnitude is the ETL's stand-in, and the luminosity from it means nothing.
    expect(starSurfaceOf({ ...proxima, magnitudeBand: undefined }, []).radiusSolar).toBeNull();
  });
});
