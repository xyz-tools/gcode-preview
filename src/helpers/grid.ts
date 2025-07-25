import { BufferGeometry, Color, Float32BufferAttribute, LineBasicMaterial, LineSegments } from 'three';

class Grid extends LineSegments {
  constructor(sizeX: number, stepX: number, sizeZ: number, stepZ: number, color: Color | string | number = 0x888888) {
    color = new Color(color);

    const vertices: number[] = [];
    const colors: number[] = [];
    let j = 0;

    // Lines parallel to X-axis (move along Z)
    for (let z = 0; z <= sizeZ; z += stepZ) {
      vertices.push(0, 0, z, sizeX, 0, z);
      color.toArray(colors, j);
      j += 3;
      color.toArray(colors, j);
      j += 3;
    }

    // Lines parallel to Z-axis (move along X)
    for (let x = 0; x <= sizeX; x += stepX) {
      vertices.push(x, 0, 0, x, 0, sizeZ);
      color.toArray(colors, j);
      j += 3;
      color.toArray(colors, j);
      j += 3;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geometry.rotateX(Math.PI); // Rotate to align with the XZ plane
    const material = new LineBasicMaterial({ vertexColors: true, toneMapped: false });

    super(geometry, material);
  }

  override readonly type = 'GridHelper';

  dispose() {
    this.geometry.dispose();
    if (Array.isArray(this.material)) {
      this.material.forEach((m) => m.dispose());
    } else {
      this.material.dispose();
    }
  }
}

export { Grid };
