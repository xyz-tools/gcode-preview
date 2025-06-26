import { Vector3 } from 'three';

/**
 * Represents a 3D vector in GCode coordinates that is easily convertible to Three.js Vector3.
 * This is a convenience class. Care should be taken when many allocations are made.
 */
export class GCodeVector3 extends Vector3 {
  constructor(x: number, y: number, z: number) {
    super(x, y, z);
  }

  /**
   * map from GCode coordinates to Three.js Vector3
   * GCode uses (X, Y, Z) while Three.js uses (X, Z, Y)
   * also the Y in GCode goes to the back, while in Three.js Z goes to the front
   * @returns Vector3
   */
  toVector3(): Vector3 {
    return new Vector3(this.x, this.z, -this.y);
  }

  static fromVector3(vector: Vector3): GCodeVector3 {
    return new GCodeVector3(vector.x, -vector.z, vector.y);
  }
}
