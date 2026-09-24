import { describe, expect, it } from 'vitest';

import { parsePlanetMeanElements, parseSatelliteMeanElements } from './mean-elements';

/** Standish's p_elem_t2.txt, cut to the lines that matter here, as JPL published them. */
const TABLE_2 = `Keplerian elements and their rates, with respect to the mean ecliptic and equinox of J2000,
valid for the time-interval 3000 BC -- 3000 AD.  NOTE: the computation of M for Jupiter through
Pluto *must* be augmented by the additional terms given in Table 2b (below).

EM Bary   1.00000018      0.01673163     -0.00054346      100.46691572    102.93005885     -5.11260389
         -0.00000003     -0.00003661     -0.01337178    35999.37306329      0.31795260     -0.24123856
Jupiter   5.20248019      0.04853590      1.29861416       34.33479152     14.27495244    100.29282654
         -0.00002864      0.00018026     -0.00322699     3034.90371757      0.18199196      0.13024619
Pluto    39.48686035      0.24885238     17.14104260      238.96535011    224.09702598    110.30167986
          0.00449751      0.00006016      0.00000501      145.18042903     -0.00968827     -0.00809981

Table 2b.
Jupiter   -0.00012452    0.06064060   -0.35635438   38.35125000
Pluto     -0.01262724
`;

/** The satellite page's markup around three rows, as the 2021 page served it. */
const SATELLITES = `
<td align="left" nowrap><b>Satellites of Earth</b></td>
<td align="right" nowrap><b>jump to:</b> <a href="#earth">Earth</a>, <a href="#mars">Mars</a></td>
<H3>Mean <a href="?glossary&term=ecliptic">ecliptic</a> orbital elements</H3>
Epoch 2000 Jan. 1.50 TT<BR>
<TR ALIGN=right><TD ALIGN=left>Moon</TD>
<TD>384400.</TD><TD>0.0554</TD><TD>318.15</TD><TD>135.27</TD><TD>5.16</TD><TD>125.08</TD>
<TD>13.176358</TD><TD>27.322</TD><TD>5.997</TD><TD>18.600</TD>
<TD ALIGN=right><A HREF="#ref1">1</A></TD></TR>
<td align="left" nowrap><b>Satellites of Jupiter</b></td>
<td align="right" nowrap><b>jump to:</b> <a href="#earth">Earth</a>, <a href="#mars">Mars</a></td>
<H3>Mean orbital elements referred to the local <a href="?glossary&term=lp">Laplace planes</a></H3>
Epoch 1997 Jan. 16.00 TT<BR>
<TR ALIGN=right><TD ALIGN=left>Io</TD><TD>421800.</TD><TD>0.0041</TD>
<TD>84.129</TD><TD>342.021</TD><TD>0.036</TD><TD>43.977</TD><TD>203.4889583</TD>
<TD>1.769</TD><TD>1.625</TD><TD>7.420</TD><TD>268.057</TD><TD>64.495</TD>
<TD>0.000</TD>
<TD ALIGN=right><A HREF="#ref11">11</A></TD></TR>
<td align="left" nowrap><b>Satellites of Neptune</b></td>
<td align="right" nowrap><b>jump to:</b> <a href="#earth">Earth</a>, <a href="#mars">Mars</a></td>
<H3>Mean orbital elements referred to the local <a href="?glossary&term=lp">Laplace planes</a></H3>
Epoch 2000 Jan.  1.50 TT<BR>
<TR ALIGN=right><TD ALIGN=left>Triton</TD><TD>354759.</TD><TD>0.0000</TD>
<TD>66.142</TD><TD>352.257</TD><TD>156.865</TD><TD>177.608</TD>
<TD>61.2572638</TD><TD>5.877</TD><TD>386.371</TD><TD>687.446</TD>
<TD>299.456</TD><TD>43.414</TD><TD>0.010</TD>
<TD ALIGN=right><A HREF="#ref54">54</A></TD></TR>
`;

