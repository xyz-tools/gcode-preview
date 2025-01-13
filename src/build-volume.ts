import { Grid } from './helpers/grid';
import { AxesHelper, Group, Vector3 } from 'three';
import { LineBox } from './helpers/line-box';
import { type Disposable } from './helpers/three-utils';

/**
 * Represents the build volume of a 3D printer.
 */
export class BuildVolume {
  /** Width of the build volume in mm */
  x: number;
  /** Depth of the build volume in mm */
  y: number;
  /** Height of the build volume in mm */
  z: number;
  /** Color used for the grid */
  color: number;
  /** List of disposable objects that need cleanup */
  private disposables: Disposable[] = [];

  /**
   * Creates a new BuildVolume instance
   * @param x - Width in mm
   * @param y - Depth in mm
   * @param z - Height in mm
   * @param color - Color for visualization (default: 0x888888)
   */
  constructor(x: number, y: number, z: number, color: number = 0x888888) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.color = color;
  }

  /**
   * Creates and positions the XYZ axes helper for the build volume
   * @returns Configured AxesHelper instance
   */
  createAxes(): AxesHelper {
    const axes = new AxesHelper(10);

    const scale = new Vector3(1, 1, 1);
    scale.z *= -1;

    axes.scale.multiply(scale);
    axes.position.setZ(this.y / 2);
    axes.position.setX(-this.x / 2);

    this.disposables.push(axes);

    return axes;
  }

  /**
   * Creates a grid visualization for the build volume's base
   * @returns Configured Grid instance
   */
  createGrid(): Grid {
    const grid = new Grid(this.x, 10, this.y, 10, this.color);
    this.disposables.push(grid);
    return grid;
  }

  /**
   * Creates a wireframe box representing the build volume boundaries
   * @returns Configured LineBox instance
   */
  createLineBox(): LineBox {
    const lineBox = new LineBox(this.x, this.z, this.y, this.color);
    this.disposables.push(lineBox);
    return lineBox;
  }

  /**
   * Creates a group containing all visualization elements (box, grid, axes)
   * @returns Group containing all build volume visualizations
   */
  createGroup(): Group {
    const group = new Group();
    group.add(this.createLineBox());
    group.add(this.createGrid());
    group.add(this.createAxes());

    return group;
  }

  /**
   * Cleans up all disposable resources created by this build volume
   */
  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }
}
