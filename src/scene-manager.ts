import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { BuildVolume, type BuildVolumeDef } from './build-volume';
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
  MathUtils
} from 'three';

export type { BuildVolumeDef };

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
  /** Initial camera position [x, y, z] */
  private initialCameraPosition = [-100, 400, 450];
  /** Whether to use inches instead of millimeters */
  private _inches = false;
  /** Disable color gradient between layers */
  private _disableGradient = false;
  job: Job;

  // rendering
  /** Disposable resources */
  private disposables: Disposable[] = [];
  /** Default extrusion color */
  static readonly defaultExtrusionColor = ObjectsManager.defaultExtrusionColor;
  /** Animation frame ID */
  private animationFrameId?: number;
  /** Previous start layer before single layer mode */
  private prevStartLayer = 0;
  // colors
  /** Background color */
  private _backgroundColor = new Color(0xe0e0e0);
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
      this.objectsManager.setBuildVolume(opts.buildVolume);
    }
    this.initialCameraPosition = opts.initialCameraPosition ?? this.initialCameraPosition;
    // assign the backing fields directly: the setters would draw the scene before
    // the colors below have been applied, and initScene() draws it once anyway
    this._renderExtrusion = opts.renderExtrusion ?? this._renderExtrusion;
    this._renderTravel = opts.renderTravel ?? this._renderTravel;
    this.objectsManager.renderTubes = opts.renderTubes ?? this.objectsManager.renderTubes;

    if (opts.boundingBoxColor !== undefined) {
      this.objectsManager.setBoundingBoxColor(new Color(opts.boundingBoxColor));
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
    this.controls.target.set(this.buildVolume.x / 2, 0, -this.buildVolume.y / 2);
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
    return this.objectsManager.buildVolume;
  }

  /**
   * Sets the build volume dimensions
   * @param value - Partial build volume properties (x, y, z, smallGrid)
   */
  set buildVolume(value: BuildVolumeDef | undefined) {
    this.objectsManager.setBuildVolume(value);
  }

  /**
   * Gets the current extrusion color(s)
   * @returns Color or array of colors for extruded paths
   */
  get extrusionColor(): Color | Color[] {
    return this.objectsManager.extrusionColor;
  }

  /**
   * Sets the extrusion color(s)
   * @param value - Color value(s) as number, string, Color instance, or array of ColorRepresentation
   */
  set extrusionColor(value: number | string | Color | ColorRepresentation[]) {
    this.objectsManager.setExtrusionColor(
      Array.isArray(value) ? value.map((color) => new Color(color)) : new Color(value)
    );
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
    return this.objectsManager.travelColor;
  }

  /**
   * Sets the travel move color
   * @param value - Color value as number, string, or Color instance
   */
  set travelColor(value: number | string | Color) {
    this.objectsManager.setTravelColor(new Color(value));
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
    return this.objectsManager.boundingBoxColor;
  }

  /**
   * Sets the bounding box color
   * @param value - Color value or undefined to hide the bounding box
   */
  set boundingBoxColor(value: ColorRepresentation | undefined) {
    this.objectsManager.setBoundingBoxColor(value !== undefined ? new Color(value) : undefined);

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
    return this.objectsManager.boundingBoxMesh;
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
    if (this.buildVolume) {
      return Math.max(this.buildVolume.x, this.buildVolume.y, this.buildVolume.z) * FRUSTUM_PADDING;
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
    this.renderPaths();

    this.renderBoundingBox();
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

    if (this.job.paths.length <= 1) {
      this.renderPaths();
    } else {
      return this.renderFrameLoop(pathCount > 0 ? Math.min(pathCount, this.job.paths.length) : 1);
    }
  }

  /**
   * Animation loop that renders paths incrementally
   * @param pathCount - Number of paths to render per frame
   * @returns Promise that resolves when all paths are rendered
   * @remarks
   * The cursor walks the job's combined path list; the ObjectsManager routes
   * each prefix by category and skips what it has already drawn.
   */
  private renderFrameLoop(pathCount: number): Promise<void> {
    return new Promise((resolve) => {
      let drawnUpTo = 0;
      const loop = () => {
        if (drawnUpTo >= this.job.paths.length) {
          // the returned promise is the completion signal
          resolve();
        } else {
          drawnUpTo = Math.min(drawnUpTo + pathCount, this.job.paths.length);
          this.renderFrame(drawnUpTo);
          requestAnimationFrame(loop);
        }
      };
      loop();
    });
  }

  /**
   * Renders one animation frame containing the paths up to the given index
   * @param endPathNumber - End index into the job's combined path list
   */
  private renderFrame(endPathNumber: number): void {
    this.renderPaths(endPathNumber);

    this.renderBoundingBox();
    this.renderer.render(this.scene, this.camera);
  }

  private renderBoundingBox(): void {
    if (!this.job) return;

    this.objectsManager.updateBoundingBox(this.job.boundingBox);
  }

  // reset parser & processing state
  clear(): void {
    // read the settings off the outgoing manager before it is torn down
    const { lineWidth, lineHeight, extrusionWidth, renderTubes, ambientLight, directionalLight, brightness } =
      this.objectsManager;
    const { buildVolume, boundingBoxColor, extrusionColor, travelColor } = this.objectsManager;
    // the bounding box belongs to the outgoing job, but the build volume does not:
    // it is recreated on the replacement manager from the same dimensions
    const buildVolumeDef = buildVolume
      ? { x: buildVolume.x, y: buildVolume.y, z: buildVolume.z, smallGrid: buildVolume.smallGrid }
      : undefined;

    this.startLayer = undefined;
    this.endLayer = Infinity;
    this._singleLayerMode = false;
    this.job = undefined;

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
    this.objectsManager.boundingBoxColor = boundingBoxColor;
    this.objectsManager.extrusionColor = extrusionColor;
    this.objectsManager.travelColor = travelColor;
    if (buildVolumeDef) this.objectsManager.setBuildVolume(buildVolumeDef);
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
   * Builds any paths that have not been drawn yet, across the whole job.
   * @remarks
   * Turning a category back on reveals paths that were skipped while it was off.
   * The ObjectsManager skips whatever it has already drawn, so this stays cheap.
   */
  private renderMissingPaths(): void {
    if (!this.job) return;

    this.renderPaths();
  }

  /**
   * Draws the job's paths up to the given index of its combined path list
   * @param endPathNumber - End index into job.paths (default: all of them)
   */
  private renderPaths(endPathNumber: number = Infinity): void {
    this.objectsManager.setTravelsVisible(this._renderTravel);
    this.objectsManager.setExtrusionsVisible(this._renderExtrusion);

    this.objectsManager.renderPaths(this.job.paths.slice(0, endPathNumber), {
      travels: this._renderTravel,
      extrusions: this._renderExtrusion
    });
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
