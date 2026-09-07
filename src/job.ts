import { Path, PathType } from './path';
import { State } from './state';
import { Layer } from './layer';
import {
  TravelTypeIndexer,
  LayersMetadataIndexer,
  ToolIndexer,
  Indexer,
  NonApplicableIndexer,
  NonPlanarExtrusionError
} from './indexers';
import { BoundingBox } from './bounding-box';
import { Metadata } from './parser/gcode-parser';
import { ExtrusionDimensionMetadata } from './parser/metadata-parser-base';
import { JobStats } from './job-stats';

/** Filament diameter assumed when the metadata announces none, in millimeters */
const DEFAULT_FILAMENT_DIAMETER = 1.75;
/** Derived layer heights outside this range are considered implausible */
const MIN_DERIVED_HEIGHT = 0.01;
const MAX_DERIVED_HEIGHT = 1.0;
/** Derived extrusion widths outside this range are considered implausible */
const MIN_DERIVED_WIDTH = 0.1;
const MAX_DERIVED_WIDTH = 2.0;
/**
 * Segments shorter than this derive no width, in millimeters: the slicer
 * rounds E to a few decimals, and over a near-zero length that quantization
 * noise dominates the derived value.
 */
const MIN_DERIVED_SEGMENT_LENGTH = 0.05;
/**
 * A derived width within this relative tolerance of the current one keeps the
 * current value, so residual noise cannot shatter the model into micro-paths.
 * 2% separates real Cura width steps (0.4 vs 0.42 infill is 5%) from noise.
 */
const DERIVED_WIDTH_TOLERANCE = 0.02;

/**
 * Represents a complete print job containing paths, layers, and state
 * @remarks
 * Manages the collection of paths, organizes them into layers and tools,
 * and tracks the current print state
 */
export class Job {
  /** All paths in the job */
  paths: Path[] = [];
  /** Current print state */
  state: State;
  /** Travel paths (non-extrusion moves) */
  private travelPaths: Path[] = [];
  /** Extrusion paths */
  private extrusionPaths: Path[] = [];
  /** Layers in the job */
  private _layers: Layer[] = [];
  /** Paths organized by tool */
  private _toolPaths: Path[][] = [];
  /** Indexers for organizing paths */
  private indexers: Indexer[];
  /** Layer indexer, retained so metadata can be applied after construction */
  private layersIndexer: LayersMetadataIndexer;
  /** Current in-progress path */
  inprogressPath: Path | undefined;
  public boundingBox: BoundingBox = new BoundingBox();
  private _metadata: Metadata | undefined;
  /** Extrusion dimension changes from slicer metadata, in line order */
  private extrusionDimensions: ExtrusionDimensionMetadata[] = [];
  /** Position in extrusionDimensions up to which events have been applied */
  private dimensionCursor = 0;
  /**
   * Whether per-path dimensions are derived from the moves.
   * @remarks
   * On unless the slicer metadata opts out (see
   * `SlicerMetadataParser.derivesExtrusionDimensions`); announced dimensions
   * outrank derived ones per path rather than switching the derivation off.
   */
  private deriveDimensions = true;
  /** Filament cross-section area feeding the width derivation, in mm² */
  private filamentCrossSection = Math.PI * (DEFAULT_FILAMENT_DIAMETER / 2) ** 2;
  /** Z of the last extrusion move, from which derived layer heights are measured */
  private lastExtrusionZ: number | undefined;
  /** How many commands have been executed on this job — one per parsed line */
  private executedCommandCount = 0;

  /** Statistics accumulated while interpreting the job's G-code */
  public stats: JobStats = new JobStats();

  /**
   * Creates a new Job instance
   * @param opts - Job options
   * @param opts.state - Initial state (default: State.initial)
   * @param opts.minLayerThreshold - Minimum layer height threshold (default: LayersIndexer.DEFAULT_TOLERANCE)
   */
  constructor(opts: { state?: State; minLayerThreshold?: number } = {}) {
    this.state = opts.state || State.initial;
    this.layersIndexer = new LayersMetadataIndexer(this._layers, [], opts.minLayerThreshold);
    this.indexers = [
      new TravelTypeIndexer({ travel: this.travelPaths, extrusion: this.extrusionPaths }),
      this.layersIndexer,
      new ToolIndexer(this._toolPaths)
    ];
  }

