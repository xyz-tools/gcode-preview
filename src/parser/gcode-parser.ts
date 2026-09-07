import { Thumbnail } from '../thumbnail';
import { ExtrusionDimensionMetadata, LayerMetadata, SlicerMetadataParser } from './metadata-parser-base';
import { detectSlicer, parseSlicerMetadata } from './slicer-detector';

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
}

/** What a parse call returns: the commands that were read, plus everything learned about the file along the way */
export type ParseResult = { metadata: Metadata; commands: GCodeCommand[] };

/** Everything the parser picked up about the file itself, as opposed to its movements */
export type Metadata = {
  thumbnails: Record<string, Thumbnail>;
  layerMetadata?: LayerMetadata[];
  /** Extrusion dimension changes from `;WIDTH:` / `;HEIGHT:` comments, in line order */
  extrusionDimensions?: ExtrusionDimensionMetadata[];
  slicerName?: string;
  /**
   * Set when the detected slicer announces no dimension comments (Cura), so
   * per-path width and height should be derived from the moves instead
   * (see `Job.deriveMoveDimensions`)
   */
  deriveExtrusionDimensions?: boolean;
  /** Filament diameter in millimeters announced by header comments, when known */
  filamentDiameter?: number;
};

/**
 * Whether a character code is an ASCII letter, which is what opens a G-code word.
 * @param code - Result of charCodeAt
 */
function isAlphaCode(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90);
}

/**
 * Options for configuring the parser
 */
export type ParserOptions = {
  /**
   * Keep every source line on `lines`. Off by default: a 3.5 MB file costs
   * several megabytes to hold, and nothing in the library reads the text back.
   */
  keepLines?: boolean;
};

