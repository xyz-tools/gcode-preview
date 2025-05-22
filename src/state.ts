/**
 * Represents the current state of the print job
 * @remarks
 * Tracks the current position, extrusion state, active tool, and units
 */
export class State {
  /** Current X position */
  x: number;
  /** Current Y position */
  y: number;
  /** Current Z position */
  z: number;
  /** Current extrusion amount */
  e: number;
  /** Currently active tool */
  tool: number;
  /** Current units (millimeters or inches) */
  units: 'mm' | 'in';

  /**
   * Gets a new State instance with default initial values
   * @returns New State instance with x=0, y=0, z=0, e=0, tool=0, units='mm'
   */
  static get initial(): State {
    const state = new State();
    Object.assign(state, { x: 0, y: 0, z: 0, e: 0, tool: 0, units: 'mm' });
    return state;
  }
}
