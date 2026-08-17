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
    measured.push({ label: 'Radius', value: formatRadiusKm(body.radiusKm) });
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
    measured.push({ label: 'Inclination', value: `${body.orbit.inclinationDeg.toFixed(2)}°` });
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

  return { kindLabel: KIND_LABELS[body.kind], measured, derived, provenance: provenanceFor(body) };
}

/**
 * The derived surface is a reasoned illustration, and a panel of real measurements sitting next
 * to it is exactly the context in which it could be mistaken for another one.
 */
function provenanceFor(body: BodyDetailViewModel): string {
  if (body.hasPhotography) {
    return 'Surface: NASA/ESA/USGS photography.';
  }
  return body.appearance.equilibriumTemperatureK === null
    ? 'Surface illustrated from this body’s measured size and mass. Its host star is not in the catalogue, so no temperature could be derived. Not an observation — no image of this world exists.'
    : 'Surface illustrated from the measurements above — size, density and the temperature derived from its star’s output and its orbit. Not an observation — no image of this world exists.';
}
