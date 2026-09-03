import { PathType } from '../../path';
import type { CommandHandler } from '../../interpreter';

/**
 * Executes a linear move command (G0/G1)
 * @param command - GCodeCommand containing move parameters
 * @param job - Job instance to update
 * @remarks
 * Handles both rapid moves (G0) and linear moves (G1). Updates the job state
 * and adds points to the current path based on the command parameters.
 * G0 is for rapid moves (non-extrusion), G1 is for linear moves (with optional extrusion).
 */
export const linearMove: CommandHandler = (command, job) => {
  const { x, y, z, e, f } = command.params;

  // discard zero length moves
  if (x === undefined && y === undefined && z === undefined) {
    if (e > 0) {
      job.stats.retractions++;
    } else if (e < 0) {
      job.stats.deretractions++;
    } else if (f !== undefined) {
      job.stats.feedrateChanges++;
    } else {
      job.stats.others++;
    }

    return;
  }

  job.stats.points++;

  const { state } = job;
  let currentPath = job.inprogressPath;
  const pathType = e > 0 ? PathType.Extrusion : PathType.Travel;

  if (currentPath === undefined || currentPath.travelType !== pathType) {
    currentPath = job.breakPath(pathType);
  }

  if (e > 0) {
    job.stats.extrusionDistance += e;
  }

  // e is omitted bc currently we're assuming relative extrusion distances
  // see also https://github.com/xyz-tools/gcode-preview/issues/179
  state.x = x === undefined ? state.x : x + state.positionShift.x;
  state.y = y === undefined ? state.y : y + state.positionShift.y;
  state.z = z === undefined ? state.z : z + state.positionShift.z;

  const pos = job.resolvePosition();
  currentPath.addPoint(pos.x, pos.y, pos.z);
  if (pathType === PathType.Extrusion) {
    job.boundingBox.update(pos.x, pos.y, pos.z);
  }
};
