import { GCodeCommand } from './gcode-parser';
import { SlicerMetadataParser, SlicerMetadataResult } from './metadata-parser-base';
import { PrusaSlicerMetadataParser } from './prusa-slicer-parser';
import { CuraMetadataParser } from './cura-parser';
import { PrusaFamilyMetadataParser } from './prusa-family-parser';
import { Simplify3DMetadataParser } from './simplify3d-parser';
import { Slic3rMetadataParser } from './slic3r-parser';

/**
 * Available slicer metadata parsers
 */
const AVAILABLE_PARSERS: SlicerMetadataParser[] = [
  new PrusaSlicerMetadataParser(),
  new PrusaFamilyMetadataParser(),
  new Simplify3DMetadataParser(),
  new Slic3rMetadataParser(),
  new CuraMetadataParser()
];

/**
 * Detects which slicer generated the gcode and returns appropriate parser
 * @param commands - Array of gcode commands with comments
 * @returns The detected parser, or null if no parser can handle the gcode
 */
export function detectSlicer(commands: GCodeCommand[]): SlicerMetadataParser | null {
  // Try each parser in order of confidence
  for (const parser of AVAILABLE_PARSERS) {
    if (parser.canParse(commands)) {
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
