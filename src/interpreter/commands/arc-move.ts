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
    // applyExtrusion keeps the extruder position in sync for the moves that follow; the
    // arc itself derives no dimensions (Cura only emits arcs via plugins) and
    // simply carries the state's current width and height like any move.
    // Classified from the extruded length, matching g0/g1: a retraction -- or an
    // absolute-mode E that decreases -- is a travel move with no material laid
    // down, and used to render as deposited filament and stretch the bounding box.
    const extruded = state.applyExtrusion(e);
    const pathType = extruded > 0 ? PathType.Extrusion : PathType.Travel;
    const currentPath = job.continuePath(pathType);

    if (extruded > 0) {
      job.stats.extrusionDistance += extruded;
    }

    // Start the path before moving the state so it retains the arc's origin.
    // Only absolute endpoints receive the G92 shift; I/J/R remain offsets.
    if (state.positioning === 'relative') {
      state.moveBy(x, y, z);
    } else {
      state.moveTo(x, y, z);
    }

    // The tessellator emits the exact endpoint; omitted axes retain their
    // previous (possibly unknown) coordinates in the state.
    arcTessellator.tessellate(
      from,
      { cw, x: state.x, y: state.y, z: state.z, i, j, r },
      (px, py, pz) => {
        currentPath.addPoint(px, py, pz);
        if (pathType === PathType.Extrusion) {
          job.boundingBox.update(px, py, pz);
        }
      },
      state.units
    );
  };
};

/** Executes an arc move command (G2/G3) with the default chord tolerance */
export const arcMove: CommandHandler = makeArcMove();
