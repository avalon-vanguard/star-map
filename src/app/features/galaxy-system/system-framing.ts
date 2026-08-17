import * as THREE from 'three/webgpu';

import { CartesianCoordinates } from '../../shared/astro/coordinates';

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
const STAR_RADIUS_TO_INNERMOST_ORBIT = 0.45;

/**
 * Halo extent as a multiple of the star's own radius, and the floor on that extent as a
 * fraction of the framed radius.
 *
 * The floor is what keeps a star visible. A system's star is sized against its *innermost*
 * orbit — it must never swallow its closest planet — while the camera is placed to frame the
 * *outermost* ring, and those differ by a factor of a hundred in the solar system. At the
 * distance that fits Pluto in view, a disc that stays clear of Mercury is about one pixel
 * across; there is no radius that satisfies both, because the information genuinely does not
 * fit on one screen at that zoom.
 *
 * The halo resolves it, because light is not a surface: a glow that reaches past the innermost
 * orbit does not claim the star is that large, it claims the star is bright. So the disc stays
 * honest to the orbits and the halo is floored against the frame.
 *
 * The floor is set by what it must not cover. Its visual radius is half the extent, so a floor
 * of `f` puts the halo's edge at `f / 2` of the frame radius — and the orbits it has to leave
 * legible sit at their own fraction of that same radius. In the solar system, framed to hold
 * Pluto, Venus's orbit is at 1.3% of the frame radius and Earth's at 1.8%, so a floor of 2%
 * leaves both of them outside the halo. Mercury's, at 0.7%, is inside it — and would be at any
 * halo large enough to see, since the orbit itself is only a few pixels wide there.
 */
const STAR_GLOW_TO_MARKER = 3.2;
const MIN_STAR_GLOW_TO_FRAME = 0.02;

/**
 * Clear space left around the framed radius, as a fraction of it. The camera backs off this
 * much further than the geometry strictly needs, so the outermost ring sits inside the frame
 * with room around it rather than grazing the edge.
 */
const FRAME_MARGIN = 0.12;

/**
 * The camera the system view is framed for. The vertical field of view is what
 * `EngineService` creates its camera with; the aspect decides which screen axis is the tighter
 * one, since a perspective camera's `fov` is vertical and the horizontal extent scales with the
 * aspect. Anything landscape is bound by the vertical, anything portrait by the horizontal.
 */
export interface SystemViewport {
  fovDegrees: number;
  aspect: number;
}

export const DEFAULT_SYSTEM_VIEWPORT: SystemViewport = { fovDegrees: 50, aspect: 1 };

/** Half-angle tangent along whichever screen axis is the tighter of the two. */
function tightHalfExtent(viewport: SystemViewport): number {
  return Math.tan((viewport.fovDegrees * Math.PI) / 360) * Math.min(1, viewport.aspect);
}

/**
 * Floor on the framing distance. Only guards the degenerate case — it sits just above the
 * orbit controls' own minimum distance, so for any real system the fit above decides.
 */
const MIN_FRAMING_DISTANCE_AU = 0.06;

/**
 * Ceiling on the framing distance, so a distant companion does not push the star to a dot.
 *
 * Generous enough to frame the solar system out to Pluto in any window shape, which needs 120 AU
 * on a landscape display and 140 on a portrait one once the camera's real field of view is
 * accounted for. Only genuinely pathological systems reach it now — the handful with
 * directly-imaged companions hundreds of AU out — and those still arrive framed on their inner
 * region, with the orbit controls reaching far enough to pull back to the rest.
 */
const MAX_FRAMING_DISTANCE_AU = 200;

/** Framing for a star with no known planets, where there is nothing to fit. */
const EMPTY_SYSTEM_FRAMING_DISTANCE_AU = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Where the camera settles when arriving at a system, as a unit direction from the star —
 * expressed in the system's *own* reference plane, before that plane is rotated into the scene.
 *
 * A three-quarter view, about 37 degrees off the plane's normal, so a system reads as a disc
 * rather than as a line.
 */
export const SYSTEM_VIEW_DIRECTION_IN_PLANE: CartesianCoordinates = { x: 0, y: 0.6, z: 0.8 };

/**
 * That direction carried into the scene's equatorial frame by the system's own reference frame.
 *
 * The scene is equatorial so that orbits and stars share one frame, but no system's orbits lie
 * in the equatorial plane: the solar system's are measured against the ecliptic, 23.4 degrees
 * out of it, and an exoplanet system's against the plane of the sky, which depends on where its
 * host star happens to be. Left to the equatorial axes — or to any single fixed direction — some
 * systems come out edge-on.
 *
 * Rather than rotate the world into a comfortable pose, which would put the orbits back at odds
 * with the sky, the camera is placed relative to whichever plane the system was measured in. So
 * every system reads as a disc while staying exactly where it truly sits.
 */
