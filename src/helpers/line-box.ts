import { BufferGeometry, Float32BufferAttribute, Color, LineSegments, LineDashedMaterial } from 'three';

/**
 * A helper class that creates a 3D box outline with dashed lines using Three.js LineSegments.
 * The box is centered at the origin and can be configured with different dimensions and colors.
 */
class LineBox extends LineSegments {
  /**
   * Creates a new LineBox instance
   * @param x - Width of the box along the X axis
   * @param y - Height of the box along the Y axis
   * @param z - Depth of the box along the Z axis
   * @param color - Color of the box lines (can be Color, hex number, or CSS color string)
   */
  constructor(x: number, y: number, z: number, color: Color | number | string) {
    // Create geometry for the box
    const geometryBox = LineBox.createBoxGeometry(x, y, z);

    // Create material for the lines with dashed effect
    const material = new LineDashedMaterial({ color: new Color(color), dashSize: 3, gapSize: 1 });

    // Initialize the LineSegments with the geometry and material
    super(geometryBox, material);

    // Compute line distances for the dashed effect
    this.computeLineDistances();

    // Align the bottom of the box to Y position
    this.position.setY(y / 2);
  }

  /**
   * Creates the geometry for the box outline
   * @param xSize - Width of the box along the X axis
   * @param ySize - Height of the box along the Y axis
   * @param zSize - Depth of the box along the Z axis
   * @returns BufferGeometry containing the box's line segments
   */
  static createBoxGeometry(xSize: number, ySize: number, zSize: number): BufferGeometry {
    const x = xSize / 2;
    const y = ySize / 2;
    const z = zSize / 2;

    const geometry = new BufferGeometry();
    const position: number[] = [];

    // Define box edges for LineSegments
    position.push(
      -x,
      -y,
      -z,
      -x,
      y,
      -z,
      -x,
      y,
      -z,
      x,
      y,
      -z,
      x,
      y,
      -z,
      x,
      -y,
      -z,
      -x,
      -y,
      z,
      -x,
      y,
      z,
      -x,
      y,
      z,
      x,
      y,
      z,
      x,
      y,
      z,
      x,
      -y,
      z,
      -x,
      y,
      -z,
      -x,
      y,
      z,
      x,
      y,
      -z,
      x,
      y,
      z
    );

    geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
    return geometry;
  }

  /**
   * Disposes of the box's geometry and material resources
   * Call this method when the box is no longer needed to free up memory
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
