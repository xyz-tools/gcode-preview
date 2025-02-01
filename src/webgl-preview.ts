import { Parser } from './gcode-parser';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import { BuildVolume } from './build-volume';
import { type Disposable } from './helpers/three-utils';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import { DevGUI, DevModeOptions } from './dev-gui';
import { Interpreter } from './interpreter';
import { Job } from './job';
import { Path } from './path';
import { createColorMaterial } from './helpers/colorMaterial';

import {
  BatchedMesh,
  BufferGeometry,
  Color,
  ColorRepresentation,
  Euler,
  Group,
  Material,
  PerspectiveCamera,
  Plane,
  REVISION,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
  MathUtils
} from 'three';

/**
 * Options for configuring the G-code preview
 */
export type GCodePreviewOptions = {
  /** Build volume dimensions */
  buildVolume?: BuildVolume;
  /** Background color of the preview */
  backgroundColor?: ColorRepresentation;
  /** Canvas element to render into */
  canvas?: HTMLCanvasElement;
  /** Last layer to render (1-based index) */
  endLayer?: number;
  /** Color(s) for extruded paths */
  extrusionColor?: ColorRepresentation | ColorRepresentation[];
  /** Initial camera position [x, y, z] */
  initialCameraPosition?: number[];
  /** Color for the last segment of each path */
  lastSegmentColor?: ColorRepresentation;
  /** Width of rendered lines */
  lineWidth?: number;
  /** Height of extruded lines */
  lineHeight?: number;
  /** List of G-code commands considered non-travel moves */
  nonTravelMoves?: string[];
  /** Minimum layer height threshold */
  minLayerThreshold?: number;
  /** Whether to render extrusion paths */
  renderExtrusion?: boolean;
  /** Whether to render travel moves */
  renderTravel?: boolean;
  /** First layer to render (1-based index) */
  startLayer?: number;
  /** Color for the top layer */
  topLayerColor?: ColorRepresentation;
  /** Color for travel moves */
  travelColor?: ColorRepresentation;
  /** Colors for different tools */
  toolColors?: Record<number, ColorRepresentation>;
  /** Disable color gradient between layers */
  disableGradient?: boolean;
  /** Width of extruded material */
  extrusionWidth?: number;
  /** Render paths as 3D tubes instead of lines */
  renderTubes?: boolean;
  /**
   * @deprecated Please see the demo how to implement drag and drop.
   */
  allowDragNDrop?: boolean;
  /** Enable developer mode with additional controls */
  devMode?: boolean | DevModeOptions;
};

/**
 * WebGL-based G-code preview renderer
 */
export class WebGLPreview {
  /** Minimum layer height threshold */
  minLayerThreshold: number;
  /** Three.js scene */
  scene: Scene;
  /** Three.js perspective camera */
  camera: PerspectiveCamera;
  /** Three.js WebGL renderer */
  renderer: WebGLRenderer & {
    info: {
      render: { triangles: number; calls: number; lines: number; points: number };
      memory: { geometries: number; textures: number };
    };
  };
  /** Orbit controls for camera */
  controls: OrbitControls;
  /** Canvas element being rendered to */
  canvas: HTMLCanvasElement;
  /** Whether to render extrusion paths */
  renderExtrusion = true;
  /** Whether to render travel moves */
  renderTravel = false;
  /** Whether to render paths as 3D tubes */
  renderTubes = false;
  /** Width of extruded material */
  extrusionWidth?: number;
  /** Width of rendered lines */
  lineWidth?: number;
  /** Height of extruded lines */
  lineHeight = 0.2;
  /** First layer to render (1-based index) */
  _startLayer?: number;
  /** Last layer to render (1-based index) */
  _endLayer?: number;
  /** Whether single layer mode is enabled */
  _singleLayerMode = false;
  /** Build volume dimensions */
  buildVolume?: BuildVolume & {
    x: number;
    y: number;
    z: number;
  };
  /** Initial camera position [x, y, z] */
  initialCameraPosition = [-100, 400, 450];
  /** Whether to use inches instead of millimeters */
  inches = false;
  /** List of G-code commands considered non-travel moves */
  nonTravelmoves: string[] = [];
  /** Disable color gradient between layers */
  disableGradient = false;

  /** Job containing parsed G-code data */
  job: Job;
  /** G-code interpreter */
  interpreter = new Interpreter();
  /** G-code parser */
  parser = new Parser();

