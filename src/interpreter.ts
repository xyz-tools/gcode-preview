import { Path, PathType } from './path';
import { GCodeCommand } from './gcode-parser';
import { Job } from './job';

/**
 * Interprets and executes G-code commands, updating the job state accordingly
 *
 * @remarks
 * This class handles the execution of G-code commands, translating them into
 * movements and state changes in the print job. It supports common G-code commands
 * including linear moves (G0/G1), arcs (G2/G3), unit changes (G20/G21), and tool selection.
 */
export class Interpreter {
  // eslint-disable-next-line no-unused-vars
  [key: string]: (...args: unknown[]) => unknown;

  /**
   * Executes an array of G-code commands, updating the provided job
   * @param commands - Array of GCodeCommand objects to execute
   * @param job - Job instance to update (default: new Job)
   * @returns The updated job instance
   */
  execute(commands: GCodeCommand[], job = new Job()): Job {
    job.resumeLastPath();
    commands.forEach((command) => {
      if (command.gcode !== undefined) {
        if (this[command.gcode] === undefined) {
          return;
        }
        this[command.gcode](command, job);
      }
    });
    job.finishPath();

    return job;
  }

  /**
   * Executes a G0/G1 linear move command
   * @param command - GCodeCommand containing move parameters
   * @param job - Job instance to update
   * @remarks
   * Handles both rapid moves (G0) and linear moves (G1). Updates the job state
   * and adds points to the current path based on the command parameters.
   */
  g0(command: GCodeCommand, job: Job): void {
    const { x, y, z, e } = command.params;
    const { state } = job;

    let currentPath = job.inprogressPath;
    const pathType = e > 0 ? PathType.Extrusion : PathType.Travel;

    if (currentPath === undefined || currentPath.travelType !== pathType) {
      currentPath = this.breakPath(job, pathType);
    }

    state.x = x ?? state.x;
    state.y = y ?? state.y;
    state.z = z ?? state.z;

    currentPath.addPoint(state.x, state.y, state.z);
  }

  g1 = this.g0;

  /**
   * Executes a G2/G3 arc move command
   * @param command - GCodeCommand containing arc parameters
   * @param job - Job instance to update
   * @remarks
   * Handles both clockwise (G2) and counter-clockwise (G3) arc moves. Supports
   * both I/J center offset and R radius modes. Calculates intermediate points
   * along the arc and updates the job state accordingly.
   */
  g2(command: GCodeCommand, job: Job): void {
    const { x, y, z, e } = command.params;
    let { i, j, r } = command.params;
    const { state } = job;

    const cw = command.gcode === 'g2';
    let currentPath = job.inprogressPath;
    const pathType = e ? PathType.Extrusion : PathType.Travel;

    if (currentPath === undefined || currentPath.travelType !== pathType) {
      currentPath = this.breakPath(job, pathType);
    }

    if (r) {
      // in r mode a minimum radius will be applied if the distance can otherwise not be bridged
      const deltaX = x - state.x; // assume abs mode
      const deltaY = y - state.y;

      // apply a minimal radius to bridge the distance
      const minR = Math.sqrt(Math.pow(deltaX / 2, 2) + Math.pow(deltaY / 2, 2));
      r = Math.max(r, minR);

      const dSquared = Math.pow(deltaX, 2) + Math.pow(deltaY, 2);
      const hSquared = Math.pow(r, 2) - dSquared / 4;
      // if (dSquared == 0 || hSquared < 0) {
      //   return { position: { x: x, y: z, z: y }, points: [] }; //we'll abort the render and move te position to the new position.
      // }
      let hDivD = Math.sqrt(hSquared / dSquared);

      // Ref RRF DoArcMove for details
      if ((cw && r < 0.0) || (!cw && r > 0.0)) {
        hDivD = -hDivD;
      }
      i = deltaX / 2 + deltaY * hDivD;
      j = deltaY / 2 - deltaX * hDivD;
      // } else {
      //     //the radial point is an offset from the current position
      //     ///Need at least on point
      //     if (i == 0 && j == 0) {
      //         return { position: { x: x, y: y, z: z }, points: [] }; //we'll abort the render and move te position to the new position.
      //     }
    }

    const wholeCircle = state.x == x && state.y == y;
    const centerX = state.x + i;
    const centerY = state.y + j;

    const arcRadius = Math.sqrt(i * i + j * j);
    const arcCurrentAngle = Math.atan2(-j, -i);
    const finalTheta = Math.atan2(y - centerY, x - centerX);

    let totalArc;
    if (wholeCircle) {
      totalArc = 2 * Math.PI;
    } else {
      totalArc = cw ? arcCurrentAngle - finalTheta : finalTheta - arcCurrentAngle;
      if (totalArc < 0.0) {
        totalArc += 2 * Math.PI;
      }
    }
    let totalSegments = (arcRadius * totalArc) / 0.5;
    if (state.units == 'in') {
      totalSegments *= 25;
    }
    if (totalSegments < 1) {
      totalSegments = 1;
    }
    let arcAngleIncrement = totalArc / totalSegments;
    arcAngleIncrement *= cw ? -1 : 1;

    const zDist = state.z - (z || state.z);
    const zStep = zDist / totalSegments;

    // get points for the arc
    let px = state.x;
    let py = state.y;
    let pz = state.z;
    // calculate segments
    let currentAngle = arcCurrentAngle;

    for (let moveIdx = 0; moveIdx < totalSegments - 1; moveIdx++) {
      currentAngle += arcAngleIncrement;
      px = centerX + arcRadius * Math.cos(currentAngle);
      py = centerY + arcRadius * Math.sin(currentAngle);
      pz += zStep;
      currentPath.addPoint(px, py, pz);
    }

    state.x = x || state.x;
    state.y = y || state.y;
    state.z = z || state.z;

    currentPath.addPoint(state.x, state.y, state.z);
  }

