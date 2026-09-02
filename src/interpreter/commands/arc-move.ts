import { PathType } from '../../path';
import { ArcTessellator, ArcTessellatorOptions } from '../../arc-tessellator';
import type { CommandHandler } from '../../interpreter';

/**
 * Builds an arc move handler (G2/G3) around its own tessellator
 * @param options - Tessellation options, e.g. a custom chord tolerance
 * @returns A handler executing arc moves with the configured tessellator
 * @remarks
 * The handler covers both clockwise (G2) and counter-clockwise (G3) arc
 * moves. The arc math itself lives in ArcTessellator; the handler routes the
 * resulting points into the current path and updates the job state.
 * G2 is for clockwise arcs, G3 is for counter-clockwise arcs.
 */
export const makeArcMove = (options: ArcTessellatorOptions = {}): CommandHandler => {
  const arcTessellator = new ArcTessellator(options);
  return (command, job) => {
    const { x, y, z, e, i, j, r } = command.params;
    const { state } = job;
    // Starting position for the arc, with any un-homed axis assumed at the origin.
    const from = job.resolvePosition();

    const cw = command.gcode === 'g2';
    let currentPath = job.inprogressPath;
    // `e > 0`, matching g0/g1: a negative E is a retraction, i.e. a travel move with no
    // material laid down. The looser `e ?` used to misclassify a retracting arc as
    // Extrusion, so it rendered as deposited filament and stretched the bounding box.
    const pathType = e > 0 ? PathType.Extrusion : PathType.Travel;

    if (currentPath === undefined || currentPath.travelType !== pathType) {
      currentPath = job.breakPath(pathType);
    }

    if (e > 0) {
      job.stats.extrusionDistance += e;
    }

    // The tessellator runs on the resolved position and emits every point,
    // ending with the exact endpoint -- which equals resolvePosition() after
    // the state update below, so no separate endpoint emission is needed.
    arcTessellator.tessellate(
      from,
      { cw, x, y, z, i, j, r },
      (px, py, pz) => {
        currentPath.addPoint(px, py, pz);
        if (pathType === PathType.Extrusion) {
          job.boundingBox.update(px, py, pz);
        }
      },
      state.units
    );

    // `??` not `||`: an arc ending on X0, Y0 or Z0 used to silently keep the previous
    // coordinate. Safe now that the parser drops non-finite params -- `||` was also
    // rejecting NaN here by accident, which `??` does not do. An axis the command
    // omits keeps its previous (possibly unknown) value, preserving isHomed semantics.
    state.x = x ?? state.x;
    state.y = y ?? state.y;
    state.z = z ?? state.z;
  };
};

/** Executes an arc move command (G2/G3) with the default chord tolerance */
export const arcMove: CommandHandler = makeArcMove();
