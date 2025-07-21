import { Path } from './path';

/**
 * Represents a single layer in the print job
 * @remarks
 * Contains information about the layer number, paths, height, and Z position
 */
export class Layer {
  /**
   * Creates a new Layer instance
   * @param paths - Array of paths in this layer
   * @param lineNumber - Line number in G-code file
   * @param height - Layer height (default: 0)
   * @param z - Z position (default: 0)
   */
  constructor(
    public paths: Path[],
    public lineNumber: number,
    public height: number = 0,
    public z: number = 0,
    public layer: number = 0
  ) {}
}
