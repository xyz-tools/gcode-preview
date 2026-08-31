import { PathType } from '../../path';
import { CommandHandler, breakPath, resolvePosition } from '../shared';

/**
 * Executes an arc move command (G2/G3)
 * @param command - GCodeCommand containing arc parameters
 * @param job - Job instance to update
 * @param context - Interpreter context to report counters into
 * @remarks
 * Handles both clockwise (G2) and counter-clockwise (G3) arc moves. Supports
 * both I/J center offset and R radius modes. Calculates intermediate points
 * along the arc and updates the job state accordingly.
 * G2 is for clockwise arcs, G3 is for counter-clockwise arcs.
 */
export const arcMove: CommandHandler = (command, job, context) => {
  const { x, y, z, e } = command.params;
  let { i, j, r } = command.params;
  // Set when the arc cannot be described at all, so only the endpoint is emitted.
  let arcIsDegenerate = false;
  const { state } = job;
  // Starting position for the arc, with any un-homed axis assumed at the origin.
  const from = resolvePosition(state);

  const cw = command.gcode === 'g2';
  let currentPath = job.inprogressPath;
  // `e > 0`, matching g0/g1: a negative E is a retraction, i.e. a travel move with no
  // material laid down. The looser `e ?` used to misclassify a retracting arc as
  // Extrusion, so it rendered as deposited filament and stretched the bounding box.
  const pathType = e > 0 ? PathType.Extrusion : PathType.Travel;

  if (currentPath === undefined || currentPath.travelType !== pathType) {
    currentPath = breakPath(job, pathType);
  }

  if (e > 0) {
    context.extrusionDistance += e;
  }

  if (r) {
    // in r mode a minimum radius will be applied if the distance can otherwise not be bridged
    const deltaX = x - from.x; // assume abs mode
    const deltaY = y - from.y;

    // apply a minimal radius to bridge the distance
    const minR = Math.sqrt(Math.pow(deltaX / 2, 2) + Math.pow(deltaY / 2, 2));
    r = Math.max(r, minR);

    const dSquared = Math.pow(deltaX, 2) + Math.pow(deltaY, 2);
    const hSquared = Math.pow(r, 2) - dSquared / 4;

    // R mode cannot describe a whole circle: with start == end the centre is
    // undefined, and hSquared / dSquared divides by zero, which used to make i/j NaN
    // and poison every derived value. Skip the arc and move straight to the endpoint.
    // (hSquared < 0 needs no guard: r was just clamped to minR, so it cannot go
    // negative.) This replaces the guard that was commented out here.
    if (dSquared === 0) {
      arcIsDegenerate = true;
    } else {
      let hDivD = Math.sqrt(hSquared / dSquared);

      // Ref RRF DoArcMove for details
      if ((cw && r < 0.0) || (!cw && r > 0.0)) {
        hDivD = -hDivD;
      }
      i = deltaX / 2 + deltaY * hDivD;
      j = deltaY / 2 - deltaX * hDivD;
    }
  }

  const wholeCircle = from.x == x && from.y == y;
  const centerX = from.x + i;
  const centerY = from.y + j;

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

  // target - current. This was the other way round, so a helical arc climbing
  // Z1 -> Z3 walked its intermediate points down to Z-0.97 and only landed on Z3 at
  // the endpoint, leaving a visible spike in the rendered path.
  //
  // `??` not `||`: Z0 is a legitimate target, and `|| state.z` turned a descent to
  // Z0 into a flat arc at the old height. This matches the endpoint assignment
  // below, and is only safe because the parser now drops non-finite params -- `||`
  // was rejecting NaN here by accident, and `??` does not.
  const zDist = (z ?? from.z) - from.z;
  const zStep = zDist / totalSegments;

  // get points for the arc
  let px = from.x;
  let py = from.y;
  let pz = from.z;
  // calculate segments
  let currentAngle = arcCurrentAngle;

  // A degenerate arc leaves totalSegments non-finite even though every param was
  // finite: an R-mode whole circle divides by dSquared === 0, and offsets near
  // Number.MAX_VALUE overflow arcRadius. NaN already skipped the loop (NaN - 1
  // fails the condition), but Infinity ran until the vertex array hit its length
  // limit and threw, aborting the whole job. Emit no intermediate points in either
  // case and fall through to the endpoint below.
  if (!arcIsDegenerate && Number.isFinite(totalSegments)) {
    for (let moveIdx = 0; moveIdx < totalSegments - 1; moveIdx++) {
      currentAngle += arcAngleIncrement;
      px = centerX + arcRadius * Math.cos(currentAngle);
      py = centerY + arcRadius * Math.sin(currentAngle);
      pz += zStep;
      currentPath.addPoint(px, py, pz);
      if (pathType === PathType.Extrusion) {
        job.boundingBox.update(px, py, pz);
      }
    }
  }

  // `??` not `||`: an arc ending on X0, Y0 or Z0 used to silently keep the previous
  // coordinate. Safe now that the parser drops non-finite params -- `||` was also
  // rejecting NaN here by accident, which `??` does not do.
  state.x = x ?? state.x;
  state.y = y ?? state.y;
  state.z = z ?? state.z;

  const pos = resolvePosition(state);
  currentPath.addPoint(pos.x, pos.y, pos.z);
  if (pathType === PathType.Extrusion) {
    job.boundingBox.update(pos.x, pos.y, pos.z);
  }
};
