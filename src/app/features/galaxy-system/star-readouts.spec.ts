import { describe, expect, it } from 'vitest';

import { StarRecord } from '../../shared/models/star.model';
import { catalogueCensus, describingCatalogue, positionsNote, starReadouts, starSubtitle } from './star-readouts';

/** Three kinds of star the catalogue holds, each as the decoder gives it back. */
const HYG_STAR: StarRecord = {
  id: 32263,
  name: 'Sirius',
  x: -0.49,
  y: 2.47,
  z: -0.75,
  magnitude: -1.44,
  magnitudeBand: 'V',
  spectralType: 'A0m',
  colorIndex: 0.009,
  colorSystem: 'B-V',
  distanceError: 0.004,
  distanceFromGaia: false,
  source: 'hyg'
};
// A star Gaia alone knows, at 117 pc and good to a tenth.
const GAIA_STAR: StarRecord = {
  id: 1000000001,
  name: 'Gaia DR3 5612323414549657984',
  x: 117,
  y: 0,
  z: 0,
  magnitude: 11.2,
  magnitudeBand: 'G',
  spectralType: 'Unknown',
  colorIndex: 1.43,
  colorSystem: 'BP-RP',
  distanceError: 0.1,
  distanceFromGaia: true,
  source: 'gaia'
};
// HYG's description of Proxima, at the place and distance Gaia measures.
const PLACED_BY_GAIA: StarRecord = { ...HYG_STAR, name: 'Proxima Centauri', magnitude: 11.01, colorIndex: 1.807, spectralType: 'M5Ve', distanceFromGaia: true, source: 'gaia' };

function value(readouts: { label: string; value: string }[], label: string): string | undefined {
  return readouts.find((readout) => readout.label === label)?.value;
}

