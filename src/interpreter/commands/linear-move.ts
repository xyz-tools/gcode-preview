import { PathType } from '../../path';
import type { CommandHandler } from '../../interpreter';
import { resolvePosition } from './resolve-position';

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

  // The move's physical endpoint; an omitted axis keeps its current
  // (possibly unknown) position. Resolved before touching the state so the
  // dimension derivation below still sees the segment's starting point.
  const targetX = x === undefined ? state.x : x + state.positionShift.x;
  const targetY = y === undefined ? state.y : y + state.positionShift.y;
  const targetZ = z === undefined ? state.z : z + state.positionShift.z;

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
  
  const relative = state.positioning === 'relative';
  state.x = resolvePosition(x, state.x, relative);
  state.y = resolvePosition(y, state.y, relative);
  state.z = resolvePosition(z, state.z, relative);

  const pos = job.resolvePosition();
  currentPath.addPoint(pos.x, pos.y, pos.z);
  if (pathType === PathType.Extrusion) {
    job.boundingBox.update(pos.x, pos.y, pos.z);
  }
};
