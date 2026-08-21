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
  /**
   * Creates a new GCodeCommand instance
   * @param src - The original G-code line
   * @param gcode - The parsed G-code command (e.g., 'g0', 'g1')
   * @param params - The parsed parameters
   * @param comment - Optional comment from the G-code line
   */
  constructor(
    public src: string,
    public gcode: string,
    public params: GCodeParameters,
    public comment?: string
  ) {}
  /* eslint-enable no-unused-vars */
}

export type ParseResult = { metadata: Metadata; commands: GCodeCommand[] };
export type Metadata = { thumbnails: Record<string, Thumbnail> };

/**
 * Whether a character code is an ASCII letter, which is what opens a G-code word.
 * @param code - Result of charCodeAt
 */
function isAlphaCode(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90);
}

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

  /**
   * Parses G-code input into commands and metadata
   * @param input - G-code to parse, either as a string or array of lines
   * @returns Object containing parsed metadata and commands
   *
   * @remarks
   * This method handles both single-line and multi-line G-code input, extracting
   * commands, parameters, and metadata such as thumbnails. It preserves comments
   * and maintains the original source lines.
   *
   * @example
   * ```typescript
   * const parser = new Parser();
   * const result = parser.parseGCode('G1 X100 Y100 F1000 ; Move to position');
   * ```
   */
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

  /**
   * Converts an array of G-code lines into GCodeCommand objects
   * @param lines - Array of G-code lines to convert
   * @returns Array of parsed GCodeCommand objects
   * @private
   */
  private lines2commands(lines: string[]): GCodeCommand[] {
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
    const firstSemicolon = input.indexOf(';');
    const cmd = firstSemicolon < 0 ? input : input.slice(0, firstSemicolon);

    let comment: string | undefined;
    if (keepComments && firstSemicolon >= 0) {
      // only the span up to the next semicolon, matching the previous split(';')[1]
      const nextSemicolon = input.indexOf(';', firstSemicolon + 1);
      const text = nextSemicolon < 0 ? input.slice(firstSemicolon + 1) : input.slice(firstSemicolon + 1, nextSemicolon);
      comment = text || undefined;
    }

    let gcode = '';
    const params: GCodeParameters = {};
    let isFirstWord = true;

    // Walk the line once. Each letter opens a word whose value runs to the next
    // letter, which is the same split the previous regex produced -- without
    // building an array of every fragment and a trimmed copy of each one.
    let i = 0;
    while (i < cmd.length) {
      if (!isAlphaCode(cmd.charCodeAt(i))) {
        i++;
        continue;
      }

      const letter = cmd[i];
      let end = i + 1;
      while (end < cmd.length && !isAlphaCode(cmd.charCodeAt(end))) end++;
      const value = cmd.slice(i + 1, end).trim();

      if (isFirstWord) {
        gcode = letter.toLowerCase() + Number(value);
        isFirstWord = false;
      } else {
        params[letter.toLowerCase()] = parseFloat(value);
      }

      i = end;
    }

    return new GCodeCommand(line, gcode, params, comment);
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
