import { GCodeCommand } from './gcode-parser';
import { SlicerMetadataParser, LayerMetadata } from './metadata-parser-base';

/**
 * Parser for Cura metadata comments
 *
 * Cura uses the following layer comment format:
 * ;LAYER:0
 * ;LAYER:1
 * ;LAYER:2
 */
export class CuraMetadataParser extends SlicerMetadataParser {
  readonly slicerName = 'Cura';

  readonly identificationPatterns = [/LAYER:\d+/, /Cura_SteamEngine/i, /Generated with Cura/i, /CURA_/i];

  /**
   * Parses layer metadata from Cura comments
   * @param commands - Array of gcode commands with comments
   * @returns Array of layer metadata
   */
  parseLayerMetadata(commands: GCodeCommand[]): LayerMetadata[] {
    const layers: LayerMetadata[] = [];

    commands.forEach((command, lineIndex) => {
      if (!command.comment) return;

      const comment = command.comment.trim();

      // Check for layer marker
      const layerMatch = comment.match(/LAYER:(\d+)/);
      if (layerMatch) {
        const layerIndex = parseInt(layerMatch[1], 10);

        // Try to extract Z position from the next few commands
        let z: number | undefined;
        let height: number | undefined;

        // Look ahead in the next 10 commands for a Z move
        for (let i = lineIndex + 1; i < Math.min(commands.length, lineIndex + 10); i++) {
          const nextCommand = commands[i];
          if (nextCommand.params.z !== undefined) {
            z = nextCommand.params.z;

            // Calculate layer height if we have a previous layer
            if (layers.length > 0 && layers[layers.length - 1].z !== undefined) {
              height = z - layers[layers.length - 1].z!;
            }
            break;
          }
        }

        layers.push({
          layerIndex,
          z,
          height,
          lineIndex
        });
      }
    });

    return layers;
  }
}
