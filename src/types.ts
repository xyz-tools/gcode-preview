import type { ColorRepresentation } from 'three';
import type { BuildVolume } from './build-volume';
import type { DevModeOptions } from './dev-gui';

export type BuildVolumeDef = Pick<BuildVolume, 'x' | 'y' | 'z' | 'smallGrid'>;

/**
 * Options for configuring the G-code preview
 */
export type GCodePreviewOptions = LibOptions & RendererOptions;

export type LibOptions = {
  /** Enable developer mode with additional controls */
  devMode?: boolean | DevModeOptions;
  minLayerThreshold?: number;
  /** Enable drag and drop file handling */
  droppable?: boolean;
};

export type RendererOptions = {
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
};
