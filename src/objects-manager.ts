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

/** Called when a change invalidated the existing geometry and the scene has to be redrawn. */
export type RebuildRequest = () => void;

export class ObjectsManager {
  extrusionsGroup: Group;
  travelMovesGroup: Group;
  scene: Scene;
  disposables: Disposable[] = [];
  /** Clipping planes for the current layer range, applied to every line material we create */
  clippingPlanes: Plane[] = [];

  /** Shader materials used for tube rendering, indexed by tool */
  materials: ShaderMaterial[] = [];
  ambientLight = 0.4;
  directionalLight = 1.3;
  brightness = 1.3;

  lineWidth: number;
  lineHeight: number;
  /** Width of extruded material. Undefined means each path uses its own width. */
  extrusionWidth?: number;
  renderTubes = false;

  /** How long to coalesce geometry rebuilds for, in ms */
  static readonly rebuildDebounce = 100;

  private renderedPaths = new Set<Path>();
  private onRebuildNeeded?: RebuildRequest;
  private rebuildTimeout?: ReturnType<typeof setTimeout>;
  /** Current layer range, kept so materials created later start out clipped correctly */
  private clipMinZ?: number;
  private clipMaxZ?: number;

  constructor(
    scene: Scene,
    lineWidth: number,
    lineHeight = 0.2,
    extrusionWidth?: number,
    onRebuildNeeded?: RebuildRequest
  ) {
    this.scene = scene;
    this.extrusionsGroup = this.createGroup('Extrusions');
    this.travelMovesGroup = this.createGroup('Travel Moves');
    this.scene.add(this.extrusionsGroup);
    this.scene.add(this.travelMovesGroup);

    this.lineWidth = lineWidth;
    this.lineHeight = lineHeight;
    this.extrusionWidth = extrusionWidth;
    this.onRebuildNeeded = onRebuildNeeded;
  }

  // --- visibility: a boolean flip, no geometry work ---------------------------

  setTravelsVisible(visible: boolean) {
    this.travelMovesGroup.visible = visible;
  }

  setExtrusionsVisible(visible: boolean) {
    this.extrusionsGroup.visible = visible;
  }

  // --- appearance: mutate materials in place, no geometry work ----------------

  /**
   * Recolors the extrusions belonging to one tool.
   * @param color - New color
   * @param toolIndex - Tool to recolor, defaulting to the first
   */
  setExtrusionColor(color: Color, toolIndex = 0) {
    const material = this.materials[toolIndex];
    if (material?.uniforms) {
      material.uniforms.uColor.value = color;
    }

    this.extrusionLinesForTool(toolIndex).forEach((line) => {
      (line.material as LineMaterial).color.set(color);
    });
  }

  setTravelColor(color: Color) {
    this.travelMovesGroup.children.forEach((child) => {
      if (child instanceof LineSegments2) {
        (child.material as LineMaterial).color.set(color);
      }
    });
  }

  setAmbientLight(value: number) {
    this.ambientLight = value;
    this.updateUniform('ambient', value);
  }

  setDirectionalLight(value: number) {
    this.directionalLight = value;
    this.updateUniform('directional', value);
  }

  setBrightness(value: number) {
    this.brightness = value;
    this.updateUniform('brightness', value);
  }

  // --- dimensions: baked into the buffers, so these need a rebuild ------------

  setLineWidth(value: number) {
    if (value === this.lineWidth) return;
    this.lineWidth = value;
    this.requestRebuild();
  }

  setLineHeight(value: number) {
    if (value === this.lineHeight) return;
    this.lineHeight = value;
    this.requestRebuild();
  }

  setExtrusionWidth(value: number | undefined) {
    if (value === this.extrusionWidth) return;
    this.extrusionWidth = value;
    this.requestRebuild();
  }

  setRenderTubes(value: boolean) {
    if (value === this.renderTubes) return;
    this.renderTubes = value;
    this.requestRebuild();
  }

  // --- rendering --------------------------------------------------------------

