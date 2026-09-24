import { formatDistance, formatLuminosity } from '../../shared/format/quantity';
import { StarRecord } from '../../shared/models/star.model';
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
 * A star's measured readouts, each with what it was measured in: the band of its magnitude, which
 * colour its colour index is, the distance's uncertainty, and the catalogues they come from.
 * `luminosity` is derived, and marked so.
 */
export function starReadouts(star: StarRecord, luminosity: number | null): HudReadout[] {
  const distancePc = Math.hypot(star.x, star.y, star.z);
  const catalogue = describingCatalogue(star);
  return [
    // Suppressed for the Sun rather than printed as `0.00 pc`, which is arithmetically right
    // and reads as a bug: the distance from here to here is not a measurement.
    ...(distancePc > 0 ? [{ label: 'Distance', value: formatDistance(distancePc, star.distanceError) }] : []),
    // A G magnitude and a V one are not comparable: a red dwarf is up to three brighter in G.
    { label: 'Magnitude', value: star.magnitudeBand ? `${star.magnitudeBand} ${star.magnitude.toFixed(2)}` : 'Not measured' },
    ...(star.colorIndex !== null
      ? [{ label: 'Colour', value: `${star.colorSystem === 'BP-RP' ? 'BP−RP' : 'B−V'} ${star.colorIndex.toFixed(2)}` }]
      : []),
    ...(luminosity !== null ? [{ label: 'Luminosity', value: formatLuminosity(luminosity), derived: true }] : []),
    { label: 'Source', value: catalogue === 'HYG' && star.distanceFromGaia ? 'HYG, Gaia DR3 distance' : catalogue }
  ];
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
