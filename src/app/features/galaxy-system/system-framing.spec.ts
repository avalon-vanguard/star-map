import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { eclipticToEquatorial, OBLIQUITY_J2000_DEG } from '../../shared/astro/coordinates';
import {
  bodyMarkerRadiusAu,
  DEFAULT_STAR_MARKER_RADIUS_AU,
  starMarkerRadiusAu,
  systemFramingDistanceAu,
  systemGridRingsAu,
  SYSTEM_VIEW_DIRECTION_IN_PLANE,
  systemViewDirection
} from './system-framing';

/** Real systems spanning the range the view has to cope with. */
const TRAPPIST_1 = { innermost: 0.01154, outermost: 0.06189 };
const GL_357 = { innermost: 0.035, outermost: 0.204 };
const SOLAR = { innermost: 0.387, outermost: 30.07 };

describe('starMarkerRadiusAu', () => {
  it('never reaches the innermost orbit', () => {
    for (const { innermost } of [TRAPPIST_1, GL_357, SOLAR]) {
      expect(starMarkerRadiusAu(innermost)).toBeLessThan(innermost);
    }
  });

  it('shrinks to fit a compact system whose orbits were all inside the old fixed radius', () => {
    // Every TRAPPIST-1 orbit is inside 0.2 AU, so the star used to swallow the entire system.
    expect(starMarkerRadiusAu(TRAPPIST_1.innermost)).toBeLessThan(TRAPPIST_1.outermost);
    expect(starMarkerRadiusAu(GL_357.innermost)).toBeLessThan(GL_357.outermost);
  });

  it('never grows beyond the default, however wide the system', () => {
    expect(starMarkerRadiusAu(SOLAR.innermost)).toBeLessThanOrEqual(DEFAULT_STAR_MARKER_RADIUS_AU);
    expect(starMarkerRadiusAu(500)).toBe(DEFAULT_STAR_MARKER_RADIUS_AU);
  });

  it('scales in proportion to the innermost orbit', () => {
    expect(starMarkerRadiusAu(0.02) / starMarkerRadiusAu(0.01)).toBeCloseTo(2, 9);
  });

  it('falls back to the default when there are no planets to scale against', () => {
    for (const innermost of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(starMarkerRadiusAu(innermost)).toBe(DEFAULT_STAR_MARKER_RADIUS_AU);
    }
  });

  it('stays positive for an extremely tight orbit', () => {
    expect(starMarkerRadiusAu(0.0001)).toBeGreaterThan(0);
  });
});

describe('systemFramingDistanceAu', () => {
  it('fits the whole system in view', () => {
    for (const { outermost } of [TRAPPIST_1, GL_357, SOLAR]) {
      expect(systemFramingDistanceAu(outermost)).toBeGreaterThan(outermost);
    }
  });

  it('closes right in on a compact system instead of hanging back at a fixed floor', () => {
    // The old floor was 3 AU — some 48x the width of the entire TRAPPIST-1 system.
    expect(systemFramingDistanceAu(TRAPPIST_1.outermost)).toBeLessThan(1);
    expect(systemFramingDistanceAu(GL_357.outermost)).toBeLessThan(1);
  });

  it('scales in proportion to the outermost orbit', () => {
    expect(systemFramingDistanceAu(0.2) / systemFramingDistanceAu(0.1)).toBeCloseTo(2, 9);
  });

  it('caps the distance so a far-flung companion cannot shrink the star to nothing', () => {
    expect(systemFramingDistanceAu(1000)).toBe(systemFramingDistanceAu(5000));
    expect(systemFramingDistanceAu(SOLAR.outermost)).toBeLessThanOrEqual(80);
  });

  it('stays outside the orbit controls minimum distance', () => {
    // Framing closer than the controls allow would be clamped straight back out again.
    expect(systemFramingDistanceAu(0.00001)).toBeGreaterThanOrEqual(0.05);
  });

  it('uses a sensible default for a star with no known planets', () => {
    for (const outermost of [0, -1, Number.NaN]) {
      expect(systemFramingDistanceAu(outermost)).toBe(3);
    }
  });
});

