import { describe, expect, it } from 'vitest';

import { extractGmKm3PerS2, extractRadiusKm, extractRotationPeriodHours, isTidallyLocked } from './horizons-page';

// Lines as the Horizons pages print them.
const JUPITER = `  Vol. Mean Radius (km) = 69911+-6          Flattening            = 0.06487
  Sid. rot. period (III)= 9h 55m 29.711 s   Sid. rot. rate (rad/s)= 0.00017585`;
const MIRANDA = `  Radius (km)           = 240x234.2x232.9   Density (g cm^-3)   =  1.18 +- 0.05
  GM (km^3/s^2)         =  4.3   +- 0.2     Geometric Albedo    =  0.27
  Eccentricity, e         =   0.0027        Rotational period   = Synchronous`;
const CHARON = `  GM (km^3/s^2)           = 106.10 +- 0.3 Density (g cm^-3)     = 1.853 +- 0.004
  Radius (km, IAU2015)    = 606 +- 0.5    Geometric albedo      = `;
const PLUTO = `  GM (planet) km^3/s^2  = 869.326         Density (R=1195 km)   = 1.86 g/cm^3
  Vol. mean radius (km) = 1188.3+-1.6     Mass ratio (Mc/Mp)    = 0.122`;
const PHOEBE = `  Radius (km)            = 106.6    +- 1.1    Density (g/cm^3)=  1.633 +- 0.049
  Eccentricity, e        =     0.1635         Rotational period = 9h 16.438 m`;
const HYPERION = `  Mean Radius (km)        = 133    +- 8    Density (g/cm^3)  =  0.569 +- 0.108
  Eccentricity, e         = 0.0232         Rotational period = Chaotic`;

describe('Horizons page radius', () => {
  it('reads a volumetric mean radius', () => {
    expect(extractRadiusKm(PLUTO)).toBe(1188.3);
  });

  it('reads the radius Charon states against IAU 2015', () => {
    expect(extractRadiusKm(CHARON)).toBe(606);
  });

  it('gives a triaxial body the radius of the sphere of its volume, not its longest axis', () => {
    // (240 × 234.2 × 232.9)^(1/3); the IAU's mean radius for Miranda is 235.8.
    expect(extractRadiusKm(MIRANDA)).toBeCloseTo(235.7, 1);
    // Phobos spaces its axes out; it was drawn at its longest, 13.1 km, against the IAU's 11.08.
    expect(extractRadiusKm('  Radius (km)             = 13.1 x11.1 x9.3 Density (g cm^-3)   =  1.90')).toBeCloseTo(11.06, 2);
  });
});

describe('Horizons page rotation', () => {
  it('reads hours, minutes and seconds', () => {
    expect(extractRotationPeriodHours(JUPITER)).toBeCloseTo(9.925, 3);
  });

  it('reads hours and minutes, as Phoebe states them', () => {
    expect(extractRotationPeriodHours(PHOEBE)).toBeCloseTo(9 + 16.438 / 60, 6);
  });

  it('finds no period where the spin is chaotic', () => {
    expect(extractRotationPeriodHours(HYPERION)).toBeUndefined();
    expect(isTidallyLocked(HYPERION)).toBe(false);
    expect(isTidallyLocked(MIRANDA)).toBe(true);
  });
});

describe('Horizons page GM', () => {
  it('reads a moon’s GM and Pluto’s, which are written differently', () => {
    expect(extractGmKm3PerS2(CHARON)).toBe(106.1);
    expect(extractGmKm3PerS2(PLUTO)).toBe(869.326);
    expect(extractGmKm3PerS2(HYPERION)).toBeUndefined();
  });
});
