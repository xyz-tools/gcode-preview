import { BufferGeometry, Vector3 } from 'three';
import { ExtrusionGeometry } from './extrusion-geometry';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

/**
 * Type of path movement
 */
export enum PathType {
  /** Travel move (non-extrusion) */
  Travel = 'Travel',
  /** Extrusion move (material deposition) */
  Extrusion = 'Extrusion'
}

/**
 * Represents a path in 3D space with associated properties
 * @remarks
 * Used to store and manipulate G-code path data including vertices,
 * extrusion parameters, and tool information
 */
export class Path {
  /** Default extrusion width, used when neither the path nor the renderer supplies one */
  static readonly DEFAULT_EXTRUSION_WIDTH = 0.6;

  /** Default line height, used when neither the path nor the renderer supplies one */
  static readonly DEFAULT_LINE_HEIGHT = 0.2;

  /** Type of path movement */
  public travelType: PathType;

  /**
   * Width of extruded material, or `undefined` when slicer metadata provided none
   * @remarks
   * When the dimensions changed mid-path (see {@link updateDimensions}) this
   * holds the most recent width; the earlier widths live per point.
   */
  public extrusionWidth?: number;

  /**
   * Height of extruded line, or `undefined` when slicer metadata provided none
   * @remarks
   * When the dimensions changed mid-path (see {@link updateDimensions}) this
   * holds the most recent height; the earlier heights live per point.
   */
  public lineHeight?: number;

  /** Tool number used for this path */
  public tool: number;

  /** Index of the layer this path belongs to, set by the LayersIndexer; undefined for non-planar jobs */
  public layerIndex?: number;

  /** Internal storage for path vertices */
  private _vertices: number[];

  /**
   * Per-point [width, height] pairs, parallel to the vertices. Only allocated
   * once the dimensions change mid-path; a path with uniform dimensions keeps
   * the two scalars alone. `NaN` encodes "unknown" (no slicer metadata), so
   * the render-time fallback still applies per point.
   */
  private _pointDims?: number[];

  /**
   * Creates a new Path instance
   * @param travelType - Type of path movement
   * @param extrusionWidth - Width of extruded material, when known
   * @param lineHeight - Height of extruded line, when known
   * @param tool - Tool number (default: 0)
   * @remarks
   * A path's own dimensions come from slicer metadata and take precedence at
   * render time; a path without them falls back to the renderer's global
   * setting, then to the built-in defaults.
   */
  constructor(travelType: PathType, extrusionWidth?: number, lineHeight?: number, tool = 0) {
    this.travelType = travelType;
    this._vertices = [];
    this.extrusionWidth = extrusionWidth;
    this.lineHeight = lineHeight;
    this.tool = tool;
  }

  /**
   * Gets the path's vertices as a flat array of numbers
   * @returns Array of vertex coordinates in [x,y,z] order
   */
  get vertices(): number[] {
    return this._vertices;
  }

  /**
   * Adds a new point to the path
   * @param x - X coordinate
   * @param y - Y coordinate
   * @param z - Z coordinate
   */
  addPoint(x: number, y: number, z: number): void {
    this._vertices.push(x, y, z);
    this._pointDims?.push(this.extrusionWidth ?? NaN, this.lineHeight ?? NaN);
  }

  /**
   * Changes the extrusion dimensions for the points added from here on
   * @param extrusionWidth - Width for the upcoming points, when known
   * @param lineHeight - Height for the upcoming points, when known
   * @remarks
   * The first mid-path change switches the path to per-point dimensions: the
   * points added so far keep the dimensions they were added under, and each
   * later point records the dimensions current at its own add. This is what
   * lets one path span slicer dimension changes (`;WIDTH:` / `;HEIGHT:`)
   * instead of being broken apart at every change — the path used to be
   * split here, which multiplied path counts on adaptive-layer-height files.
   */
  updateDimensions(extrusionWidth?: number, lineHeight?: number): void {
    if (extrusionWidth === this.extrusionWidth && lineHeight === this.lineHeight) {
      return;
    }
    if (this._pointDims === undefined) {
      const dims = new Array<number>((this._vertices.length / 3) * 2);
      for (let i = 0; i < dims.length; i += 2) {
        dims[i] = this.extrusionWidth ?? NaN;
        dims[i + 1] = this.lineHeight ?? NaN;
      }
      this._pointDims = dims;
    }
    this.extrusionWidth = extrusionWidth;
    this.lineHeight = lineHeight;
  }

  /**
   * Whether the extrusion dimensions changed somewhere along the path
   */
  get hasVaryingDimensions(): boolean {
    return this._pointDims !== undefined;
  }

  /**
   * Gets the line height at a given point of the path
   * @param pointIndex - Index of the point (not the flat vertex offset)
   * @returns The height the point was added under, or `undefined` when
   * slicer metadata provided none
   */
  lineHeightAt(pointIndex: number): number | undefined {
    if (this._pointDims === undefined) {
      return this.lineHeight;
    }
    const height = this._pointDims[pointIndex * 2 + 1];
    return Number.isNaN(height) ? undefined : height;
  }

