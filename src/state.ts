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
