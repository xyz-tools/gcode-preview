import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import { BuildVolume } from './build-volume';
import { type Disposable } from './helpers/three-utils';
import { LineBox } from './helpers/line-box';

import { Path } from './path';
import { Job } from './job';
import { createColorMaterial } from './helpers/colorMaterial';

import {
  BatchedMesh,
  BufferGeometry,
  Color,
  ColorRepresentation,
  Euler,
  Group,
  Material,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  REVISION,
  Scene,
  ShaderMaterial,
  Vector3,
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
  private _buildVolume?: BuildVolume;
  /** Initial camera position [x, y, z] */
  initialCameraPosition = [-100, 400, 450];
  /** Whether to use inches instead of millimeters */
  inches = false;
  /** List of G-code commands considered non-travel moves */
  nonTravelmoves: string[] = [];
  /** Disable color gradient between layers */
  disableGradient = false;
  job: Job;
  /** Bounding box mesh */
  private boundingBoxMesh?: LineBox;
  /** Color for the bounding box */
  private _boundingBoxColor?: Color;

  // rendering
  /** Group containing all extruded paths */
  private group?: Group;
  /** Group containing all travel paths */
  private travelGroup?: Group;

  /** Disposable resources */
  private disposables: Disposable[] = [];
  /** Default extrusion color */
  static readonly defaultExtrusionColor = new Color('hotpink');
  /** Current extrusion color(s) */
  private _extrusionColor: Color | Color[] = SceneManager.defaultExtrusionColor;
  /** Animation frame ID */
  private animationFrameId?: number;
  /** Current path index for animated rendering */
  private renderPathIndex?: number;
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
  /** Last render time in milliseconds */
  lastRenderTime = 0;
  /** Whether to render in wireframe mode */
  _wireframe = false;
  /** Whether to preserve drawing buffer */
  private preserveDrawingBuffer = false;
  private currentChunk: Group;
  private onFrame: () => void;

  /**
   * Creates a new SceneManager instance
   * @param opts - Configuration options
   * @throws Error if no canvas element is provided
   */
  constructor(opts: SceneManagerOptions, job: Job, onFrame?: () => void) {
    this.job = job;
    this.scene = new Scene();
    this.scene.background = this._backgroundColor;
    if (opts.backgroundColor !== undefined) {
      this.backgroundColor = new Color(opts.backgroundColor);
    }
    this.endLayer = opts.endLayer;
    this.startLayer = opts.startLayer;
    this.lineWidth = opts.lineWidth ?? 1;
    this.lineHeight = opts.lineHeight ?? this.lineHeight;
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
    this.renderExtrusion = opts.renderExtrusion ?? this.renderExtrusion;
    this.renderTravel = opts.renderTravel ?? this.renderTravel;
    this.nonTravelmoves = opts.nonTravelMoves ?? this.nonTravelmoves;
    this.renderTubes = opts.renderTubes ?? this.renderTubes;
    this.extrusionWidth = opts.extrusionWidth;
    this.onFrame = onFrame;

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
    console.debug('preview options', opts);

    this.canvas = opts.canvas;
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      preserveDrawingBuffer: this.preserveDrawingBuffer
    });

    this.renderer.localClippingEnabled = true;
    this.camera = this.createCamera(opts.orthographic ?? false);
    this.camera.position.fromArray(this.initialCameraPosition);
    this.resize();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(this._buildVolume.x / 2, 0, -this._buildVolume.y / 2);
    this.loadCamera();

    this.initScene();
    this.animate();
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
      return;
    }

    this._buildVolume = new BuildVolume(value.x, value.y, value.z, value.smallGrid, this.scene);

    if (this._buildVolume) {
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
    const startLayer = this.job.layers[this._startLayer - 1];
    const endLayer = this.job.layers[this._endLayer - 1];
    const minZ = startLayer?.z - startLayer?.height;
    const maxZ = endLayer?.z;

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
  private createClippingPlanes(minZ: number | undefined, maxZ: number | undefined) {
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
    // console.debug('set endLayer', value);
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
    this.onFrame?.();
  }

  /**
   * Initializes the Three.js scene by clearing the existing model
   * @remarks
   * Clears all existing scene objects and disposables, then adds build volume visualization
   * and lighting if 3D tube rendering is enabled.
   */
  private initScene(): void {
    this.materials = [];

    // Recursively remove all children from the main group and their descendants from the scene
    const removeRecursively = (object: Group) => {
      while (object.children.length > 0) {
        const child = object.children[0];
        if ((child as Group).children && (child as Group).children.length > 0) {
          removeRecursively(child as Group);
        }
        object.remove(child);
        this.scene.remove(child);
      }
    };
    if (this.group) {
      removeRecursively(this.group);
    }

    // while (this.disposables.length > 0) {
    //   const disposable = this.disposables.pop();
    //   if (disposable) disposable.dispose();
    // }

    if (this._buildVolume) {
      this.disposables.push(this._buildVolume);
      this._buildVolume.update();
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
  private createGroup(name: string) : Group {
    const group = new Group();
    group.name = name;
    group.quaternion.setFromEuler(new Euler(-Math.PI / 2, 0, 0));
    if (this._buildVolume) {
      // group.position.set(-this._buildVolume.x / 2, 0, this._buildVolume.y / 2);
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
    this.group = this.group ?? this.createGroup('allLayers');
    this.currentChunk = this.group;
    this.initScene();

    this.renderPathIndex = 0;

    this.renderPaths();
    if (this.boundingBoxColor !== undefined) {
      this.renderBoundingBox();
    }

    this.scene.add(this.group);
    this.renderer.render(this.scene, this.camera);
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
    if (!this.group) {
      this.group = this.createGroup('allLayers');
      this.scene.add(this.group);
    }
    const chunk = new Group();
    chunk.name = 'chunk' + this.renderPathIndex;
    this.currentChunk = chunk;
    const endPathNumber = Math.min(this.renderPathIndex + pathCount, this.job.paths.length - 1);
    this.renderPaths(endPathNumber);
    if (this._boundingBoxColor !== undefined) {
      this.renderBoundingBox();
    }
    this.renderPathIndex = endPathNumber;
    this.group?.add(chunk);
  }

  private renderBoundingBox(): void {
    if (!this.job) return;
    if (!this.job.boundingBox.isValid) {
      console.error('Invalid bounding box, skipping rendering');
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
    this.startLayer = undefined;
    this.endLayer = Infinity;
    this._singleLayerMode = false;
    this.job = undefined;
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
        const slicedToolPaths = toolPaths.slice(this.renderPathIndex, endPathNumber);
        if (slicedToolPaths.length === 0) {
          return;
        }
        if (this.renderTubes) {
          this.renderPathsAsTubes(slicedToolPaths, color);
        } else {
          this.renderPathsAsLines(slicedToolPaths, color);
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
    const minZ = this.job.layers[this._startLayer - 1]?.z;
    const maxZ = this.job.layers[this._endLayer - 1]?.z;

    let clippingPlanes: Plane[] = [];
    clippingPlanes = this.createClippingPlanes(minZ, maxZ);

    const material = new LineMaterial({
      color: Number(color.getHex()),
      linewidth: this.lineWidth,
      clippingPlanes
    });

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
    this.currentChunk?.add(line);
  }

  /**
   * Renders paths as 3D tubes
   * @param paths - Array of paths to render
   * @param color - Color to use for the tubes
   */
  private renderPathsAsTubes(paths: Path[], color: Color): void {
    console.log('rendering '+paths.length+' paths as tubes');

    // use a random color instead of the default extrusion color
    // const randomColor = Math.floor(Math.random() * 16777215); // 0xFFFFFF
    // this._extrusionColor = new Color(randomColor);
    const colorNumber = Number(color.getHex());
    const geometries: BufferGeometry[] = [];

    const material = createColorMaterial(colorNumber, this.ambientLight, this.directionalLight, this.brightness);

    this.materials.push(material);
    let totalExtrusionDistance = 0;

    paths.forEach((path) => {
      const { geometry, extrusionDistance } = path.geometry({
        extrusionWidthOverride: this.extrusionWidth,
        lineHeightOverride: this.lineHeight
      }, totalExtrusionDistance);

      if (!geometry) return;

      console.debug(extrusionDistance, 'mm extrusion distance for path');
      totalExtrusionDistance = extrusionDistance;

      this.disposables.push(geometry);
      geometries.push(geometry);
    });

    const batchedMesh = this.createBatchMesh(geometries, material);
    this.disposables.push(material);

    this.currentChunk?.add(batchedMesh);
  }

  /**
   * Creates a batched mesh from multiple geometries sharing the same material
   * @param geometries - Array of geometries to batch
   * @param material - Material to use for the batched mesh
   * @returns Batched mesh instance
   */
  private createBatchMesh(geometries: BufferGeometry[], material: Material): BatchedMesh {
    console.debug('creating batched mesh with', geometries.length, 'geometries');
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
