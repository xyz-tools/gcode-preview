import { Units } from './units';

/**
 * Represents the current state of the print job
 * @remarks
 * Tracks the current position, extrusion state, active tool, and units
 */
export class State {
  /** Current X position in millimeters, or `undefined` until the axis is homed (G28) */
  x: number | undefined = undefined;
  /** Current Y position in millimeters, or `undefined` until the axis is homed (G28) */
  y: number | undefined = undefined;
  /** Current Z position in millimeters, or `undefined` until the axis is homed (G28) */
  z: number | undefined = undefined;
  /** Current extruder position in millimeters, tracked by `applyExtrusion` and reset by G92 */
  e = 0;
  /**
   * Whether E parameters are relative distances (M83) rather than absolute
   * extruder positions (M82).
   * @remarks
   * Defaults to absolute, matching every major firmware (Marlin, Klipper,
   * RepRapFirmware, Smoothieware). A file that uses relative E without saying so reads as one long
   * retraction and renders as travel moves only. Slicers always emit M82 or
   * M83, so that only affects hand-written gcode -- and guessing the other
   * way would misread the declared-absolute files this exists to get right.
   */
  relativeExtrusion = false;
  /**
   * Shift between the logical G-code coordinates and the physical position,
   * created by G92: `physical = logical + positionShift`.
   * @remarks
   * G92 gives the current position new coordinates without moving the
   * printhead. The state keeps tracking the physical position in `x`/`y`/`z`,
   * so move handlers add this shift to incoming X/Y/Z parameters to translate
   * them back into physical space. Mirrors Marlin's `position_shift`, and is
   * kept separate from future home offsets (M206/M428) so the two can compose.
   * E is deliberately not part of the shift: as in Marlin, `G92 E` sets the
   * extruder position (`e`) directly.
   */
  positionShift = { x: 0, y: 0, z: 0 };
  /** Currently active tool */
  tool = 0;
  /**
   * Width of extruded material, in millimeters, for paths created from here
   * on, or `undefined` until slicer metadata announces one.
   * @remarks
   * Fed by `;WIDTH:` comments (PrusaSlicer family) via the slicer metadata
   * pipeline (see `Job.beginCommand`). Paths created while this is
   * `undefined` carry no width of their own and fall back at render time to
   * the global setting, then to the built-in 0.6.
   */
  extrusionWidth: number | undefined = undefined;
  /**
   * Height of the extruded line, in millimeters, for paths created from here
   * on, or `undefined` until slicer metadata announces one.
   * @remarks
   * Fed by `;HEIGHT:` comments (PrusaSlicer family), which vary throughout a
   * print when adaptive layer height is enabled. Paths created while this is
   * `undefined` carry no height of their own and fall back at render time to
   * the global setting, then to the built-in 0.2.
   */
  lineHeight: number | undefined = undefined;
  /** Current units (millimeters or inches) */
  units: Units = 'mm';
  /**
   * Whether the axes have been homed (G28).
   * @remarks
   * Until an axis is homed its real position is unknown, which is why `x`/`y`/`z`
   * can be `undefined`. Consumers can read this flag to tell real coordinates
   * from ones a renderer may have assumed. How to render an un-homed position is
   * the job's decision (see `Job.resolvePosition`), not the state's.
   */
  isHomed = false;

  /**
   * Applies a move's E parameter to the extruder position
   * @param e - The move's E parameter, or undefined when the move has none
   * @returns The filament length this move extrudes (negative for retractions)
   * @remarks
   * In relative mode (M83) the parameter is the extruded length itself; in
   * absolute mode (M82) the length is the difference with the tracked
   * position. Both modes leave `e` at the move's resulting extruder position,
   * so G92 E resets (which set `e` directly) compose naturally with either.
   */
  applyExtrusion(e: number | undefined): number {
    if (e === undefined) return 0;
    if (this.relativeExtrusion) {
      this.e += e;
      return e;
    }
    const delta = e - this.e;
    this.e = e;
    return delta;
  }

  /**
   * Gets a new State instance with default initial values
   * @returns New State with an un-homed (unknown) position, e=0, tool=0, units='mm'
   */
  static get initial(): State {
    return new State();
  }
}
