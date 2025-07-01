import { Grid } from './helpers/grid';
import { AxesHelper, Color, Group, Vector3, Scene } from 'three';
import { LineBox } from './helpers/line-box';
import { type Disposable } from './helpers/three-utils';

/**
 * Represents the build volume of a 3D printer.
 */
export class BuildVolume {
  /** Width of the build volume in mm */
  private _x: number;
  /** Depth of the build volume in mm */
  private _y: number;
  /** Height of the build volume in mm */
  private _z: number;
  /** Color used for the grid */
  private gridColor: Color = new Color(0x888888); // Default grid color
  private smallGridColor: Color = new Color(0x444444); // Default small grid color

  /** List of disposable objects that need cleanup */
  private _group: Group | null = null;

  /**
   * Creates a new BuildVolume instance
   * @param x - Width in mm
   * @param y - Depth in mm
   * @param z - Height in mm
   * @param smallGrid - Whether to show a small grid
   * @param scene - The Three.js scene to add the build volume to
   */
  constructor(
    x: number,
    y: number,
    z: number,
    private _smallGrid: boolean | undefined,
    private scene: Scene
  ) {
    this._x = x;
    this._y = y;
    this._z = z;
  }

  get x(): number {
    return this._x;
  }
  set x(value: number) {
    this._x = value;
    if (this._x < 0) {
      this._x = 0;
    }
    this.update(); // Update the build volume when x changes
  }
  get y(): number {
    return this._y;
  }
  set y(value: number) {
    this._y = value;
    if (this._y <= 0) {
      this._y = 0;
    }
    this.update(); // Update the build volume when y changes
  }
  get z(): number {
    return this._z;
  }
  set z(value: number) {
    if (value < 0) {
      throw new Error('Height (z) must be equal to or greater than 0');
    }
    this._z = value;
    this.update(); // Update the build volume when z changes
  }
  get smallGrid(): boolean | undefined {
    return this._smallGrid;
  }
  set smallGrid(value: boolean | undefined) {
    if (this._smallGrid !== value) {
      this._smallGrid = value;
      this.update(); // Update the build volume when smallGrid changes
    }
  }

  /**
   * Updates the build volume visualization in the scene.
   * If the group doesn't exist, it creates and adds it to the scene.
   *
   * TODO: move this to a more appropriate place, like a scene manager
   */
  update(): void {
    if (this._group) {
      this.scene.remove(this._group);
      // It's important to dispose of the old group's children properly
      this._group.children.forEach((child) => {
        const disposable = child as unknown as Disposable;
        if (typeof disposable.dispose === 'function') {
          disposable.dispose();
        }
      });
      this._group.clear();
    }

    if (this.x <= 0 || this.y <= 0) return; // No need to create a build volume if dimensions are invalid

    this._group = this.createGroup();
    this.scene.add(this._group);
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

    return axes;
  }

  /**
   * Creates a grid visualization for the build volume's base
   * @returns Configured Grid instance
   */
  createGrid(size = 1, color: Color): Grid {
    const grid = new Grid(this.x, size, this.y, size, color);
    // const grid = new GridHelper(200,10, color, color);
    return grid;
  }

  /**
   * Creates a wireframe box representing the build volume boundaries
   * @returns Configured LineBox instance
   */
  createLineBox(): LineBox {
    const lineBox = new LineBox(this.x, this.z, this.y, this.gridColor, false);
    return lineBox;
  }

  /**
   * Creates a group containing all visualization elements (box, grid, axes)
   * @returns Group containing all build volume visualizations
   */
  createGroup(): Group {
    const group = new Group();
    group.name = 'BuildVolume';
    group.add(this.createLineBox());
    if (this.smallGrid) {
      group.add(this.createGrid(1, this.smallGridColor)); // Darker grid for better visibility
    }
    group.add(this.createGrid(10, this.gridColor));
    group.add(this.createAxes());

    return group;
  }

  /**
   * Cleans up all disposable resources created by this build volume
   * and removes the group from the scene.
   */
  dispose(): void {
    if (this._group) {
      this.scene.remove(this._group);
      this._group.children.forEach((child) => {
        const disposable = child as unknown as Disposable;
        if (typeof disposable.dispose === 'function') {
          disposable.dispose();
        }
      });
      this._group.clear();
      this._group = null;
    }
  }
}
