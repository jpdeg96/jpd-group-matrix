/**
 * Chart palette.
 *
 * Validated with the data-viz validator against this application's three real
 * surfaces — white, the dark slate `#191d24`, and the blossom near-white
 * `#fffcfe`. All six categorical slots pass the lightness band, chroma floor,
 * CVD separation (worst adjacent ΔE 9.1 light / 8.4 dark) and normal-vision
 * floor (19.6 / 19.3) in every mode.
 *
 * Light and blossom carry a contrast WARN on three slots (aqua, yellow,
 * magenta sit below 3:1 on a near-white surface). The relief rule therefore
 * applies and is honoured: every categorical chart ships visible labels AND a
 * table view, so colour never carries a value on its own.
 *
 * Slots are assigned in fixed order and never cycled. Past six categories the
 * tail folds into "Other" rather than growing new hues.
 */

export const CATEGORICAL_LIGHT = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
] as const;

export const CATEGORICAL_DARK = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
] as const;

/** Everything past the last slot folds into this, never a generated hue. */
export const OTHER_LIGHT = "#898781";
export const OTHER_DARK = "#898781";

export const MAX_SLICES = CATEGORICAL_LIGHT.length;

/** Single-series magnitude hue. One colour for every bar — never a value ramp. */
export const SEQUENTIAL_LIGHT = "#2a78d6";
export const SEQUENTIAL_DARK = "#3987e5";

/** Second sequential context (hours), so it reads as a different measure. */
export const SEQUENTIAL_ALT_LIGHT = "#eb6834";
export const SEQUENTIAL_ALT_DARK = "#d95926";

export function categoricalColor(slot: number, dark: boolean): string {
  const palette = dark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
  return slot < palette.length
    ? palette[slot]!
    : dark
      ? OTHER_DARK
      : OTHER_LIGHT;
}