  // rendering
  /** Group containing all rendered paths */
  private group?: Group;
  /** Disposable resources */
  private disposables: Disposable[] = [];
  /** Default extrusion color */
  static readonly defaultExtrusionColor = new Color('hotpink');
  /** Current extrusion color(s) */
  private _extrusionColor: Color | Color[] = WebGLPreview.defaultExtrusionColor;
  /** Animation frame ID */
  private animationFrameId?: number;
  /** Current path index for animated rendering */
  private renderPathIndex?: number;
  /** Clipping plane for minimum layer */
  private minPlane = new Plane(new Vector3(0, 1, 0), 0.6);
  /** Clipping plane for maximum layer */
  private maxPlane = new Plane(new Vector3(0, -1, 0), 0.1);
  /** Active clipping planes */
  private clippingPlanes: Plane[] = [];
  /** Previous start layer before single layer mode */
  private prevStartLayer = 0;

  // shader material
  private materials: ShaderMaterial[] = [];
  private _ambientLight = 0.4;
  private _directionalLight = 1.3;
  private _brightness = 1.3;

  // colors
  /** Background color */
  private _backgroundColor = new Color(0xe0e0e0);
  /** Travel move color */
  private _travelColor = new Color(0x990000);
  /** Top layer color */
  private _topLayerColor?: Color;
  /** Last segment color */
  private _lastSegmentColor?: Color;
  /** Tool-specific colors */
  private _toolColors: Record<number, Color> = {};

  // dev mode
  /** Developer mode configuration */
  private devMode?: boolean | DevModeOptions = false;
  /** Last render time in milliseconds */
  _lastRenderTime = 0;
  /** Whether to render in wireframe mode */
  _wireframe = false;
  /** Performance stats */
  private stats?: Stats;
  /** Container for stats display */
  private statsContainer?: HTMLElement;
  /** Developer GUI */
  private devGui?: DevGUI;
  /** Whether to preserve drawing buffer */
  private preserveDrawingBuffer = false;

