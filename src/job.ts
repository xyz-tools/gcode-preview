import { Path } from './path';
import { State } from './state';
import { Layer } from './layer';
import { TravelTypeIndexer, LayersIndexer, ToolIndexer, Indexer, NonApplicableIndexer } from './indexers';
import { BoundingBox } from './bounding-box';

/**
 * Represents the current state of the print job
 * @remarks
 * Tracks the current position, extrusion state, active tool, and units
 */

/**
 * Represents a single layer in the print job
 * @remarks
 * Contains information about the layer number, paths, height, and Z position
 */

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
  /** Current in-progress path */
  inprogressPath: Path | undefined;
  public boundingBox: BoundingBox = new BoundingBox();

  /**
   * Creates a new Job instance
   * @param opts - Job options
   * @param opts.state - Initial state (default: State.initial)
   * @param opts.minLayerThreshold - Minimum layer height threshold (default: LayersIndexer.DEFAULT_TOLERANCE)
   */
  constructor(opts: { state?: State; minLayerThreshold?: number } = {}) {
    this.state = opts.state || State.initial;
    this.indexers = [
      new TravelTypeIndexer({ travel: this.travelPaths, extrusion: this.extrusionPaths }),
      new LayersIndexer(this._layers, opts.minLayerThreshold),
      new ToolIndexer(this._toolPaths)
    ];
  }

  /**
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
   * Resumes the last path from the job as the current in-progress path
   * @remarks
   * Removes the path from all indexes and sets it as the current in-progress path
   */
  resumeLastPath(): void {
    if (this.paths.length === 0) {
      return;
    }
    this.inprogressPath = this.paths.pop();
    [this.extrusionPaths, this.travelPaths, this.layers[this.layers.length - 1]?.paths].forEach((indexer) => {
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
   * Checks if the job contains planar layers
   * @returns True if the job contains at least one layer, false otherwise
   */
  isPlanar(): boolean {
    return this.layers.length > 0;
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
    this.indexers.forEach((indexer) => {
      try {
        indexer.sortIn(path);
      } catch (e) {
        if (!(e instanceof NonApplicableIndexer)) {
          throw e; // If the error is not a NonApplicableIndexer, it will be thrown.
        }

        console.warn('Non-planar path detected; clearing layer index');
        this._layers = [];

        const i = this.indexers.indexOf(indexer);
        this.indexers.splice(i, 1);
      }
    });
  }
}
