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
  const { state } = job;

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

    // still account the E parameter: in absolute mode a retract/prime pair
    // moves the extruder position, and losing it here would misattribute the
    // difference to the next extruding move
    state.applyExtrusion(e);
    return;
  }

  job.stats.points++;

  // Classified from the length actually extruded, not the raw E parameter: in
  // absolute mode a wipe or retract can move in X/Y while E decreases, which
  // still reads as a positive parameter but lays down no material.
  // see also https://github.com/xyz-tools/gcode-preview/issues/179
  const extruded = state.applyExtrusion(e);
  const pathType = extruded > 0 ? PathType.Extrusion : PathType.Travel;
  const currentPath = job.continuePath(pathType);

  if (extruded > 0) {
    job.stats.extrusionDistance += extruded;
  }

  if (state.positioning === 'relative') {
    state.moveBy(x, y, z);
  } else {
    state.moveTo(x, y, z);
  }

  const pos = job.resolvePosition();
  currentPath.addPoint(pos.x, pos.y, pos.z);
  if (pathType === PathType.Extrusion) {
    job.boundingBox.update(pos.x, pos.y, pos.z);
  }
};
