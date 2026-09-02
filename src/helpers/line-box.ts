import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments
} from 'three';

/**
 * Axis-aligned wireframe box, used for the build volume outline and the
 * bounding box around the rendered G-code model
 * @remarks
 * Only the 12 edges are drawn, no faces. The box spans from the origin to
 * (x, y, -z): the depth is negated to match the scene's z-flip convention
 * (see BuildVolume.createAxes), so callers pass their world-space depth as
 * a positive number.
 */
class LineBox extends LineSegments {
  /**
   * Creates a new LineBox instance
   * @param x - Width of the box
   * @param y - Height of the box
   * @param z - Depth of the box, drawn towards negative z
   * @param color - Color of the box edges
   * @param dashed - Whether to draw dashed instead of solid lines (default: true)
   */
  constructor(x: number, y: number, z: number, color: Color | number | string, dashed = true) {
    const geometryBox = LineBox.createBoxGeometry(x, y, -z);
    const material = dashed
      ? new LineDashedMaterial({ color: new Color(color), dashSize: 3, gapSize: 1 })
      : new LineBasicMaterial({ color: new Color(color) });

    super(geometryBox, material);

    if (dashed) {
      this.computeLineDistances();
    }
  }

  /**
   * Creates the edge geometry of a box spanning (0, 0, 0) to (x, y, z)
   * @param x - Width of the box
   * @param y - Height of the box
   * @param z - Depth of the box, unnegated
   * @returns BufferGeometry holding the box's 12 edges as line segment pairs
   */
  static createBoxGeometry(x: number, y: number, z: number): BufferGeometry {
    const geometry = new BufferGeometry();
    const position: number[] = [];

    // Define edges from (0, 0, 0) to (x, y, z)
    // prevent eslint from spreading the code over multiple lines
    // prettier-ignore
    position.push(
      0, 0, 0, 0, y, 0,
      0, y, 0, x, y, 0,
      x, y, 0, x, 0, 0,
      x, 0, 0, 0, 0, 0,

      0, 0, z, 0, y, z,
      0, y, z, x, y, z,
      x, y, z, x, 0, z,
      x, 0, z, 0, 0, z,

      0, 0, 0, 0, 0, z,
      0, y, 0, 0, y, z,
      x, y, 0, x, y, z,
      x, 0, 0, x, 0, z
    );

    geometry.setAttribute('position', new Float32BufferAttribute(position, 3));

    return geometry;
  }

  /**
   * Frees the GPU resources held by the box's geometry and material(s)
   */
  dispose() {
    this.geometry.dispose();
    if (Array.isArray(this.material)) {
      this.material.forEach((material) => material.dispose());
    } else {
      this.material.dispose();
    }
  }
}

export { LineBox };
