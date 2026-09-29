import { describe, expect, it } from 'vitest';

import { meanElementsAt } from './kepler';
import { orbitalTermsOfPrimeMeridian, orientationAt, parsePckRotationalElements } from './rotational-elements';
import { MeanElementRates, OrbitalElements, RotationalElements } from '../models/body.model';

// Excerpts of pck00011.tpc as NAIF publishes it: prose, then data blocks.
const KERNEL = String.raw`KPL/PCK

     The portion of the file preceding the first data block is treated
     as a comment.

\begindata

        BODY399_POLE_RA        = (    0.      -0.641         0. )
        BODY399_POLE_DEC       = (   90.      -0.557         0. )
        BODY399_PM             = (  190.147  360.9856235     0. )

\begintext

     A data block starts with the \begindata token only when that token
     sits on a line by itself, so BODY399_PM = ( 1 2 3 ) here is prose.

\begindata

        BODY301_POLE_RA      = (  269.9949        0.0031        0.      )
        BODY301_POLE_DEC     = (   66.5392        0.0130        0.      )
        BODY301_PM           = (   38.3213       13.17635815   -1.4D-12 )

           BODY899_POLE_RA        = (  299.36     0.         0. )
           BODY899_POLE_DEC       = (   43.46     0.         0. )
           BODY899_PM             = (  249.978  541.1397757  0. )
           BODY899_NUT_PREC_RA    = (  0.70 0. 0. 0. 0. 0. 0. 0. )
           BODY899_NUT_PREC_DEC   = ( -0.51 0. 0. 0. 0. 0. 0. 0. )
           BODY899_NUT_PREC_PM    = ( -0.48 0. 0. 0. 0. 0. 0. 0. )
              BODY8_NUT_PREC_ANGLES = (   357.85         52.316
                                          323.92      62606.6   )

        BODY199_POLE_RA          = (  281.0103   -0.0328     0. )
        BODY199_POLE_DEC         = (   61.4155   -0.0049     0. )
        BODY199_PM               = (  329.5988    6.1385108  0. )
        BODY199_NUT_PREC_RA  = ( 0. 0. )
        BODY199_NUT_PREC_DEC = ( 0. 0. )
        BODY199_NUT_PREC_PM  = (    0.01067257
                                   -0.00112309  )
        BODY1_NUT_PREC_ANGLES  = ( 174.7910857  0.14947253587500003E+06
                                   349.5821714  0.29894507175000006E+06 )

          BODY401_POLE_RA  = ( 317.67071657    -0.10844326  0. )
          BODY401_POLE_DEC = (  52.88627266    -0.06134706  0. )
          BODY401_PM       = (  35.18774440  1128.84475928
                                9.536137031212154e-09 )
          BODY401_NUT_PREC_RA   = (  -1.78428399 )
          BODY401_NUT_PREC_DEC  = (  -1.07516537 )
          BODY401_NUT_PREC_PM   = (   1.42421769
                                     -1.143      )
        BODY4_MAX_PHASE_DEGREE = 2
        BODY4_NUT_PREC_ANGLES  = (
            190.72646643      15917.10818695   0
            189.63271560   41215158.18420050   12.711923222 )

\begintext
`;

describe('parsePckRotationalElements', () => {
  it('reads a pole and a prime meridian from the data blocks, not from the prose around them', () => {
    expect(parsePckRotationalElements(KERNEL, 399)).toEqual({
      elements: { poleRaDeg: [0, -0.641, 0], poleDecDeg: [90, -0.557, 0], primeMeridianDeg: [190.147, 360.9856235, 0] },
      skippedDeg: []
    });
  });

  it('reads the exponent the Fortran way, as the Moon’s quadratic is written', () => {
    expect(parsePckRotationalElements(KERNEL, 301)!.elements.primeMeridianDeg).toEqual([38.3213, 13.17635815, -1.4e-12]);
  });

  it('pairs each periodic term with its system’s angle', () => {
    expect(parsePckRotationalElements(KERNEL, 899)!.elements.terms).toEqual([{ angleDeg: [357.85, 52.316], ra: 0.7, dec: -0.51, pm: -0.48 }]);
  });

  it('reads angles to the degree the system states, Phobos’s quadratic among them', () => {
    expect(parsePckRotationalElements(KERNEL, 401)!.elements.terms).toEqual([
      { angleDeg: [190.72646643, 15917.10818695, 0], ra: -1.78428399, dec: -1.07516537, pm: 1.42421769 },
      { angleDeg: [189.6327156, 41215158.1842005, 12.711923222], ra: 0, dec: 0, pm: -1.143 }
    ]);
  });

  it('leaves out a term under a hundredth of a degree, and says how large it was', () => {
    const mercury = parsePckRotationalElements(KERNEL, 199)!;

    expect(mercury.elements.terms).toEqual([{ angleDeg: [174.7910857, 149472.53587500003], ra: 0, dec: 0, pm: 0.01067257 }]);
    expect(mercury.skippedDeg).toEqual([0.00112309]);
  });

  it('gives nothing for a body the kernel has no model for', () => {
    expect(parsePckRotationalElements(KERNEL, 802)).toBeUndefined();
  });
});