  /**
   * Gets the slicer metadata (thumbnails, layer metadata, slicer name) for this job
   * @returns The metadata, or undefined if none has been set
   */
  get metadata(): Metadata | undefined {
    return this._metadata;
  }

  /**
   * Sets the slicer metadata and forwards layer metadata to the layer indexer
   * @param metadata - Parsed slicer metadata
   * @remarks
   * Must be set before paths are indexed (i.e. before executing commands) so the
   * layer indexer can use slicer-provided layer boundaries instead of the
   * tolerance-based fallback.
   */
  set metadata(metadata: Metadata | undefined) {
    this._metadata = metadata;
    this.layersIndexer.setLayerMetadata(metadata?.layerMetadata ?? []);
    this.setExtrusionDimensions(metadata?.extrusionDimensions ?? []);
    this.deriveDimensions = metadata?.deriveExtrusionDimensions !== false;
    const filamentDiameter = metadata?.filamentDiameter ?? DEFAULT_FILAMENT_DIAMETER;
    this.filamentCrossSection = Math.PI * (filamentDiameter / 2) ** 2;
  }

  /**
   * Replaces the extrusion dimension metadata consumed by `beginCommand`
   * @param extrusionDimensions - Dimension change events, in line order
   * @remarks
   * Mirrors LayersMetadataIndexer.setLayerMetadata: a streaming parse re-sets
   * the same (growing) array each chunk, which keeps the cursor; swapping in a
   * different array rewinds it so stale positions cannot leak.
   */
  private setExtrusionDimensions(extrusionDimensions: ExtrusionDimensionMetadata[]): void {
    if (extrusionDimensions === this.extrusionDimensions) return;
    this.extrusionDimensions = extrusionDimensions;
    this.dimensionCursor = 0;
  }

  /**
   * Advances the job to the next command the interpreter executes
   * @remarks
   * Called by the interpreter once per command, in file order. Every parsed
   * line yields exactly one command, so counting them gives the current line
   * index — which is how line-indexed slicer metadata is mapped onto the
   * command stream: extrusion dimension changes (`;WIDTH:` / `;HEIGHT:`
   * comments) recorded at or before this line are folded into the state here.
   * The in-progress path is deliberately left alone: the move handlers break
   * it via `continuePath` when the state no longer matches, which keeps a
   * streamed parse identical to a one-shot parse — the interpreter resumes
   * the last path at every chunk boundary, undoing any break performed here.
   */
  beginCommand(): void {
    const lineIndex = this.executedCommandCount++;
    while (
      this.dimensionCursor < this.extrusionDimensions.length &&
      this.extrusionDimensions[this.dimensionCursor].lineIndex <= lineIndex
    ) {
      const dimension = this.extrusionDimensions[this.dimensionCursor++];
      if (dimension.width !== undefined) this.state.extrusionWidth = dimension.width;
      if (dimension.height !== undefined) this.state.lineHeight = dimension.height;
    }
  }

