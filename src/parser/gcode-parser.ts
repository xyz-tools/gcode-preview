import { parseLine, toGCodeCommand, GCodeCommand, type GCodeParameters } from 'gcode-ast';
import { Thumbnail } from '../thumbnail';
import { LayerMetadata, SlicerMetadataParser } from './metadata-parser-base';
import { detectSlicer, parseSlicerMetadata } from './slicer-detector';

/**
 * Parameters for G-code commands, keyed by lower-case address letter.
 * @remarks
 * Re-exported from `gcode-ast`. The index signature is retained there for the
 * same reason it exists here: a consumer may read a word this library does not
 * name, and non-finite values are dropped rather than stored.
 */
export type { GCodeParameters };

/**
 * Represents a parsed G-code command.
 * @remarks
 * Re-exported from `gcode-ast`'s compat view: the same four-argument shape
 * (`src`, `gcode`, `params`, `comment`) this library has always exported, plus
 * a `node` back-reference to the typed AST node it was derived from.
 */
export { GCodeCommand };

/** What a parse call returns: the commands that were read, plus everything learned about the file along the way */
export type ParseResult = { metadata: Metadata; commands: GCodeCommand[] };

/** Everything the parser picked up about the file itself, as opposed to its movements */
export type Metadata = {
  thumbnails: Record<string, Thumbnail>;
  layerMetadata?: LayerMetadata[];
  slicerName?: string;
};

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

    // Extract thumbnails
    const thumbs = this.parseMetadata(comments).thumbnails;
    for (const [key, value] of Object.entries(thumbs)) {
      this.metadata.thumbnails[key] = value;
    }

    // Extract layer metadata from slicer comments. Pass the full command list
    // (not just comments) so parsers that read Z from G-code moves work.
    if (!this.metadataParser) {
      this.metadataParser = detectSlicer(commands);
      // The slicer name comes from the chunk that identified the slicer -- a
      // later chunk may contain layer comments but not the header.
      if (this.metadataParser) {
        this.metadata.slicerName = this.metadataParser.detectSlicerName(comments);
      }
    }
    const slicerMetadata = parseSlicerMetadata(commands, this.metadataParser);
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
    const { line: parsed } = parseLine(line, {
      // A preview renders what it can and ignores the rest, so diagnostics are
      // noise here. Off entirely rather than capped: nothing reads them yet.
      maxDiagnostics: 0,
      // `spans: false` / `raw: false` would cut most of what tokenizing
      // allocates, but neither is reachable yet: `GCodeCommand.src` is public
      // API and reads `line.raw`, and `toGCodeCommand` is typed to require a
      // `span`. See the PR body -- this is the remaining perf headroom.
      strictness: 'lenient'
    });

    const command = toGCodeCommand(parsed, { keepSource: true });
    if (!keepComments) command.comment = undefined;
    return command;
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
