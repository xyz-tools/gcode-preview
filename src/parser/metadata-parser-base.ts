import { GCodeCommand } from './gcode-parser';

/**
 * Metadata about a layer extracted from slicer comments
 */
export interface LayerMetadata {
  /** Layer index/number (0-based) */
  layerIndex?: number;
  /** Z position in millimeters */
  z?: number;
  /** Layer height in millimeters */
  height?: number;
  /** Line index in the original gcode where this layer starts */
  lineIndex: number;
}

/**
 * A change of extrusion dimensions announced by slicer comments
 * @remarks
 * Slicers of the PrusaSlicer family announce the width and height of the
 * extrusions that follow with standalone `;WIDTH:` / `;HEIGHT:` comments.
 * These change many times within a single layer (per feature type, and per
 * layer with adaptive layer height), so they are reported as individual
 * line-indexed events rather than folded into the per-layer metadata.
 */
export interface ExtrusionDimensionMetadata {
  /** Extrusion width in millimeters, when the comment announced one */
  width?: number;
  /** Line height in millimeters, when the comment announced one */
  height?: number;
  /** Line index in the original gcode from which the change applies */
  lineIndex: number;
}

/**
 * Result of parsing slicer metadata from gcode comments
 */
export interface SlicerMetadataResult {
  /** Array of layer metadata extracted from comments */
  layers: LayerMetadata[];
  /** Extrusion dimension changes extracted from comments, in line order */
  extrusionDimensions: ExtrusionDimensionMetadata[];
  /** Name of the detected slicer */
  slicerName?: string;
}

/**
 * Abstract base class for slicer-specific metadata parsers
 */
export abstract class SlicerMetadataParser {
  /**
   * The name of the slicer this parser handles
   */
  abstract readonly slicerName: string;

  /**
   * Patterns that identify this slicer in gcode comments
   */
  abstract readonly identificationPatterns: RegExp[];

  /**
   * Checks if this parser can handle the given gcode based on comments
   * @param commands - Array of gcode commands with comments
   * @returns True if this parser can handle the gcode
   */
  canParse(commentCommands: GCodeCommand[], maxLines = 200): boolean {
    const sample = commentCommands.length > maxLines ? commentCommands.slice(0, maxLines) : commentCommands;
    return this.identificationPatterns.some((pattern) => sample.some((cmd) => pattern.test(cmd.comment!)));
  }

  /**
   * Resolves the slicer name to report for the given gcode.
   * @param commentCommands - Array of gcode commands with comments
   * @returns The slicer name
   * @remarks
   * Parsers that handle a family of slicers sharing one comment dialect
   * override this to report the specific generator named in the header.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  detectSlicerName(commentCommands: GCodeCommand[]): string {
    return this.slicerName;
  }

  /**
   * Parses layer metadata from gcode comments
   * @param commands - Array of gcode commands with comments
   * @returns Layer metadata extracted from comments
   */
  abstract parseLayerMetadata(commands: GCodeCommand[]): LayerMetadata[];

  /**
   * Parses extrusion dimension changes from gcode comments
   * @param commands - Array of gcode commands with comments
   * @returns Dimension change events extracted from comments, in line order
   * @remarks
   * Only dialects that announce per-path dimensions override this; the
   * default reports none.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parseExtrusionDimensions(commands: GCodeCommand[]): ExtrusionDimensionMetadata[] {
    return [];
  }

  /**
   * Whether per-path extrusion dimensions should be derived from the moves
   * themselves for this gcode
   * @param commentCommands - Array of gcode commands with comments
   * @returns True when the job should derive dimensions volumetrically
   * @remarks
   * Dialects that announce no dimension comments at all (Cura) opt in here,
   * so the job can reconstruct per-path width and height from extrusion
   * amounts and Z changes instead. Dialects with explicit `;WIDTH:` /
   * `;HEIGHT:` comments keep the default `false`: their announced values are
   * exact and must not be overridden by derived approximations. Evaluated on
   * the chunk that identified the slicer (like `detectSlicerName`), so it can
   * inspect header comments.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  derivesExtrusionDimensions(commentCommands: GCodeCommand[]): boolean {
    return false;
  }

  /**
   * Reads the filament diameter announced in header comments, when any
   * @param commentCommands - Array of gcode commands with comments
   * @returns The filament diameter in millimeters, or undefined when unknown
   * @remarks
   * Feeds the volumetric dimension derivation (see
   * `derivesExtrusionDimensions`), which converts extruded filament lengths
   * into deposited volume. Only header-borne values may be reported here: a
   * diameter that appears after moves (like Cura's end-of-file `;SETTING_3`
   * blob) would reach a one-shot parse before any move executes but a
   * streamed parse only after every move already ran, making the two disagree.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parseFilamentDiameter(commentCommands: GCodeCommand[]): number | undefined {
    return undefined;
  }
}