  /**
   * Derives the extrusion dimensions of the move about to be executed and
   * folds them into the state, best-effort
   * @param target - The move's physical endpoint; an axis the move leaves
   * unchanged carries the current (possibly unknown) state value
   * @param extruded - The filament length the move extrudes (see `State.applyExtrusion`)
   * @remarks
   * Active only when the slicer metadata asked for it (Cura, whose files
   * announce no dimension comments); paths then carry these derived values as
   * their own, taking the same render-time precedence over the global
   * fallback as comment-announced dimensions do. Move handlers call this for
   * extruding moves before `continuePath`, so a change breaks the path
   * exactly like a `;WIDTH:` / `;HEIGHT:` comment would.
   *
   * Layer height is the Z step between consecutive extrusion moves (the
   * first one's Z stands in for the first layer). Only extrusion Zs are
   * compared, so z-hop travels are invisible; a zero step (ironing, or
   * printing on within the layer) and steps outside 0.01–1.0 mm (spiralize's
   * continuous micro-climb, a probe artifact, moving down to a second
   * sequential object) keep the current height.
   *
   * Width comes from conservation of volume with a rectangular deposit
   * cross-section — width = (ΔE × filament cross-section) / (length ×
   * height) — matching the box profile ExtrusionGeometry extrudes. The
   * result is quantized to 0.01 mm and kept within 2% of the current width,
   * so E-value rounding noise cannot break the model into micro-paths, and
   * discarded entirely when implausible (outside 0.1–2.0 mm, or over a
   * segment too short to measure).
   */
  deriveMoveDimensions(
    target: { x: number | undefined; y: number | undefined; z: number | undefined },
    extruded: number
  ): void {
    if (!this.deriveDimensions || extruded <= 0) return;

    if (target.z !== undefined) {
      const step = this.lastExtrusionZ === undefined ? target.z : target.z - this.lastExtrusionZ;
      if (step >= MIN_DERIVED_HEIGHT && step <= MAX_DERIVED_HEIGHT) {
        // rounded so consecutive layers with equal heights compare equal
        // despite floating-point Z subtraction noise
        this.state.derivedLineHeight = Math.round(step * 10000) / 10000;
      }
      this.lastExtrusionZ = target.z;
    }

    // Nothing below is needed while the slicer announces the width itself: it
    // would outrank the derived one anyway. Worth skipping rather than
    // discarding -- on a file that announces every width (3DBenchy) the
    // segment length and volume arithmetic is a third of the interpret time.
    if (this.state.extrusionWidth !== undefined) return;

    // The announced height still feeds the width derivation, which needs the
    // height the material was actually laid at, not the inferred one.
    const height = this.state.resolvedLineHeight;
    if (height === undefined) return;

    // Resolved exactly like the rendered geometry: an unknown axis is assumed
    // at the origin (see resolvePosition).
    const from = this.resolvePosition();
    const length = Math.hypot((target.x ?? 0) - from.x, (target.y ?? 0) - from.y, (target.z ?? 0) - from.z);
    // Number.isFinite: overflowing (yet individually finite) coordinates can
    // make hypot Infinity — or NaN via Inf - Inf — and both pass a plain `<`
    if (!Number.isFinite(length) || length < MIN_DERIVED_SEGMENT_LENGTH) return;

    const width = (extruded * this.filamentCrossSection) / (length * height);
    // inclusive form so NaN (e.g. from an Infinity/Infinity overflow) is
    // rejected rather than latched into the state and every path after it
    if (!(width >= MIN_DERIVED_WIDTH && width <= MAX_DERIVED_WIDTH)) return;

    const quantized = Math.round(width * 100) / 100;
    const current = this.state.derivedExtrusionWidth;
    if (current !== undefined && Math.abs(quantized - current) <= current * DERIVED_WIDTH_TOLERANCE) return;
    this.state.derivedExtrusionWidth = quantized;
  }

  /**
   *
   * Gets all extrusion paths in the job
   * @returns Array of extrusion paths
   */
  get extrusions(): Path[] {
    return this.extrusionPaths;
  }

  /**
   * Gets all travel paths in the job
   * @returns Array of travel paths
   */
  get travels(): Path[] {
    return this.travelPaths;
  }

  /**
   * Gets paths organized by tool
   * @returns 2D array of paths, where each sub-array contains paths for a specific tool
   */
  get toolPaths(): Path[][] {
    return this._toolPaths;
  }

  /**
   * Gets all layers in the job
   * @returns Array of Layer objects
   */
  get layers(): Layer[] {
    return this._layers;
  }

  /**
   * Adds a path to the job and indexes it
   * @param path - Path to add
   */
  addPath(path: Path): void {
    this.paths.push(path);
    this.indexPath(path);
  }

  /**
   * Finalizes the current in-progress path
   * @remarks
   * If the in-progress path has vertices, it will be added to the job
   * and the in-progress path reference will be cleared
   */
  finishPath(): void {
    if (this.inprogressPath === undefined) {
      return;
    }
    if (this.inprogressPath.vertices.length > 0) {
      this.addPath(this.inprogressPath);
      this.inprogressPath = undefined;
    }
  }

