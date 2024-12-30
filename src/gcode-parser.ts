import { Thumbnail } from './thumbnail';

/**
 * Parameters for G-code commands used in 3D printing.
 *
 * @remarks
 * This interface defines the common parameters used in G-code commands for 3D printing.
 * While additional parameters may exist in G-code files, only the parameters listed here
 * are actively used in this library. Other parameters are still parsed and preserved
 * through the index signature.
 *
 * @example
 * ```typescript
 * const params: GCodeParameters = {
 *   y: 100,    // Move to Y position 100
 *   z: 0.2,    // Set layer height to 0.2
 *   f: 1200,   // Set feed rate to 1200mm/min
 *   e: 123.45  // Extrude filament
 * };
 * ```
 */
export interface GCodeParameters {
  /**
   * X-axis position in millimeters.
   * Used for positioning the print head along the X axis.
   */
  x?: number;

  /**
   * Y-axis position in millimeters.
   * Used for positioning the print head along the Y axis.
   */
  y?: number;

  /**
   * Z-axis position in millimeters.
   * Typically used for layer height control and vertical positioning.
   */
  z?: number;

  /**
   * Extruder position/length in millimeters.
   * Controls the amount of filament to extrude.
   */
  e?: number;

  /**
   * Feed rate (speed) in millimeters per minute.
   * Determines how fast the print head moves.
   */
  f?: number;

  /**
   * X offset from current position to arc center in millimeters.
   * Used in G2/G3 arc movement commands.
   */
  i?: number;

  /**
   * Y offset from current position to arc center in millimeters.
   * Used in G2/G3 arc movement commands.
   */
  j?: number;

  /**
   * Radius of arc in millimeters.
   * Alternative way to specify arc movement in G2/G3 commands.
   */
  r?: number;

  /**
   * Tool number for multi-tool setups.
   * Used to select between different extruders or tools.
   */
  t?: number;

  /**
   * Index signature for additional G-code parameters.
   * Allows parsing and storing of parameters not explicitly defined above.
   */
  [key: string]: number | undefined;
}

/**
 * Represents a parsed G-code command
 */
export class GCodeCommand {
  /* eslint-disable no-unused-vars */
  constructor(
    /** The original G-code line */
    public src: string,

    /** The parsed G-code command (e.g., 'g0', 'g1') */
    public gcode: string,

    /** The parsed parameters */
    public params: GCodeParameters,
    
    /** Optional comment from the G-code line */
    public comment?: string
  ) {}
  /* eslint-enable no-unused-vars */
}

type ParseResult = { metadata: Metadata; commands: GCodeCommand[] };
type Metadata = { thumbnails: Record<string, Thumbnail> };

/**
 * A G-code parser that processes G-code commands and extracts metadata.
 *
 * @remarks
 * This parser handles both single-line and multi-line G-code input, extracting
 * commands, parameters, and metadata such as thumbnails. It preserves comments
 * and maintains the original source lines.
 *
 * @example
 * ```typescript
 * const parser = new Parser();
 * const result = parser.parseGCode('G1 X100 Y100 F1000 ; Move to position');
 * ```
 */
export class Parser {
  /** Metadata extracted from G-code comments, including thumbnails */
  metadata: Metadata = { thumbnails: {} };
  
  /** Original G-code lines stored for reference */
  lines: string[] = [];

  parseGCode(input: string | string[]): ParseResult {
    this.lines = Array.isArray(input) ? input : input.split('\n');
    const commands = this.lines2commands(this.lines);

    // merge thumbs
    const thumbs = this.parseMetadata(commands.filter((cmd) => cmd.comment)).thumbnails;
    for (const [key, value] of Object.entries(thumbs)) {
      this.metadata.thumbnails[key] = value;
    }

    return { metadata: this.metadata, commands: commands };
  }

  private lines2commands(lines: string[]) {
    return lines.map((l) => this.parseCommand(l));
  }

