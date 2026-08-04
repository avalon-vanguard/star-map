/**
 * How the system view sizes itself to whatever system it is showing.
 *
 * Real planetary systems span four orders of magnitude: TRAPPIST-1's outermost planet orbits
 * closer than Mercury by a factor of six, while some directly-imaged companions sit hundreds of
 * AU out. A single fixed star size and camera distance cannot serve both, and the fixed pair
 * that used to be hard-coded served only the wide end — 29% of systems had *every* orbit inside
 * the star marker, so they rendered as a lone sphere with nothing around it, and 52% were
 * framed from a distance floor far larger than the system itself.
 *
 * Both quantities are therefore derived from the system's own scale. Because the star and the
 * camera scale together, a compact system ends up looking like a wide one: same apparent star,
 * same apparent spread of orbits.
 */

/** Star size when there are no orbits to scale against, and the ceiling everywhere else. */
export const DEFAULT_STAR_MARKER_RADIUS_AU = 0.2;

/**
 * Star radius as a fraction of the innermost orbit. Comfortably below 1 so there is visible
 * space between the star's limb and the closest orbit, rather than the orbit grazing or
 * disappearing inside it.
 */
const STAR_RADIUS_TO_INNERMOST_ORBIT = 0.35;

/** Camera distance as a multiple of the outermost orbit, so the whole system fits in view. */
const FRAMING_TO_OUTERMOST_ORBIT = 2.4;

/**
 * Floor on the framing distance. Only guards the degenerate case — it sits just above the
 * orbit controls' own minimum distance, so for any real system the fit above decides.
 */
const MIN_FRAMING_DISTANCE_AU = 0.06;

/** Ceiling on the framing distance, so a distant companion does not push the star to a dot. */
const MAX_FRAMING_DISTANCE_AU = 80;

/** Framing for a star with no known planets, where there is nothing to fit. */
const EMPTY_SYSTEM_FRAMING_DISTANCE_AU = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Radius (AU) to draw the system's star at, given its innermost orbit.
 *
 * Never larger than {@link DEFAULT_STAR_MARKER_RADIUS_AU}, and never large enough to reach the
 * closest orbit. Falls back to that default when the system has no planets, since there is
 * then nothing for the star to crowd.
 */
export function starMarkerRadiusAu(innermostOrbitAu: number): number {
  if (!Number.isFinite(innermostOrbitAu) || innermostOrbitAu <= 0) {
    return DEFAULT_STAR_MARKER_RADIUS_AU;
  }
  return Math.min(DEFAULT_STAR_MARKER_RADIUS_AU, innermostOrbitAu * STAR_RADIUS_TO_INNERMOST_ORBIT);
}

/**
 * Distance (AU) to settle the camera at, given the system's outermost orbit — far enough that
 * every orbit fits in frame, close enough that a compact system is not a cluster of specks.
 */
export function systemFramingDistanceAu(outermostOrbitAu: number): number {
  if (!Number.isFinite(outermostOrbitAu) || outermostOrbitAu <= 0) {
    return EMPTY_SYSTEM_FRAMING_DISTANCE_AU;
  }
  return clamp(outermostOrbitAu * FRAMING_TO_OUTERMOST_ORBIT, MIN_FRAMING_DISTANCE_AU, MAX_FRAMING_DISTANCE_AU);
}

/**
 * Span of the solar system, in AU, used as the reference every other system's marker sizes are
 * scaled against. The marker constants below were tuned by eye at this scale.
 */
const REFERENCE_SYSTEM_SPAN_AU = 30;

/** Exaggerated (non-physical) marker sizes at the reference scale, so planets stay visible. */
const MIN_MARKER_RADIUS_AU = 0.012;
const MAX_MARKER_RADIUS_AU = 0.09;
/** Physical radius (km) that maps to one AU of marker radius before clamping. */
const MARKER_RADIUS_KM_PER_AU = 18000;

/**
 * Radius (AU) to draw a planet, moon or exoplanet marker at, scaled to the system it sits in.
 *
 * Marker sizes are deliberately exaggerated — a true-scale Earth would be invisible next to its
 * own orbit — but the exaggeration has to be relative to the system, not absolute. Fixed AU
 * sizes tuned against the solar system's 30 AU span become grotesque in a system a hundredth
 * that size: a marker of 0.09 AU inside a 0.2 AU system is wider than the orbits it sits on, so
 * a single planet swallows the entire view.
 *
 * Scaling by the span keeps every system looking like the solar system does: orbits legible,
 * planets as small dots on them.
 */
export function bodyMarkerRadiusAu(radiusKm: number | undefined, systemSpanAu: number): number {
  const span = Number.isFinite(systemSpanAu) && systemSpanAu > 0 ? systemSpanAu : REFERENCE_SYSTEM_SPAN_AU;
  const atReferenceScale = radiusKm ? clamp(radiusKm / MARKER_RADIUS_KM_PER_AU, MIN_MARKER_RADIUS_AU, MAX_MARKER_RADIUS_AU) : MIN_MARKER_RADIUS_AU;

  return atReferenceScale * (span / REFERENCE_SYSTEM_SPAN_AU);
}
