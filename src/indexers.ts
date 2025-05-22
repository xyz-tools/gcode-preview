import { Path, PathType } from './path';
import { Layer } from './layer'; // Assuming Layer is now in its own file

/**
 * Base error class for indexer-related errors
 */
export class NonApplicableIndexer extends Error {}

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
export class TravelTypeIndexer extends Indexer {
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
export class NonPlanarPathError extends NonApplicableIndexer {
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
export class ToolIndexer extends Indexer {
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
