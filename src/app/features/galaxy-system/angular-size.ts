/**
 * How a size in pixels becomes a size the scene can draw.
 *
 * Sprites in this view are sized angularly rather than in world units, so a star holds the same
 * share of the screen however far away it is and whatever the window is doing. Pixels are what
 * the figures are chosen in, though — "a star is between one and a half and six pixels across"
 * is a statement someone can check by looking — so the two are related through a reference
 * viewport and field of view, and the pixel figures are exact only at that height.
 *
 * Shared rather than restated per renderer: the star field and the rings drawn over it have to
 * agree, or a ring sits a little wide of the star it belongs to at some window sizes and not at
 * others.
 */

export const REFERENCE_VIEWPORT_HEIGHT_PX = 900;
export const REFERENCE_FOV_DEGREES = 55;

/** Multiply a size in reference pixels by this to get the angular size the material wants. */
export const PIXELS_TO_ANGULAR_SIZE = (2 * Math.tan((REFERENCE_FOV_DEGREES * Math.PI) / 180 / 2)) / REFERENCE_VIEWPORT_HEIGHT_PX;
