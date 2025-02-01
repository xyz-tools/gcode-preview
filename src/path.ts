/* eslint-disable no-unused-vars */
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
  /** Type of path movement */
  public travelType: PathType;

  /** Width of extruded material */
  public extrusionWidth: number;

  /** Height of extruded line */
  public lineHeight: number;

  /** Tool number used for this path */
  public tool: number;

  /** Internal storage for path vertices */
  private _vertices: number[];

  /**
   * Creates a new Path instance
   * @param travelType - Type of path movement
   * @param extrusionWidth - Width of extruded material (default: 0.6)
   * @param lineHeight - Height of extruded line (default: 0.2)
   * @param tool - Tool number (default: 0)
   */
  constructor(travelType: PathType, extrusionWidth = 0.6, lineHeight = 0.2, tool = 0) {
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
   * @param opts.extrusionWidthOverride - Optional override for extrusion width
   * @param opts.lineHeightOverride - Optional override for line height
   * @returns BufferGeometry representing the path
   */
  geometry(opts: { extrusionWidthOverride?: number; lineHeightOverride?: number } = {}): BufferGeometry {
    if (this._vertices.length < 6) {
      // a path needs at least 2 points to be valid
      console.warn('Path has less than 6 points, returning empty geometry');
      return null;
    }

    // check for zero length paths
    // do this check for each segment
    for (let i = 0; i < this._vertices.length - 3; i += 3) {
      const dx = this._vertices[i] - this._vertices[i + 3];
      const dy = this._vertices[i + 1] - this._vertices[i + 4];
      const dz = this._vertices[i + 2] - this._vertices[i + 5];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance < 0.0001) {
        console.warn('Path has zero length, skipping');
        return null;
      }
    }

    return new ExtrusionGeometry(
      this.path(),
      opts.extrusionWidthOverride ?? this.extrusionWidth,
      opts.lineHeightOverride ?? this.lineHeight,
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

  /**
   * Checks if the path contains any vertical moves
   * @returns True if any Z coordinates differ from the initial Z
   */
  hasVerticalMoves(): boolean {
    return this.vertices.some((_, i, arr) => i % 3 === 2 && arr[i] !== arr[2]);
  }
}