/**
 * A G-code parser that processes G-code commands and extracts metadata.
 *
 * @remarks
 * This parser handles both single-line and multi-line G-code input, extracting
 * commands, parameters, and metadata such as thumbnails. It preserves comments
 * and, when created with `keepLines`, retains the original source lines.
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

  /**
   * Original G-code lines, in the order they were parsed.
   * @remarks
   * Only populated when the parser was created with `keepLines`. Streaming
   * parses append to this, so it spans the whole input rather than just the
   * most recent chunk.
   *
   * String input is split on `'\n'`, so input ending in a newline yields one
   * final empty line here. That is the split's honest answer and is
   * deliberately not filtered out.
   */
  lines: string[] = [];

  private metadataParser: SlicerMetadataParser | null = null;

  /**
   * Thumbnail currently being accumulated, between a 'thumbnail begin' comment
   * and its 'thumbnail end'. Kept on the instance (not local to a single
   * parseMetadata call) so a block that spans multiple parseGCode calls -- as
   * happens when streaming cuts the file mid-thumbnail -- keeps accumulating
   * instead of being silently dropped.
   */
  private thumb?: Thumbnail;

  /**
   * How many lines have been parsed, counting every call.
   * @remarks
   * Tracked whether or not the lines themselves are kept. Counts exactly what
   * `lines` would hold, so a trailing newline contributes one final empty
   * line.
   */
  lineCount = 0;

  /** Whether to retain source lines on `lines` */
  private readonly keepLines: boolean;

  /**
   * The first comments of the file, kept across chunks.
   * @remarks
   * Slicer identification can land on a later chunk than the header it needs
   * to read: a streamed parse may see `;FLAVOR:Griffin` in one chunk and the
   * `;Generated with Cura` that identifies the slicer in the next. Header
   * questions (slicer name, filament diameter, whether to derive dimensions)
   * are asked against this sample rather than the identifying chunk alone, so
   * streamed and one-shot parses answer them identically.
   */
  private headerComments: GCodeCommand[] = [];

  /** How many leading comments `headerComments` retains */
  private static readonly HEADER_COMMENT_SAMPLE = 200;

  /**
   * Creates a new Parser instance
   * @param opts - Parser options
   */
  constructor(opts: ParserOptions = {}) {
    this.keepLines = opts.keepLines ?? false;
  }

  /**
   * Parses G-code input into commands and metadata
   * @param input - G-code to parse, either as a string or array of lines
   * @returns Object containing parsed metadata and commands
   *
   * @remarks
   * This method handles both single-line and multi-line G-code input, extracting
   * commands, parameters, and metadata such as thumbnails. It preserves comments
   * and, when the parser was created with `keepLines`, appends the original
   * source lines to `lines`.
   *
   * @example
   * ```typescript
   * const parser = new Parser();
   * const result = parser.parseGCode('G1 X100 Y100 F1000 ; Move to position');
   * ```
   */
  parseGCode(input: string | string[]): ParseResult {
    const lines = Array.isArray(input) ? input : input.split('\n');
    this.lineCount += lines.length;

    if (this.keepLines) {
      // appended one at a time: spreading a whole file's worth of lines into
      // push() overflows the argument limit
      for (const line of lines) this.lines.push(line);
    }

    // only the lines from this call, so a streaming parse does not redo the
    // chunks it has already handled
    const commands = this.lines2commands(lines);

    const comments = commands.filter((cmd) => cmd.comment);
    if (this.headerComments.length < Parser.HEADER_COMMENT_SAMPLE) {
      this.headerComments = this.headerComments.concat(comments).slice(0, Parser.HEADER_COMMENT_SAMPLE);
    }

    // Extract thumbnails
    const thumbs = this.parseMetadata(comments).thumbnails;
    for (const [key, value] of Object.entries(thumbs)) {
      this.metadata.thumbnails[key] = value;
    }

    // Extract layer metadata from slicer comments. Pass the full command list
    // (not just comments) so parsers that read Z from G-code moves work.
    if (!this.metadataParser) {
      this.metadataParser = detectSlicer(commands);
      // Header questions are asked against the retained header sample, not the
      // identifying chunk: a streamed parse can identify the slicer on a chunk
      // that no longer holds the ;FLAVOR: line the diameter and the derivation
      // flag are read from, which made those answers depend on chunk size.
      if (this.metadataParser) {
        this.metadata.slicerName = this.metadataParser.detectSlicerName(this.headerComments);
        if (this.metadataParser.derivesExtrusionDimensions(this.headerComments)) {
          this.metadata.deriveExtrusionDimensions = true;
        }
        const filamentDiameter = this.metadataParser.parseFilamentDiameter(this.headerComments);
        if (filamentDiameter !== undefined) {
          this.metadata.filamentDiameter = filamentDiameter;
        }
      }
    }
    const slicerMetadata = parseSlicerMetadata(commands, this.metadataParser);

    if (slicerMetadata.extrusionDimensions.length > 0) {
      // Accumulate across chunks like the layers below, shifting the parsers'
      // chunk-local line indices into whole-file coordinates.
      const dimensions = (this.metadata.extrusionDimensions ??= []);
      const lineOffset = this.lineCount - lines.length;
      for (const dimension of slicerMetadata.extrusionDimensions) {
        dimensions.push({ ...dimension, lineIndex: dimension.lineIndex + lineOffset });
      }
    }

    if (slicerMetadata.layers.length > 0) {
      // Accumulate across chunks (like thumbnails above): a streaming parse
      // hands each chunk to parseGCode separately, and the parsers report
      // chunk-local indices. lineIndex shifts by the lines parsed before this
      // chunk; positional layer numbering (layerIndex === position in the
      // chunk result) continues from the layers gathered so far, while
      // explicit slicer-reported indices (e.g. Cura's LAYER:n) are kept.
      const layers = (this.metadata.layerMetadata ??= []);
      const lineOffset = this.lineCount - lines.length;
      const layerOffset = layers.length;
      slicerMetadata.layers.forEach((layer, i) => {
        // Parsers that derive height from the previous layer's Z cannot see
        // across a chunk boundary; the first layer of a chunk knows the
        // previous layer only here, where the accumulated result is in hand.
        let height = layer.height;
        const previous = layers[layers.length - 1];
        if (height === undefined && i === 0 && layer.z !== undefined && previous?.z !== undefined) {
          height = Math.round((layer.z - previous.z) * 10000) / 10000;
        }
        layers.push({
          ...layer,
          height,
          lineIndex: layer.lineIndex + lineOffset,
          layerIndex: layer.layerIndex === i ? i + layerOffset : layer.layerIndex
        });
      });
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
      // Normalized once here so every consumer sees '; layer 1' and ';layer 1'
      // identically -- the slicer metadata parsers anchor their patterns with ^.
      comment = text.trim() || undefined;
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
        // Validate at the boundary: `X`, `Xabc` and overflowing digit runs parse to
        // NaN/Infinity. Drop the param instead of storing a poisoned value -- an absent
        // param is handled everywhere downstream (`x ?? state.x`), a NaN is not: it would
        // latch into the job state and from there into every later vertex.
        const parsed = parseFloat(value);
        if (Number.isFinite(parsed)) {
          params[letter.toLowerCase()] = parsed;
        }
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
   * The in-progress thumbnail lives on the parser instance, so a block that
   * spans multiple calls (a streaming parse hands each chunk to parseGCode
   * separately) accumulates across them. Each call returns only the
   * thumbnails completed during that call; a block still open at the end of
   * a call carries into the next one.
   *
   * @example
   * ```typescript
   * const commands = parser.parseGCode(gcode).commands;
   * const metadata = parser.parseMetadata(commands.filter(cmd => cmd.comment));
   * ```
   */
  parseMetadata(metadata: GCodeCommand[]): Metadata {
    const thumbnails: Record<string, Thumbnail> = {};

    for (const cmd of metadata) {
      const comment = cmd.comment;
      if (!comment) continue;
      const idxThumbBegin = comment.indexOf('thumbnail begin');
      const idxThumbEnd = comment.indexOf('thumbnail end');

      if (idxThumbBegin > -1) {
        this.thumb = Thumbnail.parse(comment.slice(idxThumbBegin + 15).trim());
      } else if (this.thumb) {
        if (idxThumbEnd == -1) {
          this.thumb.chars += comment.trim();
        } else {
          if (this.thumb.isValid) {
            thumbnails[this.thumb.size] = this.thumb;
          }
          this.thumb = undefined;
        }
      }
    }

    return { thumbnails };
  }
}
