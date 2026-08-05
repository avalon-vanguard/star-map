/** Broad visual category a deep-sky object is grouped under on the galaxy-view backdrop. */
export type DeepSkyKind = 'galaxy' | 'nebula' | 'cluster';

/** How a record's distance estimate was derived, when one could be derived at all. */
export type DeepSkyDistanceMethod = 'parallax' | 'redshift';

/**
 * A notable deep-sky object (nebula, star cluster or galaxy) from the OpenNGC catalog,
 * rendered as the galaxy view's backdrop.
 *
 * **Why a direction and not a position.** Every other record in this app carries a Cartesian
 * position in parsecs, but deep-sky objects deliberately do not. The star field spans 50 pc;
 * the nearest object here is several hundred parsecs away and the galaxies are millions. At
 * true scale they would all sit far outside the galaxy camera's far plane, so a position in
 * parsecs would be unusable for the backdrop it exists to draw.
 *
 * More importantly the distances mostly are not knowable from this catalog: OpenNGC publishes
 * no distance column, so it has to be inferred from redshift or parallax, and that inference
 * fails for exactly the best-known objects — M31, M33 and M42 are all Local Group members whose
 * redshift is negative (they are approaching us) or absent. What *is* always known, and known
 * precisely, is the line of sight. So the position here is a unit vector on the celestial
 * sphere and {@link distancePc} is optional metadata.
 */
export interface DeepSkyRecord {
  /** OpenNGC designation, e.g. `NGC0224`. Stable, and unique within the catalog. */
  id: string;
  /** Best available display name: common name, else Messier number, else the designation. */
  name: string;
  kind: DeepSkyKind;
  /**
   * Unit vector toward the object, in the same equatorial J2000 frame as `StarRecord`
   * (+X toward the vernal equinox, +Z toward the north celestial pole). Not a position —
   * see the note on this interface.
   */
  x: number;
  y: number;
  z: number;
  /** Apparent major-axis size on the sky, in degrees. */
  angularSizeDeg: number;
  /** Apparent visual magnitude (falling back to blue), or `null` when unphotometered. */
  magnitude: number | null;
  /** Estimated distance in parsecs, or `null` when it could not be derived. */
  distancePc: number | null;
  /** Provenance for {@link distancePc}; `null` whenever the distance is `null`. */
  distanceMethod: DeepSkyDistanceMethod | null;
  /** IAU constellation abbreviation, e.g. `And`. */
  constellation: string;
  /** Messier designation, e.g. `M31`, when the object has one. */
  messier: string | null;
}
