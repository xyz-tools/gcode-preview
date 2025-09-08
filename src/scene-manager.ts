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
import { EventsDispatcher } from './events-dispatcher';

export enum SceneManagerEvent {
  BUILD_VOLUME_CHANGE = 'buildVolumeChange',
  EXTRUSION_COLOR_CHANGE = 'extrusionColorChange',
  BACKGROUND_COLOR_CHANGE = 'backgroundColorChange',
  TRAVEL_COLOR_CHANGE = 'travelColorChange',
  TOP_LAYER_COLOR_CHANGE = 'topLayerColorChange',
  LAST_SEGMENT_COLOR_CHANGE = 'lastSegmentColorChange',
  BOUNDING_BOX_COLOR_CHANGE = 'boundingBoxColorChange',
  RENDER_EXTRUSION_CHANGE = 'renderExtrusionChange',
  RENDER_TRAVEL_CHANGE = 'renderTravelChange',
  RENDER_TUBES_CHANGE = 'renderTubesChange',
  SINGLE_LAYER_MODE_CHANGE = 'singleLayerModeChange',
  LINE_WIDTH_CHANGE = 'lineWidthChange',
  START_LAYER_CHANGE = 'startLayerChange',
  END_LAYER_CHANGE = 'endLayerChange',
  AMBIENT_LIGHT_CHANGE = 'ambientLightChange',
  DIRECTIONAL_LIGHT_CHANGE = 'directionalLightChange',
  BRIGHTNESS_CHANGE = 'brightnessChange',
  BOUNDING_BOX_MESH_CHANGE = 'boundingBoxMeshChange',
  LINE_HEIGHT_CHANGE = 'lineHeightChange',
  EXTRUSION_WIDTH_CHANGE = 'extrusionWidthChange',
  DISABLE_GRADIENT_CHANGE = 'disableGradientChange',
  ANIMATION_COMPLETE = 'animationComplete',
  FRAME_RENDERED = 'frameRendered'
}

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
  /** Whether to render paths as 3D tubes */
  private _renderTubes = false;
  /** Width of extruded material */
  private _extrusionWidth?: number;
  /** Width of rendered lines */
  private _lineWidth?: number;
  /** Height of extruded lines */
  private _lineHeight = 0.2;
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
  /** Group containing all rendered paths */
  private group?: Group;
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
  /** Last render time in milliseconds */
  lastRenderTime = 0;
  /** Whether to render in wireframe mode */
  private _wireframe = false;
  /** Whether to preserve drawing buffer */
  private preserveDrawingBuffer = false;
  private currentChunk: Group;
  private eventsDispatcher: EventsDispatcher = new EventsDispatcher();

  private _renderTimeout: ReturnType<typeof setTimeout>;

  /**
   * Creates a new SceneManager instance
   * @param opts - Configuration options
   * @throws Error if no canvas element is provided
   */
  constructor(opts: SceneManagerOptions, job: Job, eventsDispatcher?: EventsDispatcher) {
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
    this.renderTubes = opts.renderTubes ?? this.renderTubes;
    this.extrusionWidth = opts.extrusionWidth;
    this.eventsDispatcher = eventsDispatcher ?? this.eventsDispatcher;

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

    this.renderer.localClippingEnabled = true;
    this.camera = this.createCamera(opts.orthographic ?? false);
    this.camera.position.fromArray(this.initialCameraPosition);
    this.resize();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(this._buildVolume.x / 2, 0, -this._buildVolume.y / 2);
    this.loadCamera();

    this.initScene();
    this.animate();
    this.eventsDispatcher.addEventListener(SceneManagerEvent.ANIMATION_COMPLETE, () => {
      this.setRerenderListeners();
    });
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

      if (this._buildVolume) {
        this.disposables.push(this._buildVolume);
        this._buildVolume.update();
      }
    }
    this.eventsDispatcher.emit(SceneManagerEvent.BUILD_VOLUME_CHANGE, this._buildVolume);
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
    this.eventsDispatcher.emit(SceneManagerEvent.EXTRUSION_COLOR_CHANGE, this._extrusionColor);
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
    this.eventsDispatcher.emit(SceneManagerEvent.BACKGROUND_COLOR_CHANGE, this._backgroundColor);
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
    this.eventsDispatcher.emit(SceneManagerEvent.TRAVEL_COLOR_CHANGE, this._travelColor);
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
    this.eventsDispatcher.emit(SceneManagerEvent.TOP_LAYER_COLOR_CHANGE, this._topLayerColor);
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
    this.eventsDispatcher.emit(SceneManagerEvent.LAST_SEGMENT_COLOR_CHANGE, this._lastSegmentColor);
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

    this.eventsDispatcher.emit(SceneManagerEvent.BOUNDING_BOX_COLOR_CHANGE, this._boundingBoxColor);
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
    this.eventsDispatcher.emit(SceneManagerEvent.START_LAYER_CHANGE, [this._startLayer]);
  }

  get renderExtrusion(): boolean {
    return this._renderExtrusion;
  }
  set renderExtrusion(value: boolean) {
    this._renderExtrusion = value;
    this.eventsDispatcher.emit(SceneManagerEvent.RENDER_EXTRUSION_CHANGE, [this._renderExtrusion]);
  }

  get renderTravel(): boolean {
    return this._renderTravel;
  }
  set renderTravel(value: boolean) {
    this._renderTravel = value;
    this.eventsDispatcher.emit(SceneManagerEvent.RENDER_TRAVEL_CHANGE, this._renderTravel);
  }

  get renderTubes(): boolean {
    return this._renderTubes;
  }
  set renderTubes(value: boolean) {
    this._renderTubes = value;
    this.eventsDispatcher.emit(SceneManagerEvent.RENDER_TUBES_CHANGE, this._renderTubes);
  }

  get boundingBoxMesh(): LineBox | undefined {
    return this._boundingBoxMesh;
  }
  set boundingBoxMesh(value: LineBox | undefined) {
    this._boundingBoxMesh = value;
    this.eventsDispatcher.emit(SceneManagerEvent.BOUNDING_BOX_MESH_CHANGE, this._boundingBoxMesh);
  }

  get lineWidth(): number | undefined {
    return this._lineWidth;
  }
  set lineWidth(value: number | undefined) {
    this._lineWidth = value;
    this.eventsDispatcher.emit(SceneManagerEvent.LINE_WIDTH_CHANGE, this._lineWidth);
  }

  get lineHeight(): number {
    return this._lineHeight;
  }
  set lineHeight(value: number) {
    this._lineHeight = value;
    this.eventsDispatcher.emit(SceneManagerEvent.LINE_HEIGHT_CHANGE, [this._lineHeight]);
  }

  get extrusionWidth(): number | undefined {
    return this._extrusionWidth;
  }
  set extrusionWidth(value: number | undefined) {
    this._extrusionWidth = value;
    this.eventsDispatcher.emit(SceneManagerEvent.EXTRUSION_WIDTH_CHANGE, [this._extrusionWidth]);
  }

  get disableGradient(): boolean {
    return this._disableGradient;
  }
  set disableGradient(value: boolean) {
    this._disableGradient = value;
    this.eventsDispatcher.emit(SceneManagerEvent.DISABLE_GRADIENT_CHANGE, [this._disableGradient]);
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
    this.eventsDispatcher.emit(SceneManagerEvent.SINGLE_LAYER_MODE_CHANGE, [this._singleLayerMode]);
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
    this.eventsDispatcher.emit(SceneManagerEvent.FRAME_RENDERED, null);
  }

  /**
   * Initializes the Three.js scene by creating all necessary objects
   * @remarks
   * Adds build volume visualization
   * and lighting if 3D tube rendering is enabled.
   */
  private initScene(): void {
    this.group = this.group ?? this.createGroup('allLayers');
    this.currentChunk = this.group;

    this.renderPathIndex = 0;

    this.renderPaths();

    this.renderBoundingBox();

    if (this._buildVolume) {
      this.disposables.push(this._buildVolume);
      this._buildVolume.update();
    }
    this.scene.add(this.group);
  }

  /** Resets the scene by clearing all existing objects and re-initializing
   * @remarks
   * Disposes of all materials and geometries, removes all children from the main group,
   * and calls initScene to set up a fresh scene.
   */
  private resetScene() {
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

    this.initScene();
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
          this.eventsDispatcher.emit(SceneManagerEvent.ANIMATION_COMPLETE, [this._buildVolume]);
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
    this.renderBoundingBox();
    this.renderPathIndex = endPathNumber;

    this.renderBoundingBox();
    this.group?.add(chunk);
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
    this.startLayer = undefined;
    this.endLayer = Infinity;
    this._singleLayerMode = false;
    this.job = undefined;
    this.scene.remove(this.boundingBoxMesh);
    this.boundingBoxMesh = undefined;
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

    if (this.renderExtrusion && this.job?.toolPaths.length > 0) {
      this.job.toolPaths.forEach((toolPaths, index) => {
        const color = Array.isArray(this._extrusionColor)
          ? (this._extrusionColor[index] ?? this.fallbackExtrusionColor(index))
          : this._extrusionColor;
        if (this.renderTubes) {
          this.renderPathsAsTubes(toolPaths.slice(this.renderPathIndex, endPathNumber), color);
        } else {
          this.renderPathsAsLines(toolPaths.slice(this.renderPathIndex, endPathNumber), color);
        }
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

    const geometry = new LineSegmentsGeometry().setPositions(this.packLineVertices(paths));
    const line = new LineSegments2(geometry, material);

    this.disposables.push(material);
    this.disposables.push(geometry);
    this.currentChunk?.add(line);
  }

  /**
   * Packs path vertices into the flat position buffer LineSegmentsGeometry wants.
   * @param paths - Paths to pack, back to back
   * @returns Six floats per segment: the two endpoints of each line
   * @remarks
   * Sized up front and filled in place. Pushing onto a plain array instead makes
   * it grow repeatedly and leaves setPositions to copy the whole thing into a
   * Float32Array, which measured ~6x slower on a 650k float model.
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

    this.currentChunk?.add(batchedMesh);
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

  private setRerenderListeners() {
    const eventsRequiringRerender = [
      SceneManagerEvent.BACKGROUND_COLOR_CHANGE,
      SceneManagerEvent.BUILD_VOLUME_CHANGE,
      SceneManagerEvent.EXTRUSION_COLOR_CHANGE,
      SceneManagerEvent.LINE_WIDTH_CHANGE,
      SceneManagerEvent.RENDER_TUBES_CHANGE,
      SceneManagerEvent.BOUNDING_BOX_COLOR_CHANGE,
      SceneManagerEvent.SINGLE_LAYER_MODE_CHANGE,
      SceneManagerEvent.TRAVEL_COLOR_CHANGE,
      SceneManagerEvent.RENDER_EXTRUSION_CHANGE,
      SceneManagerEvent.TOP_LAYER_COLOR_CHANGE,
      SceneManagerEvent.LAST_SEGMENT_COLOR_CHANGE,
      SceneManagerEvent.RENDER_TRAVEL_CHANGE
    ];
    const rerenderDebounce = 100;
    this.eventsDispatcher.addEventListener(eventsRequiringRerender, () => {
      if (this._renderTimeout) clearTimeout(this._renderTimeout);
      this._renderTimeout = setTimeout(() => {
        this.render();
      }, rerenderDebounce);
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
