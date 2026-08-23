import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { BuildVolume } from './build-volume';
import { type Disposable } from './helpers/three-utils';
import { LineBox } from './helpers/line-box';

import { Job } from './job';
import { ObjectsManager } from './objects-manager';

import {
  Color,
  ColorRepresentation,
  OrthographicCamera,
  PerspectiveCamera,
  REVISION,
  Scene,
  WebGLRenderer,
  MathUtils,
  LineBasicMaterial
} from 'three';

export type BuildVolumeDef = Pick<BuildVolume, 'x' | 'y' | 'z' | 'smallGrid'>;

// Orthographic camera constants
const PERSPECTIVE_FOV = 25;
const PERSPECTIVE_NEAR = 1;
const PERSPECTIVE_FAR = 5000;
const ORTHO_NEAR = 0.1;
const ORTHO_FAR = 10000;
const FRUSTUM_PADDING = 1.2; // 20% margin around model/volume
const DEFAULT_FRUSTUM_SIZE = 500; // fallback when no model or build volume is loaded

export type SceneManagerOptions = {
  /** Build volume dimensions */
  buildVolume?: BuildVolumeDef;
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
  /** Disable color gradient between layers */
  disableGradient?: boolean;
  /** Width of extruded material */
  extrusionWidth?: number;
  /** Render paths as 3D tubes instead of lines */
  renderTubes?: boolean;
  /** Color for the bounding box. If undefined, the bounding box is not rendered. */
  boundingBoxColor?: ColorRepresentation;
  /** Use an orthographic (flat, no perspective distortion) camera instead of the default perspective camera */
  orthographic?: boolean;
};

/**
 * WebGL-based G-code preview renderer
 */
export class SceneManager {
  /** Three.js scene */
  scene: Scene;
  /** Three.js camera (perspective or orthographic) */
  camera: PerspectiveCamera | OrthographicCamera;
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
  private _renderExtrusion = true;
  /** Whether to render travel moves */
  private _renderTravel = false;
  /** First layer to render (1-based index) */
  private _startLayer?: number;
  /** Last layer to render (1-based index) */
  private _endLayer?: number;
  /** Whether single layer mode is enabled */
  private _singleLayerMode = false;
  /** Build volume dimensions */
  private _buildVolume?: BuildVolume;
  /** Initial camera position [x, y, z] */
  private initialCameraPosition = [-100, 400, 450];
  /** Whether to use inches instead of millimeters */
  private _inches = false;
  /** Disable color gradient between layers */
  private _disableGradient = false;
  job: Job;
  /** Bounding box mesh */
  private _boundingBoxMesh?: LineBox;
  /** Color for the bounding box */
  private _boundingBoxColor?: Color;

  // rendering
  /** Disposable resources */
  private disposables: Disposable[] = [];
  /** Default extrusion color */
  static readonly defaultExtrusionColor = new Color('hotpink');
  /** Current extrusion color(s) */
  private _extrusionColor: Color | Color[] = SceneManager.defaultExtrusionColor;
  /** Tool indices already warned about missing an entry in the extrusionColor array */
  private warnedMissingExtrusionColorIndices = new Set<number>();
  /** Animation frame ID */
  private animationFrameId?: number;
  /** Current path index for animated rendering */
  private renderPathIndex?: number;
  /** Previous start layer before single layer mode */
  private prevStartLayer = 0;
  // colors
  /** Background color */
  private _backgroundColor = new Color(0xe0e0e0);
  /** Travel move color */
  private _travelColor = new Color(0x990000);
  /** Top layer color */
  private _topLayerColor?: Color;
  /** Last segment color */
  private _lastSegmentColor?: Color;
  /** Last render time in milliseconds */
  lastRenderTime = 0;
  /** Whether to render in wireframe mode */
  private _wireframe = false;
  /** Whether to preserve drawing buffer */
  private preserveDrawingBuffer = false;
  /**
   * Called after every rendered frame, for consumers that track render stats.
   * @remarks
   * Holds a single callback: assigning it replaces any previous one.
   */
  onFrameRendered?: () => void;
  private objectsManager: ObjectsManager;

