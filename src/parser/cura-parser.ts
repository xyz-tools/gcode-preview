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

  readonly identificationPatterns = [/^LAYER:\d+/, /Cura_SteamEngine/i, /Generated with Cura/i, /CURA_/i];

  /**
   * How many header comments to sample for flavor detection. Cura puts the
   * `;FLAVOR:` line first in the file, so a small sample is plenty.
   */
  private static readonly HEADER_SAMPLE = 200;

  /**
   * Whether per-path extrusion dimensions should be derived from the moves
   * @param commentCommands - Array of gcode commands with comments
   * @returns True except for the volumetric UltiGCode flavor
   * @remarks
   * Cura emits no `;WIDTH:` / `;HEIGHT:` comments, so dimensions can only be
   * reconstructed from extrusion amounts and Z changes. The UltiGCode flavor
   * (Ultimaker 2 era) is excluded: its E values are cubic millimeters of
   * material rather than millimeters of filament, which the derivation does
   * not model — deriving from them would produce confidently wrong widths.
   */
  derivesExtrusionDimensions(commentCommands: GCodeCommand[]): boolean {
    const sample = commentCommands.slice(0, CuraMetadataParser.HEADER_SAMPLE);
    return !sample.some((cmd) => /^FLAVOR:UltiGCode/i.test(cmd.comment!));
  }

  /**
   * Reads the filament diameter implied by the header flavor
   * @param commentCommands - Array of gcode commands with comments
   * @returns 2.85 for the Griffin flavor, otherwise undefined
   * @remarks
   * Cura's own `material_diameter` setting only appears in the `;SETTING_3`
   * blob at the very end of the file, too late to inform the derivation of
   * the moves that precede it (see the base class remarks). The `;FLAVOR:`
   * header line is emitted first instead, and Griffin is only ever generated
   * for Ultimaker's own 2.85 mm machines (UM3 and S-line); every other
   * flavor falls back to the 1.75 mm default downstream.
   */
  parseFilamentDiameter(commentCommands: GCodeCommand[]): number | undefined {
    const sample = commentCommands.slice(0, CuraMetadataParser.HEADER_SAMPLE);
    return sample.some((cmd) => /^FLAVOR:Griffin/i.test(cmd.comment!)) ? 2.85 : undefined;
  }

  /**
   * Parses layer metadata from Cura comments
   * @param commands - Array of gcode commands with comments
   * @returns Array of layer metadata
   */
  parseLayerMetadata(commands: GCodeCommand[]): LayerMetadata[] {
    const layers: LayerMetadata[] = [];

    commands.forEach((command, lineIndex) => {
      if (!command.comment) return;

      const comment = command.comment;

      // Check for layer marker
      const layerMatch = comment.match(/^LAYER:(\d+)/);
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