  renderTravelLines(paths: Path[], color: Color) {
    const unrenderedPaths = this.takeUnrendered(paths);
    if (unrenderedPaths.length === 0) return;

    this.travelMovesGroup.add(this.renderPathsAsLines(unrenderedPaths, color));
  }

  /**
   * Renders extrusions in whichever representation is currently selected.
   */
  renderExtrusions(paths: Path[], color: Color, toolIndex = 0) {
    if (this.renderTubes) {
      this.renderExtrusionTubes(paths, color, toolIndex);
    } else {
      this.renderExtrusionLines(paths, color, toolIndex);
    }
  }

  renderExtrusionLines(paths: Path[], color: Color, toolIndex = 0) {
    const unrenderedPaths = this.takeUnrendered(paths);
    if (unrenderedPaths.length === 0) return;

    const lines = this.renderPathsAsLines(unrenderedPaths, color);
    lines.userData.toolIndex = toolIndex;
    this.extrusionsGroup.add(lines);
  }

  renderExtrusionTubes(paths: Path[], color: Color, toolIndex = 0) {
    const unrenderedPaths = this.takeUnrendered(paths);
    if (unrenderedPaths.length === 0) return;

    const tubes = this.renderPathsAsTubes(unrenderedPaths, color, toolIndex);
    tubes.userData.toolIndex = toolIndex;
    this.extrusionsGroup.add(tubes);
  }

  /**
   * Empties both groups and forgets which paths have been rendered, so the next
   * render call rebuilds everything from scratch.
   * @remarks
   * Used when a change invalidates existing geometry (new job, tubes/lines swap,
   * line dimensions). Cheap property changes should mutate in place instead.
   */
  reset() {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.materials = [];
    this.renderedPaths.clear();
    this.extrusionsGroup.clear();
    this.travelMovesGroup.clear();
  }

  /**
   * Returns the paths that have not been rendered yet, marking them as rendered.
   * @remarks
   * Progressive rendering calls the render methods repeatedly with overlapping
   * slices; this keeps each path to exactly one draw.
   */
  private takeUnrendered(paths: Path[]): Path[] {
    const unrendered = paths.filter((p) => !this.renderedPaths.has(p));
    unrendered.forEach((p) => this.renderedPaths.add(p));
    return unrendered;
  }

  /**
   * Schedules a rebuild, coalescing bursts of changes into a single redraw.
   * @remarks
   * Dragging a slider fires a change per pixel; without this each one would
   * discard and rebuild every geometry in the scene.
   */
  private requestRebuild() {
    if (this.rebuildTimeout) clearTimeout(this.rebuildTimeout);

    this.rebuildTimeout = setTimeout(() => {
      this.rebuildTimeout = undefined;
      this.reset();
      this.onRebuildNeeded?.();
    }, ObjectsManager.rebuildDebounce);
  }

  private updateUniform(name: string, value: number) {
    this.materials.forEach((material) => {
      if (material.uniforms[name]) {
        material.uniforms[name].value = value;
      }
    });
  }

  private extrusionLinesForTool(toolIndex: number): LineSegments2[] {
    return this.extrusionsGroup.children.filter(
      (child): child is LineSegments2 => child instanceof LineSegments2 && child.userData.toolIndex === toolIndex
    );
  }

  /**
   * Returns the shader material for a tool, creating it on first use.
   * @remarks
   * Progressive rendering calls into here once per frame per tool; caching keeps
   * one material per tool so recoloring has a single place to write to.
   */
  private getOrCreateToolMaterial(toolIndex: number, color: Color): ShaderMaterial {
    let material = this.materials[toolIndex];

    if (!material) {
      material = createColorMaterial(Number(color.getHex()), this.ambientLight, this.directionalLight, this.brightness);
      // a material created after the layer range was set still has to respect it
      if (this.clipMinZ !== undefined) material.uniforms.clipMinY.value = this.clipMinZ;
      if (this.clipMaxZ !== undefined) material.uniforms.clipMaxY.value = this.clipMaxZ;

      this.materials[toolIndex] = material;
      this.disposables.push(material);
    }

    return material;
  }