describe('orientationAt', () => {
  const J2000 = 2451545.0;

  it('turns the prime meridian at its rate per day and moves the pole at its rate per century', () => {
    const earth = parsePckRotationalElements(KERNEL, 399)!.elements;

    const epoch = orientationAt(earth, J2000);
    expect([epoch.poleRaDeg, epoch.poleDecDeg]).toEqual([0, 90]);
    expect(epoch.primeMeridianDeg).toBeCloseTo(190.147, 9);
    const century = orientationAt(earth, J2000 + 36525);
    expect(century.poleRaDeg).toBeCloseTo(-0.641, 12);
    expect(century.poleDecDeg).toBeCloseTo(90 - 0.557, 12);
    expect(orientationAt(earth, J2000 + 1).primeMeridianDeg).toBeCloseTo(190.147 + 360.9856235 - 360, 9);
  });

  it('adds a term as a sine to the right ascension and the meridian and a cosine to the declination', () => {
    const neptune = parsePckRotationalElements(KERNEL, 899)!.elements;
    const days = 9000;
    const angle = ((357.85 + (52.316 * days) / 36525) * Math.PI) / 180;
    const drawn = orientationAt(neptune, J2000 + days);

    expect(drawn.poleRaDeg).toBeCloseTo(299.36 + 0.7 * Math.sin(angle), 12);
    expect(drawn.poleDecDeg).toBeCloseTo(43.46 - 0.51 * Math.cos(angle), 12);
    expect(drawn.primeMeridianDeg).toBeCloseTo((249.978 + 541.1397757 * days - 0.48 * Math.sin(angle)) % 360, 6);
  });

  it('carries the quadratic in the meridian and in the angle, which is how Phobos falls inward', () => {
    const phobos = parsePckRotationalElements(KERNEL, 401)!.elements;
    const days = 36525;
    const first = (190.72646643 + 15917.10818695) * (Math.PI / 180);
    const second = (189.6327156 + 41215158.1842005 + 12.711923222) * (Math.PI / 180);
    const expected = 35.1877444 + 1128.84475928 * days + 9.536137031212154e-9 * days * days + 1.42421769 * Math.sin(first) - 1.143 * Math.sin(second);

    expect(orientationAt(phobos, J2000 + days).primeMeridianDeg).toBeCloseTo(((expected % 360) + 360) % 360, 5);
  });
});

describe('orbitalTermsOfPrimeMeridian', () => {
  const J2000 = 2451545.0;
  // Mimas's and Phobos's rows and W as pck00011.tpc and JPL's table give them, with each mean
  // motion set to W's rate, so that only the terms can part the two.
  const MIMAS: RotationalElements = {
    poleRaDeg: [40.66, -0.036],
    poleDecDeg: [83.52, -0.004],
    primeMeridianDeg: [333.46, 381.994555, 0],
    terms: [
      { angleDeg: [177.4, -36505.5], ra: 13.56, dec: -1.53, pm: -13.48 },
      { angleDeg: [316.45, 506.2], ra: 0, dec: 0, pm: -44.85 }
    ]
  };
  const PHOBOS: RotationalElements = {
    poleRaDeg: [317.67071657, -0.10844326, 0],
    poleDecDeg: [52.88627266, -0.06134706, 0],
    primeMeridianDeg: [35.1877444, 1128.84475928, 9.536137031212154e-9]
  };
  const orbit = (epochJd: number): OrbitalElements => ({
    semiMajorAxisAu: 0.001,
    eccentricity: 0.02,
    inclinationDeg: 1.5,
    longitudeOfAscendingNodeDeg: 170,
    argumentOfPeriapsisDeg: 60,
    meanAnomalyAtEpochDeg: 10,
    epochJd
  });

  /** The moon's mean longitude less W, which a locked moon holds still whatever the date. */
  function lead(elements: RotationalElements, epochJd: number, angleRate: number | undefined, jd: number): number {
    const { meanAnomalyTerms, meanMotionDegPerDay, meanAnomalyDeg } = orbitalTermsOfPrimeMeridian(elements, epochJd, angleRate);
    const start = orbit(epochJd);
    const rates: MeanElementRates = {
      meanMotionDegPerDay: elements.primeMeridianDeg[1] + meanMotionDegPerDay,
      longitudeOfAscendingNodeDegPerDay: -1,
      argumentOfPeriapsisDegPerDay: 2,
      meanAnomalyTerms
    };
    const moved = meanElementsAt({ ...start, meanAnomalyAtEpochDeg: start.meanAnomalyAtEpochDeg + meanAnomalyDeg }, rates, jd);
    const longitude = moved.longitudeOfAscendingNodeDeg + moved.argumentOfPeriapsisDeg + moved.meanAnomalyAtEpochDeg;
    // W with the pole's nodding term left out: that one is the pole's, not the orbit's.
    const w = orientationAt({ ...elements, terms: elements.terms?.filter((term) => term.angleDeg[1] === angleRate) }, jd).primeMeridianDeg;
    return (((longitude - w) % 360) + 540) % 360 - 180;
  }

  it('moves Mimas along its orbit by the libration its W carries, over the 71 years it takes', () => {
    const atEpoch = lead(MIMAS, J2000, 506.2, J2000);
    for (const years of [-130, -40, 17.8, 35.5, 100]) {
      expect(lead(MIMAS, J2000, 506.2, J2000 + years * 365.25)).toBeCloseTo(atEpoch, 8);
    }
  });

  it('speeds Phobos up by the tidal quadratic its W carries about J2000, from a row whose epoch is 1950', () => {
    const epoch = 2433282.5;
    const atEpoch = lead(PHOBOS, epoch, undefined, epoch);
    for (const years of [-150, 0, 50, 100, 150, 400]) {
      expect(lead(PHOBOS, epoch, undefined, J2000 + years * 365.25)).toBeCloseTo(atEpoch, 6);
    }
  });

  it('refuses a term W does not carry', () => {
    expect(() => orbitalTermsOfPrimeMeridian(PHOBOS, J2000, 506.2)).toThrow();
  });
});
