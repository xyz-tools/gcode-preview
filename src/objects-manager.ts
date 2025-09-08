import { LineBox } from './helpers/line-box';
import { Path } from './path';
import { type Disposable } from './helpers/three-utils';

import {
  Group,
  Scene,
  Color,
  Plane,
  Vector3,
  ShaderMaterial,
  Euler,
  BatchedMesh,
  BufferGeometry,
  Material
} from 'three';

import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { createColorMaterial } from './helpers/colorMaterial';

export class ObjectsManager {
  extrusionsGroup: Group;
  travelMovesGroup: Group;
  boundingBox: LineBox;
  scene: Scene;
  disposables: Disposable[] = [];
  clippingPlanes: Plane[] = [];

  // shader material
  materials: ShaderMaterial[] = [];
  ambientLight = 0.4;
  directionalLight = 1.3;
  brightness = 1.3;

  lineWidth: number;
  lineHeight: number;

  extrusionWidth = 0.6;

  private renderedPaths: Path[] = [];

  constructor(scene: Scene, lineWidth: number, lineHeight = 0.2, extrusionWidth = 0.6) {
    this.scene = scene;
    this.extrusionsGroup = this.createGroup('Extrusions');
    this.travelMovesGroup = this.createGroup('Travel Moves');
    this.scene.add(this.extrusionsGroup);
    this.scene.add(this.travelMovesGroup);

    this.lineWidth = lineWidth;
    this.lineHeight = lineHeight ?? 0.2;
    this.extrusionWidth = extrusionWidth;
    this.clippingPlanes = this.createClippingPlanes(lineWidth, lineHeight);
  }

  hideTravels() {
    this.travelMovesGroup.visible = false;
  }

  showTravels() {
    this.travelMovesGroup.visible = true;
  }

  hideExtrusions() {
    this.extrusionsGroup.visible = false;
  }

  showExtrusions() {
    this.extrusionsGroup.visible = true;
  }

  renderTravelLines(paths: Path[], color: Color) {
    const unrenderedPaths = paths.filter((p) => !this.renderedPaths.includes(p));
    const line = this.renderPathsAsLines(unrenderedPaths, color);
    this.travelMovesGroup.add(line);
    this.renderedPaths.push(...unrenderedPaths);
  }

  renderExtrusionLines(paths: Path[], color: Color) {
    const unrenderedPaths = paths.filter((p) => !this.renderedPaths.includes(p));
    const line = this.renderPathsAsLines(unrenderedPaths, color);
    this.extrusionsGroup.add(line);
    this.renderedPaths.push(...unrenderedPaths);
  }

  renderExtrusionTubes(paths: Path[], color: Color) {
    const unrenderedPaths = paths.filter((p) => !this.renderedPaths.includes(p));
    const tubes = this.renderPathsAsTubes(unrenderedPaths, color);
    this.extrusionsGroup.add(tubes);
    this.renderedPaths.push(...unrenderedPaths);
  }

