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

  private static hasNonPlanarVertex(vertices: number[], tolerance: number): boolean {
    for (let i = 5; i < vertices.length; i += 3) {
      if (Math.abs(vertices[i] - vertices[i - 3]) > tolerance) return true;
    }
    return false;
  }

  /**
   * Sorts a path into the appropriate layer
   * @param path - Path to sort
   * @throws NonPlanarPathError if path is non-planar
   */
  sortIn(path: Path): void {
    if (
      path.travelType === PathType.Extrusion &&
      LayersIndexer.hasNonPlanarVertex(path.vertices, this.tolerance)
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
      this.indexes[path.tool].push(path);
    }
  }
}

/**
 * Indexer that organizes paths into layers using slicer metadata when available,
 * falling back to tolerance-based detection
 */
export class LayersMetadataIndexer extends Indexer {
  /** Default layer height used when metadata does not specify one */
  private static readonly DEFAULT_LAYER_HEIGHT = 0.2;

  /** Z tolerance (mm) used when matching a path to a metadata layer */
  private static readonly Z_MATCH_TOLERANCE = 0.01;

  /** Array of layers being managed */
  declare protected indexes: Layer[];

  /** Layer metadata from slicer comments */
  private layerMetadata: LayerMetadata[];

  /** Fallback tolerance indexer, writing into the same layer array */
  private fallbackIndexer: LayersIndexer;

  /** Current layer pointer for metadata-based indexing (paths arrive in Z order) */
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
    this.layerMetadata = layerMetadata ?? [];
    // The fallback shares the same layer array, so no copying/syncing is needed.
    this.fallbackIndexer = new LayersIndexer(indexes, tolerance);
  }

  /** Whether slicer-provided layer metadata is available */
  get hasMetadata(): boolean {
    return this.layerMetadata.length > 0;
  }

  /**
   * Replaces the layer metadata used for indexing.
   * @param layerMetadata - Layer metadata from slicer comments
   * @remarks Must be set before paths are indexed to take effect.
   */
  setLayerMetadata(layerMetadata: LayerMetadata[]): void {
    this.layerMetadata = layerMetadata ?? [];
  }

  /**
   * Sorts a path into the appropriate layer using metadata or tolerance fallback
   * @param path - Path to sort
   * @throws NonPlanarPathError if path is non-planar (fallback mode only)
   */
  sortIn(path: Path): void {
    if (this.hasMetadata) {
      this.sortWithMetadata(path);
    } else {
      this.fallbackIndexer.sortIn(path);
    }
  }

  /** The most recent layer, or undefined when no layers exist yet */
  private get lastLayer(): Layer | undefined {
    return this.indexes[this.indexes.length - 1];
  }

  /**
   * Sorts a path into a layer using slicer metadata
   * @param path - Path to sort
   */
  private sortWithMetadata(path: Path): void {
    // Travel moves never open a new layer; attach them to the current one.
    if (path.travelType !== PathType.Extrusion) {
      this.lastLayer?.paths.push(path);
      return;
    }

    const pathZ = path.vertices[2];
    const targetLayerIndex = this.findLayerIndexForZ(pathZ);

    if (targetLayerIndex < 0) {
      // Z sits above everything the metadata describes: keep it in the last
      // known layer, creating a bootstrap layer if none exist yet.
      if (this.indexes.length === 0) {
        this.indexes.push(new Layer(pathZ, LayersMetadataIndexer.DEFAULT_LAYER_HEIGHT));
      }
      this.lastLayer!.paths.push(path);
      return;
    }

    this.ensureLayersUpTo(targetLayerIndex, pathZ);
    this.currentMetadataLayerIndex = targetLayerIndex;
    this.indexes[targetLayerIndex].paths.push(path);
  }

  /**
   * Finds the metadata layer a path at the given Z belongs to.
   * @param pathZ - Z position of the path
   * @returns Layer index, or -1 when the Z is above all known layers
   */
  private findLayerIndexForZ(pathZ: number): number {
    for (let i = this.currentMetadataLayerIndex; i < this.layerMetadata.length; i++) {
      const z = this.layerMetadata[i].z;
      // Metadata without a Z falls back to plain layer order.
      if (z === undefined) return i;
      if (pathZ <= z + LayersMetadataIndexer.Z_MATCH_TOLERANCE) return i;
    }
    return -1;
  }

  /**
   * Creates layers from metadata up to and including the target index.
   * @param targetIndex - Highest layer index that must exist
   * @param fallbackZ - Z to use when a layer's metadata omits it
   */
  private ensureLayersUpTo(targetIndex: number, fallbackZ: number): void {
    while (this.indexes.length <= targetIndex) {
      const metadata = this.layerMetadata[this.indexes.length];
      const z = metadata.z ?? fallbackZ;
      const height = metadata.height ?? LayersMetadataIndexer.DEFAULT_LAYER_HEIGHT;
      this.indexes.push(new Layer(z, height));
    }
  }
}
