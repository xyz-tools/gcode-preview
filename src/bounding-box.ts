export class BoundingBox {
  private minX: number = Infinity;
  private maxX: number = -Infinity;
  private minY: number = Infinity;
  private maxY: number = -Infinity;
  private minZ: number = Infinity;
  private maxZ: number = -Infinity;

  constructor() {
    // console.log('BoundingBox initialized');
  }

  /**
   * Updates the bounding box with the given coordinates.
   * @param x - The X coordinate.
   * @param y - The Y coordinate.
   * @param z - The Z coordinate.
   */
  public update(x: number, y: number, z: number): void {
    this.minX = Math.min(this.minX, x);
    this.maxX = Math.max(this.maxX, x);
    this.minY = Math.min(this.minY, y);
    this.maxY = Math.max(this.maxY, y);
    this.minZ = Math.min(this.minZ, z);
    this.maxZ = Math.max(this.maxZ, z);
    // console.log(`Updated bounding box: minX=${this.minX}, maxX=${this.maxX}, minY=${this.minY}, maxY=${this.maxY}, minZ=${this.minZ}, maxZ=${this.maxZ}`);
  }

  /**
   * Checks if the bounding box has been updated with any points.
   * @returns True if at least one point has been added, false otherwise.
   */
  public get isValid(): boolean {
    return this.minX !== Infinity;
  }

  /**
   * Gets the size of the bounding box.
   * @returns An object with x, y, and z dimensions, or null if the bounding box is not valid.
   */
  public get size(): { x: number; y: number; z: number } | null {
    if (!this.isValid) {
      return null;
    }
    return {
      x: this.maxX - this.minX,
      y: this.maxY - this.minY,
      z: this.maxZ - this.minZ
    };
  }

  /**
   * Gets the center coordinates of the bounding box.
   * @returns An object with x, y, and z center coordinates, or null if the bounding box is not valid.
   */
  public get center(): { x: number; y: number; z: number } | null {
    if (!this.isValid) {
      return null;
    }
    return {
      x: this.minX + (this.maxX - this.minX) / 2,
      y: this.minY + (this.maxY - this.minY) / 2,
      z: this.minZ + (this.maxZ - this.minZ) / 2
    };
  }
}