  /**
   * Creates a new SceneManager instance
   * @param opts - Configuration options
   * @throws Error if no canvas element is provided
   */
  constructor(opts: SceneManagerOptions, job: Job) {
    this.job = job;
    this.scene = new Scene();
    this.objectsManager = this.createObjectsManager(opts.lineWidth ?? 1, opts.lineHeight, opts.extrusionWidth);
    this.scene.background = this._backgroundColor;
    if (opts.backgroundColor !== undefined) {
      this.backgroundColor = new Color(opts.backgroundColor);
    }
    this.endLayer = opts.endLayer;
    this.startLayer = opts.startLayer;

    if (opts.buildVolume) {
      this._buildVolume = new BuildVolume(
        opts.buildVolume.x,
        opts.buildVolume.y,
        opts.buildVolume.z,
        opts.buildVolume.smallGrid,
        this.scene
      );
      this.disposables.push(this._buildVolume);
    }
    this.initialCameraPosition = opts.initialCameraPosition ?? this.initialCameraPosition;
    // assign the backing fields directly: the setters would draw the scene before
    // the colors below have been applied, and initScene() draws it once anyway
    this._renderExtrusion = opts.renderExtrusion ?? this._renderExtrusion;
    this._renderTravel = opts.renderTravel ?? this._renderTravel;
    this.objectsManager.renderTubes = opts.renderTubes ?? this.objectsManager.renderTubes;

    if (opts.boundingBoxColor !== undefined) {
      this._boundingBoxColor = new Color(opts.boundingBoxColor);
    }

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
    if (opts.disableGradient !== undefined) {
      this.disableGradient = opts.disableGradient;
    }

    console.info('Using THREE r' + REVISION);
    console.debug('preview options', opts);

    this.canvas = opts.canvas;
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      preserveDrawingBuffer: this.preserveDrawingBuffer
    });
    this.disposables.push(this.renderer);

    this.renderer.localClippingEnabled = true;
    this.camera = this.createCamera(opts.orthographic ?? false);
    this.camera.position.fromArray(this.initialCameraPosition);
    this.resize();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(this._buildVolume.x / 2, 0, -this._buildVolume.y / 2);
    this.disposables.push(this.controls);
    this.loadCamera();

    this.initScene();
    this.animate();
  }

  /**
   * Builds an ObjectsManager wired to rebuild the scene when geometry is invalidated.
   * @remarks
   * The manager decides *whether* a change needs new geometry; this callback is
   * how it asks for the paths to be walked again.
   */
  private createObjectsManager(lineWidth: number, lineHeight?: number, extrusionWidth?: number): ObjectsManager {
    const manager = new ObjectsManager(this.scene, lineWidth, lineHeight, extrusionWidth, () => {
      if (this.job) this.render();
    });
    this.disposables.push(manager);

    return manager;
  }

  /**
   * Gets the current build volume
   * @returns Current build volume or undefined if not set
   */
  get buildVolume(): BuildVolume | undefined {
    return this._buildVolume;
  }

  /**
   * Sets the build volume dimensions
   * @param value - Partial build volume properties (x, y, z, smallGrid)
   */
  set buildVolume(value: BuildVolumeDef | undefined) {
    if (!value) {
      this._buildVolume?.dispose();
      this._buildVolume = undefined;
    } else {
      this._buildVolume = new BuildVolume(value.x, value.y, value.z, value.smallGrid, this.scene);

      this.disposables.push(this._buildVolume);
      this._buildVolume.update();
    }
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
      this._extrusionColor = value.map((color) => new Color(color));
      this._extrusionColor.forEach((color, index) => this.objectsManager.setExtrusionColor(color, index));
      // tools past the end of the array draw with the fallback, so recolor them too
      for (let index = this._extrusionColor.length; index < (this.job?.toolPaths.length ?? 0); index++) {
        if (!this.job.toolPaths[index]?.length) continue;
        this.objectsManager.setExtrusionColor(this.fallbackExtrusionColor(index), index);
      }
      return;
    }

    this._extrusionColor = new Color(value);
    this.objectsManager.setExtrusionColor(this._extrusionColor);
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
    this.objectsManager.setTravelColor(this._travelColor);
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
   * Gets the current bounding box color
   * @returns Color representation or undefined if not set
   */
  get boundingBoxColor(): ColorRepresentation | undefined {
    return this._boundingBoxColor;
  }

  /**
   * Sets the bounding box color
   * @param value - Color value or undefined to hide the bounding box
   */
  set boundingBoxColor(value: ColorRepresentation | undefined) {
    this._boundingBoxColor = value !== undefined ? new Color(value) : undefined;

    this.renderBoundingBox();
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
    if (typeof value === 'number' && value > 0 && value <= this.job.countLayers) {
      this._startLayer = value;
    } else {
      this._startLayer = undefined;
    }

    this.updateClippingPlanes();
  }

  get renderExtrusion(): boolean {
    return this._renderExtrusion;
  }
  set renderExtrusion(value: boolean) {
    this._renderExtrusion = value;
    this.objectsManager.setExtrusionsVisible(value);
    if (value) this.renderMissingPaths();
  }

  get renderTravel(): boolean {
    return this._renderTravel;
  }
  set renderTravel(value: boolean) {
    this._renderTravel = value;
    this.objectsManager.setTravelsVisible(value);
    if (value) this.renderMissingPaths();
  }

  get renderTubes(): boolean {
    return this.objectsManager.renderTubes;
  }
  set renderTubes(value: boolean) {
    this.objectsManager.setRenderTubes(value);
  }

  get boundingBoxMesh(): LineBox | undefined {
    return this._boundingBoxMesh;
  }
  set boundingBoxMesh(value: LineBox | undefined) {
    this._boundingBoxMesh = value;
  }

  get lineWidth(): number | undefined {
    return this.objectsManager.lineWidth;
  }
  set lineWidth(value: number | undefined) {
    this.objectsManager.setLineWidth(value);
  }

  get lineHeight(): number {
    return this.objectsManager.lineHeight;
  }
  set lineHeight(value: number) {
    this.objectsManager.setLineHeight(value);
  }

  get extrusionWidth(): number | undefined {
    return this.objectsManager.extrusionWidth;
  }
  set extrusionWidth(value: number | undefined) {
    this.objectsManager.setExtrusionWidth(value);
  }

  get disableGradient(): boolean {
    return this._disableGradient;
  }
  set disableGradient(value: boolean) {
    this._disableGradient = value;
  }

  /**
   * Updates the clipping planes for the 3D preview based on the start and end layers.
   *
   * This method calculates the minimum and maximum Z values from the specified start and end layers.
   * A bound that is unset — or that sits at the very end of the layer stack — leaves that side of
   * the range unbounded: an endLayer equal to the layer count is no restriction, so moves outside
   * the printed layers (travel moves above the top layer, most commonly) stay visible.
   *
   * It then updates the clipping planes for shader materials and line clipping using these Z values.
   *
   */
  updateClippingPlanes() {
    const bottomLayer = this._startLayer > 1 ? this.job.layers[this._startLayer - 1] : undefined;
    const topLayer = this._endLayer < this.job.layers.length ? this.job.layers[this._endLayer - 1] : undefined;
    // an open bound must stay undefined: subtracting through `?.` would produce
    // NaN, which passes the !== undefined guards and ends up in plane constants
    // and shader uniforms, where NaN comparisons are undefined behavior in GLSL
    const minZ = bottomLayer === undefined ? undefined : bottomLayer.z - bottomLayer.height;
    const maxZ = topLayer?.z;

    this.objectsManager.updateClippingPlanes(minZ, maxZ);
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
      this._endLayer = MathUtils.clamp(value, 1, this.job.countLayers);
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
    if (value == this._singleLayerMode) {
      return;
    }

    this._singleLayerMode = value;

    if (this._singleLayerMode) {
      this.prevStartLayer = this._startLayer;
      this._startLayer = Math.max(this._endLayer - 1, 1);
    } else {
      this._startLayer = this.prevStartLayer;
    }

    // the visible range moved, so the clipping planes have to follow
    this.updateClippingPlanes();
  }

  get ambientLight(): number {
    return this.objectsManager.ambientLight;
  }
  set ambientLight(value: number) {
    this.objectsManager.setAmbientLight(value);
  }

  get directionalLight(): number {
    return this.objectsManager.directionalLight;
  }
  set directionalLight(value: number) {
    this.objectsManager.setDirectionalLight(value);
  }

  get brightness(): number {
    return this.objectsManager.brightness;
  }
  set brightness(value: number) {
    this.objectsManager.setBrightness(value);
  }

  get orthographic(): boolean {
    return this.camera instanceof OrthographicCamera;
  }

  set orthographic(value: boolean) {
    if (value === this.orthographic) return;

    const oldPosition = this.camera.position.clone();
    const oldTarget = this.controls.target.clone();

    this.camera = this.createCamera(value);
    this.camera.position.copy(oldPosition);

    this.controls.dispose();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(oldTarget);
    if (value) {
      this.controls.screenSpacePanning = true;
    }
    this.controls.update();

    this.resize();
  }

  private createCamera(orthographic: boolean): PerspectiveCamera | OrthographicCamera {
    const aspect = this.canvas.offsetWidth / this.canvas.offsetHeight;
    if (orthographic) {
      const frustumSize = this.getOrthoFrustumSize();
      const halfH = frustumSize / 2;
      const halfW = halfH * aspect;
      return new OrthographicCamera(-halfW, halfW, halfH, -halfH, ORTHO_NEAR, ORTHO_FAR);
    }
    return new PerspectiveCamera(PERSPECTIVE_FOV, aspect, PERSPECTIVE_NEAR, PERSPECTIVE_FAR);
  }

  private getOrthoFrustumSize(): number {
    if (this.job?.boundingBox?.isValid) {
      const size = this.job.boundingBox.size;
      return Math.max(size.x, size.y, size.z) * FRUSTUM_PADDING;
    }
    if (this._buildVolume) {
      return Math.max(this._buildVolume.x, this._buildVolume.y, this._buildVolume.z) * FRUSTUM_PADDING;
    }
    return DEFAULT_FRUSTUM_SIZE;
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
    this.onFrameRendered?.();
  }

  /**
   * Initializes the Three.js scene by creating all necessary objects
   * @remarks
   * Adds build volume visualization
   * and lighting if 3D tube rendering is enabled.
   */
  private initScene(): void {
    this.renderPathIndex = 0;

    this.renderPaths();

    this.renderBoundingBox();

    if (this._buildVolume) {
      this.disposables.push(this._buildVolume);
      this._buildVolume.update();
    }
  }

  /** Resets the scene by clearing all existing objects and re-initializing
   * @remarks
   * Discards every path currently in the scene along with its geometries and
   * materials, then calls initScene to rebuild from the job.
   */
  private resetScene() {
    this.objectsManager.reset();
    this.initScene();
  }

  /**
   * Renders all visible paths in the scene
   */
  render(): void {
    const startRender = performance.now();

    this.resetScene();

    this.renderer?.render(this.scene, this.camera);
    this.lastRenderTime = performance.now() - startRender;
  }

  /**
   * Renders paths incrementally using an animation loop
   * @experimental
   * @param pathCount - Number of paths to render per frame
   * @returns Promise that resolves when rendering is complete
   */
  async renderAnimated(pathCount: number | undefined = undefined): Promise<void> {
    // sensible default for pathCount
    pathCount = pathCount ?? Math.floor(this.job.paths.length / 60);

    this.renderPathIndex = 0;

    if (this.renderPathIndex >= this.job.paths.length - 1) {
      this.renderPaths();
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
          // the returned promise is the completion signal
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
    const endPathNumber = Math.min(this.renderPathIndex + pathCount, this.job.paths.length - 1);
    this.renderPaths(endPathNumber);
    this.renderBoundingBox();
    this.renderPathIndex = endPathNumber;

    this.renderBoundingBox();
    this.renderer.render(this.scene, this.camera);
  }

  private renderBoundingBox(): void {
    if (!this.job) return;
    if (!this.job.boundingBox.isValid) {
      return;
    }

    // create the bounding box mesh if it doesn't exist
    if (!this.boundingBoxMesh) {
      this.boundingBoxMesh = this.createBoundingBox();
      this.boundingBoxMesh.name = 'bounding-box';
      this.disposables.push(this.boundingBoxMesh);

      this.scene.add(this.boundingBoxMesh);
    }
    this.boundingBoxMesh.visible = this._boundingBoxColor !== undefined;
    (this.boundingBoxMesh.material as LineBasicMaterial).color = this._boundingBoxColor;
  }

  createBoundingBox(): LineBox {
    const bb = this.job.boundingBox;
    const size = bb.size;
    const mesh = new LineBox(size.x, size.z, size.y, this._boundingBoxColor, false);
    const pos = bb.corners.min.toVector3();
    mesh.position.set(pos.x, pos.y, pos.z);
    return mesh;
  }

  // reset parser & processing state
  clear(): void {
    // read the settings off the outgoing manager before it is torn down
    const { lineWidth, lineHeight, extrusionWidth, renderTubes, ambientLight, directionalLight, brightness } =
      this.objectsManager;

    this.startLayer = undefined;
    this.endLayer = Infinity;
    this._singleLayerMode = false;
    this.job = undefined;
    this.scene.remove(this.boundingBoxMesh);
    this.boundingBoxMesh = undefined;

    // drop the old manager from disposables too, or dispose() would revisit it
    this.disposables = this.disposables.filter((d) => d !== this.objectsManager);
    this.objectsManager.dispose();
    this.objectsManager = this.createObjectsManager(lineWidth, lineHeight, extrusionWidth);
    // assign the fields directly: the fresh manager has no materials or geometry
    // yet, so the setters' uniform writes and rebuild requests have nothing to do
    this.objectsManager.renderTubes = renderTubes;
    this.objectsManager.ambientLight = ambientLight;
    this.objectsManager.directionalLight = directionalLight;
    this.objectsManager.brightness = brightness;
  }

  resize(): void {
    const [w, h] = [this.canvas.offsetWidth, this.canvas.offsetHeight];
    const aspect = w / h;

    if (this.camera instanceof OrthographicCamera) {
      const frustumSize = this.getOrthoFrustumSize();
      const halfH = frustumSize / 2;
      const halfW = halfH * aspect;
      this.camera.left = -halfW;
      this.camera.right = halfW;
      this.camera.top = halfH;
      this.camera.bottom = -halfH;
    } else {
      this.camera.aspect = aspect;
    }
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h, false);
  }

  dispose(): void {
    this.cancelAnimation();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
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
   * Renders paths between the current render index and specified end index
   * @param endPathNumber - End index of paths to render (default: Infinity)
   */
  /**
   * Builds any paths that have not been drawn yet, across the whole job.
   * @remarks
   * Turning a category back on reveals paths that were skipped while it was off,
   * and those can sit anywhere in the job — not just past renderPathIndex, which
   * indexes the combined path list rather than travels or a single tool. The
   * ObjectsManager skips whatever it has already drawn, so this stays cheap.
   */
  private renderMissingPaths(): void {
    if (!this.job) return;

    const resumeFrom = this.renderPathIndex;
    this.renderPathIndex = 0;
    this.renderPaths();
    this.renderPathIndex = resumeFrom;
  }

  private renderPaths(endPathNumber: number = Infinity): void {
    this.objectsManager.setTravelsVisible(this._renderTravel);
    if (this._renderTravel) {
      this.objectsManager.renderTravelLines(
        this.job.travels.slice(this.renderPathIndex, endPathNumber),
        this._travelColor
      );
    }

    this.objectsManager.setExtrusionsVisible(this._renderExtrusion);
    if (this._renderExtrusion && this.job?.toolPaths.length > 0) {
      this.job.toolPaths.forEach((toolPaths, index) => {
        const color = Array.isArray(this._extrusionColor)
          ? (this._extrusionColor[index] ?? this.fallbackExtrusionColor(index))
          : this._extrusionColor;
        this.objectsManager.renderExtrusions(toolPaths.slice(this.renderPathIndex, endPathNumber), color, index);
      });
    }
  }

  /**
   * Falls back to a usable color when extrusionColor is an array with no entry for a tool index
   * @param toolIndex - Tool index missing a configured color
   * @returns The array's last configured color, or the default extrusion color if the array is empty
   * @remarks
   * A gcode file can reference more tools than the caller supplied colors for (e.g. a color array
   * sized for 2 tools rendering a 3-tool file). Warns once per tool index instead of throwing.
   */
  private fallbackExtrusionColor(toolIndex: number): Color {
    if (!this.warnedMissingExtrusionColorIndices.has(toolIndex)) {
      this.warnedMissingExtrusionColorIndices.add(toolIndex);
      console.warn(`No extrusionColor configured for tool index ${toolIndex}, falling back to another color`);
    }
    const colors = this._extrusionColor as Color[];
    return colors[colors.length - 1] ?? SceneManager.defaultExtrusionColor;
  }

  saveCamera() {
    localStorage.setItem('cameraPosition', JSON.stringify(this.camera.position));
    localStorage.setItem('cameraRotation', JSON.stringify(this.camera.rotation));
    localStorage.setItem('cameraZoom', JSON.stringify(this.camera.zoom));
    localStorage.setItem('cameraTarget', JSON.stringify(this.controls.target));
  }
  loadCamera() {
    const position = JSON.parse(localStorage.getItem('cameraPosition'));
    const rotation = JSON.parse(localStorage.getItem('cameraRotation'));
    const zoom = JSON.parse(localStorage.getItem('cameraZoom'));
    const target = JSON.parse(localStorage.getItem('cameraTarget'));
    if (position && rotation && zoom && target) {
      this.camera.position.x = position.x;
      this.camera.position.y = position.y;
      this.camera.position.z = position.z;
      this.camera.rotation.x = rotation.x;
      this.camera.rotation.y = rotation.y;
      this.camera.rotation.z = rotation.z;
      this.camera.zoom = zoom;
      // this.camera.updateProjectionMatrix();
      this.controls.target.x = target.x;
      this.controls.target.y = target.y;
      this.controls.target.z = target.z;
      this.controls.update();
    }
  }

  clearCamera() {
    localStorage.removeItem('cameraPosition');
    localStorage.removeItem('cameraRotation');
    localStorage.removeItem('cameraZoom');
    localStorage.removeItem('cameraTarget');
  }
}
