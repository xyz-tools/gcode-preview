/**
 * Resolves a move parameter to a target coordinate
 * @param value - Coordinate from the command, or `undefined` when the axis is omitted
 * @param current - Current position of the axis
 * @param relative - Whether relative positioning (G91) is active
 * @returns The target coordinate for the axis
 * @remarks
 * An omitted axis keeps its current position. In relative mode the value is an
 * offset from the current position; in absolute mode it is the target itself.
 */
export function resolvePosition(value: number | undefined, current: number, relative: boolean): number {
  if (value === undefined) {
    return current;
  }
  return relative ? current + value : value;
}
