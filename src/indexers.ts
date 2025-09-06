import { Path, PathType } from './path';
import { Layer } from './layer';
import { LayerMetadata } from './parser/metadata-parser-base';

/**
 * Base error class for indexer-related errors
 */
export class NonApplicableIndexer extends Error {}

/**
 * Base class for path indexers
 * @remarks
 * Indexers organize paths into different structures (layers, tools, etc.)
 */
export abstract class Indexer {
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
  abstract sortIn(path: Path): void;
}

/**
 * Indexer that organizes paths by travel type (extrusion vs travel moves)
 */
export class TravelTypeIndexer extends Indexer {
  /** Indexes containing arrays of paths for each travel type */
  declare protected indexes: Record<string, Path[]>;

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
export class NonPlanarExtrusionError extends NonApplicableIndexer {
  constructor() {
    super('Non-planar extrusions cannot be indexed by layer');
  }
}

/**
 * Indexer that organizes paths into layers based on Z height
 */
export class LayersIndexer extends Indexer {
  /** Default tolerance for layer height differences */
  static readonly DEFAULT_TOLERANCE = 0.05;

  /** Array of layers being managed */
  declare protected indexes: Layer[];

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
      throw new NonPlanarExtrusionError();
    }

    // new layers are only created when extruding
    if (path.travelType === PathType.Extrusion) {
      const newZ = path.vertices[2];
      const lastZ = this.lastLayer?.z;

      // either this is the first extrusion path
      // or this is an extrusion path that is higher than the last layer
      if (!this.lastLayer || newZ - lastZ > this.tolerance) {
        this.createLayerAt(newZ);
      }
    }

    this.lastLayer?.paths.push(path);
  }

  /**
   * Gets the last layer in the indexes
   * @returns The most recent layer
   */
  private get lastLayer(): Layer {
    return this.indexes[this.indexes.length - 1];
  }

  /**
   * Creates a new layer at the specified Z height
   * @param z - Z height for the new layer
   */
  private createLayerAt(z: number): void {
    const lastZ = this.lastLayer?.z || 0;
    const height = z - lastZ;
    this.indexes.push(new Layer(z, height));
  }
}

/**
 * Indexer that organizes paths by tool number
 */
export class ToolIndexer extends Indexer {
  /** 2D array of paths indexed by tool number */
  declare protected indexes: Path[][];

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
      this.indexes[path.tool] = this.indexes[path.tool] || [];
      if (this.indexes[path.tool] === undefined) {
        this.indexes[path.tool] = [];
      }
      this.indexes[path.tool].push(path);
    }
  }
}

/**
 * Indexer that organizes paths into layers using slicer metadata when available,
 * falling back to tolerance-based detection
 */
export class LayersMetadataIndexer extends Indexer {
  /** Array of layers being managed */
  declare protected indexes: Layer[];

  /** Layer metadata from slicer comments */
  private layerMetadata: LayerMetadata[];

  /** Fallback tolerance indexer */
  private fallbackIndexer: LayersIndexer;

  /** Current layer index for metadata-based indexing */
  private currentMetadataLayerIndex = 0;

  /**
   * Creates a new LayersMetadataIndexer
   * @param indexes - Array to store layers
   * @param layerMetadata - Layer metadata from slicer comments
   * @param tolerance - Height tolerance for fallback detection
   */
  constructor(
    indexes: Layer[],
    layerMetadata: LayerMetadata[] = [],
    tolerance: number = LayersIndexer.DEFAULT_TOLERANCE
  ) {
    super(indexes);
    this.layerMetadata = layerMetadata;
    this.fallbackIndexer = new LayersIndexer([], tolerance);
  }

  /**
   * Sorts a path into the appropriate layer using metadata or tolerance fallback
   * @param path - Path to sort
   * @throws NonPlanarPathError if path is non-planar
   */
  sortIn(path: Path): void {
    // If we have metadata, use it
    if (this.layerMetadata.length > 0) {
      this.sortWithMetadata(path);
    } else {
      // Fallback to tolerance-based detection
      this.fallbackIndexer.sortIn(path);
      // Copy layers from fallback indexer to our indexes
      this.syncFromFallback();
    }
  }

  /**
   * Sort path using slicer metadata
   * @param path - Path to sort
   */
  private sortWithMetadata(path: Path): void {
    if (path.travelType === PathType.Extrusion) {
      const pathZ = path.vertices[2];

      // Find the appropriate layer based on Z position
      let targetLayerIndex = -1;
      for (let i = this.currentMetadataLayerIndex; i < this.layerMetadata.length; i++) {
        const metadata = this.layerMetadata[i];
        // If metadata has Z, use it for matching, otherwise just use layer order
        if (metadata.z !== undefined) {
          if (pathZ <= metadata.z + 0.01) {
            // small tolerance for floating point
            targetLayerIndex = i;
            break;
          }
        } else {
          // No Z in metadata, just use the first available layer
          targetLayerIndex = i;
          break;
        }
      }

      // If we found a matching layer in metadata
      if (targetLayerIndex >= 0) {
        // Ensure we have enough layers in our indexes
        while (this.indexes.length <= targetLayerIndex) {
          const metadata = this.layerMetadata[this.indexes.length];
          const z = metadata.z !== undefined ? metadata.z : pathZ; // Use path Z if metadata Z missing
          const height = metadata.height || 0.2; // default height if not specified
          this.indexes.push(new Layer(z, height));
        }

        this.currentMetadataLayerIndex = targetLayerIndex;
        this.indexes[targetLayerIndex].paths.push(path);
      } else {
        // If no metadata match, add to last layer or create new one
        if (this.indexes.length === 0) {
          this.indexes.push(new Layer(pathZ, 0.2));
        }
        this.indexes[this.indexes.length - 1].paths.push(path);
      }
    } else {
      // Travel paths go to the last layer
      if (this.indexes.length > 0) {
        this.indexes[this.indexes.length - 1].paths.push(path);
      }
    }
  }

  /**
   * Copy layers from fallback indexer to our indexes
   */
  private syncFromFallback(): void {
    const fallbackLayers = (this.fallbackIndexer as { indexes: Layer[] }).indexes;
    for (const layer of fallbackLayers) {
      if (!this.indexes.includes(layer)) {
        this.indexes.push(layer);
      }
    }
  }
}