describe('star and framing together', () => {
  it('gives compact and wide systems a comparable apparent star size', () => {
    // Both scale with the system, so the star subtends a similar angle either way — the point
    // of deriving them from the same measurements rather than fixing them.
    const apparent = ({ innermost, outermost }: { innermost: number; outermost: number }) =>
      starMarkerRadiusAu(innermost) / systemFramingDistanceAu(outermost);

    const compact = apparent(TRAPPIST_1);
    const midRange = apparent(GL_357);

    expect(compact).toBeGreaterThan(0);
    expect(compact / midRange).toBeGreaterThan(0.25);
    expect(compact / midRange).toBeLessThan(4);
  });

  it('always leaves the innermost orbit outside the star, at every scale', () => {
    for (const innermost of [0.005, 0.01, 0.05, 0.2, 1, 5, 40]) {
      expect(starMarkerRadiusAu(innermost)).toBeLessThan(innermost);
    }
  });
});

describe('bodyMarkerRadiusAu', () => {
  const EARTH_RADIUS_KM = 6371;
  const SOLAR_SPAN_AU = 30.07;

  it('scales in proportion to the system span', () => {
    const wide = bodyMarkerRadiusAu(EARTH_RADIUS_KM, SOLAR_SPAN_AU);
    const compact = bodyMarkerRadiusAu(EARTH_RADIUS_KM, SOLAR_SPAN_AU / 100);

    expect(compact / wide).toBeCloseTo(0.01, 6);
  });

  it('keeps a marker far smaller than the orbits it sits on, at any scale', () => {
    // A fixed 0.09 AU marker inside Gl 357's 0.204 AU system was wider than the orbits, so one
    // planet swallowed the whole view.
    for (const span of [0.06, 0.204, 1, 30.07, 800]) {
      expect(bodyMarkerRadiusAu(EARTH_RADIUS_KM, span)).toBeLessThan(span / 5);
    }
  });

  it('gives compact and wide systems the same apparent marker size', () => {
    const apparent = (span: number) => bodyMarkerRadiusAu(EARTH_RADIUS_KM, span) / systemFramingDistanceAu(span);

    expect(apparent(0.204)).toBeCloseTo(apparent(10), 6);
  });

  it('still renders a bigger body as a bigger marker', () => {
    const jupiter = bodyMarkerRadiusAu(69911, SOLAR_SPAN_AU);
    const pluto = bodyMarkerRadiusAu(1188, SOLAR_SPAN_AU);

    expect(jupiter).toBeGreaterThan(pluto);
  });

  it('falls back to the smallest marker for a body with no known radius', () => {
    const unknown = bodyMarkerRadiusAu(undefined, SOLAR_SPAN_AU);
    const pluto = bodyMarkerRadiusAu(1188, SOLAR_SPAN_AU);

    expect(unknown).toBeGreaterThan(0);
    expect(unknown).toBeLessThanOrEqual(pluto);
  });

  it('treats a missing span as the reference scale rather than collapsing to zero', () => {
    for (const span of [0, -5, Number.NaN]) {
      expect(bodyMarkerRadiusAu(EARTH_RADIUS_KM, span)).toBeGreaterThan(0);
    }
  });

  it('leaves the solar system essentially as it was before scaling', () => {
    // The constants were tuned at this span, so the scale factor here is ~1.
    expect(bodyMarkerRadiusAu(EARTH_RADIUS_KM, SOLAR_SPAN_AU)).toBeCloseTo(0.09, 2);
  });
});

