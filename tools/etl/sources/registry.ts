import { fetchGaiaStars } from './gaia';
import { StarSource } from './star-sources';

/**
 * Every catalogue this pipeline knows about, wired in or not, with an honest note on each.
 *
 * Kept as data so `npm run etl` can print what it actually used rather than what a README claims
 * it uses. The four unimplemented entries are not placeholders for missing work: three of them
 * cannot contribute stars to a 3D map at all, for the reason recorded against each.
 */
export const STAR_SOURCES: readonly StarSource[] = [
  {
    id: 'hyg',
    name: 'HYG database (Hipparcos, Yale Bright Star, Gliese)',
    role: 'positional',
    endpoint: 'https://raw.githubusercontent.com/astronexus/HYG-Database',
    contributes: 'A complete, named, spectrally classified bright-star catalogue with parallaxes — 68388 stars within 250 pc.',
    unimplementedBecause: null
  },
  {
    id: 'gaia',
    name: 'Gaia DR3',
    role: 'positional',
    endpoint: 'https://gea.esac.esa.int/tap-server/tap/sync',
    contributes:
      'Parallaxes fifty times more precise than Hipparcos, for 1.8 billion sources — the only survey that can add stars to a 3D map, because it is the only one that measures how far away they are.',
    unimplementedBecause: null,
    fetch: fetchGaiaStars
  },
  {
    id: 'decaps2',
    name: 'DECaPS2 (Dark Energy Camera Plane Survey)',
    role: 'backdrop',
    endpoint: 'https://datalab.noirlab.edu/tap',
    contributes:
      'The deepest optical census of the southern galactic plane: 3.32 billion objects across 130 degrees, in the dust-obscured region every other catalogue thins out in.',
    unimplementedBecause:
      'Photometric only — no parallaxes, so not one of its 3.32 billion objects can be placed in depth. Fifty times Gaia’s object count and zero stars this map can position. It would enter as a direction-only backdrop layer, alongside the deep-sky shell.'
  },
  {
    id: 'sdss5-mwm',
    name: 'SDSS-V Milky Way Mapper',
    role: 'enrichment',
    endpoint: 'https://api.sdss.org',
    contributes:
      'All-sky optical and infrared spectroscopy: effective temperatures, surface gravities, metallicities and radial velocities, which is real spectral classification rather than a colour index standing in for one.',
    unimplementedBecause:
      'Adds no positions. It is keyed to targets Gaia already places, so it joins onto an existing catalogue rather than extending it — worth having once Gaia is in, and worth nothing before.'
  },
  {
    id: 'euclid-q2-bulge',
    name: 'Euclid Galactic Bulge Survey (Q2)',
    role: 'backdrop',
    endpoint: 'https://easidr.esac.esa.int/sas',
    contributes: 'High-resolution imagery and astrometry of the crowded inner bulge, around 8 kpc away.',
    unimplementedBecause:
      'At 8 kpc a parallax is a few microarcseconds, so this is astrometry without usable distances for a map of this kind. Its natural use here is imagery — a real photograph of the bulge on the galactic view, in place of part of the procedural model.'
  },
  {
    id: 'saga',
    name: 'SAGA (Stellar Abundances for Galactic Archaeology)',
    role: 'enrichment',
    endpoint: 'https://sagadatabase.jp',
    contributes: 'Compiled elemental abundances for metal-poor stars — the chemical record of how the Galaxy assembled.',
    unimplementedBecause:
      'A compilation keyed to stars other catalogues place, covering tens of thousands of objects rather than millions. Like SDSS-V it enriches; it cannot extend the map on its own.'
  }
];

export function positionalSources(): readonly StarSource[] {
  return STAR_SOURCES.filter((source) => source.role === 'positional' && source.fetch !== undefined);
}

/** A one-line-per-source report of what the pipeline can and cannot draw on. */
export function describeSources(): string {
  return STAR_SOURCES.map((source) => {
    const status = source.unimplementedBecause === null ? (source.fetch ? 'wired in' : 'wired in (built separately)') : 'declared, not fetched';
    return `  [${source.role}] ${source.name} — ${status}`;
  }).join('\n');
}