  dispose() {
    if (this.rebuildTimeout) clearTimeout(this.rebuildTimeout);
    this.rebuildTimeout = undefined;
    this.extrusionsGroup.removeFromParent();
    this.travelMovesGroup.removeFromParent();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  updateClippingPlanes(minZ?: number, maxZ?: number) {
    this.clipMinZ = minZ;
    this.clipMaxZ = maxZ;
    this.clippingPlanes = this.createClippingPlanes(minZ, maxZ);
    this.updateClippingPlanesForShaderMaterials(minZ, maxZ);
    this.updateLineClipping();
  }

  private renderPathsAsLines(paths: Path[], color: Color): LineSegments2 {
    const material = new LineMaterial({
      color: Number(color.getHex()),
      linewidth: this.lineWidth,
      clippingPlanes: this.clippingPlanes
    });

    const geometry = new LineSegmentsGeometry().setPositions(this.packLineVertices(paths));
    this.disposables.push(material);
    this.disposables.push(geometry);
    return new LineSegments2(geometry, material);
  }

  /**
   * Packs path vertices into the flat position buffer LineSegmentsGeometry wants.
   * @param paths - Paths to pack, back to back
   * @returns Six floats per segment: the two endpoints of each line
   * @remarks
   * Sized up front and filled in place. Pushing onto a plain array instead makes
   * it grow repeatedly and leaves setPositions to copy the whole thing into a
   * Float32Array, which measured ~4x slower on a 650k float model.
   *
   * Lines need to be offset: the gcode specifies the nozzle height, which is the
   * top of the extrusion. The line has no constant height in world coords, so it
   * is drawn at the horizontal midplane of the extrusion layer — otherwise the
   * clipping plane cuts it.
   */
  private packLineVertices(paths: Path[]): Float32Array {
    const offset = -this.lineHeight / 2;

    let segments = 0;
    for (const path of paths) {
      segments += Math.max(0, Math.ceil((path.vertices.length - 3) / 3));
    }

    const positions = new Float32Array(segments * 6);
    let next = 0;

    for (const path of paths) {
      const vertices = path.vertices;
      for (let i = 0; i < vertices.length - 3; i += 3) {
        positions[next++] = vertices[i];
        positions[next++] = vertices[i + 1] - 0.1;
        positions[next++] = vertices[i + 2] + offset;
        positions[next++] = vertices[i + 3];
        positions[next++] = vertices[i + 4] - 0.1;
        positions[next++] = vertices[i + 5] + offset;
      }
    }

    return positions;
  }

  /**
   * Renders paths as 3D tubes
   * @param paths - Array of paths to render
   * @param color - Color to use for the tubes
   */
  private renderPathsAsTubes(paths: Path[], color: Color, toolIndex: number): BatchedMesh {
    const geometries: BufferGeometry[] = [];
    const material = this.getOrCreateToolMaterial(toolIndex, color);

    paths.forEach((path) => {
      const geometry = path.geometry({
        extrusionWidthOverride: this.extrusionWidth,
        lineHeightOverride: this.lineHeight
      });

      if (!geometry) return;

      this.disposables.push(geometry);
      geometries.push(geometry);
    });

    return this.createBatchMesh(geometries, material);
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
   * Applies the current clipping planes to every `LineSegments2` in the scene.
   */
  private updateLineClipping() {
    // TODO: apply clipping selectively to travels lines and extrusion lines
    // and/or use a clipping group
    this.scene.traverse((obj) => {
      if (obj instanceof LineSegments2) {
        (obj.material as LineMaterial).clippingPlanes = this.clippingPlanes;
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

  private updateClippingPlanesForShaderMaterials(minZ?: number, maxZ?: number) {
    this.materials.forEach((material) => {
      material.uniforms.clipMinY.value = minZ ?? -Infinity;
      material.uniforms.clipMaxY.value = maxZ ?? Infinity;
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
