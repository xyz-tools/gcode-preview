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
import { JobStats } from './job-stats';

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
   * If the in-progress path has at least two points, it will be added to the
   * job and the in-progress path reference will be cleared. A path holding
   * only its seeded start point (e.g. left by a G92 reposition) has no
   * geometry: it is kept in progress so a later command can extend or replace
   * it, but is never committed to the job.
   */
  finishPath(): void {
    if (this.inprogressPath === undefined) {
      return;
    }
    if (this.inprogressPath.vertices.length > 3) {
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
    const currentPath = new Path(newType, 0.6, 0.2, this.state.tool);
    const pos = this.resolvePosition();
    currentPath.addPoint(pos.x, pos.y, pos.z);
    this.inprogressPath = currentPath;
    return currentPath;
  }

  /**
   * Resumes the last path from the job as the current in-progress path
   * @remarks
   * Removes the path from all indexes and sets it as the current in-progress
   * path. Does nothing when a path is already in progress (e.g. a repositioned
   * start point carried over from the previous chunk).
   */
  resumeLastPath(): void {
    if (this.inprogressPath !== undefined || this.paths.length === 0) {
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
