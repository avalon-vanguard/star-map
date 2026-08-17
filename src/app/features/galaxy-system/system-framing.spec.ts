import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { eclipticToEquatorial, OBLIQUITY_J2000_DEG } from '../../shared/astro/coordinates';
import {
  bodyMarkerRadiusAu,
  DEFAULT_STAR_MARKER_RADIUS_AU,
  starGlowExtentAu,
  starMarkerRadiusAu,
  systemFrameRadiusAu,
  systemFramingDistanceAu,
  systemGridRingsAu,
  SystemViewport,
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
  it('fits the radius it is given in view, with room around it', () => {
    for (const radius of [TRAPPIST_1.outermost, GL_357.outermost, SOLAR.outermost]) {
      expect(systemFrameRadiusAu(systemFramingDistanceAu(radius))).toBeGreaterThan(radius);
    }
  });

  it('closes right in on a compact system instead of hanging back at a fixed floor', () => {
    // The old floor was 3 AU — some 48x the width of the entire TRAPPIST-1 system.
    expect(systemFramingDistanceAu(TRAPPIST_1.outermost)).toBeLessThan(1);
    expect(systemFramingDistanceAu(GL_357.outermost)).toBeLessThan(1);
  });

  it('scales in proportion to the radius it has to frame', () => {
    expect(systemFramingDistanceAu(0.2) / systemFramingDistanceAu(0.1)).toBeCloseTo(2, 9);
  });

  it('backs off further for a narrower field of view, which a fixed multiple could not', () => {
    // The bug this replaced: the multiple was tuned by eye against a 55-degree field and the
    // engine's camera is 50, so everything sat that much too close.
    const wide = systemFramingDistanceAu(1, { fovDegrees: 70, aspect: 1.78 });
    const narrow = systemFramingDistanceAu(1, { fovDegrees: 30, aspect: 1.78 });
    expect(narrow).toBeGreaterThan(wide);
  });

  it('backs off further for a portrait window, where the horizontal axis is the tighter one', () => {
    const landscape = systemFramingDistanceAu(1, { fovDegrees: 50, aspect: 1.78 });
    const portrait = systemFramingDistanceAu(1, { fovDegrees: 50, aspect: 0.6 });
    expect(portrait).toBeCloseTo(landscape / 0.6, 6);
  });

  it('ignores aspect once the window is landscape, since the vertical binds there', () => {
    const square = systemFramingDistanceAu(1, { fovDegrees: 50, aspect: 1 });
    expect(systemFramingDistanceAu(1, { fovDegrees: 50, aspect: 2.5 })).toBeCloseTo(square, 9);
  });

  it('caps the distance so a far-flung companion cannot shrink the star to nothing', () => {
    expect(systemFramingDistanceAu(1000)).toBe(systemFramingDistanceAu(5000));
  });

  it('reaches far enough to frame the solar system out to Pluto', () => {
    // The old 80 AU ceiling could not: at the camera's real field of view this needs 120.
    const rings = systemGridRingsAu(39.288);
    const distance = systemFramingDistanceAu(rings[rings.length - 1]);
    expect(distance).toBeLessThan(200);
    expect(systemFrameRadiusAu(distance)).toBeGreaterThan(39.288);
  });

  it('stays outside the orbit controls minimum distance', () => {
    // Framing closer than the controls allow would be clamped straight back out again.
    expect(systemFramingDistanceAu(0.00001)).toBeGreaterThanOrEqual(0.05);
  });

  it('uses a sensible default for a star with no known planets', () => {
    for (const radius of [0, -1, Number.NaN]) {
      expect(systemFramingDistanceAu(radius)).toBe(3);
    }
  });
});

