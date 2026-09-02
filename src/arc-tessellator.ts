import { Units, MM_PER_INCH } from './units';

/** A point along a tessellated arc, in absolute G-code coordinates */
export interface ArcPoint {
  x: number;
  y: number;
  z: number;
}

/** Describes a G2/G3 arc move relative to a known start position */
export interface ArcMove {
  /** true for clockwise arcs (G2), false for counter-clockwise arcs (G3) */
  cw: boolean;
  /** Absolute target coordinates; an omitted axis keeps its start value */
  x?: number;
  y?: number;
  z?: number;
  /** X offset from the start point to the arc center (I/J mode) */
  i?: number;
  /** Y offset from the start point to the arc center (I/J mode) */
  j?: number;
  /** Arc radius (R mode); takes precedence over i/j when non-zero */
  r?: number;
}

/** Receives each tessellated point in order, endpoint included */
// eslint-disable-next-line no-unused-vars
export type EmitPoint = (x: number, y: number, z: number) => void;

/** Options for {@link ArcTessellator} */
export interface ArcTessellatorOptions {
  /**
   * Maximum deviation, in millimeters, between the emitted chords and the true
   * arc (default 0.05). Smaller values produce smoother, heavier geometry.
   */
  chordTolerance?: number;
}

/** Max chord deviation from the true arc, in millimeters */
const DEFAULT_CHORD_TOLERANCE = 0.05;

/**
 * Cap on the angle a single segment may span (22.5 degrees, so a full circle
 * gets at least 16 segments). Below chordTolerance-sized radii the tolerance
 * alone would allow steps so coarse that small circles render as squares.
 */
const MAX_SEGMENT_ANGLE = Math.PI / 8;

/**
 * Tessellates G2/G3 arc moves into straight line segments
 *
 * @remarks
 * Downstream geometry only handles straight segments, so arcs are approximated
 * by a polyline. The segment count is chosen so the chords stay within
 * chordTolerance of the true arc: for an angular step t on a circle of radius
 * r the worst-case gap (sagitta) is r * (1 - cos(t / 2)), so the step scales
 * with the square root of the radius instead of linearly -- large arcs get far
 * fewer points than fixed-length segments would, at equal visual quality.
 * Supports both I/J center-offset mode and R radius mode, including helical
 * arcs that change Z along the way. All arc math lives here; the interpreter
 * routes the resulting points into paths and job state.
 */
export class ArcTessellator {
  private readonly chordTolerance: number;

  constructor(options: ArcTessellatorOptions = {}) {
    this.chordTolerance = options.chordTolerance ?? DEFAULT_CHORD_TOLERANCE;
  }
  /**
   * Converts an arc move into the points to draw, ending on the arc's endpoint
   * @param start - Absolute position at the start of the arc
   * @param move - Arc parameters from the G2/G3 command
   * @param emit - Called once per point, in order, endpoint last. A callback
   * instead of a returned array so arc-heavy files do not allocate a throwaway
   * point object per segment.
   * @param units - Current units; the chord tolerance is defined in
   * millimeters, so inch-based arcs are tessellated proportionally finer
   * @returns The arc's exact endpoint (also the last point emitted). Emits at
   * least the endpoint, even for degenerate arcs.
   */
  tessellate(start: ArcPoint, move: ArcMove, emit: EmitPoint, units: Units = 'mm'): ArcPoint {
    const { cw, x, y, z } = move;
    let { i, j, r } = move;
    // Set when the arc cannot be described at all, so only the endpoint is emitted.
    let arcIsDegenerate = false;

    if (r) {
      // in r mode a minimum radius will be applied if the distance can otherwise not be bridged
      const deltaX = x - start.x; // assume abs mode
      const deltaY = y - start.y;

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

        // Ref RRF DoArcMove. RRF also negates for cw arcs with a negative r
        // (the long-way-round form), but r cannot be negative here: it was just
        // clamped to minR, which is positive whenever dSquared is non-zero.
        if (!cw) {
          hDivD = -hDivD;
        }
        i = deltaX / 2 + deltaY * hDivD;
        j = deltaY / 2 - deltaX * hDivD;
      }
    }

    const wholeCircle = start.x == x && start.y == y;
    const centerX = start.x + i;
    const centerY = start.y + j;

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
    // Coarsest angular step that keeps every chord within tolerance, from
    // inverting the sagitta: t = 2 * acos(1 - tolerance / radius). The acos
    // argument is clamped to -1 for radii at or below the tolerance, where any
    // step would satisfy it and only the MAX_SEGMENT_ANGLE cap matters. A
    // non-finite radius flows through as NaN or a 0 step, making totalSegments
    // non-finite; the guard below the z handling skips the loop for those.
    const radiusMm = units == 'in' ? arcRadius * MM_PER_INCH : arcRadius;
    const maxStep = 2 * Math.acos(Math.max(1 - this.chordTolerance / radiusMm, -1));
    const step = Math.min(maxStep, MAX_SEGMENT_ANGLE);

    let totalSegments = totalArc / step;
    if (totalSegments < 1) {
      totalSegments = 1;
    }
    let arcAngleIncrement = totalArc / totalSegments;
    arcAngleIncrement *= cw ? -1 : 1;

    // target - current. This was the other way round, so a helical arc climbing
    // Z1 -> Z3 walked its intermediate points down to Z-0.97 and only landed on Z3 at
    // the endpoint, leaving a visible spike in the rendered path.
    //
    // `??` not `||`: Z0 is a legitimate target, and `|| start.z` turned a descent to
    // Z0 into a flat arc at the old height. This matches the endpoint below, and is
    // only safe because the parser now drops non-finite params -- `||` was rejecting
    // NaN here by accident, and `??` does not.
    const zDist = (z ?? start.z) - start.z;
    const zStep = zDist / totalSegments;

    let pz = start.z;
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
        pz += zStep;
        emit(centerX + arcRadius * Math.cos(currentAngle), centerY + arcRadius * Math.sin(currentAngle), pz);
      }
    }

    // `??` not `||`: an arc ending on X0, Y0 or Z0 used to silently keep the previous
    // coordinate. Safe now that the parser drops non-finite params -- `||` was also
    // rejecting NaN here by accident, which `??` does not do.
    const endPoint = { x: x ?? start.x, y: y ?? start.y, z: z ?? start.z };
    emit(endPoint.x, endPoint.y, endPoint.z);

    return endPoint;
  }
}
