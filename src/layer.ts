import { Path } from './path';

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
  constructor(paths: Path[], lineNumber: number, height: number = 0, z: number = 0) {
    this.paths = paths;
    this.lineNumber = lineNumber;
    this.height = height;
    this.z = z;
  }
}
