import { GCodeCommand } from './gcode-parser';
import { SlicerMetadataParser, SlicerMetadataResult } from './metadata-parser-base';
import { PrusaFamilyMetadataParser } from './prusa-family-parser';

/**
 * Available slicer metadata parsers
 */
const AVAILABLE_PARSERS: SlicerMetadataParser[] = [new PrusaFamilyMetadataParser()];

/**
 * Detects which slicer generated the gcode and returns appropriate parser
 * @param commands - Array of gcode commands with comments
 * @returns The detected parser, or null if no parser can handle the gcode
 */
export function detectSlicer(commands: GCodeCommand[]): SlicerMetadataParser | null {
  const commentCommands = commands.filter((cmd) => cmd.comment);
  for (const parser of AVAILABLE_PARSERS) {
    if (parser.canParse(commentCommands)) {
      return parser;
    }
  }
  return null;
}

/**
 * Parses layer metadata from gcode comments using automatic slicer detection
 * @param commands - Array of gcode commands
 * @returns Parsed metadata result with layers and detected slicer name
 */
export function parseSlicerMetadata(
  commands: GCodeCommand[],
  parser: SlicerMetadataParser | null
): SlicerMetadataResult {
  if (!parser) {
    return { layers: [] };
  }

  const layers = parser.parseLayerMetadata(commands);

  return {
    layers,
    slicerName: parser.slicerName
  };
}

/**
 * Gets all available slicer parsers
 * @returns Array of available parsers
 */
export function getAvailableParsers(): SlicerMetadataParser[] {
  return [...AVAILABLE_PARSERS];
}