describe('starReadouts', () => {
  it('names the band of the magnitude, and which colour the colour index is', () => {
    expect(value(starReadouts(HYG_STAR), 'Magnitude')).toBe('V -1.44');
    expect(value(starReadouts(GAIA_STAR), 'Magnitude')).toBe('G 11.20');
    expect(value(starReadouts(HYG_STAR), 'Colour')).toBe('B−V 0.01');
    expect(value(starReadouts(GAIA_STAR), 'Colour')).toBe('BP−RP 1.43');
  });

  it('says a stand-in magnitude was not measured, and leaves out a colour there is none of', () => {
    const unmeasured = starReadouts({ ...GAIA_STAR, magnitude: 12, magnitudeBand: undefined, colorIndex: null, colorSystem: undefined });
    expect(value(unmeasured, 'Magnitude')).toBe('Not measured');
    expect(value(unmeasured, 'Colour')).toBeUndefined();
    // Still Gaia's star, as the 44 Gaia sources with no G are: no band is not HYG's V.
    expect(value(unmeasured, 'Source')).toBe('Gaia DR3');
  });

  it('gives the distance with its uncertainty', () => {
    expect(value(starReadouts(GAIA_STAR), 'Distance')).toBe('117 ± 12 pc');
  });

  it("gives an archive star's distance error as the archive does, on the distance, not as a parallax range", () => {
    // KMT-2016-BLG-1836L, 7 100 +800 −2 400 pc: a mean of 22.5 %.
    const lens = { ...GAIA_STAR, x: 7100, magnitudeBand: undefined, colorIndex: null, colorSystem: undefined, distanceError: 0.2254, distanceFromGaia: false, source: 'exoplanet-archive' };
    expect(value(starReadouts(lens), 'Distance')).toBe('7.1 ± 1.6 kpc');
    expect(value(starReadouts({ ...lens, source: 'hyg' }), 'Distance')).toBe('5.8 kpc to 9.2 kpc');
  });

  it('names the catalogue a star comes from, and whose distance it has', () => {
    expect(value(starReadouts(GAIA_STAR), 'Source')).toBe('Gaia DR3');
    expect(value(starReadouts(HYG_STAR), 'Source')).toBe('HYG');
    expect(value(starReadouts(PLACED_BY_GAIA), 'Source')).toBe('HYG, Gaia DR3 distance');
    expect(value(starReadouts({ ...HYG_STAR, source: 'exoplanet-archive' }), 'Source')).toBe('NASA Exoplanet Archive');
  });

  it('says a radius was derived, and from what; a published one plainly', () => {
    expect(starReadouts(PLACED_BY_GAIA, { radiusSolar: 0.1049, radiusDerived: true, temperatureK: 3068, luminositySolar: null, luminosityDerived: true }).find((readout) => readout.label === 'Radius')).toEqual({
      label: 'Radius',
      value: '~0.10 solar radii, from colour and brightness',
      derived: true
    });
    expect(value(starReadouts(PLACED_BY_GAIA, { radiusSolar: 0.141, radiusDerived: false, temperatureK: 2900, luminositySolar: null, luminosityDerived: true }), 'Radius')).toBe('0.141 solar radii');
    expect(value(starReadouts(HYG_STAR, { radiusSolar: 584.3, radiusDerived: true, temperatureK: 3590, luminositySolar: null, luminosityDerived: true }), 'Radius')).toBe('~580 solar radii, from colour and brightness');
    expect(value(starReadouts(HYG_STAR, { radiusSolar: 1, radiusDerived: false, temperatureK: 5772, luminositySolar: null, luminosityDerived: true }), 'Radius')).toBe('1.00 solar radii');
    expect(starReadouts(HYG_STAR, { radiusSolar: null, radiusDerived: true, temperatureK: null, luminositySolar: null, luminosityDerived: true }).some((readout) => readout.label === 'Radius')).toBe(false);
  });

  it('marks a derived luminosity so, and a published one not', () => {
    const surface = { radiusSolar: null, radiusDerived: true, temperatureK: null };
    expect(starReadouts(HYG_STAR, { ...surface, luminositySolar: 25.4, luminosityDerived: true }).find((readout) => readout.label === 'Luminosity')).toEqual({ label: 'Luminosity', value: '25.40 L☉', derived: true });
    expect(starReadouts(PLACED_BY_GAIA, { ...surface, luminositySolar: 0.00151, luminosityDerived: false }).find((readout) => readout.label === 'Luminosity')).toEqual({ label: 'Luminosity', value: '0.002 L☉' });
    expect(starReadouts(HYG_STAR, { ...surface, luminositySolar: null, luminosityDerived: true }).some((readout) => readout.label === 'Luminosity')).toBe(false);
  });
});

describe('positionsNote', () => {
  it("says which positions are the archive's distances rather than parallaxes, and how many", () => {
    expect(positionsNote([HYG_STAR, GAIA_STAR])).toBe('Positions from measured parallaxes. Grid marks the galactic plane through the Sun.');
    expect(positionsNote([HYG_STAR, { ...GAIA_STAR, source: 'exoplanet-archive' }])).toBe(
      'Positions from measured parallaxes, and for the 1 planet hosts only the NASA Exoplanet Archive places, from its distances. Grid marks the galactic plane through the Sun.'
    );
  });
});

describe('starSubtitle', () => {
  it("prints the catalogue's classification where it has one", () => {
    expect(starSubtitle(HYG_STAR)).toBe('Spectral type A0m');
  });

  it("estimates one from the colour otherwise, in the colour's own system, and says so", () => {
    // 1.43 is a K5 dwarf in BP−RP; read as B−V it would be an M0.
    expect(starSubtitle(GAIA_STAR)).toBe('Spectral type ~K5, from colour');
  });

  it('prints nothing rather than "Unknown" when there is neither', () => {
    expect(starSubtitle({ ...GAIA_STAR, colorIndex: null, colorSystem: undefined })).toBe('');
  });
});

describe('catalogueCensus', () => {
  it('counts the stars by the catalogue describing them, not by whose position they have', () => {
    expect(describingCatalogue(PLACED_BY_GAIA)).toBe('HYG');
    expect(catalogueCensus([GAIA_STAR, GAIA_STAR, GAIA_STAR, HYG_STAR, PLACED_BY_GAIA])).toBe('Gaia DR3 3 · HYG 2');
  });
});
