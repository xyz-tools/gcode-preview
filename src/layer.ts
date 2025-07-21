import { Path } from './path';

/**
 * Represents a single layer in the print job
 * @remarks
 * Contains information about the layer number, paths, height, and Z position
 */
export class Layer {
  /** Array of paths in this layer */
  paths: Path[] = [];
  
  /**
   * Creates a new Layer instance
   * @param height - Layer height (default: 0)
   * @param z - Z position (default: 0)
   */
  constructor(
    public z: number,
    public height: number = 0,
  ) {}
}
