import { BufferGeometry, Color, Float32BufferAttribute, LineBasicMaterial, LineDashedMaterial, LineSegments } from "three";

class LineBox extends LineSegments {
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

  static createBoxGeometry(x: number, y: number, z: number): BufferGeometry {
    const geometry = new BufferGeometry();
    const position: number[] = [];

    // Define edges from (0, 0, 0) to (x, y, z)
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