  g3 = this.g2;

  /**
   * Executes a G20 command to set units to inches
   * @param command - GCodeCommand containing the command
   * @param job - Job instance to update
   */
  g20(command: GCodeCommand, job: Job): void {
    job.state.units = 'in';
  }

  /**
   * Executes a G21 command to set units to millimeters
   * @param command - GCodeCommand containing the command
   * @param job - Job instance to update
   */
  g21(command: GCodeCommand, job: Job): void {
    job.state.units = 'mm';
  }

  /**
   * Executes a G28 homing command
   * @param command - GCodeCommand containing the command
   * @param job - Job instance to update
   * @remarks
   * Moves all axes to their home positions (0,0,0) and updates the job state.
   */
  g28(command: GCodeCommand, job: Job): void {
    job.state.x = 0;
    job.state.y = 0;
    job.state.z = 0;
  }

  /**
   * Executes a T0 command to select tool 0
   * @param command - GCodeCommand containing the command
   * @param job - Job instance to update
   */
  t0(command: GCodeCommand, job: Job): void {
    job.state.tool = 0;
  }
  /**
   * Executes a T1 command to select tool 1
   * @param command - GCodeCommand containing the command
   * @param job - Job instance to update
   */
  t1(command: GCodeCommand, job: Job): void {
    job.state.tool = 1;
  }
  /**
   * Executes a T2 command to select tool 2
   * @param command - GCodeCommand containing the command
   * @param job - Job instance to update
   */
  t2(command: GCodeCommand, job: Job): void {
    job.state.tool = 2;
  }
  /**
   * Executes a T3 command to select tool 3
   * @param command - GCodeCommand containing the command
   * @param job - Job instance to update
   */
  t3(command: GCodeCommand, job: Job): void {
    job.state.tool = 3;
  }
  /**
   * Executes a T4 command to select tool 4
   * @param command - GCodeCommand containing the command
   * @param job - Job instance to update
   */
  t4(command: GCodeCommand, job: Job): void {
    job.state.tool = 4;
  }
  /**
   * Executes a T5 command to select tool 5
   * @param command - GCodeCommand containing the command
   * @param job - Job instance to update
   */
  t5(command: GCodeCommand, job: Job): void {
    job.state.tool = 5;
  }
  /**
   * Executes a T6 command to select tool 6
   * @param command - GCodeCommand containing the command
   * @param job - Job instance to update
   */
  t6(command: GCodeCommand, job: Job): void {
    job.state.tool = 6;
  }
  /**
   * Executes a T7 command to select tool 7
   * @param command - GCodeCommand containing the command
   * @param job - Job instance to update
   */
  t7(command: GCodeCommand, job: Job): void {
    job.state.tool = 7;
  }

  /**
   * Creates a new path and sets it as the current in-progress path
   * @param job - Job instance to update
   * @param newType - Type of the new path
   * @returns The newly created path
   * @remarks
   * This method is called when a path type change is detected (e.g. switching
   * between travel and extrusion moves). It finalizes the current path and
   * starts a new one of the specified type.
   */
  private breakPath(job: Job, newType: PathType): Path {
    job.finishPath();
    const currentPath = new Path(newType, 0.6, 0.2, job.state.tool);
    currentPath.addPoint(job.state.x, job.state.y, job.state.z);
    job.inprogressPath = currentPath;
    return currentPath;
  }
}
