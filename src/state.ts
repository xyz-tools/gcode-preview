/**
 * Represents the current state of the print job
 * @remarks
 * Tracks the current position, extrusion state, active tool, and units
 */
export class State {
  /** Current X position, or `undefined` until the axis is homed (G28) */
  x: number | undefined = undefined;
  /** Current Y position, or `undefined` until the axis is homed (G28) */
  y: number | undefined = undefined;
  /** Current Z position, or `undefined` until the axis is homed (G28) */
  z: number | undefined = undefined;
  /** Current extrusion amount */
  e = 0;
  /** Currently active tool */
  tool = 0;
  /** Current units (millimeters or inches) */
  units: 'mm' | 'in' = 'mm';
  /**
   * Whether the axes have been homed (G28).
   * @remarks
   * Until an axis is homed its real position is unknown. While `isHomed` is
   * `false`, {@link State.position} assumes the origin so the viewer can still
   * render best-effort (see https://github.com/xyz-tools/gcode-preview/issues/361).
   * Consumers can read this flag to tell real coordinates from assumed ones.
   */
  isHomed = false;

  /**
   * The current position, with any un-homed axis assumed to be at the origin.
   * @remarks
   * `x`/`y`/`z` are `undefined` until homed; rendering needs concrete numbers,
   * so an unknown axis falls back to `0`. Check {@link State.isHomed} to know
   * whether these coordinates are real or assumed.
   * @returns The position as concrete `x`, `y`, `z` numbers
   */
  get position(): { x: number; y: number; z: number } {
    return { x: this.x ?? 0, y: this.y ?? 0, z: this.z ?? 0 };
  }

  /**
   * Gets a new State instance with default initial values
   * @returns New State with an un-homed (unknown) position, e=0, tool=0, units='mm'
   */
  static get initial(): State {
    return new State();
  }
}
