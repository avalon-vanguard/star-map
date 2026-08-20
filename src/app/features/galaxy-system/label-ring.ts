/**
 * Where a name goes on the ring around the view, given the direction it stands for and the
 * panels already occupying the frame.
 *
 * Pure and in screen space, so the rule can be read and tested without a scene: the caller turns
 * a direction into an angle, this decides where on the ring that angle can actually be printed,
 * and the caller turns the answer back into a point the renderer can project.
 */

/** A box the ring must not print into, in pixels from the top-left of the viewport. */
export interface ReservedBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface RingViewport {
  readonly width: number;
  readonly height: number;
}

/** A place on the ring, in normalised device coordinates (-1..1, y up). */
export interface RingPlacement {
  readonly x: number;
  readonly y: number;
  /** The angle actually used, which is the requested one unless a panel was in the way. */
  readonly angle: number;
}

/**
 * How far the bearing may be bent to get out from behind a panel, and in what steps. Bending is
 * a lie about the direction, so it is kept small and always tried in the smallest amount that
 * works, alternating sides so the name ends up on whichever side of the panel is nearer.
 */
const MAX_NUDGE_RADIANS = Math.PI / 3;
const NUDGE_STEP_RADIANS = Math.PI / 24;

/**
 * The label's text runs this far from its anchor, as a fraction of the viewport width, and this
 * tall. A name clears a panel only if the whole line does, not just the point it hangs from.
 */
const LABEL_REACH_FRACTION = 0.13;
const LABEL_HEIGHT_PX = 30;

function overlaps(x: number, y: number, viewport: RingViewport, reserved: readonly ReservedBox[]): boolean {
  const px = ((x + 1) / 2) * viewport.width;
  const py = ((1 - y) / 2) * viewport.height;
  const reach = viewport.width * LABEL_REACH_FRACTION;
  // Either side, because which side the text hangs on is decided later, by the label pass.
  const left = px - reach;
  const right = px + reach;
  const top = py - LABEL_HEIGHT_PX / 2;
  const bottom = py + LABEL_HEIGHT_PX / 2;
  return reserved.some((box) => left < box.right && right > box.left && top < box.bottom && bottom > box.top);
}

/**
 * Places one name on the ring at `angle`, moved along the ring if a panel is in the way, or
 * `null` if the whole neighbourhood of that angle is covered — better absent than half hidden
 * behind a readout.
 *
 * `radius` is a fraction of the frame's shorter side, so the ring is a circle on screen — and
 * fits whichever way up the frame is. Sizing it against the height alone puts the ring a
 * viewport and a half wide on a phone held upright, which is to say off both edges.
 */
export function ringPlacement(
  angle: number,
  radius: number,
  viewport: RingViewport,
  reserved: readonly ReservedBox[] = []
): RingPlacement | null {
  const shorterSide = Math.min(viewport.width, viewport.height);
  const scaleX = viewport.width === 0 ? radius : (radius * shorterSide) / viewport.width;
  const scaleY = viewport.height === 0 ? radius : (radius * shorterSide) / viewport.height;
  for (let nudge = 0; nudge <= MAX_NUDGE_RADIANS; nudge += NUDGE_STEP_RADIANS) {
    for (const candidate of nudge === 0 ? [angle] : [angle + nudge, angle - nudge]) {
      const x = Math.cos(candidate) * scaleX;
      const y = Math.sin(candidate) * scaleY;
      if (!overlaps(x, y, viewport, reserved)) {
        return { x, y, angle: candidate };
      }
    }
  }
  return null;
}
