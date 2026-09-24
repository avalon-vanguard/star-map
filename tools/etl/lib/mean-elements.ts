import { fetchTextCached } from './http';

/**
 * Standish's "Keplerian Elements for Approximate Positions of the Major Planets", Table 2a/2b:
 * elements against the J2000 ecliptic and their rates per century, fit to the JPL ephemeris for
 * 3000 BC to AD 3000. Table 1 is closer near the present — Saturn within 0.23 degrees of Horizons
 * from 1950 to 2100 against this table's 0.32 — but it is only fit for 1800-2050, which the clock
 * leaves in minutes, and by AD 3000 it has Saturn 4.3 degrees out where this one is within 0.3
 * of every planet. The page at ssd.jpl.nasa.gov/planets/approx_pos.html carries the same numbers but has
 * dropped Pluto, so this reads the plain-text file as JPL last published it, from the Internet
 * Archive's copy — pinned to one capture, so the numbers cannot move under the cache.
 */
const PLANET_ELEMENTS_URL = 'https://web.archive.org/web/20210420020242id_/https://ssd.jpl.nasa.gov/txt/p_elem_t2.txt';

/**
 * JPL SSD's planetary satellite mean elements, as the page stood until 2021: each moon's elements,
 * its sidereal mean motion to ten figures, and how fast its node and periapsis turn, against its
 * local Laplace plane (the Moon against the ecliptic). The current page, ssd.jpl.nasa.gov/sats/elem,
 * has dropped the mean motion and rounds the period to four or five figures — 0.3187 days for
 * Phobos, which is a revolution out within a decade — so a period from it would not hold. Pinned
 * to one Internet Archive capture for the same reason as the planets.
 */
const SATELLITE_ELEMENTS_URL = 'https://web.archive.org/web/20210203000649id_/https://ssd.jpl.nasa.gov/?sat_elem';

export async function fetchPlanetMeanElementsText(): Promise<string> {
  return fetchTextCached(PLANET_ELEMENTS_URL, 'jpl-planet-mean-elements-t2.txt');
}

export async function fetchSatelliteMeanElementsHtml(): Promise<string> {
  return fetchTextCached(SATELLITE_ELEMENTS_URL, 'jpl-satellite-mean-elements.html');
}
