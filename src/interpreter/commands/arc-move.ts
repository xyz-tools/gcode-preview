import { toMillimeters } from '../../units';
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
    const { state } = job;
    const { units } = state;
    const e = toMillimeters(command.params.e, units);
    const i = toMillimeters(command.params.i, units);
    const j = toMillimeters(command.params.j, units);
    const r = toMillimeters(command.params.r, units);
    // The endpoint arrives in logical coordinates; translate it into physical
    // space up front so the tessellator's derived values agree with `from`.
    // I/J/R are relative distances and need no shift.
    const { positionShift } = state;
    const x = command.params.x === undefined ? undefined : toMillimeters(command.params.x, units)! + positionShift.x;
    const y = command.params.y === undefined ? undefined : toMillimeters(command.params.y, units)! + positionShift.y;
    const z = command.params.z === undefined ? undefined : toMillimeters(command.params.z, units)! + positionShift.z;
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

    job.stats.recordExtrusion(extruded);

    // The tessellator runs on the resolved position and emits every point,
    // ending with the exact endpoint -- which equals resolvePosition() after
    // the state update below, so no separate endpoint emission is needed.
    arcTessellator.tessellate(from, { cw, x, y, z, i, j, r }, (px, py, pz) => {
      currentPath.addPoint(px, py, pz);
      if (pathType === PathType.Extrusion) {
        job.boundingBox.update(px, py, pz);
      }
    });

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
