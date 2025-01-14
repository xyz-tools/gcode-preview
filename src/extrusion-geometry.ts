import { BufferGeometry, Float32BufferAttribute, Vector2, Vector3 } from 'three';

/**
 * A geometry class for extruding 3D paths into volumetric shapes
 */
class ExtrusionGeometry extends BufferGeometry {
  /**
   * Parameters used to create this geometry
   */
  parameters: {
    /** Array of points defining the path */
    points: Vector3[];
    /** Width of the extruded shape */
    lineWidth: number;
    /** Height of the extruded shape */
    lineHeight: number;
    /** Number of segments around the circumference */
    radialSegments: number;
    /** Whether the path is closed */
    closed: boolean;
  };

  /**
   * The geometry type
   */
  readonly type: string;

  /**
   * Creates a new ExtrusionGeometry
   * @param points - Array of points defining the path (default: single point at origin)
   * @param lineWidth - Width of the extruded shape (default: 0.6)
   * @param lineHeight - Height of the extruded shape (default: 0.2)
   * @param radialSegments - Number of segments around the circumference (default: 8)
   */
  constructor(
    points: Vector3[] = [new Vector3()],
    lineWidth: number = 0.6,
    lineHeight: number = 0.2,
    radialSegments: number = 8
  ) {
    super();

    this.type = 'ExtrusionGeometry';

    this.parameters = {
      points: points,
      lineWidth: lineWidth,
      lineHeight: lineHeight,
      radialSegments: radialSegments,
      closed: false
    };

    // helper variables

    const vertex = new Vector3();
    const normal = new Vector3();
    const uv = new Vector2();

    // buffer

    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // create buffer data

    generateBufferData();

    // build geometry

    this.setIndex(indices);
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));

    // functions

    /**
     * Generates all buffer data (vertices, normals, UVs, and indices)
     */
    function generateBufferData(): void {
      for (let i = 0; i < points.length; i++) {
        generateSegment(i);
      }

      // if the geometry is not closed, generate the last row of vertices and normals
      // at the regular position on the given path
      //
      // if the geometry is closed, duplicate the first row of vertices and normals (uvs will differ)

      generateSegment(closed === false ? points.length - 1 : 0);

      // uvs are generated in a separate function.
      // this makes it easy compute correct values for closed geometries

      generateUVs();

      // finally create faces

      generateIndices();
    }

    /**
     * Generates vertices and normals for a segment of the path
     * @param i - Index of the segment to generate
     */
    function generateSegment(i: number): void {
      // First get the tangent to the corner between the two segments.

      const [P, N, B] = computeCornerAngles(i);

      // generate points around the tangent

      for (let j = 0; j <= radialSegments; j++) {
        const v = (j / radialSegments) * Math.PI * 2;
        const sin = Math.sin(v);
        const cos = -Math.cos(v);

        // normal
        normal.x = cos * N.x + sin * B.x;
        normal.y = cos * N.y + sin * B.y;
        normal.z = cos * N.z + sin * B.z;

        normal.normalize();
        normals.push(normal.x, normal.y, normal.z);

        // vertex

        vertex.x = P.x + lineWidth * normal.x * 0.5;
        vertex.y = P.y + lineWidth * normal.y * 0.5;
        vertex.z = P.z + lineHeight * normal.z * 0.5;
        vertices.push(vertex.x, vertex.y, vertex.z - lineHeight * 0.5);
      }
    }

    /**
     * Generates face indices to connect the vertices
     */
    function generateIndices(): void {
      for (let j = 1; j < points.length; j++) {
        for (let i = 1; i <= radialSegments; i++) {
          const a = (radialSegments + 1) * (j - 1) + (i - 1);
          const b = (radialSegments + 1) * j + (i - 1);
          const c = (radialSegments + 1) * j + i;
          const d = (radialSegments + 1) * (j - 1) + i;

          // faces

          indices.push(a, b, d);
          indices.push(b, c, d);
        }
      }
    }

    /**
     * Generates UV coordinates for texture mapping
     */
    function generateUVs(): void {
      for (let i = 0; i < points.length; i++) {
        for (let j = 0; j <= radialSegments; j++) {
          uv.x = i / points.length;
          uv.y = j / radialSegments;

          uvs.push(uv.x, uv.y);
        }
      }
    }

    /**
     * Computes the corner angles (position, normal, binormal) for a segment
     * @param i - Index of the segment
     * @returns Array containing position, normal and binormal vectors
     */
    function computeCornerAngles(i: number): Array<Vector3> {
      const P = points[i];
      const tangent = new Vector3();
      const N = new Vector3();
      const B = new Vector3();
      const vec = new Vector3();

      tangent
        .copy(P)
        .sub(points[i - 1] || P)
        .normalize()
        .add((points[i + 1] || P).clone().sub(P).normalize())
        .normalize();

      // Calculate the normal and binormal vectors for the segment
      // it used to be pre-computed using a curve `.computeFrenetFrames`
      let min = Number.MAX_VALUE;
      const tx = Math.abs(tangent.x);
      const ty = Math.abs(tangent.y);
      const tz = Math.abs(tangent.z);

      if (tx <= min) {
        min = tx;
        N.set(1, 0, 0);
      }

      if (ty <= min) {
        min = ty;
        N.set(0, 1, 0);
      }

      if (tz <= min) {
        N.set(0, 0, 1);
      }

      vec.crossVectors(tangent, N).normalize();

      N.crossVectors(tangent, vec);
      B.crossVectors(tangent, N);

      return [P, N, B];
    }
  }
}

export { ExtrusionGeometry };
