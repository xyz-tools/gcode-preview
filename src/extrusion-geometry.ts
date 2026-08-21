import { BufferAttribute, BufferGeometry, Vector2, Vector3 } from 'three';

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

    // Scratch vectors for computeCornerAngles. It runs once per point, and
    // allocating a fresh set each time means hundreds of thousands of short
    // lived Vector3 on a real model. Every one is fully overwritten before use,
    // and generateSegment consumes the result before the next call, so they are
    // safe to share.
    const tangent = new Vector3();
    const cornerNormal = new Vector3();
    const cornerBinormal = new Vector3();
    const cross = new Vector3();
    const nextDirection = new Vector3();

    // buffers, sized up front from the path topology so they are filled in
    // place. Growing plain arrays and letting three.js copy them into typed
    // arrays afterwards costs both the repeated growth and the copy.
    const ringSize = radialSegments + 1;
    // one ring per point, plus the closing ring generateBufferData adds
    const vertexCount = (points.length + 1) * ringSize;
    const uvCount = points.length * ringSize;
    const indexCount = Math.max(0, points.length - 1) * radialSegments * 6;

    // The ring of sines and cosines depends only on j, which runs from 0 to
    // radialSegments, so it is the same for every point on the path. Computing
    // it once keeps a large model from making a million trig calls to produce a
    // handful of distinct values.
    const ringSin = new Float64Array(radialSegments + 1);
    const ringCos = new Float64Array(radialSegments + 1);
    for (let j = 0; j <= radialSegments; j++) {
      const angle = (j / radialSegments) * Math.PI * 2;
      ringSin[j] = Math.sin(angle);
      ringCos[j] = -Math.cos(angle);
    }

    const vertices = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(uvCount * 2);
    // indices only ever reference this geometry's own vertices, so the widest
    // value is vertexCount - 1
    const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

    let vertexCursor = 0;
    let normalCursor = 0;
    let uvCursor = 0;
    let indexCursor = 0;

    // create buffer data

    generateBufferData();

    // build geometry

    this.setIndex(new BufferAttribute(indices, 1));
    this.setAttribute('position', new BufferAttribute(vertices, 3));
    this.setAttribute('normal', new BufferAttribute(normals, 3));
    this.setAttribute('uv', new BufferAttribute(uvs, 2));

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
        const sin = ringSin[j];
        const cos = ringCos[j];

        // normal
        normal.x = cos * N.x + sin * B.x;
        normal.y = cos * N.y + sin * B.y;
        normal.z = cos * N.z + sin * B.z;

        normal.normalize();
        normals[normalCursor++] = normal.x;
        normals[normalCursor++] = normal.y;
        normals[normalCursor++] = normal.z;

        // vertex

        vertex.x = P.x + lineWidth * normal.x * 0.5;
        vertex.y = P.y + lineWidth * normal.y * 0.5;
        vertex.z = P.z + lineHeight * normal.z * 0.5;
        vertices[vertexCursor++] = vertex.x;
        vertices[vertexCursor++] = vertex.y;
        vertices[vertexCursor++] = vertex.z - lineHeight * 0.5;
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

          indices[indexCursor++] = a;
          indices[indexCursor++] = b;
          indices[indexCursor++] = d;
          indices[indexCursor++] = b;
          indices[indexCursor++] = c;
          indices[indexCursor++] = d;
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

          uvs[uvCursor++] = uv.x;
          uvs[uvCursor++] = uv.y;
        }
      }
    }

    /**
     * Computes the corner angles (position, normal, binormal) for a segment
     *
     * Note: the returned N/B vectors are shared scratch — consume them before
     * the next call; do not store references.
     * @param i - Index of the segment
     * @returns Array containing position, normal and binormal vectors
     */
    function computeCornerAngles(i: number): Array<Vector3> {
      const P = points[i];
      const N = cornerNormal;
      const B = cornerBinormal;
      const vec = cross;

      tangent
        .copy(P)
        .sub(points[i - 1] || P)
        .normalize()
        .add(
          nextDirection
            .copy(points[i + 1] || P)
            .sub(P)
            .normalize()
        )
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