describe('systemGridRingsAu', () => {
  it('reaches past the outermost orbit, so no planet sits off the edge of the grid', () => {
    for (const { outermost } of [TRAPPIST_1, GL_357, SOLAR]) {
      const rings = systemGridRingsAu(outermost);
      expect(rings.length).toBeGreaterThan(0);
      expect(rings[rings.length - 1]).toBeGreaterThan(outermost);
    }
  });

  it('gives a legible handful of rings at every scale, four orders of magnitude apart', () => {
    for (const { outermost } of [TRAPPIST_1, GL_357, SOLAR, { outermost: 650 }]) {
      const rings = systemGridRingsAu(outermost);
      expect(rings.length).toBeGreaterThanOrEqual(3);
      expect(rings.length).toBeLessThanOrEqual(10);
    }
  });

  it('spaces them evenly, on a round number', () => {
    const rings = systemGridRingsAu(SOLAR.outermost);
    // The solar system reads in 5 AU steps: 5, 10, ... out past Neptune at 30.07.
    expect(rings).toEqual([5, 10, 15, 20, 25, 30, 35]);
  });

  it('scales the step down to the system rather than defaulting to whole AU', () => {
    // TRAPPIST-1's outermost planet orbits at 0.062 AU. Whole-AU rings would put the entire
    // system inside the first one.
    const rings = systemGridRingsAu(TRAPPIST_1.outermost);
    expect(rings[0]).toBeLessThan(TRAPPIST_1.outermost / 2);
    for (const radius of rings) {
      expect(Number.isFinite(radius)).toBe(true);
      expect(radius).toBeGreaterThan(0);
    }
  });

  it('keeps the step free of floating-point drift, so labels would read cleanly', () => {
    for (const radius of systemGridRingsAu(TRAPPIST_1.outermost)) {
      // Multiplying the step out rather than accumulating it keeps these exact to 1e-12.
      expect(Math.abs(radius * 1000 - Math.round(radius * 1000))).toBeLessThan(1e-9);
    }
  });

  it('draws no grid for a system with nothing to measure against', () => {
    for (const outermost of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(systemGridRingsAu(outermost)).toEqual([]);
    }
  });
});

describe('systemViewDirection', () => {
  const RAD_TO_DEG = 180 / Math.PI;
  const ECLIPTIC_FRAME = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (OBLIQUITY_J2000_DEG * Math.PI) / 180);

  /** Angle between the camera direction and the plane's own normal, in degrees. */
  function angleFromNormalDeg(frame: THREE.Quaternion): number {
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(frame);
    return Math.acos(Math.abs(systemViewDirection(frame).dot(normal))) * RAD_TO_DEG;
  }

  it('returns a unit direction', () => {
    expect(systemViewDirection(ECLIPTIC_FRAME).length()).toBeCloseTo(1, 12);
  });

  it('holds the same three-quarter angle to the plane whatever plane that is', () => {
    // The whole point: one fixed direction in the scene's frame would be face-on for the solar
    // system and edge-on for an exoplanet system measured against the plane of the sky.
    const skyPlanes = [
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0.3, -0.5, 0.81).normalize()),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0))
    ];

    // atan(0.6 / 0.8) — the angle the in-plane direction was chosen at, held exactly.
    const expected = Math.atan2(SYSTEM_VIEW_DIRECTION_IN_PLANE.y, SYSTEM_VIEW_DIRECTION_IN_PLANE.z) * RAD_TO_DEG;
    for (const frame of [ECLIPTIC_FRAME, ...skyPlanes]) {
      expect(angleFromNormalDeg(frame)).toBeCloseTo(expected, 9);
    }
  });

  it('is well clear of edge-on in every case, which is what it exists to prevent', () => {
    for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.2, 0.9, -0.4).normalize()]) {
      const frame = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
      expect(angleFromNormalDeg(frame)).toBeLessThan(60);
    }
  });

  it('leaves the solar system framed exactly as the ecliptic conversion used to frame it', () => {
    // The previous behaviour was correct for the one system whose elements are ecliptic; this
    // pins that it did not move while the other systems were fixed.
    const previous = eclipticToEquatorial(SYSTEM_VIEW_DIRECTION_IN_PLANE);
    const current = systemViewDirection(ECLIPTIC_FRAME);
    const length = Math.hypot(previous.x, previous.y, previous.z);

    expect(current.x).toBeCloseTo(previous.x / length, 12);
    expect(current.y).toBeCloseTo(previous.y / length, 12);
    expect(current.z).toBeCloseTo(previous.z / length, 12);
  });
});
