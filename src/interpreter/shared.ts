import { Path, PathType } from '../path';
import { GCodeCommand } from '../parser/gcode-parser';
import { Job } from '../job';
import { State } from '../state';

/**
 * Counters the command handlers report into while executing a job
 *
 * @remarks
 * Implemented by the `Interpreter`, which passes itself to every handler.
 */
// TODO: maybe these props should move to the Job class
export interface InterpreterContext {
  retractions: number;
  deretractions: number;
  feedrateChanges: number;
  others: number;
  /** for reference, how many points were added to the job */
  points: number;
  extrusionDistance: number;
}

/**
 * Executes a single G-code command against a job
 * @param command - GCodeCommand to execute
 * @param job - Job instance to update
 * @param context - Interpreter context to report counters into
 */
export type CommandHandler = (command: GCodeCommand, job: Job, context: InterpreterContext) => void;

/**
 * Resolves a state's position for rendering.
 * @param state - Current job state
 * @returns The position as concrete `x`, `y`, `z` numbers
 * @remarks
 * An axis that has not been homed has an unknown (`undefined`) position. The
 * interpreter chooses to assume the origin (`0`) for such axes so the viewer can
 * still render best-effort (see #361); `state.isHomed` lets a consumer tell these
 * assumed coordinates from real ones.
 */
export function resolvePosition(state: State): { x: number; y: number; z: number } {
  return { x: state.x ?? 0, y: state.y ?? 0, z: state.z ?? 0 };
}

/**
 * Creates a new path and sets it as the current in-progress path
 * @param job - Job instance to update
 * @param newType - Type of the new path
 * @returns The newly created path
 * @remarks
 * This function is called when a path type change is detected (e.g. switching
 * between travel and extrusion moves). It finalizes the current path and
 * starts a new one of the specified type.
 */
export function breakPath(job: Job, newType: PathType): Path {
  job.finishPath();
  const currentPath = new Path(newType, 0.6, 0.2, job.state.tool);
  const pos = resolvePosition(job.state);
  currentPath.addPoint(pos.x, pos.y, pos.z);
  job.inprogressPath = currentPath;
  return currentPath;
}