  /**
   * Creates a new WebGLPreview instance
   * @param opts - Configuration options
   * @throws Error if no canvas element is provided
   */
  constructor(opts: GCodePreviewOptions) {
    this.minLayerThreshold = opts.minLayerThreshold ?? this.minLayerThreshold;
    this.job = new Job({ minLayerThreshold: this.minLayerThreshold });
    this.scene = new Scene();
    this.scene.background = this._backgroundColor;
    if (opts.backgroundColor !== undefined) {
      this.backgroundColor = new Color(opts.backgroundColor);
    }
    this.endLayer = opts.endLayer;
    this.startLayer = opts.startLayer;
    this.lineWidth = opts.lineWidth ?? 1;
    this.lineHeight = opts.lineHeight ?? this.lineHeight;
    this.buildVolume = opts.buildVolume && new BuildVolume(opts.buildVolume.x, opts.buildVolume.y, opts.buildVolume.z);
    this.initialCameraPosition = opts.initialCameraPosition ?? this.initialCameraPosition;
    this.renderExtrusion = opts.renderExtrusion ?? this.renderExtrusion;
    this.renderTravel = opts.renderTravel ?? this.renderTravel;
    this.nonTravelmoves = opts.nonTravelMoves ?? this.nonTravelmoves;
    this.renderTubes = opts.renderTubes ?? this.renderTubes;
    this.extrusionWidth = opts.extrusionWidth;
    this.devMode = opts.devMode ?? this.devMode;
    this.stats = this.devMode ? new Stats() : undefined;

    if (!opts.canvas) {
      throw Error('Set either opts.canvas or opts.targetId');
    }

    if (opts.extrusionColor !== undefined) {
      this.extrusionColor = opts.extrusionColor;
    }
    if (opts.travelColor !== undefined) {
      this.travelColor = new Color(opts.travelColor);
    }
    if (opts.topLayerColor !== undefined) {
      this.topLayerColor = new Color(opts.topLayerColor);
    }
    if (opts.lastSegmentColor !== undefined) {
      this.lastSegmentColor = new Color(opts.lastSegmentColor);
    }
    if (opts.toolColors) {
      this._toolColors = {};
      for (const [key, value] of Object.entries(opts.toolColors)) {
        this._toolColors[parseInt(key)] = new Color(value);
      }
    }

    if (opts.disableGradient !== undefined) {
      this.disableGradient = opts.disableGradient;
    }

    console.info('Using THREE r' + REVISION);
    console.debug('opts', opts);

    this.canvas = opts.canvas;
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      preserveDrawingBuffer: this.preserveDrawingBuffer
    });

    this.renderer.localClippingEnabled = true;
    this.camera = new PerspectiveCamera(25, this.canvas.offsetWidth / this.canvas.offsetHeight, 10, 5000);
    this.camera.position.fromArray(this.initialCameraPosition);

    this.resize();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.initScene();
    this.animate();

    if (opts.allowDragNDrop) this._enableDropHandler();

    this.initStats();
  }

  /**
   * Gets the current extrusion color(s)
   * @returns Color or array of colors for extruded paths
   */
  get extrusionColor(): Color | Color[] {
    return this._extrusionColor;
  }

  /**
   * Sets the extrusion color(s)
   * @param value - Color value(s) as number, string, Color instance, or array of ColorRepresentation
   */
  set extrusionColor(value: number | string | Color | ColorRepresentation[]) {
    if (Array.isArray(value)) {
      this._extrusionColor = [];
      // loop over the object and convert all colors to Color
      for (const [index, color] of value.entries()) {
        this._extrusionColor[index] = new Color(color);
        if (!this.materials[index]) {
          this.materials[index] = createColorMaterial(
            this._extrusionColor[index].getHex(),
            this.ambientLight,
            this.directionalLight,
            this.brightness
          );
        }
        const material = this.materials[index];
        if (material && material.uniforms) {
          material.uniforms.uColor.value = this._extrusionColor[index];
        }
      }
      return;
    }

    this._extrusionColor = new Color(value);
    if (!this.materials[0]) {
      this.materials[0] = createColorMaterial(
        this._extrusionColor.getHex(),
        this.ambientLight,
        this.directionalLight,
        this.brightness
      );
    }

    this.materials[0].uniforms.uColor.value = this._extrusionColor;
  }

  /**
   * Gets the current background color
   * @returns Current background color
   */
  get backgroundColor(): Color {
    return this._backgroundColor;
  }

  /**
   * Sets the background color
   * @param value - Color value as number, string, or Color instance
   */
  set backgroundColor(value: number | string | Color) {
    this._backgroundColor = new Color(value);
    this.scene.background = this._backgroundColor;
  }

  /**
   * Gets the current travel move color
   * @returns Current travel move color
   */
  get travelColor(): Color {
    return this._travelColor;
  }

  /**
   * Sets the travel move color
   * @param value - Color value as number, string, or Color instance
   */
  set travelColor(value: number | string | Color) {
    this._travelColor = new Color(value);
  }

  /**
   * Gets the current top layer color
   * @returns Color representation or undefined if not set
   */
  get topLayerColor(): ColorRepresentation | undefined {
    return this._topLayerColor;
  }

  /**
   * Sets the top layer color
   * @param value - Color value or undefined to clear
   */
  set topLayerColor(value: ColorRepresentation | undefined) {
    this._topLayerColor = value !== undefined ? new Color(value) : undefined;
  }

  /**
   * Gets the current last segment color
   * @returns Color representation or undefined if not set
   */
  get lastSegmentColor(): ColorRepresentation | undefined {
    return this._lastSegmentColor;
  }

  /**
   * Sets the last segment color
   * @param value - Color value or undefined to clear
   */
  set lastSegmentColor(value: ColorRepresentation | undefined) {
    this._lastSegmentColor = value !== undefined ? new Color(value) : undefined;
  }

  /**
   * Gets the total number of layers in the job
   * @returns Number of layers
   */
  get countLayers(): number {
    return this.job.layers.length;
  }

  /**
   * Gets the current start layer (1-based index)
   * @returns Start layer number
   */
  get startLayer(): number | undefined {
    return this._startLayer;
  }

  /**
   * Sets the start layer (1-based index)
   * @param value - Layer number to start rendering from
   */
  set startLayer(value: number | undefined) {
    if (typeof value === 'number') {
      this._startLayer = MathUtils.clamp(value, 1, this.countLayers);
    } else {
      this._startLayer = undefined;
    }

    this.updateClippingPlanes();
  }

  /**
   * Updates the clipping planes for the 3D preview based on the start and end layers.
   *
   * This method calculates the minimum and maximum Z values from the specified start and end layers.
   * If the start layer is not defined, the minimum Z value defaults to 0.
   * If the end layer is not defined, the maximum Z value defaults to Infinity.
   *
   * It then updates the clipping planes for shader materials and line clipping using these Z values.
   *
   * @private
   */
  private updateClippingPlanes() {
    const minZ = !this._startLayer ? 0 : this.job.layers[this._startLayer - 1]?.z ?? 0;

    const maxZ = !this._endLayer ? Infinity : this.job.layers[this._endLayer - 1]?.z ?? Infinity;

    this.updateClippingPlanesForShaderMaterials(minZ, maxZ);
    this.updateLineClipping(minZ, maxZ);
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
   * Applies clipping planes to the specified material based on the minimum and maximum Z values.
   *
   * This method creates clipping planes for the top and bottom of the specified Z range,
   * then applies them to the material's clippingPlanes property.
   *
   * @param material - Shader material to apply clipping planes to
   * @param minZ - The minimum Z value for the clipping plane.
   * @param maxZ - The maximum Z value for the clipping plane.
   */
  private applyMinMaxClippingPlanes(material: Material, minZ: number, maxZ: number) {
    material.clippingPlanes = [new Plane(new Vector3(0, 1, 0), -minZ), new Plane(new Vector3(0, -1, 0), maxZ)];
  }

  /**
   * Updates the clipping planes for all `LineSegments2` objects in the scene.
   * This method filters the scene's children to find instances of `LineSegments2`,
   * then applies the clipping planes to their materials.
   *
   * @param minZ - The minimum Z value for the clipping plane.
   * @param maxZ - The maximum Z value for the clipping plane.
   */
  private updateLineClipping(minZ: number, maxZ: number) {
    this.scene.traverse((obj) => {
      if (obj instanceof LineSegments2) {
        const material = obj.material as LineMaterial;
        this.applyMinMaxClippingPlanes(material, minZ, maxZ);
      }
    });
  }

  /**
   * Gets the current end layer (1-based index)
   * @returns End layer number
   */
  get endLayer(): number | undefined {
    return this._endLayer;
  }

  /**
   * Sets the end layer (1-based index)
   * @param value - Layer number to end rendering at
   */
  set endLayer(value: number | undefined) {
    if (typeof value === 'number') {
      this._endLayer = MathUtils.clamp(value, 1, this.countLayers);
    } else {
      this._endLayer = undefined;
    }

    if (this._singleLayerMode === true) {
      this.startLayer = this._endLayer - 1;
    }

    this.updateClippingPlanes();
  }

  /**
   * Gets whether single layer mode is enabled
   * @returns True if single layer mode is active
   */
  get singleLayerMode(): boolean {
    return this._singleLayerMode;
  }

  /**
   * Sets single layer mode
   * @param value - True to enable single layer mode
   */
  set singleLayerMode(value: boolean) {
    this._singleLayerMode = value;
    if (value) {
      this.prevStartLayer = this._startLayer;
      this.startLayer = this._endLayer - 1;
    } else {
      this.startLayer = this.prevStartLayer;
    }
  }

  get ambientLight(): number {
    return this._ambientLight;
  }
  set ambientLight(value: number) {
    this._ambientLight = value;

    // update material uniforms
    this.materials.forEach((material) => {
      material.uniforms.ambient.value = value;
    });
  }

  get directionalLight(): number {
    return this._directionalLight;
  }
  set directionalLight(value: number) {
    this._directionalLight = value;

    // update material uniforms
    this.materials.forEach((material) => {
      material.uniforms.directional.value = value;
    });
  }

  get brightness(): number {
    return this._brightness;
  }
  set brightness(value: number) {
    this._brightness = value;

    // update material uniforms
    this.materials.forEach((material) => {
      material.uniforms.brightness.value = value;
    });
  }

  /** @internal */
  /**
   * Animation loop that continuously renders the scene
   * @internal
   */
  animate(): void {
    this.animationFrameId = requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.stats?.update();
  }

  /**
   * Processes G-code and updates the visualization
   * @param gcode - G-code string or array of strings to process
   */
  processGCode(gcode: string | string[]): void {
    const { commands } = this.parser.parseGCode(gcode);
    this.interpreter.execute(commands, this.job);
    this.render();
  }

  /**
   * Initializes the Three.js scene by clearing existing elements and setting up lights
   * @remarks
   * Clears all existing scene objects and disposables, then adds build volume visualization
   * and lighting if 3D tube rendering is enabled.
   */
  private initScene(): void {
    this.materials = [];
    while (this.scene.children.length > 0) {
      this.scene.remove(this.scene.children[0]);
    }

    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      if (disposable) disposable.dispose();
    }

    if (this.buildVolume) {
      this.disposables.push(this.buildVolume);
      this.scene.add(this.buildVolume.createGroup());
    }
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
    if (this.buildVolume) {
      group.position.set(-this.buildVolume.x / 2, 0, this.buildVolume.y / 2);
    } else {
      // FIXME: this is just a very crude approximation for centering
      group.position.set(-100, 0, 100);
    }
    return group;
  }

  /**
   * Renders all visible paths in the scene
   */
  render(): void {
    const startRender = performance.now();
    this.group = this.createGroup('allLayers');
    this.initScene();

    this.renderPaths();

    this.scene.add(this.group);
    this.renderer.render(this.scene, this.camera);
    this._lastRenderTime = performance.now() - startRender;
  }

  /**
   * Renders paths incrementally using an animation loop
   * @experimental
   * @param pathCount - Number of paths to render per frame
   * @returns Promise that resolves when rendering is complete
   */
  async renderAnimated(pathCount = 1): Promise<void> {
    this.initScene();

    this.renderPathIndex = 0;

    if (this.renderPathIndex >= this.job.paths.length - 1) {
      this.render();
    } else {
      return this.renderFrameLoop(pathCount > 0 ? Math.min(pathCount, this.job.paths.length) : 1);
    }
  }

  /**
   * Animation loop that renders paths incrementally
   * @param pathCount - Number of paths to render per frame
   * @returns Promise that resolves when all paths are rendered
   */
  private renderFrameLoop(pathCount: number): Promise<void> {
    return new Promise((resolve) => {
      const loop = () => {
        if (this.renderPathIndex >= this.job.paths.length - 1) {
          resolve();
        } else {
          this.renderFrame(pathCount);
          requestAnimationFrame(loop);
        }
      };
      loop();
    });
  }

  /**
   * Renders a frame with the specified number of paths
   * @param pathCount - Number of paths to render in this frame
   * @remarks
   * Creates a new group for the frame and renders paths up to the specified count.
   * Updates the renderPathIndex to track progress through the job's paths.
   */
  private renderFrame(pathCount: number): void {
    this.group = this.createGroup('parts' + this.renderPathIndex);
    const endPathNumber = Math.min(this.renderPathIndex + pathCount, this.job.paths.length - 1);
    this.renderPaths(endPathNumber);
    this.renderPathIndex = endPathNumber;
    this.scene.add(this.group);
  }

  // reset parser & processing state
  clear(): void {
    this.resetState();
    this.parser = new Parser();
    this.job = new Job({ minLayerThreshold: this.minLayerThreshold });
  }

  // reset processing state
  /**
   * Resets the preview state to default values
   * @remarks
   * Resets layer ranges, single layer mode, and developer GUI state.
   * Called when clearing the preview or starting a new job.
   */
  private resetState(): void {
    this.startLayer = 1;
    this.endLayer = Infinity;
    this._singleLayerMode = false;
    this.devGui?.reset();
  }

  resize(): void {
    const [w, h] = [this.canvas.offsetWidth, this.canvas.offsetHeight];
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h, false);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.controls.dispose();
    this.renderer.dispose();

    this.cancelAnimation();
  }

  /**
   * Cancels the current animation frame request
   * @remarks
   * Stops the animation loop and clears the animation frame ID.
   * Called during cleanup to prevent memory leaks.
   */
  private cancelAnimation(): void {
    if (this.animationFrameId !== undefined) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = undefined;
  }

  /**
   * Enables drag and drop handling for G-code files
   * @remarks
   * Adds event listeners for drag and drop operations on the canvas.
   * @deprecated This feature is deprecated
   */
  private _enableDropHandler(): void {
    console.warn('Drag and drop is deprecated as a library feature. See the demo how to implement your own.');
    this.canvas.addEventListener('dragover', (evt) => {
      evt.stopPropagation();
      evt.preventDefault();
      if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'copy';
      this.canvas.classList.add('dragging');
    });

    this.canvas.addEventListener('dragleave', (evt) => {
      evt.stopPropagation();
      evt.preventDefault();
      this.canvas.classList.remove('dragging');
    });

    this.canvas.addEventListener('drop', async (evt) => {
      evt.stopPropagation();
      evt.preventDefault();
      this.canvas.classList.remove('dragging');
      const files: FileList | [] = evt.dataTransfer?.files ?? [];
      const file = files[0];

      this.clear();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this._readFromStream(file.stream() as unknown as ReadableStream<any>);
      this.render();
    });
  }

  /**
   * Renders paths between the current render index and specified end index
   * @param endPathNumber - End index of paths to render (default: Infinity)
   */
  private renderPaths(endPathNumber: number = Infinity): void {
    if (this.renderTravel) {
      this.renderPathsAsLines(this.job.travels.slice(this.renderPathIndex, endPathNumber), this._travelColor);
    }

    if (this.renderExtrusion) {
      this.job.toolPaths.forEach((toolPaths, index) => {
        const color = Array.isArray(this._extrusionColor) ? this._extrusionColor[index] : this._extrusionColor;
        if (this.renderTubes) {
          this.renderPathsAsTubes(toolPaths.slice(this.renderPathIndex, endPathNumber), color);
        } else {
          this.renderPathsAsLines(toolPaths.slice(this.renderPathIndex, endPathNumber), color);
        }
      });
    }
  }

  /**
   * Renders paths as 2D lines
   * @param paths - Array of paths to render
   * @param color - Color to use for the lines
   */
  private renderPathsAsLines(paths: Path[], color: Color): void {
    const minZ = this.job.layers[this._startLayer - 1]?.z ?? 0;
    const maxZ = this.job.layers[this._endLayer - 1]?.z ?? Infinity;

    const material = new LineMaterial({
      color: Number(color.getHex()),
      linewidth: this.lineWidth
    });

    this.applyMinMaxClippingPlanes(material, minZ, maxZ);

    const lineVertices: number[] = [];

    // lines need to be offset.
    // The gcode specifies the nozzle height which is the top of the extrusion.
    // The line doesn't have a constant height in world coords so it should be rendered at horizontal midplane of the extrusion layer.
    // Otherwise the line will be clipped by the clipping plane.
    const offset = -this.lineHeight / 2;

    paths.forEach((path) => {
      for (let i = 0; i < path.vertices.length - 3; i += 3) {
        lineVertices.push(path.vertices[i], path.vertices[i + 1] - 0.1, path.vertices[i + 2] + offset);
        lineVertices.push(path.vertices[i + 3], path.vertices[i + 4] - 0.1, path.vertices[i + 5] + offset);
      }
    });

    const geometry = new LineSegmentsGeometry().setPositions(lineVertices);
    const line = new LineSegments2(geometry, material);

    this.disposables.push(material);
    this.disposables.push(geometry);
    this.group?.add(line);
  }

  /**
   * Renders paths as 3D tubes
   * @param paths - Array of paths to render
   * @param color - Color to use for the tubes
   */
  private renderPathsAsTubes(paths: Path[], color: Color): void {
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

    this.group?.add(batchedMesh);
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
      batchedMesh.addInstance(geometryId);
    });

    return batchedMesh;
  }

  /**
   * Reads and processes G-code from a stream
   * @experimental
   * @param stream - Readable stream containing G-code data
   * @returns Promise that resolves when stream processing is complete
   */
  async _readFromStream(stream: ReadableStream): Promise<void> {
    const reader = stream.getReader();
    let result;
    let tail = '';
    let size = 0;
    do {
      console.debug('reading from stream');
      result = await reader.read();
      size += result.value?.length ?? 0;
      const str = decode(result.value);
      const idxNewLine = str.lastIndexOf('\n');
      const maxFullLine = str.slice(0, idxNewLine);

      // parse increments but don't render yet
      const { commands } = this.parser.parseGCode(tail + maxFullLine);

      // we'll execute the commands immediately, for now
      this.interpreter.execute(commands, this.job);

      tail = str.slice(idxNewLine);
    } while (!result.done);
    console.debug('read from stream', size);
    this.render();
  }

  /**
   * Initializes the developer GUI if dev mode is enabled
   */
  private initGui() {
    if (typeof this.devMode === 'boolean' && this.devMode === true) {
      this.devGui = new DevGUI(this);
    } else if (typeof this.devMode === 'object') {
      this.devGui = new DevGUI(this, this.devMode);
    }
  }

  /**
   * Initializes performance statistics display if enabled
   */
  private initStats() {
    if (this.stats) {
      if (typeof this.devMode === 'object') {
        this.statsContainer = this.devMode.statsContainer;
      }
      (this.statsContainer ?? document.body).appendChild(this.stats.dom);
      this.stats.dom.classList.add('stats');
      this.initGui();
    }
  }
}

function decode(uint8array: Uint8Array) {
  return new TextDecoder('utf-8').decode(uint8array);
}
