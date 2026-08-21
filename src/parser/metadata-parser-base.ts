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
 * Result of parsing slicer metadata from gcode comments
 */
export interface SlicerMetadataResult {
  /** Array of layer metadata extracted from comments */
  layers: LayerMetadata[];
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
    const sample = commentCommands.length > maxLines
      ? commentCommands.slice(0, maxLines)
      : commentCommands;
    return this.identificationPatterns.some((pattern) =>
      sample.some((cmd) => pattern.test(cmd.comment!))
    );
  }

  /**
   * Parses layer metadata from gcode comments
   * @param commands - Array of gcode commands with comments
   * @returns Layer metadata extracted from comments
   */
  abstract parseLayerMetadata(commands: GCodeCommand[]): LayerMetadata[];
}
