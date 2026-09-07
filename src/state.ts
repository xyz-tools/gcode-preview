import { Units } from './units';

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
   * Gets a new State instance with default initial values
   * @returns New State with an un-homed (unknown) position, e=0, tool=0, units='mm'
   */
  static get initial(): State {
    return new State();
  }
}
