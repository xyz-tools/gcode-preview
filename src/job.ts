import { Path, PathType } from './path';

/**
 * Represents the current state of the print job
 * @remarks
 * Tracks the current position, extrusion state, active tool, and units
 */
export class State {
  /** Current X position */
  x: number;
  /** Current Y position */
  y: number;
  /** Current Z position */
  z: number;
  /** Current extrusion amount */
  e: number;
  /** Currently active tool */
  tool: number;
  /** Current units (millimeters or inches) */
  units: 'mm' | 'in';

  /**
   * Gets a new State instance with default initial values
   * @returns New State instance with x=0, y=0, z=0, e=0, tool=0, units='mm'
   */
  static get initial(): State {
    const state = new State();
    Object.assign(state, { x: 0, y: 0, z: 0, e: 0, tool: 0, units: 'mm' });
    return state;
  }
}

/**
 * Represents a single layer in the print job
 * @remarks
 * Contains information about the layer number, paths, height, and Z position
 */
export class Layer {
  /** Layer number (0-based index) */
  public layer: number;
  /** Array of paths in this layer */
  public paths: Path[];
  /** Line number in the G-code file where this layer starts */
  public lineNumber: number;
  /** Height of this layer */
  public height: number = 0;
  /** Z position of this layer */
  public z: number = 0;

  /**
   * Creates a new Layer instance
   * @param layer - Layer number
   * @param paths - Array of paths in this layer
   * @param lineNumber - Line number in G-code file
   * @param height - Layer height (default: 0)
   * @param z - Z position (default: 0)
   */
  constructor(layer: number, paths: Path[], lineNumber: number, height: number = 0, z: number = 0) {
    this.layer = layer;
    this.paths = paths;
    this.lineNumber = lineNumber;
    this.height = height;
    this.z = z;
  }
}

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
        if (e instanceof NonApplicableIndexer) {
          if (e instanceof NonPlanarPathError) {
            this._layers = [];
          }
          const i = this.indexers.indexOf(indexer);
          this.indexers.splice(i, 1);
        } else {
          throw e;
        }
      }
    });
  }
}

/**
 * Base error class for indexer-related errors
 */
class NonApplicableIndexer extends Error {}

/**
 * Base class for path indexers
 * @remarks
 * Indexers organize paths into different structures (layers, tools, etc.)
 */
export class Indexer {
  /** The indexes being managed by this indexer */
  protected indexes: unknown;

  /**
   * Creates a new Indexer instance
   * @param indexes - The indexes to manage
   */
  constructor(indexes: unknown) {
    this.indexes = indexes;
  }

  /**
   * Sorts a path into the appropriate index
   * @param path - Path to sort
   * @throws Error if not implemented in subclass
   */
  sortIn(path: Path): void {
    path;
    throw new Error('Method not implemented.');
  }
}

/**
 * Indexer that organizes paths by travel type (extrusion vs travel moves)
 */
class TravelTypeIndexer extends Indexer {
  /** Indexes containing arrays of paths for each travel type */
  protected declare indexes: Record<string, Path[]>;

  /**
   * Creates a new TravelTypeIndexer
   * @param indexes - Object containing arrays for travel and extrusion paths
   */
  constructor(indexes: Record<string, Path[]>) {
    super(indexes);
  }

  /**
   * Sorts a path into either extrusion or travel paths
   * @param path - Path to sort
   */
  sortIn(path: Path): void {
    if (path.travelType === PathType.Extrusion) {
      this.indexes.extrusion.push(path);
    } else {
      this.indexes.travel.push(path);
    }
  }
}

/**
 * Error thrown when attempting to index a non-planar path
 */
class NonPlanarPathError extends NonApplicableIndexer {
  constructor() {
    super("Non-planar paths can't be indexed by layer");
  }
}

/**
 * Indexer that organizes paths into layers based on Z height
 */
export class LayersIndexer extends Indexer {
  /** Default tolerance for layer height differences */
  static readonly DEFAULT_TOLERANCE = 0.05;

  /** Array of layers being managed */
  protected declare indexes: Layer[];

  /** Tolerance for layer height differences */
  private tolerance: number;

  /**
   * Creates a new LayersIndexer
   * @param indexes - Array to store layers
   * @param tolerance - Height tolerance for layer detection (default: DEFAULT_TOLERANCE)
   */
  constructor(indexes: Layer[], tolerance: number = LayersIndexer.DEFAULT_TOLERANCE) {
    super(indexes);
    this.tolerance = tolerance;
  }

  /**
   * Sorts a path into the appropriate layer
   * @param path - Path to sort
   * @throws NonPlanarPathError if path is non-planar
   */
  sortIn(path: Path): void {
    if (
      path.travelType === PathType.Extrusion &&
      path.vertices.some((_, i, arr) => i > 3 && i % 3 === 2 && Math.abs(arr[i] - arr[i - 3]) > this.tolerance)
    ) {
      throw new NonPlanarPathError();
    }

    if (this.indexes[this.indexes.length - 1] === undefined) {
      this.createLayer(path.vertices[2]);
    }

    if (
      path.travelType === PathType.Extrusion &&
      this.lastLayer().paths.some((p) => p.travelType === PathType.Extrusion)
    ) {
      if (path.vertices[2] - (this.lastLayer().z || 0) > this.tolerance) {
        this.createLayer(path.vertices[2]);
      }
    }
    this.lastLayer().paths.push(path);
  }

  /**
   * Gets the last layer in the indexes
   * @returns The most recent layer
   */
  private lastLayer(): Layer {
    return this.indexes[this.indexes.length - 1];
  }

  /**
   * Creates a new layer at the specified Z height
   * @param z - Z height for the new layer
   */
  private createLayer(z: number): void {
    const layerNumber = this.indexes.length;
    const height = z - (this.lastLayer()?.z || 0);
    this.indexes.push(new Layer(this.indexes.length, [], layerNumber, height, z));
  }
}

/**
 * Indexer that organizes paths by tool number
 */
class ToolIndexer extends Indexer {
  /** 2D array of paths indexed by tool number */
  protected declare indexes: Path[][];

  /**
   * Creates a new ToolIndexer
   * @param indexes - 2D array to store paths by tool
   */
  constructor(indexes: Path[][]) {
    super(indexes);
  }

  /**
   * Sorts a path into the appropriate tool's path array
   * @param path - Path to sort
   */
  sortIn(path: Path): void {
    if (path.travelType === PathType.Extrusion) {
      this.indexes;
      this.indexes[path.tool] = this.indexes[path.tool] || [];
      if (this.indexes[path.tool] === undefined) {
        this.indexes[path.tool] = [];
      }
      this.indexes[path.tool].push(path);
    }
  }
}
