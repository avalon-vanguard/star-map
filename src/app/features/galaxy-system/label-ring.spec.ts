import { describe, expect, it } from 'vitest';

import { ReservedBox, ringPlacement } from './label-ring';

const VIEWPORT = { width: 1440, height: 900 };

/** Where a placement lands on screen, which is what the rule is really about. */
function screen(placement: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(((placement.x + 1) / 2) * VIEWPORT.width), y: Math.round(((1 - placement.y) / 2) * VIEWPORT.height) };
}

describe('ringPlacement', () => {
  it('puts a name where its bearing points, on a ring that is round on screen', () => {
    const right = ringPlacement(0, 0.74, VIEWPORT);
    const up = ringPlacement(Math.PI / 2, 0.74, VIEWPORT);

    // Same distance from the centre in pixels, despite the frame being wider than it is tall.
    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const radius = (p: { x: number; y: number }) => Math.hypot(screen(p).x - centre.x, screen(p).y - centre.y);
    expect(radius(right!)).toBeCloseTo(radius(up!), 0);
    expect(screen(right!).y).toBe(450);
    expect(screen(up!).x).toBe(720);
  });

  it('leaves the bearing alone when nothing is in the way', () => {
    expect(ringPlacement(1.1, 0.74, VIEWPORT)?.angle).toBeCloseTo(1.1);
  });

  it('slides a name along the ring rather than printing it behind a panel', () => {
    // The readout panel, bottom left, where the ring passes.
    const readout: ReservedBox = { left: 24, top: 640, right: 536, bottom: 830 };
    const behindIt = (5 * Math.PI) / 4;

    const placed = ringPlacement(behindIt, 0.74, VIEWPORT, [readout]);

    expect(placed).not.toBeNull();
    expect(placed!.angle).not.toBeCloseTo(behindIt);
    const { x, y } = screen(placed!);
    expect(x > readout.right || x < readout.left || y < readout.top || y > readout.bottom).toBe(true);
  });

  it('moves it the smallest distance that clears, and to the nearer side', () => {
    const box: ReservedBox = { left: 0, top: 0, right: 1440, bottom: 200 };
    const straightUp = Math.PI / 2;

    const placed = ringPlacement(straightUp, 0.74, VIEWPORT, [box]);

    expect(placed).not.toBeNull();
    expect(Math.abs(placed!.angle - straightUp)).toBeLessThanOrEqual(Math.PI / 3);
  });

  it('gives up rather than half-hide a name, when everything near its bearing is covered', () => {
    const wall: ReservedBox = { left: 0, top: 0, right: 1440, bottom: 900 };

    expect(ringPlacement(0, 0.74, VIEWPORT, [wall])).toBeNull();
  });

  it('counts the width of the text, not just the point it hangs from', () => {
    // A panel the anchor clears by 40px but the text does not.
    const justRight: ReservedBox = { left: 1150, top: 400, right: 1440, bottom: 500 };

    const placed = ringPlacement(0, 0.74, VIEWPORT, [justRight]);

    expect(placed!.angle).not.toBeCloseTo(0);
  });

  it('fits a frame held upright, where sizing against the height alone would miss it entirely', () => {
    const phone = { width: 390, height: 844 };

    const right = ringPlacement(0, 0.74, phone);
    const up = ringPlacement(Math.PI / 2, 0.74, phone);

    expect(Math.abs(right!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(up!.y)).toBeLessThanOrEqual(1);
    // Still a circle: the same number of pixels out, whichever way it is measured.
    expect(Math.abs(right!.x) * (phone.width / 2)).toBeCloseTo(Math.abs(up!.y) * (phone.height / 2), 0);
  });

  it('survives a viewport with no height rather than dividing by it', () => {
    expect(ringPlacement(0, 0.74, { width: 0, height: 0 })).not.toBeNull();
  });
});
