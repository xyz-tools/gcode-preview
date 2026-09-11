/** Units a G-code file can select with G20 (inches) or G21 (millimeters) */
export type Units = 'mm' | 'in';

/** Millimeters per inch, for converting values from inch-based G-code */
export const MM_PER_INCH = 25.4;

/**
 * Converts a command distance to millimeters
 * @param value - A distance in the current units, or `undefined` when the command omits the word
 * @param units - The units the value is expressed in
 * @returns The distance in millimeters, or `undefined` for an omitted word
 * @remarks
 * Everything downstream of the interpreter works in millimeters; converting at
 * the command boundary keeps inch files (G20) from leaking their units into
 * the state, the paths or the rendered geometry.
 */
export function toMillimeters(value: number | undefined, units: Units): number | undefined {
  return value === undefined ? undefined : value * (units === 'in' ? MM_PER_INCH : 1);
}