  /**
   * Resolves the current state's position for rendering.
   * @returns The position as concrete `x`, `y`, `z` numbers
   * @remarks
   * An axis that has not been homed has an unknown (`undefined`) position. The
   * job chooses to assume the origin (`0`) for such axes so the viewer can
   * still render best-effort (see #361); `state.isHomed` lets a consumer tell
   * these assumed coordinates from real ones.
   */
  resolvePosition(): { x: number; y: number; z: number } {
    return { x: this.state.x ?? 0, y: this.state.y ?? 0, z: this.state.z ?? 0 };
  }

  /**
   * Finalizes the current in-progress path and starts a new one of the given type
   * @param newType - Type of the new path
   * @returns The newly created path, seeded with the current position
   * @remarks
   * Called when a path type change is detected (e.g. switching between travel
   * and extrusion moves).
   */
  breakPath(newType: PathType): Path {
    this.finishPath();
    const currentPath = new Path(
      newType,
      this.state.resolvedExtrusionWidth,
      this.state.resolvedLineHeight,
      this.state.tool
    );
    const pos = this.resolvePosition();
    currentPath.addPoint(pos.x, pos.y, pos.z);
    this.inprogressPath = currentPath;
    return currentPath;
  }

  /**
   * Returns the path the next move of the given type should extend
   * @param pathType - Type of the move about to be added
   * @returns The in-progress path when it can continue, otherwise a fresh one
   * @remarks
   * The in-progress path continues only while its type and its extrusion
   * dimensions still match the state; dimension metadata that changed the
   * state since the path was started (see `beginCommand`) breaks it here, so
   * every path carries a single width and height. Deciding this lazily at
   * move time (and not when the metadata is applied) keeps streamed and
   * one-shot parses identical: the interpreter resumes the last finished path
   * at every chunk boundary, which would undo an eager break.
   */
  continuePath(pathType: PathType): Path {
    const currentPath = this.inprogressPath;
    if (
      currentPath !== undefined &&
      currentPath.travelType === pathType &&
      currentPath.extrusionWidth === this.state.resolvedExtrusionWidth &&
      currentPath.lineHeight === this.state.resolvedLineHeight
    ) {
      return currentPath;
    }
    return this.breakPath(pathType);
  }

  /**
   * Resumes the last path from the job as the current in-progress path
   * @remarks
   * Removes the path from all indexes and sets it as the current in-progress path
   */
  resumeLastPath(): void {
    if (this.paths.length === 0) {
      return;
    }
    this.inprogressPath = this.paths.pop();
    [
      this.extrusionPaths,
      this.travelPaths,
      this.layers[this.layers.length - 1]?.paths,
      this._toolPaths[this.inprogressPath.tool]
    ].forEach((indexer) => {
      if (indexer === undefined || indexer.length === 0) {
        return;
      }
      const travelIndex = indexer.indexOf(this.inprogressPath);
      if (travelIndex > -1) {
        indexer.splice(travelIndex, 1);
      }
    });
  }

  /**
   * Checks if the job contains planar extrusion layers
   * @returns True if the job contains at least one layer, false otherwise
   */
  get isPlanar(): boolean {
    return this.layers.length > 0;
  }

  /**
   * Gets the total number of layers in the job
   * @returns Number of layers
   */
  get countLayers(): number {
    return this.layers.length;
  }

  /**
   * Indexes a path using all available indexers
   * @param path - Path to index
   * @remarks
   * If an indexer throws a NonApplicableIndexer error, it will be removed
   * from the list of indexers. If the error is a NonPlanarPathError,
   * the layers will be cleared.
   */
  private indexPath(path: Path): void {
    // Iterate over a snapshot so removing a failed indexer
    // does not skip the indexers that follow it
    [...this.indexers].forEach((indexer) => {
      try {
        indexer.sortIn(path);
      } catch (e) {
        if (!(e instanceof NonApplicableIndexer)) {
          throw e; // If the error is not a NonApplicableIndexer, it will be thrown.
        }

        if (e instanceof NonPlanarExtrusionError) {
          console.warn('Non-planar path detected; clearing layer index');
          // Truncate in place so consumers holding the array see it emptied
          this._layers.length = 0;
        }

        // Remove the indexer that cannot handle this path
        const i = this.indexers.indexOf(indexer);
        this.indexers.splice(i, 1);
      }
    });
  }
}
