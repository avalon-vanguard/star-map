import { spectralClassification } from '../../shared/astro/spectral';
import { temperatureFromColour } from '../../shared/astro/stellar';
import { formatDistance, formatLuminosity } from '../../shared/format/quantity';
import { StarRecord, SUN_STAR_ID } from '../../shared/models/star.model';
import { StarSurface } from '../body-detail/body-view-model';
import { HudReadout } from '../hud/hud-dock.component';

/**
 * The catalogue that describes a star — its name, type and photometry — as the readout names it.
 *
 * Not the same as `source`, which records whose *position* the star has: 62 097 stars HYG
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
 * estimate. Empty with neither, rather than the ETL's literal "Unknown". Where the colour was itself
 * read off the archive's temperature, the estimate says so: 30 archive hosts measured in no colour
 * read "~X, from colour", PSR J1719-1438, a pulsar the archive gives 4 500 K, "~K5, from colour".
 */
export function starSubtitle(star: StarRecord): string {
  const classification = spectralClassification(star);
  const basis = star.colorFromTemperature ? ', from its temperature' : ', from colour';
  return !classification ? '' : `Spectral type ${classification}${classification.startsWith('~') ? basis : ''}`;
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
      ? [
          {
            label: 'Colour',
            value: `${star.colorSystem === 'BP-RP' ? 'BP−RP' : 'B−V'} ${star.colorIndex.toFixed(2)}${star.colorFromTemperature ? ', from its temperature' : ''}`,
            ...(star.colorFromTemperature ? { derived: true } : {})
          }
        ]
      : []),
    ...(surface?.luminositySolar
      ? [{ label: 'Luminosity', value: formatLuminosity(surface.luminositySolar), ...(surface.luminosityDerived ? { derived: true } : {}) }]
      : []),
    ...(surface?.radiusSolar ? [radiusReadout(surface.radiusSolar, surface.radiusDerived, radiusBasis(star))] : []),
    { label: 'Source', value: catalogue === 'HYG' && star.distanceFromGaia ? 'HYG, Gaia DR3 distance' : catalogue }
  ];
}

/**
 * What a derived radius is worked out from besides the brightness: the temperature the star's
 * colour gives, or its type's — a giant's always, and a dwarf's with no colour the table reads.
 * 10 953 radii read "from colour" whose temperature no colour went into: 10 713 giants with one,
 * 214 stars with none, GJ 3655 (M8) among them, and 26 dwarfs whose colour is off the table.
 */
function radiusBasis(star: StarRecord): string {
  if (star.colorFromTemperature) {
    return 'its temperature';
  }
  return temperatureFromColour(star) ? 'colour' : 'its type';
}

/** Two figures for a derived radius, three for a published one: 0.105 is not what colour gives. */
function radiusReadout(radiusSolar: number, derived: boolean, basis: string): HudReadout {
  const digits = derived ? 2 : 3;
  const figure = radiusSolar.toLocaleString('en-GB', { minimumSignificantDigits: digits, maximumSignificantDigits: digits });
  return derived
    ? { label: 'Radius', value: `~${figure} solar radii, from ${basis} and brightness`, derived: true }
    : { label: 'Radius', value: `${figure} solar radii` };
}

/**
 * Where the neighbourhood's positions come from: parallaxes, except for the stars only the
 * Exoplanet Archive places, which sit at its own distances — a lensing model's for the
 * microlensing hosts among them, OGLE-2005-BLG-390L's 6.6 kpc for one, with no parallax behind it —
 * and the HYG stars neither Hipparcos nor Gaia measured, which sit at the Gliese catalogue's. Those
 * have no published error, and of the 313 on the map before 63 were folded into the Gaia source SIMBAD names
 * them as (250 now), about 154 had a photometric or spectroscopic parallax in CNS3 (Gliese &
 * Jahreiss 1991), none measured: GJ 3522 at 4.46 pc is 1000/224 mas.
 */
export function positionsNote(stars: readonly StarRecord[]): string {
  const archive = stars.filter((star) => star.source === 'exoplanet-archive').length;
  const gliese = stars.filter((star) => star.source === 'hyg' && star.distanceError === undefined && star.id !== SUN_STAR_ID).length;
  const where = [
    'Positions from measured parallaxes',
    ...(gliese === 0 ? [] : [`for the ${gliese.toLocaleString('en-GB')} stars only the Gliese catalogue places, from its distances, about half of them photometric`]),
    ...(archive === 0 ? [] : [`for the ${archive.toLocaleString('en-GB')} planet hosts only the NASA Exoplanet Archive places, from its distances`])
  ].join('; ');
  return `${where}. Grid marks the galactic plane through the Sun.`;
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
