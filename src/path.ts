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

  /** Width of extruded material, or `undefined` when slicer metadata provided none */
  public extrusionWidth?: number;

  /** Height of extruded line, or `undefined` when slicer metadata provided none */
  public lineHeight?: number;

  /** Tool number used for this path */
  public tool: number;

  /** Index of the layer this path belongs to, set by the LayersIndexer; undefined for non-planar jobs */
  public layerIndex?: number;

  /** Internal storage for path vertices */
  private _vertices: number[];

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
    const segment = this.subPath(this._vertices.slice(this._vertices.length - 6));
    const body = this._vertices.length > 6 ? this.subPath(this._vertices.slice(0, this._vertices.length - 3)) : null;
    return { body, segment };
  }

  /** Builds a path carrying this path's extrusion settings over a slice of vertices. */
  private subPath(vertices: number[]): Path {
    const path = new Path(this.travelType, this.extrusionWidth, this.lineHeight, this.tool);
    for (let i = 0; i < vertices.length; i += 3) {
      path.addPoint(vertices[i], vertices[i + 1], vertices[i + 2]);
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
   * Dimensions resolve per path: the path's own value (from slicer metadata)
   * wins, then the caller's fallback (the renderer's global setting), then
   * the built-in defaults.
   */
  geometry(opts: { extrusionWidthFallback?: number; lineHeightFallback?: number } = {}): BufferGeometry {
    if (this._vertices.length < 6) {
      // a path needs at least 2 points to be valid
      console.warn('Path has less than 6 points, returning empty geometry');
      return null;
    }

    return new ExtrusionGeometry(
      this.path(),
      this.extrusionWidth ?? opts.extrusionWidthFallback ?? Path.DEFAULT_EXTRUSION_WIDTH,
      this.lineHeight ?? opts.lineHeightFallback ?? Path.DEFAULT_LINE_HEIGHT,
      4
    );
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