describe('parsePlanetMeanElements', () => {
  it('turns Standish’s longitudes into the argument of periapsis and mean anomaly', () => {
    const { orbit } = parsePlanetMeanElements(TABLE_2, 'jupiter');
    expect(orbit.argumentOfPeriapsisDeg).toBeCloseTo(14.27495244 - 100.29282654, 8);
    expect(orbit.meanAnomalyAtEpochDeg).toBeCloseTo(34.33479152 - 14.27495244, 8);
    expect(orbit.epochJd).toBe(2451545);
  });

  it('gives the rates per day, the mean motion being the mean longitude’s', () => {
    const { rates } = parsePlanetMeanElements(TABLE_2, 'earth');
    // 35 999.373 degrees a century is the sidereal year.
    expect(360 / rates.meanMotionDegPerDay).toBeCloseTo(365.2564, 4);
    expect(rates.argumentOfPeriapsisDegPerDay * 36525).toBeCloseTo(0.3179526 + 0.24123856, 8);
  });

  it('carries Table 2b’s terms for Jupiter and beyond, and none for the inner planets', () => {
    expect(parsePlanetMeanElements(TABLE_2, 'jupiter').rates.meanAnomalyTerms).toEqual({ b: -0.00012452, c: 0.0606406, s: -0.35635438, f: 38.35125 });
    expect(parsePlanetMeanElements(TABLE_2, 'earth').rates.meanAnomalyTerms).toBeUndefined();
  });

  it('reads Pluto’s row, not the note above the table that starts a line with its name', () => {
    const pluto = parsePlanetMeanElements(TABLE_2, 'pluto');
    expect(pluto.orbit.semiMajorAxisAu).toBe(39.48686035);
    expect(pluto.rates.meanAnomalyTerms).toEqual({ b: -0.01262724, c: 0, s: 0, f: 0 });
  });
});

describe('parseSatelliteMeanElements', () => {
  it('reads a Laplace-plane row with its pole and its section’s epoch', () => {
    const io = parseSatelliteMeanElements(SATELLITES, 'Jupiter', 'Io', true);
    expect(io.laplacePole).toEqual({ raDeg: 268.057, decDeg: 64.495 });
    expect(io.orbit.epochJd).toBe(2450464.5);
    expect(io.rates.meanMotionDegPerDay).toBe(203.4889583);
    expect(io.orbitSource).toBe('JPL SSD satellite mean elements, epoch 1997 Jan 16');
  });

  it('reads the Moon against the ecliptic, with no pole', () => {
    const moon = parseSatelliteMeanElements(SATELLITES, 'Earth', 'Moon', false);
    expect(moon.laplacePole).toBeUndefined();
    expect(moon.orbit.epochJd).toBe(2451545);
    expect(moon.orbit.semiMajorAxisAu * 149597870.7).toBeCloseTo(384400, 3);
  });

  it('regresses a prograde node and advances a periapsis, as the planet’s oblateness turns them', () => {
    const { rates } = parseSatelliteMeanElements(SATELLITES, 'Earth', 'Moon', false);
    expect(rates.longitudeOfAscendingNodeDegPerDay).toBeCloseTo(-360 / (18.6 * 365.25), 9);
    expect(rates.argumentOfPeriapsisDegPerDay).toBeCloseTo(360 / (5.997 * 365.25), 9);
  });

  it('advances the node of a retrograde orbit', () => {
    const { rates } = parseSatelliteMeanElements(SATELLITES, 'Neptune', 'Triton', false);
    expect(rates.longitudeOfAscendingNodeDegPerDay).toBeCloseTo(360 / (687.446 * 365.25), 9);
  });

  it('turns the periapsis backwards where a resonance holds it', () => {
    const { rates } = parseSatelliteMeanElements(SATELLITES, 'Jupiter', 'Io', true);
    expect(rates.argumentOfPeriapsisDegPerDay).toBeCloseTo(-360 / (1.625 * 365.25), 9);
  });
});
