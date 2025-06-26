import { GCodeVector3 } from './types';
export class BoundingBox {
  private min: GCodeVector3 = new GCodeVector3(Infinity, Infinity, Infinity);
  private max: GCodeVector3 = new GCodeVector3(-Infinity, -Infinity, -Infinity);

  /**
   * Updates the bounding box with the given coordinates.
   * @param x - The X coordinate.
   * @param y - The Y coordinate.
   * @param z - The Z coordinate.
   */
  public update(x: number, y: number, z: number): void {
    this.min.min(new GCodeVector3(x, y, z));
    this.max.max(new GCodeVector3(x, y, z));
  }

  /**
   * Checks if the bounding box has been updated with any points.
   * @returns True if at least one point has been added, false otherwise.
   */
  public get isValid(): boolean {
    return this.min.x !== Infinity;
  }

  /**
   * Gets the size of the bounding box.
   * @returns An object with x, y, and z dimensions, or null if the bounding box is not valid.
   */
  public get size(): GCodeVector3 | null {
    if (!this.isValid) {
      return null;
    }
    return this.max.clone().sub(this.min);
  }

  /**
   * Gets the center coordinates of the bounding box.
   * @returns An object with x, y, and z center coordinates, or null if the bounding box is not valid.
   */
  public get center(): GCodeVector3 | null {
    if (!this.isValid) {
      return null;
    }
    return this.min.clone().add(this.max).multiplyScalar(0.5);
  }

  public get corners(): { min: GCodeVector3; max: GCodeVector3 } | null {
    if (!this.isValid) {
      return null;
    }
    return {
      min: this.min.clone(),
      max: this.max.clone()
    };
  }
}