describe('starGlowExtentAu', () => {
  /** A typical viewport, so a screen-space claim can be made in pixels rather than in ratios. */
  const REFERENCE_VIEWPORT_HALF_HEIGHT_PX = 450;

  /** The halo's visual radius, in AU, at the distance this system is framed from. */
  function haloRadiusAu(innermostAu: number, outermostAu: number, glowScale = 1): number {
    // The sprite's extent is its full width, so half of it is what reaches out from the star.
    return starGlowExtentAu(starMarkerRadiusAu(innermostAu), frameRadiusFor(outermostAu), glowScale) / 2;
  }

  function frameRadiusFor(outermostAu: number): number {
    const rings = systemGridRingsAu(outermostAu);
    return systemFrameRadiusAu(systemFramingDistanceAu(rings[rings.length - 1]));
  }

  /** Apparent size on screen, as a fraction of the frame's half-height. */
  function apparentFraction(innermostAu: number, outermostAu: number, glowScale = 1): number {
    return haloRadiusAu(innermostAu, outermostAu, glowScale) / frameRadiusFor(outermostAu);
  }

  function apparentPixels(innermostAu: number, outermostAu: number): number {
    return apparentFraction(innermostAu, outermostAu) * REFERENCE_VIEWPORT_HALF_HEIGHT_PX;
  }

  it('scales with the star for a compact system, where the star is already big enough', () => {
    // A tight frame relative to the star, so the star's own multiple is what decides.
    const marker = 0.02;
    const tightFrame = 0.5;
    expect(starGlowExtentAu(marker, tightFrame)).toBeCloseTo(marker * 3.2, 9);
    expect(starGlowExtentAu(marker * 2, tightFrame)).toBeCloseTo(marker * 2 * 3.2, 9);
  });

  it('floors against the frame once the star would otherwise vanish into it', () => {
    // A star sized against a close-in orbit, framed from far enough out to hold a wide system:
    // the multiple of the star is nothing, so the frame decides instead.
    const tinyStar = 0.001;
    const wideFrame = 56;
    expect(starGlowExtentAu(tinyStar, wideFrame)).toBeGreaterThan(tinyStar * 3.2 * 100);
  });

  it('keeps the Sun visible at the distance that frames the solar system', () => {
    // The case that prompted this: the solar system spans a factor of a hundred from Mercury to
    // Pluto, so a disc that stays clear of Mercury is about a pixel across once Pluto is in view.
    expect(apparentPixels(0.387, 39.288)).toBeGreaterThan(4);
  });

  it('leaves the inner orbits clear of the halo', () => {
    // The other half of the same trade. Venus and Earth have to stay legible as rings around the
    // star, which bounds the halo from above just as visibility bounds it from below.
    const halo = haloRadiusAu(0.387, 39.288);
    const VENUS_AU = 0.723;
    const EARTH_AU = 1;
    expect(halo).toBeLessThan(VENUS_AU);
    expect(halo).toBeLessThan(EARTH_AU);
  });

  it('cannot clear Mercury as well, and does not pretend to', () => {
    // Mercury's orbit is 0.7% of the framed radius — about three pixels — so it is inside any
    // halo big enough to see. Pinned so the trade is a decision rather than an oversight.
    expect(haloRadiusAu(0.387, 39.288)).toBeGreaterThan(0.387);
  });

  it('holds the floor across every system scale the datasets contain', () => {
    // A compact system's star is genuinely large relative to its own system and keeps the bigger
    // halo; the floor is not there to equalise them, only to stop the wide ones disappearing.
    for (const [innermost, outermost] of [
      [0.387, 39.288],
      [0.035, 0.204],
      [0.01154, 0.06189],
      [1.2, 12.4]
    ]) {
      expect(apparentPixels(innermost, outermost)).toBeGreaterThan(4);
    }
  });

  it('does not blot out the system it sits in', () => {
    for (const [innermost, outermost] of [
      [0.387, 39.288],
      [0.035, 0.204],
      [0.01154, 0.06189]
    ]) {
      expect(apparentFraction(innermost, outermost)).toBeLessThan(0.2);
    }
  });

  it('dims for a star drawn from a colour rather than a photograph, but never below the floor', () => {
    // Above the floor the multiplier applies...
    expect(starGlowExtentAu(1, 10, 0.6)).toBeLessThan(starGlowExtentAu(1, 10, 1));
    // ...and at the floor it cannot dim a star into invisibility.
    expect(starGlowExtentAu(0.001, 56, 0.6)).toBe(starGlowExtentAu(0.001, 56, 1));
  });

  it('falls back to the star alone when there is no frame to measure against', () => {
    for (const frame of [0, -1, Number.NaN]) {
      expect(starGlowExtentAu(0.2, frame)).toBeCloseTo(0.2 * 3.2, 9);
    }
  });
});

describe('the grid and the framing together', () => {
  /** What the scene actually composes: rings from the orbits, then a distance from the rings. */
  function fit(outermostOrbitAu: number, viewport?: SystemViewport): { ring: number; frame: number } {
    const rings = systemGridRingsAu(outermostOrbitAu);
    const ring = rings[rings.length - 1];
    return { ring, frame: systemFrameRadiusAu(systemFramingDistanceAu(ring, viewport), viewport) };
  }

  const VIEWPORTS: SystemViewport[] = [
    { fovDegrees: 50, aspect: 1.78 },
    { fovDegrees: 50, aspect: 1 },
    { fovDegrees: 50, aspect: 0.6 }
  ];

  it('leaves the outermost ring clear of the frame edge at every scale and window shape', () => {
    // The whole point of framing against the grid rather than the orbits: before this, 368 of
    // the 371 systems in the datasets drew a grid wider than the view that was meant to hold it.
    for (const viewport of VIEWPORTS) {
      for (const { outermost } of [TRAPPIST_1, GL_357, SOLAR, { outermost: 1 }, { outermost: 12.4 }]) {
        const { ring, frame } = fit(outermost, viewport);
        expect(ring).toBeLessThan(frame);
        expect(ring / frame).toBeLessThan(0.93);
      }
    }
  });

  it('still encloses the outermost orbit, so no planet sits off the edge of the grid', () => {
    for (const { outermost } of [TRAPPIST_1, GL_357, SOLAR, { outermost: 1 }, { outermost: 12.4 }]) {
      expect(fit(outermost).ring).toBeGreaterThan(outermost);
    }
  });

  it('does not overshoot either: the grid still fills most of the frame', () => {
    // A margin is not the same as framing a system from orbit. Half the frame empty would be as
    // wrong as none of it.
    for (const { outermost } of [TRAPPIST_1, GL_357, SOLAR]) {
      const { ring, frame } = fit(outermost);
      expect(ring / frame).toBeGreaterThan(0.6);
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