  /**
   * Parses a single line of G-code into a command object.
   *
   * @param line - Single line of G-code to parse
   * @param keepComments - Whether to preserve comments in the parsed command (default: true)
   * @returns Parsed GCodeCommand object or null if line is empty/invalid
   *
   * @remarks
   * This method handles the parsing of individual G-code lines, including:
   * - Separating commands from comments
   * - Extracting the G-code command (e.g., G0, G1)
   * - Parsing parameters
   *
   * @example
   * ```typescript
   * const cmd = parser.parseCommand('G1 X100 Y100 F1000 ; Move to position');
   * ```
   */
  parseCommand(line: string, keepComments = true): GCodeCommand | null {
    const input = line.trim();
    const splitted = input.split(';');
    const cmd = splitted[0];
    const comment = (keepComments && splitted[1]) || undefined;

    const parts = cmd
      .split(/([a-zA-Z])/g)
      .slice(1)
      .map((s) => s.trim());

    const gcode = !parts.length ? '' : `${parts[0]?.toLowerCase()}${Number(parts[1])}`;
    const params = this.parseParams(parts.slice(2));
    return new GCodeCommand(line, gcode, params, comment);
  }

  /**
   * Checks if a character is an alphabetic letter (A-Z or a-z).
   *
   * @param char - Single character to check
   * @returns True if character is a letter, false otherwise
   * @private
   */
  private isAlpha(char: string): boolean {
    const code = char.charCodeAt(0);
    return (code >= 97 && code <= 122) || (code >= 65 && code <= 90);
  }

  /**
   * Parses G-code parameters from an array of parameter strings.
   *
   * @param params - Array of parameter strings (alternating between parameter letters and values)
   * @returns Object containing parsed parameters with their values
   * @private
   *
   * @remarks
   * Parameters in G-code are letter-value pairs (e.g., X100 Y200).
   * This method processes these pairs and converts values to numbers.
   * It alternates through the array since parameters come in pairs:
   * - Even indices contain parameter letters (X, Y, Z, etc.)
   * - Odd indices contain the corresponding values
   */
  private parseParams(params: string[]): GCodeParameters {
    return params.reduce((acc: GCodeParameters, cur: string, idx: number, array) => {
      // alternate bc we're processing in pairs
      if (idx % 2 == 0) return acc;

      const key = array[idx - 1].toLowerCase();
      if (this.isAlpha(key)) {
        acc[key] = parseFloat(cur);
      }

      return acc;
    }, {});
  }

  /**
   * Extracts metadata from G-code commands, particularly focusing on thumbnails.
   *
   * @param metadata - Array of G-code commands containing metadata in comments
   * @returns Object containing extracted metadata (currently only thumbnails)
   *
   * @remarks
   * This method processes special comments in the G-code that contain metadata.
   * Currently, it focuses on extracting thumbnail data that some slicers embed
   * in the G-code file. The thumbnail data is typically found between
   * 'thumbnail begin' and 'thumbnail end' markers in the comments.
   *
   * The method handles multi-line thumbnail data by accumulating characters
   * until it encounters the end marker. Once complete, it validates the
   * thumbnail data before storing it in the thumbnails record.
   *
   * @example
   * ```typescript
   * const commands = parser.parseGCode(gcode).commands;
   * const metadata = parser.parseMetadata(commands.filter(cmd => cmd.comment));
   * ```
   */
  parseMetadata(metadata: GCodeCommand[]): Metadata {
    const thumbnails: Record<string, Thumbnail> = {};

    let thumb: Thumbnail | undefined;

    for (const cmd of metadata) {
      const comment = cmd.comment;
      if (!comment) continue;
      const idxThumbBegin = comment.indexOf('thumbnail begin');
      const idxThumbEnd = comment.indexOf('thumbnail end');

      if (idxThumbBegin > -1) {
        thumb = Thumbnail.parse(comment.slice(idxThumbBegin + 15).trim());
      } else if (thumb) {
        if (idxThumbEnd == -1) {
          thumb.chars += comment.trim();
        } else {
          if (thumb.isValid) {
            thumbnails[thumb.size] = thumb;
          }
          thumb = undefined;
        }
      }
    }

    return { thumbnails };
  }
}
