import { GCodeVector3 } from './gcode-vector3';
export class BoundingBox {
  private min: GCodeVector3 = new GCodeVector3(Infinity, Infinity, Infinity);
  private max: GCodeVector3 = new GCodeVector3(-Infinity, -Infinity, -Infinity);

  /**
   * Updates the bounding box with the given coordinates.
   * Points with any non-finite coordinate (NaN or Infinity) are ignored.
   * @param x - The X coordinate.
   * @param y - The Y coordinate.
   * @param z - The Z coordinate.
   */
  public update(x: number, y: number, z: number): void {
    // Malformed gcode can yield NaN params; a partial point would corrupt the extremes, so reject the whole point.
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return;
    }
    this.min.x = Math.min(this.min.x, x);
    this.max.x = Math.max(this.max.x, x);
    this.min.y = Math.min(this.min.y, y);
    this.max.y = Math.max(this.max.y, y);
    this.min.z = Math.min(this.min.z, z);
    this.max.z = Math.max(this.max.z, z);
  }

  /**
   * Checks if the bounding box has been updated with at least one finite point.
   * @returns True if at least one finite point has been added, false otherwise.
   */
  public get isValid(): boolean {
    return Number.isFinite(this.min.x);
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
