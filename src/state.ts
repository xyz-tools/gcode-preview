/**
 * Represents the current state of the print job
 * @remarks
 * Tracks the current position, extrusion state, active tool, and units
 */
export class State {
  /** Current X position */
  x = 0;
  /** Current Y position */
  y = 0;
  /** Current Z position */
  z = 0;
  /** Current extrusion amount */
  e = 0;
  /** Currently active tool */
  tool = 0;
  /** Current units (millimeters or inches) */
  units: 'mm' | 'in' = 'mm';

  /**
   * Gets a new State instance with default initial values
   * @returns New State instance with x=0, y=0, z=0, e=0, tool=0, units='mm'
   */
  static get initial(): State {
    return new State();
  }
}
