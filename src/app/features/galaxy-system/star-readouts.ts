import { spectralClassification } from '../../shared/astro/spectral';
import { formatDistance, formatLuminosity } from '../../shared/format/quantity';
import { StarRecord } from '../../shared/models/star.model';
import { StarSurface } from '../body-detail/body-view-model';
import { HudReadout } from '../hud/hud-dock.component';

/**
 * The catalogue that describes a star — its name, type and photometry — as the readout names it.
 *
 * Not the same as `source`, which records whose *position* the star has: 62 002 stars HYG
 * describes sit where Gaia places them, and carry `gaia`. What gives them away is their V
 * magnitude, which only HYG and the archive measure and the archive's stars have their own source.
 */
export function describingCatalogue(star: StarRecord): string {
  if (star.source === 'exoplanet-archive') {
    return 'NASA Exoplanet Archive';
  }
  return star.source === 'gaia' && star.magnitudeBand !== 'V' ? 'Gaia DR3' : 'HYG';
}

/**
 * What the readout says a star is: the catalogue's classification, or — for the 83 % of stars
 * that have none, every Gaia star among them — the dwarf type its colour matches, marked as an
 * estimate. Empty with neither, rather than the ETL's literal "Unknown".
 */
export function starSubtitle(star: StarRecord): string {
  const classification = spectralClassification(star);
  return !classification ? '' : `Spectral type ${classification}${classification.startsWith('~') ? ', from colour' : ''}`;
}

/**
 * A star's measured readouts, each with what it was measured in: the band of its magnitude, which
 * colour its colour index is, the distance's uncertainty, and the catalogues they come from.
 * The luminosity and radius are the archive's where it publishes them, and otherwise derived and
 * marked so; a derived radius also says from what.
 */
export function starReadouts(star: StarRecord, surface?: StarSurface): HudReadout[] {
  const distancePc = Math.hypot(star.x, star.y, star.z);
  const catalogue = describingCatalogue(star);
  return [
    // Suppressed for the Sun rather than printed as `0.00 pc`, which is arithmetically right
    // and reads as a bug: the distance from here to here is not a measurement.
    ...(distancePc > 0 ? [{ label: 'Distance', value: formatDistance(distancePc, star.distanceError, star.source === 'exoplanet-archive') }] : []),
    // A G magnitude and a V one are not comparable: a red dwarf is up to three brighter in G.
    { label: 'Magnitude', value: star.magnitudeBand ? `${star.magnitudeBand} ${star.magnitude.toFixed(2)}` : 'Not measured' },
    ...(star.colorIndex !== null
      ? [{ label: 'Colour', value: `${star.colorSystem === 'BP-RP' ? 'BP−RP' : 'B−V'} ${star.colorIndex.toFixed(2)}` }]
      : []),
    ...(surface?.luminositySolar
      ? [{ label: 'Luminosity', value: formatLuminosity(surface.luminositySolar), ...(surface.luminosityDerived ? { derived: true } : {}) }]
      : []),
    ...(surface?.radiusSolar ? [radiusReadout(surface.radiusSolar, surface.radiusDerived)] : []),
    { label: 'Source', value: catalogue === 'HYG' && star.distanceFromGaia ? 'HYG, Gaia DR3 distance' : catalogue }
  ];
}

/** Two figures for a derived radius, three for a published one: 0.105 is not what colour gives. */
function radiusReadout(radiusSolar: number, derived: boolean): HudReadout {
  const digits = derived ? 2 : 3;
  const figure = radiusSolar.toLocaleString('en-GB', { minimumSignificantDigits: digits, maximumSignificantDigits: digits });
  return derived
    ? { label: 'Radius', value: `~${figure} solar radii, from colour and brightness`, derived: true }
    : { label: 'Radius', value: `${figure} solar radii` };
}

/**
 * Where the neighbourhood's positions come from: parallaxes, except for the stars only the
 * Exoplanet Archive places, which sit at its own distances — a lensing model's for the
 * microlensing hosts among them, OGLE-2005-BLG-390L's 6.6 kpc for one, with no parallax behind it.
 */
export function positionsNote(stars: readonly StarRecord[]): string {
  const archive = stars.filter((star) => star.source === 'exoplanet-archive').length;
  const where =
    archive === 0
      ? 'Positions from measured parallaxes.'
      : `Positions from measured parallaxes, and for the ${archive.toLocaleString('en-GB')} planet hosts only the NASA Exoplanet Archive places, from its distances.`;
  return `${where} Grid marks the galactic plane through the Sun.`;
}

/** What the catalogue holds, counted by the catalogue describing each star, largest first. */
export function catalogueCensus(stars: readonly StarRecord[]): string {
  const counts = new Map<string, number>();
  for (const star of stars) {
    const catalogue = describingCatalogue(star);
    counts.set(catalogue, (counts.get(catalogue) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([catalogue, count]) => `${catalogue} ${count.toLocaleString('en-GB')}`)
    .join(' · ');
}
