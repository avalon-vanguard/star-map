import { fetchTextCached } from './http';

/**
 * NAIF's generic text PCK, which carries the IAU WGCCRE 2015 report's rotational elements
 * (Archinal et al. 2018, Celest Mech Dyn Astr 130:22) for every body here that has them, periodic
 * terms included, in a form a program can read rather than a table typeset in a paper. A released
 * kernel is never edited, only superseded under a new name, so the URL pins the numbers.
 */
const PCK_URL = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc';

export async function fetchPckText(): Promise<string> {
  return fetchTextCached(PCK_URL, 'naif-pck00011.tpc');
}
