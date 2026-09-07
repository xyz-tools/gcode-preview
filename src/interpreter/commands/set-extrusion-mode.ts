import type { CommandHandler } from '../../interpreter';

/**
 * Executes an M82 command, switching E parameters to absolute positions
 * @param _command - GCodeCommand (no parameters used)
 * @param job - Job instance to update
 * @remarks
 * Only the E accounting (`State.trackE`) consults the mode; whether a move
 * extrudes is still classified from the raw E parameter. Cura emits M82 or
 * M83 right after its start gcode, which is what keeps the volumetric
 * dimension derivation's extruded lengths correct in either mode.
 */
export const setAbsoluteExtrusion: CommandHandler = (_command, job) => {
  job.state.relativeExtrusion = false;
};

/**
 * Executes an M83 command, switching E parameters to relative distances
 * @param _command - GCodeCommand (no parameters used)
 * @param job - Job instance to update
 */
export const setRelativeExtrusion: CommandHandler = (_command, job) => {
  job.state.relativeExtrusion = true;
};
