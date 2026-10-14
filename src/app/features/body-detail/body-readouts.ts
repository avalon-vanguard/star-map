import { PLANET_CLASS_LABELS } from '../../shared/astro/planet-appearance';
import { formatAu, formatDensity, formatMassEarth, formatPeriod, formatRadiusKm, formatTemperature } from '../../shared/format/quantity';
import { Readout } from '../../shared/models/readout';
import { BodyDetailViewModel } from './body-detail.model';

export const KIND_LABELS: Readonly<Record<BodyDetailViewModel['kind'], string>> = {
  planet: 'Planet',
  moon: 'Moon',
  dwarf: 'Dwarf planet',
  exoplanet: 'Exoplanet'
};

export interface BodyReadouts {
  readonly kindLabel: string;
  /** Only what a catalogue actually published for this body. */
  readonly measured: readonly Readout[];
  /** Everything computed from those measurements rather than observed directly. */
  readonly derived: readonly Readout[];
  /** Says plainly which of the two the surface being drawn is. */
  readonly provenance: string;
}

/**
 * Turns a body into the rows its panels display.
 *
 * Shared by the in-map card and the detail page for the same reason `buildBodyViewModel` is:
 * two independent assemblies of "what do we know about this world" drift, and here the drift
 * would be in which side of the measured/derived line a quantity falls on — which is the one
 * distinction these panels exist to make.
 */
export function bodyReadouts(body: BodyDetailViewModel): BodyReadouts {
  const measured: Readout[] = [];
  if (body.radiusKm !== undefined) {
    // A triaxial body is drawn as the sphere of its volume; a radius alone would hide its shape.
    measured.push({ label: body.semiAxesKm ? 'Mean radius' : 'Radius', value: formatRadiusKm(body.radiusKm) });
  }
  if (body.semiAxesKm) {
    measured.push({ label: 'Semi-axes', value: `${body.semiAxesKm.map((axis) => axis.toLocaleString('en-GB')).join(' × ')} km` });
  }
  if (body.massEarth !== undefined) {
    measured.push({ label: 'Mass', value: formatMassEarth(body.massEarth) });
  }
  if (body.orbit.semiMajorAxisAu !== undefined) {
    measured.push({ label: 'Semi-major axis', value: formatAu(body.orbit.semiMajorAxisAu) });
  }
  if (body.orbit.eccentricity !== undefined) {
    measured.push({ label: 'Eccentricity', value: body.orbit.eccentricity.toFixed(3) });
  }
  if (body.orbit.inclinationDeg !== undefined) {
    // Its size: Standish fits Earth's as -0.00054 degrees, which is the same orbit as +0.00054 with
    // the node half a turn round, and printed as it stands read "-0.00°".
    measured.push({ label: 'Inclination', value: `${Math.abs(body.orbit.inclinationDeg).toFixed(2)}°` });
  }
  // The period sits under whichever heading its provenance calls for. Same number, same field —
  // a published period is an observation and a computed one is not.
  if (body.orbitalPeriodDays !== undefined && body.orbitalPeriodSource === 'measured') {
    measured.push({ label: 'Period', value: formatPeriod(body.orbitalPeriodDays) });
  }
  if (body.discoveryYear !== undefined) {
    measured.push({ label: 'Discovered', value: `${body.discoveryYear}` });
  }

  const derived: Readout[] = [{ label: 'Class', value: PLANET_CLASS_LABELS[body.appearance.planetClass] }];
  if (body.orbitalPeriodDays !== undefined && body.orbitalPeriodSource === 'derived') {
    derived.push({ label: 'Period', value: formatPeriod(body.orbitalPeriodDays) });
  }
  if (body.appearance.equilibriumTemperatureK !== null) {
    derived.push({ label: 'Equilibrium temp.', value: formatTemperature(body.appearance.equilibriumTemperatureK) });
  }
  if (body.appearance.bulkDensityGramsPerCm3 !== null) {
    derived.push({ label: 'Bulk density', value: formatDensity(body.appearance.bulkDensityGramsPerCm3) });
  }

  const provenance = body.orbitSource ? `${provenanceFor(body)} Orbit: ${body.orbitSource}.` : provenanceFor(body);
  return { kindLabel: KIND_LABELS[body.kind], measured, derived, provenance };
}

/**
 * The derived surface is a reasoned illustration, and a panel of real measurements sitting next
 * to it is exactly the context in which it could be mistaken for another one.
 *
 * With no temperature, it says what is missing without claiming which: the host's luminosity, or
 * the orbit's size. It used to say the host was not in the catalogue, which is so for 27 of the
 * 2 714 planets it was printed on. Of the rest, 2 420 have no semi-major axis, and since 869635b
 * 267 have a host no survey measured the brightness of — OGLE-2005-BLG-390L b, read inside its
 * own host's system.
 *
 * A moon or dwarf planet drawn this way has been imaged — Voyager 2 photographed Uranus's five
 * large moons, Proteus and Nereid, Cassini Hyperion, and Hubble sees Eris, Haumea and Makemake as
 * points — but has no global map this app can use. So have the hundred or so exoplanets the
 * archive flags as imaged, HR 8799's four among them, though only as points of light beside their
 * star — and one of them has a map, not used here: Luhman 16 b, a brown dwarf, mapped by Doppler
 * imaging (Crossfield et al. 2014, Nature 505, 654). Only the other exoplanets, known from what they
 * do to starlight, have no image at all.
 */
function provenanceFor(body: BodyDetailViewModel): string {
  if (body.hasPhotography) {
    return 'Surface: NASA/ESA/USGS photography.';
  }
  const why =
    body.kind !== 'exoplanet'
      ? 'no global map of this world is used here'
      : body.imaged
        ? 'it has been imaged only as a point of light beside its star, and no map of it is used here'
        : 'no image of this world exists';
  return body.appearance.equilibriumTemperatureK === null
    ? `Surface illustrated from this body’s measured size and mass. No temperature could be derived: its star’s luminosity or its orbit’s size is not known. Not an observation — ${why}.`
    : `Surface illustrated from the measurements above — size, density and the temperature derived from its star’s output and its orbit. Not an observation — ${why}.`;
}