  dispose() {
    this.extrusionsGroup.removeFromParent();
    this.travelMovesGroup.removeFromParent();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  updateClippingPlanes(minZ: number, maxZ: number) {
    this.updateClippingPlanesForShaderMaterials(minZ, maxZ);
    this.updateLineClipping(minZ, maxZ);
  }

  private renderPathsAsLines(paths: Path[], color: Color): LineSegments2 {
    console.log('rendering lines', paths.length);
    const material = new LineMaterial({
      color: Number(color.getHex()),
      linewidth: this.lineWidth
    });

    // lines need to be offset.
    // The gcode specifies the nozzle height which is the top of the extrusion.
    // The line doesn't have a constant height in world coords so it should be rendered at horizontal midplane of the extrusion layer.
    // Otherwise the line will be clipped by the clipping plane.
    const offset = -this.lineHeight / 2;
    const lineVertices: number[] = [];
    paths.forEach((path) => {
      for (let i = 0; i < path.vertices.length - 3; i += 3) {
        lineVertices.push(path.vertices[i], path.vertices[i + 1] - 0.1, path.vertices[i + 2] + offset);
        lineVertices.push(path.vertices[i + 3], path.vertices[i + 4] - 0.1, path.vertices[i + 5] + offset);
      }
    });

    const geometry = new LineSegmentsGeometry().setPositions(lineVertices);
    this.disposables.push(material);
    this.disposables.push(geometry);
    return new LineSegments2(geometry, material);
  }

  /**
   * Renders paths as 3D tubes
   * @param paths - Array of paths to render
   * @param color - Color to use for the tubes
   */
  private renderPathsAsTubes(paths: Path[], color: Color): BatchedMesh {
    console.log('rendering tubes', paths.length);
    const colorNumber = Number(color.getHex());
    const geometries: BufferGeometry[] = [];

    const material = createColorMaterial(colorNumber, this.ambientLight, this.directionalLight, this.brightness);

    this.materials.push(material);

    paths.forEach((path) => {
      const geometry = path.geometry({
        extrusionWidthOverride: this.extrusionWidth,
        lineHeightOverride: this.lineHeight
      });

      if (!geometry) return;

      this.disposables.push(geometry);
      geometries.push(geometry);
    });

    const batchedMesh = this.createBatchMesh(geometries, material);
    this.disposables.push(material);
    return batchedMesh;
  }

  /**
   * Creates a batched mesh from multiple geometries sharing the same material
   * @param geometries - Array of geometries to batch
   * @param material - Material to use for the batched mesh
   * @returns Batched mesh instance
   */
  private createBatchMesh(geometries: BufferGeometry[], material: Material): BatchedMesh {
    const maxVertexCount = geometries.reduce((acc, geometry) => geometry.attributes.position.count * 3 + acc, 0);

    const batchedMesh = new BatchedMesh(geometries.length, maxVertexCount, undefined, material);
    this.disposables.push(batchedMesh);

    geometries.forEach((geometry) => {
      const geometryId = batchedMesh.addGeometry(geometry);
      // NOTE: for older versions of three.js, addInstance is not available
      // This allow webgl1 browsers to use the batched mesh
      batchedMesh.addInstance?.(geometryId);
    });

    return batchedMesh;
  }

  /**
   * Applies clipping planes to the specified material based on the minimum and maximum Z values.
   *
   * This method creates clipping planes for the top and bottom of the specified Z range,
   * then applies them to the material's clippingPlanes property.
   *
   * @param material - Shader material to apply clipping planes to
   * @param minZ - The minimum Z value for the clipping plane.
   * @param maxZ - The maximum Z value for the clipping plane.
   */
  private createClippingPlanes(minZ?: number | undefined, maxZ?: number | undefined) {
    const planes = [];
    if (minZ !== undefined) {
      planes.push(new Plane(new Vector3(0, 1, 0), -minZ));
    }
    if (maxZ !== undefined) {
      planes.push(new Plane(new Vector3(0, -1, 0), maxZ));
    }
    return planes;
  }

  /**
   * Updates the clipping planes for all `LineSegments2` objects in the scene.
   * This method filters the scene's children to find instances of `LineSegments2`,
   * then applies the clipping planes to their materials.
   *
   * @param minZ - The minimum Z value for the clipping plane.
   * @param maxZ - The maximum Z value for the clipping plane.
   */
  private updateLineClipping(minZ: number | undefined, maxZ: number | undefined) {
    // TODO: apply clipping selectively to travels lines and extrusion lines
    // and/or use a clipping group
    this.scene.traverse((obj) => {
      if (obj instanceof LineSegments2) {
        const material = obj.material as LineMaterial;
        material.clippingPlanes = this.createClippingPlanes(minZ, maxZ);
      }
    });
  }

  /**
   * Updates the clipping planes for all shader materials in the scene.
   * This method sets the min and max Z values for the clipping planes in the shader materials.
   *
   * @param minZ - The minimum Z value for the clipping plane.
   * @param maxZ - The maximum Z value for the clipping plane
   */

  private updateClippingPlanesForShaderMaterials(minZ: number, maxZ: number) {
    this.materials.forEach((material) => {
      material.uniforms.clipMinY.value = minZ;
      material.uniforms.clipMaxY.value = maxZ;
    });
  }

  /**
   * Creates a new Three.js group for organizing rendered paths
   * @param name - Name for the group
   * @returns Configured Three.js group
   * @remarks
   * Sets up the group's orientation and position based on build volume dimensions.
   * If no build volume is defined, uses a default position.
   */
  private createGroup(name: string): Group {
    const group = new Group();
    group.name = name;
    group.quaternion.setFromEuler(new Euler(-Math.PI / 2, 0, 0));
    return group;
  }
}