export function systemViewDirection(referenceFrame: THREE.Quaternion): THREE.Vector3 {
  const { x, y, z } = SYSTEM_VIEW_DIRECTION_IN_PLANE;
  return new THREE.Vector3(x, y, z).normalize().applyQuaternion(referenceFrame);
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
 * Radius, in AU, that the camera can see at the star's own distance — the half-height of the
 * view frustum where the system sits, along whichever screen axis is tighter.
 */
export function systemFrameRadiusAu(distanceAu: number, viewport: SystemViewport = DEFAULT_SYSTEM_VIEWPORT): number {
  return distanceAu * tightHalfExtent(viewport);
}

/**
 * Extent (AU) of the star's glow sprite — how wide it is drawn, not its radius.
 *
 * Normally a multiple of the star's own radius, so a compact system keeps the corona it has.
 * Floored against the framed radius, so a star framed from far enough out to hold its whole
 * system still reads as a bright point rather than disappearing into it. `glowScale` lets a
 * caller dim the halo for stars drawn without a real photograph.
 */
export function starGlowExtentAu(markerRadiusAu: number, frameRadiusAu: number, glowScale = 1): number {
  const fromStar = markerRadiusAu * STAR_GLOW_TO_MARKER * glowScale;
  const fromFrame = Number.isFinite(frameRadiusAu) && frameRadiusAu > 0 ? frameRadiusAu * MIN_STAR_GLOW_TO_FRAME : 0;
  return Math.max(fromStar, fromFrame);
}

/**
 * Distance (AU) to settle the camera at so that `framedRadiusAu` fits in view with a margin
 * around it.
 *
 * Derived from the camera's actual field of view rather than from a multiple of the outermost
 * orbit. A plain multiple cannot be right: what has to fit is a *radius* on screen, and how much
 * radius a given distance buys depends entirely on the lens. The multiple that used to be here
 * was tuned by eye against a 55-degree field, and the engine's camera is 50 — which left the
 * grid overflowing the frame in 368 of the 371 systems the datasets contain.
 *
 * Callers pass the outermost thing actually drawn, which is the reference grid's outer ring
 * rather than the outermost orbit — the ring is always the wider of the two, by construction.
 */
export function systemFramingDistanceAu(framedRadiusAu: number, viewport: SystemViewport = DEFAULT_SYSTEM_VIEWPORT): number {
  if (!Number.isFinite(framedRadiusAu) || framedRadiusAu <= 0) {
    return EMPTY_SYSTEM_FRAMING_DISTANCE_AU;
  }
  const required = (framedRadiusAu * (1 + FRAME_MARGIN)) / tightHalfExtent(viewport);
  return clamp(required, MIN_FRAMING_DISTANCE_AU, MAX_FRAMING_DISTANCE_AU);
}

/** Roughly how many rings the system grid aims for, and how far past the outermost orbit it runs. */
const TARGET_GRID_RING_COUNT = 8;
const GRID_EXTENT_TO_OUTERMOST_ORBIT = 1.15;
/** Ring spacings are always one of these times a power of ten, so the numbers stay readable. */
const RING_STEP_MANTISSAS = [1, 2, 5, 10];

/**
 * Ring radii (AU) for the system view's reference grid, given the system's outermost orbit.
 *
 * Snapped to a 1-2-5 ladder rather than evenly dividing the system, because the point of the
 * grid is to put a number on a distance: rings at 5, 10, 15 AU can be read off at a glance, and
 * rings at 4.34, 8.68, 13.02 AU cannot. That holds across the four orders of magnitude real
 * systems span — the solar system gets 5 AU rings, TRAPPIST-1 gets 0.01 AU ones.
 *
 * Empty for a system with no orbits to scale against; there is no distance to mark out.
 */
export function systemGridRingsAu(outermostOrbitAu: number): number[] {
  if (!Number.isFinite(outermostOrbitAu) || outermostOrbitAu <= 0) {
    return [];
  }

  const extent = outermostOrbitAu * GRID_EXTENT_TO_OUTERMOST_ORBIT;
  const target = extent / TARGET_GRID_RING_COUNT;
  const magnitude = Math.pow(10, Math.floor(Math.log10(target)));
  const step = magnitude * (RING_STEP_MANTISSAS.find((mantissa) => magnitude * mantissa >= target) ?? 10);

  // Rounded up, not truncated: the last ring has to enclose the outermost orbit rather than fall
  // just inside it, or the outermost planet spends its year outside the grid meant to measure it.
  const count = Math.ceil(extent / step);
  const rings: number[] = [];
  // Multiplied rather than accumulated, so a step of 0.01 does not drift into 0.060000000000000005.
  for (let index = 1; index <= count; index++) {
    rings.push(index * step);
  }
  return rings;
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
