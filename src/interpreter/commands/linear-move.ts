import { PathType } from '../../path';
import { CommandHandler, breakPath, resolvePosition } from '../shared';

/**
 * Executes a linear move command (G0/G1)
 * @param command - GCodeCommand containing move parameters
 * @param job - Job instance to update
 * @param context - Interpreter context to report counters into
 * @remarks
 * Handles both rapid moves (G0) and linear moves (G1). Updates the job state
 * and adds points to the current path based on the command parameters.
 * G0 is for rapid moves (non-extrusion), G1 is for linear moves (with optional extrusion).
 */
export const linearMove: CommandHandler = (command, job, context) => {
  const { x, y, z, e, f } = command.params;

  // discard zero length moves
  if (x === undefined && y === undefined && z === undefined) {
    if (e > 0) {
      context.retractions++;
    } else if (e < 0) {
      context.deretractions++;
    } else if (f !== undefined) {
      context.feedrateChanges++;
    } else {
      context.others++;
    }

    return;
  }

  context.points++;

  const { state } = job;
  let currentPath = job.inprogressPath;
  const pathType = e > 0 ? PathType.Extrusion : PathType.Travel;

  if (currentPath === undefined || currentPath.travelType !== pathType) {
    currentPath = breakPath(job, pathType);
  }

  if (e > 0) {
    context.extrusionDistance += e;
  }

  // e is omitted bc currently we're assuming relative extrusion distances
  // see also https://github.com/xyz-tools/gcode-preview/issues/179
  state.x = x ?? state.x;
  state.y = y ?? state.y;
  state.z = z ?? state.z;

  const pos = resolvePosition(state);
  currentPath.addPoint(pos.x, pos.y, pos.z);
  if (pathType === PathType.Extrusion) {
    job.boundingBox.update(pos.x, pos.y, pos.z);
  }
};