  /**
   * Splits the path into its final segment and the body that precedes it.
   * @returns The last two points as `segment`, and everything up to and including
   * the segment's first point as `body` (null when the path is a single segment).
   * Both carry this path's travel type, extrusion settings and tool.
   * @remarks
   * Requires at least two points; used to draw the final segment of a print in
   * its own highlight color while the rest of the path keeps another one.
   */
  splitLastSegment(): { body: Path | null; segment: Path } {
    const pointCount = this._vertices.length / 3;
    const segment = this.subPath(pointCount - 2, pointCount);
    const body = pointCount > 2 ? this.subPath(0, pointCount - 1) : null;
    return { body, segment };
  }

  /** Builds a path carrying this path's extrusion settings over a range of points (end exclusive). */
  private subPath(start: number, end: number): Path {
    const path = new Path(this.travelType, this.extrusionWidth, this.lineHeight, this.tool);
    path._vertices = this._vertices.slice(start * 3, end * 3);
    if (this._pointDims !== undefined) {
      path._pointDims = this._pointDims.slice(start * 2, end * 2);
      // The scalars describe "the points added from now on"; for a finished
      // slice that is its last point's dimensions.
      const lastWidth = path._pointDims[path._pointDims.length - 2];
      const lastHeight = path._pointDims[path._pointDims.length - 1];
      path.extrusionWidth = Number.isNaN(lastWidth) ? undefined : lastWidth;
      path.lineHeight = Number.isNaN(lastHeight) ? undefined : lastHeight;
    }
    return path;
  }

  /**
   * Checks if a point continues the current line
   * @param x - X coordinate to check
   * @param y - Y coordinate to check
   * @param z - Z coordinate to check
   * @returns True if the point matches the last point in the path
   */
  checkLineContinuity(x: number, y: number, z: number): boolean {
    if (this._vertices.length < 3) {
      return false;
    }

    const lastX = this._vertices[this._vertices.length - 3];
    const lastY = this._vertices[this._vertices.length - 2];
    const lastZ = this._vertices[this._vertices.length - 1];

    return x === lastX && y === lastY && z === lastZ;
  }

  /**
   * Converts the path's vertices to an array of Vector3 points
   * @returns Array of Vector3 points
   */
  path(): Vector3[] {
    const path: Vector3[] = [];

    for (let i = 0; i < this._vertices.length; i += 3) {
      path.push(new Vector3(this._vertices[i], this._vertices[i + 1], this._vertices[i + 2]));
    }
    return path;
  }

  /**
   * Creates a 3D geometry from the path
   * @param opts - Geometry options
   * @param opts.extrusionWidthFallback - Width for a path that carries none of its own
   * @param opts.lineHeightFallback - Height for a path that carries none of its own
   * @returns BufferGeometry representing the path
   * @remarks
   * Dimensions resolve per point: the path's own value (from slicer metadata)
   * wins, then the caller's fallback (the renderer's global setting), then
   * the built-in defaults. A path whose dimensions never changed resolves a
   * single pair for all of its points.
   */
  geometry(opts: { extrusionWidthFallback?: number; lineHeightFallback?: number } = {}): BufferGeometry {
    if (this._vertices.length < 6) {
      // a path needs at least 2 points to be valid
      console.warn('Path has less than 6 points, returning empty geometry');
      return null;
    }

    const widthFallback = opts.extrusionWidthFallback ?? Path.DEFAULT_EXTRUSION_WIDTH;
    const heightFallback = opts.lineHeightFallback ?? Path.DEFAULT_LINE_HEIGHT;

    if (this._pointDims === undefined) {
      return new ExtrusionGeometry(
        this.path(),
        this.extrusionWidth ?? widthFallback,
        this.lineHeight ?? heightFallback,
        4
      );
    }

    const pointCount = this._vertices.length / 3;
    const widths = new Float32Array(pointCount);
    const heights = new Float32Array(pointCount);
    for (let i = 0; i < pointCount; i++) {
      const width = this._pointDims[i * 2];
      const height = this._pointDims[i * 2 + 1];
      widths[i] = Number.isNaN(width) ? widthFallback : width;
      heights[i] = Number.isNaN(height) ? heightFallback : height;
    }
    return new ExtrusionGeometry(this.path(), widths, heights, 4);
  }

  /**
   * Creates a line geometry from the path
   * @returns LineSegmentsGeometry representing the path
   */
  line(): LineSegmentsGeometry {
    const lineVertices = [];
    for (let i = 0; i < this._vertices.length - 3; i += 3) {
      lineVertices.push(this._vertices[i], this._vertices[i + 1], this._vertices[i + 2]);
      lineVertices.push(this._vertices[i + 3], this._vertices[i + 4], this._vertices[i + 5]);
    }

    return new LineSegmentsGeometry().setPositions(lineVertices);
  }
}
