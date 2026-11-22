import type { CommandOf } from 'gcode-ast';
import type { Job } from '../../job';

/**
 * Executes an M82 command, switching E parameters to absolute positions
 * @param _command - The typed M82 node, unused: the code is the whole message
 * @param job - Job instance to update
 * @remarks
 * Only the E accounting (`State.applyExtrusion`) consults the mode; whether a move
 * extrudes is still classified from the raw E parameter. Cura emits M82 or
 * M83 right after its start gcode, which is what keeps the volumetric
 * dimension derivation's extruded lengths correct in either mode.
 */
export const setAbsoluteExtrusion = (_command: CommandOf<'M82'>, job: Job): void => {
  job.state.relativeExtrusion = false;
};

/**
 * Executes an M83 command, switching E parameters to relative distances
 * @param _command - The typed M83 node, unused: the code is the whole message
 * @param job - Job instance to update
 */
export const setRelativeExtrusion = (_command: CommandOf<'M83'>, job: Job): void => {
  job.state.relativeExtrusion = true;
};
