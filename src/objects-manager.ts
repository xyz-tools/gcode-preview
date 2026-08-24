import { Path, PathType } from './path';
import { type Disposable } from './helpers/three-utils';
import { BuildVolume, type BuildVolumeDef } from './build-volume';
import { type BoundingBox } from './bounding-box';
import { LineBox } from './helpers/line-box';

import {
  Group,
  Object3D,
  Scene,
  Color,
  Plane,
  Vector3,
  ShaderMaterial,
  Euler,
  BatchedMesh,
  BufferGeometry,
  LineBasicMaterial,
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

  /** Default color for extrusions when the caller supplies none */
  static readonly defaultExtrusionColor = new Color('hotpink');
  /** Current extrusion color(s); an array is indexed by tool */
  extrusionColor: Color | Color[] = ObjectsManager.defaultExtrusionColor;
  /** Current travel move color */
  travelColor = new Color(0x990000);
  /** Tool indices already warned about missing an entry in the extrusionColor array */
  private warnedMissingExtrusionColorIndices = new Set<number>();

  lineWidth: number;
  lineHeight: number;
  /** Width of extruded material. Undefined means each path uses its own width. */
  extrusionWidth?: number;
  renderTubes = false;

  /**
   * Whether extrusion lines get a per-layer brightness gradient baked into their vertex colors.
   * Only meaningful for line rendering; tubes ignore it.
   */
  gradientEnabled = false;
  /** Total number of layers, used to normalize the gradient ramp */
  layerCount = 0;

  /** Build volume visualization, or undefined when none is drawn */
  buildVolume?: BuildVolume;
  /** Wireframe box around the model, created lazily on first draw */
  boundingBoxMesh?: LineBox;
  /** Color of the bounding box; undefined hides it */
  boundingBoxColor?: Color;
  /** Size the bounding box mesh was built for, to detect stale bounds */
  private boundingBoxSize?: { x: number; y: number; z: number };

  /** How long to coalesce geometry rebuilds for, in ms */
  static readonly rebuildDebounce = 100;

  private renderedPaths = new Set<Path>();
  /** Scene objects drawn by the current top-layer/last-segment highlight */
  private highlightObjects: Object3D[] = [];
  /** Paths the current highlight drew or claimed, to unclaim on revert */
  private highlightedPaths: Path[] = [];
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
   * Stores the extrusion color(s) and repaints the rendered extrusions in place.
   * @param value - One color for every tool, or an array indexed by tool
   * @remarks
   * Tools already drawn past the end of an array repaint with the fallback
   * color, so shrinking the array never leaves a tool showing a stale color.
   */
  setExtrusionColor(value: Color | Color[]) {
    this.extrusionColor = value;

    if (!Array.isArray(value)) {
      this.applyExtrusionColor(value);
      return;
    }

    value.forEach((color, toolIndex) => this.applyExtrusionColor(color, toolIndex));
    this.renderedToolIndices().forEach((toolIndex) => {
      if (toolIndex >= value.length) this.applyExtrusionColor(this.colorForTool(toolIndex), toolIndex);
    });
  }

  setTravelColor(color: Color) {
    this.travelColor = color;
    this.travelMovesGroup.children.forEach((child) => {
      if (child instanceof LineSegments2) {
        (child.material as LineMaterial).color.set(color);
      }
    });
  }

  /**
   * Resolves the color a tool draws with, falling back when the array has no entry.
   * @param toolIndex - Tool asking for its color
   * @remarks
   * A gcode file can reference more tools than the caller supplied colors for
   * (e.g. a color array sized for 2 tools rendering a 3-tool file). The array's
   * last configured color — or the default when the array is empty — is used
   * instead, warning once per tool index rather than throwing.
   */
  colorForTool(toolIndex: number): Color {
    if (!Array.isArray(this.extrusionColor)) return this.extrusionColor;

    return this.extrusionColor[toolIndex] ?? this.fallbackExtrusionColor(toolIndex);
  }

  private fallbackExtrusionColor(toolIndex: number): Color {
    if (!this.warnedMissingExtrusionColorIndices.has(toolIndex)) {
      this.warnedMissingExtrusionColorIndices.add(toolIndex);
      console.warn(`No extrusionColor configured for tool index ${toolIndex}, falling back to another color`);
    }
    const colors = this.extrusionColor as Color[];
    return colors[colors.length - 1] ?? ObjectsManager.defaultExtrusionColor;
  }

  /** Mutates the materials and lines of one tool — or every tool — in place. */
  private applyExtrusionColor(color: Color, toolIndex?: number) {
    if (toolIndex === undefined) {
      // a scalar color applies to every tool the job renders with
      this.materials.forEach((material) => {
        if (material?.uniforms) material.uniforms.uColor.value = color;
      });
      this.extrusionsGroup.children.forEach((child) => {
        // highlight overlays keep their own color, so a tool recolor skips them
        if (child instanceof LineSegments2 && !child.userData.highlight)
          (child.material as LineMaterial).color.set(color);
      });
      return;
    }

    const material = this.materials[toolIndex];
    if (material?.uniforms) {
      material.uniforms.uColor.value = color;
    }

    this.extrusionLinesForTool(toolIndex).forEach((line) => {
      (line.material as LineMaterial).color.set(color);
    });
  }

  /** The tool indices that currently have something drawn in the scene. */
  private renderedToolIndices(): number[] {
    const indices = new Set<number>();
    // forEach skips the holes of the sparse per-tool array
    this.materials.forEach((material, toolIndex) => indices.add(toolIndex));
    this.extrusionsGroup.children.forEach((child) => {
      if (child instanceof LineSegments2) indices.add(child.userData.toolIndex);
    });
    return [...indices];
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

  // --- scene furniture: owned objects that survive geometry rebuilds ----------

  /**
   * Replaces the build volume visualization, or removes it when no dimensions are given.
   * @param value - Build volume dimensions, or undefined to draw none
   */
  setBuildVolume(value?: BuildVolumeDef) {
    this.buildVolume?.dispose();
    this.buildVolume = undefined;
    if (!value) return;

    this.buildVolume = new BuildVolume(value.x, value.y, value.z, value.smallGrid, this.scene);
    this.buildVolume.update();
  }

  /**
   * Recolors the bounding box in place; undefined hides it.
   * @param color - New color, or undefined to hide the box
   */
  setBoundingBoxColor(color?: Color) {
    this.boundingBoxColor = color;
    if (!this.boundingBoxMesh) return;

    this.boundingBoxMesh.visible = color !== undefined;
    if (color) (this.boundingBoxMesh.material as LineBasicMaterial).color = color;
  }

  /**
   * Draws the bounding box for the given bounds, creating or resizing the mesh as needed.
   * @remarks
   * The mesh is kept across geometry rebuilds — only a change in the bounds themselves
   * (a file streaming in) makes a new one. Visibility tracks whether a color is set.
   */
  updateBoundingBox(boundingBox: BoundingBox) {
    if (!boundingBox.isValid) return;
    const size = boundingBox.size;

    const stale =
      this.boundingBoxSize &&
      (size.x !== this.boundingBoxSize.x || size.y !== this.boundingBoxSize.y || size.z !== this.boundingBoxSize.z);
    if (stale) this.disposeBoundingBox();

    if (!this.boundingBoxMesh) {
      const mesh = new LineBox(size.x, size.z, size.y, this.boundingBoxColor, false);
      mesh.name = 'bounding-box';
      const min = boundingBox.corners.min.toVector3();
      mesh.position.set(min.x, min.y, min.z);

      this.boundingBoxMesh = mesh;
      this.boundingBoxSize = { x: size.x, y: size.y, z: size.z };
      this.scene.add(mesh);
    }

    this.boundingBoxMesh.visible = this.boundingBoxColor !== undefined;
    if (this.boundingBoxColor) (this.boundingBoxMesh.material as LineBasicMaterial).color = this.boundingBoxColor;
  }

  private disposeBoundingBox() {
    if (!this.boundingBoxMesh) return;

    this.scene.remove(this.boundingBoxMesh);
    this.boundingBoxMesh.dispose();
    this.boundingBoxMesh = undefined;
    this.boundingBoxSize = undefined;
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

  /**
   * Draws a slice of the job's combined path list, routing each path to its
   * category: travels as travel lines, extrusions per tool in the current
   * representation.
   * @param paths - Paths in print order, travels and extrusions interleaved
   * @param categories - Which categories to draw. Paths of a disabled category
   * are left unrendered, so they draw when the category is re-enabled.
   * @remarks
   * Already-drawn paths are skipped, so progressive rendering can pass a growing
   * prefix of the same list and each path is built exactly once.
   */
  renderPaths(paths: Path[], categories: { travels: boolean; extrusions: boolean }) {
    if (categories.travels) {
      this.renderTravelLines(paths.filter((path) => path.travelType === PathType.Travel));
    }

    if (categories.extrusions) {
      const byTool = new Map<number, Path[]>();
      for (const path of paths) {
        if (path.travelType !== PathType.Extrusion) continue;
        const toolPaths = byTool.get(path.tool);
        if (toolPaths) {
          toolPaths.push(path);
        } else {
          byTool.set(path.tool, [path]);
        }
      }
      byTool.forEach((toolPaths, toolIndex) => this.renderExtrusions(toolPaths, toolIndex));
    }
  }

  renderTravelLines(paths: Path[], color = this.travelColor) {
    const unrenderedPaths = this.takeUnrendered(paths);
    if (unrenderedPaths.length === 0) return;

    this.travelMovesGroup.add(this.renderPathsAsLines(unrenderedPaths, color, false));
  }

  /**
   * Renders a tool's extrusions in whichever representation is currently
   * selected, in the color the tool resolves to.
   */
  renderExtrusions(paths: Path[], toolIndex = 0) {
    const color = this.colorForTool(toolIndex);
    if (this.renderTubes) {
      this.renderExtrusionTubes(paths, color, toolIndex);
    } else {
      this.renderExtrusionLines(paths, color, toolIndex);
    }
  }

  renderExtrusionLines(paths: Path[], color: Color, toolIndex = 0) {
    const unrenderedPaths = this.takeUnrendered(paths);
    if (unrenderedPaths.length === 0) return;

    const lines = this.renderPathsAsLines(unrenderedPaths, color, this.gradientEnabled && this.layerCount > 0);
    lines.userData.toolIndex = toolIndex;
    this.extrusionsGroup.add(lines);
  }

  renderExtrusionTubes(paths: Path[], color: Color, toolIndex = 0) {
    const unrenderedPaths = this.takeUnrendered(paths);
    if (unrenderedPaths.length === 0) return;

    const tubes = this.renderPathsAsTubes(unrenderedPaths, this.getOrCreateToolMaterial(toolIndex, color));
    tubes.userData.toolIndex = toolIndex;
    this.extrusionsGroup.add(tubes);
  }

  /**
   * Draws `paths` in a single `color` with a dedicated material, independent of
   * the per-tool colors, and records them as rendered.
   * @remarks
   * Used for highlight overlays — the top layer and the last segment — that must
   * win over the tool color. Because the material is not the cached per-tool one,
   * recoloring a tool later leaves the highlight untouched. The object is tagged
   * so {@link setExtrusionColor} skips it for the same reason.
   */
  renderExtrusionsInColor(paths: Path[], color: Color): void {
    const unrenderedPaths = this.takeUnrendered(paths);
    if (unrenderedPaths.length === 0) return;

    const object = this.renderTubes
      ? this.renderPathsAsTubes(unrenderedPaths, this.createHighlightMaterial(color))
      : // highlights draw in their exact color and must win, so never gradient them
        this.renderPathsAsLines(unrenderedPaths, color, false);
    object.userData.highlight = true;
    this.extrusionsGroup.add(object);
    // tracked so revertHighlight can undo exactly this draw later
    this.highlightObjects.push(object);
    this.highlightedPaths.push(...unrenderedPaths);
  }

  /**
   * Removes the currently drawn highlight and forgets that its paths were
   * rendered, so the next render call redraws them in their normal color.
   * @remarks
   * Used to move a live top-layer/last-segment highlight forward as newer
   * layers or segments arrive, without leaving stale highlighted geometry
   * behind on the layer or path it has moved past. Only what the highlight
   * itself drew or claimed is unclaimed — paths the per-tool batches drew
   * stay rendered, so they are not drawn a second time. The overlay's own
   * geometry and material are disposed; the per-path source geometries they
   * were built from are left for the next full {@link reset} — the paths get
   * redrawn through the normal path, which builds its own fresh geometry
   * anyway.
   */
  revertHighlight(): void {
    this.highlightObjects.forEach((object) => {
      object.removeFromParent();
      const disposable = object as unknown as Partial<Disposable>;
      this.disposables = this.disposables.filter((d) => d !== (disposable as Disposable));
      disposable.dispose?.();
    });
    this.highlightObjects = [];
    this.highlightedPaths.forEach((path) => this.renderedPaths.delete(path));
    this.highlightedPaths = [];
  }

  /**
   * Records paths as rendered without drawing them, so later batches skip them.
   * @remarks
   * Used when a highlight redraws part of a path — its final segment in its own
   * color — so the per-tool batch does not also draw the original whole path.
   * The claim is part of the current highlight and is undone by
   * {@link revertHighlight}.
   */
  claimPaths(paths: Path[]) {
    paths.forEach((path) => this.renderedPaths.add(path));
    this.highlightedPaths.push(...paths);
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
    // the groups and disposables above already dropped the highlight overlay
    this.highlightObjects = [];
    this.highlightedPaths = [];
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
    this.buildVolume?.dispose();
    this.buildVolume = undefined;
    this.disposeBoundingBox();
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

  private renderPathsAsLines(paths: Path[], color: Color, gradient: boolean): LineSegments2 {
    const material = new LineMaterial({
      color: Number(color.getHex()),
      linewidth: this.lineWidth,
      clippingPlanes: this.clippingPlanes,
      // the gradient rides on vertex colors, multiplied against the base color, so
      // recoloring stays a one-line material.color write and the ramp reapplies itself
      vertexColors: gradient
    });

    const geometry = new LineSegmentsGeometry().setPositions(this.packLineVertices(paths));
    if (gradient) geometry.setColors(this.packLineColors(paths));
    this.disposables.push(material);
    this.disposables.push(geometry);
    return new LineSegments2(geometry, material);
  }

  /**
   * Builds the per-vertex color buffer that shades each segment by its layer depth.
   * @param paths - Paths to color, in the same order and segmentation as packLineVertices
   * @returns Six floats per segment: a grayscale brightness at each endpoint
   * @remarks
   * The value is a plain grayscale multiplier, not an absolute color: the shader
   * multiplies it against the material's base color, so the same buffer works for
   * any extrusion color and a live recolor needs no rebuild. Lower layers come out
   * darker, matching the original per-layer brightness ramp.
   */
  private packLineColors(paths: Path[]): Float32Array {
    let segments = 0;
    for (const path of paths) {
      segments += Math.max(0, Math.ceil((path.vertices.length - 3) / 3));
    }

    const colors = new Float32Array(segments * 6);
    let next = 0;

    for (const path of paths) {
      const brightness = this.layerBrightness(path.layerIndex);
      const vertices = path.vertices;
      for (let i = 0; i < vertices.length - 3; i += 3) {
        colors[next++] = brightness;
        colors[next++] = brightness;
        colors[next++] = brightness;
        colors[next++] = brightness;
        colors[next++] = brightness;
        colors[next++] = brightness;
      }
    }

    return colors;
  }

  /**
   * Maps a layer index to a brightness in [0.1, 0.8], ramping from dark at the bottom
   * to bright at the top. Paths with no layer (non-planar jobs) render at full brightness.
   * @remarks Only called with layerCount > 0, so the division is always safe.
   */
  private layerBrightness(layerIndex?: number): number {
    if (layerIndex === undefined) return 1;
    return 0.1 + (0.7 * layerIndex) / this.layerCount;
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
   * Builds a fresh tube material for a highlight overlay in the given color.
   * @remarks
   * Unlike {@link getOrCreateToolMaterial} this is never cached or shared, so a
   * later tool recolor cannot bleed into the highlight. The current layer range
   * still has to be respected, so the clip uniforms are seeded here.
   */
  private createHighlightMaterial(color: Color): ShaderMaterial {
    const material = createColorMaterial(
      Number(color.getHex()),
      this.ambientLight,
      this.directionalLight,
      this.brightness
    );
    if (this.clipMinZ !== undefined) material.uniforms.clipMinY.value = this.clipMinZ;
    if (this.clipMaxZ !== undefined) material.uniforms.clipMaxY.value = this.clipMaxZ;
    this.disposables.push(material);
    return material;
  }

  /**
   * Renders paths as 3D tubes
   * @param paths - Array of paths to render
   * @param material - Shader material shared by the batched tubes
   */
  private renderPathsAsTubes(paths: Path[], material: ShaderMaterial): BatchedMesh {
    const geometries: BufferGeometry[] = [];

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
    // travel lines share the extrusions' planes deliberately: a restricted layer
    // range hides both. An unrestricted range produces no planes at all, which
    // is what keeps travel moves outside the printed stack visible (#278)
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
