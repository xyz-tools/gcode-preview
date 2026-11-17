import { SceneManager, SceneManagerOptions } from './scene-manager';
import { GCodeCommand, Parser } from './parser/gcode-parser';
import { Interpreter } from './interpreter';
import { Job } from './job';
import { makeDroppable } from './extra/dom-utils';
import { splitChunk } from './helpers/split-chunk';

/** While streaming, how often (at most) the paths parsed so far are drawn. */
const LIVE_RENDER_INTERVAL_MS = 250;

/** How much G-code text is parsed between checks of the time budget. */
const PARSE_SLICE_CHARS = 16 * 1024;

/** How long parsing may hold the main thread before yielding to the browser. */
const PARSE_BUDGET_MS = 10;

/**
 * How long to wait for the browser to go idle before parsing anyway. A page
 * that redraws every frame on a slow device may never be idle at all.
 */
const IDLE_TIMEOUT_MS = 50;

/**
 * Preview-level options, merged into {@link GCodePreviewOptions}.
 */
type LibOptions = {
  minLayerThreshold?: number;
  /** Enable drag and drop file handling */
  droppable?: boolean;
  /**
   * Keep the parsed G-code source on `preview.parser.lines`.
   * @remarks
   * Off by default. Nothing in the library reads the source back, and holding
   * it costs several megabytes on a large file.
   */
  keepLines?: boolean;
  /**
   * How often, in milliseconds, the paths parsed so far are drawn while a
   * G-code stream is being read.
   * @remarks
   * Defaults to 250. Lower values grow the model more smoothly — 0 draws on
   * every chunk, effectively once per frame — but every draw adds a geometry
   * batch, so very low values cost draw calls on large files.
   */
  liveRenderInterval?: number;
  /**
   * Maximum deviation, in millimeters, between rendered G2/G3 arcs and the
   * true arc (default 0.05). Lower values produce smoother arcs at the cost
   * of more geometry; higher values trade smoothness for performance.
   */
  arcChordTolerance?: number;
};

/**
 * Options for configuring the G-code preview
 * @interface
 */
export type GCodePreviewOptions = LibOptions & SceneManagerOptions;

/**
 * Main G-code preview class that orchestrates rendering and parsing
 *
 * @example
 * ```typescript
 * import { GCodePreview } from 'gcode-preview';
 *
 * const preview = new GCodePreview({
 *   canvas: document.getElementById('canvas'),
 *   buildVolume: { x: 200, y: 200, z: 200 }
 * });
 *
 * // Use the sceneManager directly for most operations
 * preview.sceneManager.backgroundColor = '#000000';
 * preview.sceneManager.extrusionColor = '#00ff00';
 *
 * // Process G-code
 * preview.processGCode(gcodeString);
 * ```
 */
export class GCodePreview {
  /**
   * Called whenever parsed commands have been folded into the job.
   * @remarks
   * Holds a single callback: assigning it replaces any previous one. Wrap
   * multiple listeners in one function if several consumers need the signal.
   */
  onJobUpdated?: (job: Job) => void;
  /**
   * Called once a streamed G-code file has been read to the end.
   * @remarks
   * Holds a single callback: assigning it replaces any previous one.
   */
  onStreamEnd?: () => void;
  /** Job containing parsed G-code data */
  job: Job;
  /** The WebGL sceneManager instance for direct access to rendering properties */
  private _sceneManager: SceneManager | null;
  /** The G-code parser instance */
  private _parser: Parser | null;
  private opts: GCodePreviewOptions | null;

  private interpreter: Interpreter;

  /** The WebGL sceneManager instance for direct access to rendering properties */
  get sceneManager(): SceneManager {
    if (!this._sceneManager) {
      this._sceneManager = this.createSceneManager();
    }
    return this._sceneManager;
  }

  /** Builds a SceneManager for the current options and job. */
  private createSceneManager(): SceneManager {
    return new SceneManager(this.opts, this.job);
  }

  /** The G-code parser instance */
  get parser(): Parser {
    if (!this._parser) {
      this._parser = this.createParser();
    }
    return this._parser;
  }

  /** Builds a parser carrying the preview's parsing options. */
  private createParser(): Parser {
    return new Parser({ keepLines: this.opts?.keepLines });
  }

  /**
   * Gets the total number of layers in the job
   * @returns Number of layers
   */
  get countLayers(): number {
    return this.job.countLayers;
  }

  /**
   * Creates a new GCodePreview instance
   * @param opts - Configuration options for the preview
   */
  constructor(opts: GCodePreviewOptions) {
    this.opts = opts;
    this.interpreter = new Interpreter({ arcChordTolerance: opts.arcChordTolerance });
    this._parser = this.createParser();
    this.job = new Job({
      minLayerThreshold: this.opts.minLayerThreshold,
      // a dimension the caller asked for is not derived from the moves
      extrusionWidth: this.opts.extrusionWidth,
      lineHeight: this.opts.lineHeight
    });
    this._sceneManager = this.createSceneManager();

    if (opts.droppable) makeDroppable(this);
  }

  /**
   * Clears the preview and resets the parser, sceneManager and job
   */
  clear(): void {
    this._parser = this.createParser();
    this.job = new Job({
      minLayerThreshold: this.opts.minLayerThreshold,
      // a dimension the caller asked for is not derived from the moves
      extrusionWidth: this.opts.extrusionWidth,
      lineHeight: this.opts.lineHeight
    });
    this.sceneManager.clear();
    this.sceneManager.job = this.job;
    this.sceneManager.render();
  }

  /**
   * Processes G-code and renders the preview
   * @param gcode - G-code string or array of lines
   * @returns Promise that resolves when the animated render has completed
   * @remarks
   * A large file is parsed in slices, with the browser getting a turn between
   * them, so the page stays responsive while it loads. That means `job` fills
   * in asynchronously: read it once the returned promise resolves, or follow
   * along with `onJobUpdated`, which fires once per slice.
   */
  processGCode(gcode: string | string[]): Promise<void> {
    const job = this.job;
    return this.parseInSlices(gcode).then(() => {
      // cleared while parsing: there is nothing of ours to draw
      if (this.job === job) return this.sceneManager.renderAnimated();
    });
  }

  /**
   * Processes G-code using the sceneManager's built-in streaming method
   * @param gcode - G-code string or array of strings to process
   * @param options - Options for rendering: { render: boolean }
   * @remarks
   * Parses the G-code, executes commands, and renders the paths if `render` is true.
   */
  async processGCodeStream(
    gcode: string | string[] | ReadableStream,
    options: { render?: boolean } = { render: true }
  ): Promise<void> {
    if (gcode instanceof ReadableStream) {
      await this.readStream(gcode, { render: options.render });
    } else {
      await this.parseInSlices(gcode);
    }

    if (!this.job.isPlanar) {
      console.warn('Job is non-planar');
    }

    if (options.render) {
      // resolve only once the animated render has completed, so callers can
      // observe the moment the model is fully drawn
      await this.sceneManager.renderAnimated();
    }
  }

  async readStream(stream: ReadableStream, options: { render?: boolean } = {}): Promise<void> {
    const reader = stream.getReader();
    // the job this stream feeds; clear() swaps in a replacement
    const job = this.job;
    let result;
    let tail = '';
    let size = 0;
    let lastDrawnAt = -Infinity;

    do {
      result = await reader.read();
      // clear() ran while this chunk was in flight: the stream belongs to the
      // discarded job, so cancel it rather than corrupt the replacement
      if (this.job !== job) {
        await reader.cancel();
        return;
      }
      const length = result.value?.length ?? 0;
      if (length === 0) {
        // TextDecoderStream can legitimately emit an empty chunk (e.g. one
        // holding only a partial multi-byte sequence). Skip it and keep
        // reading; the loop only ends when the stream reports done.
        continue;
      }
      console.debug('reading from stream', Math.floor(length / 1024), 'kB');
      size += length;
      const split = splitChunk(tail, result.value);
      tail = split.tail;

      // Parsing '' would still count a line -- ''.split('\n') is [''] -- and
      // shift every lineIndex after it. Chunks complete nothing often: bytes
      // arrive without a newline, or splitChunk holds a comment run back.
      if (split.complete === '') continue;

      const { commands, metadata } = this.parser.parseGCode(split.complete);

      // forward metadata before executing: the layer indexer locks its
      // strategy on the first path it sees
      this.job.metadata = metadata;

      // we'll execute the commands immediately, for now
      this.executeCommands(commands);

      // draw what has arrived so far, so the model grows on screen while the
      // stream is still coming in. Throttled: each call only builds the paths
      // that are not drawn yet, but a geometry batch per chunk would still
      // pile up draw calls
      if (
        options.render &&
        performance.now() - lastDrawnAt >= (this.opts?.liveRenderInterval ?? LIVE_RENDER_INTERVAL_MS)
      ) {
        this.sceneManager.renderProgressive();
        lastDrawnAt = performance.now();
      }
    } while (!result.done);

    // flush the leftover tail: a file whose last line has no trailing newline
    // still needs that final command parsed and executed
    if (tail !== '') {
      const { commands } = this.parser.parseGCode(tail);
      this.executeCommands(commands);
    }

    console.debug('total read from stream', Math.floor(size / 1024), 'kB');
    this.onStreamEnd?.();
  }

  /**
   * Parses a whole document in slices, yielding to the browser whenever a
   * slice pushes the time spent past {@link PARSE_BUDGET_MS}.
   * @remarks
   * Each slice goes through splitChunk and the per-chunk steps of readStream,
   * so the result is the same as streaming the text, which the ingestion
   * equivalence harness holds equal to a one-shot parse. A `clear()` during a
   * yield abandons the rest, as it does for a stream.
   */
  private async parseInSlices(gcode: string | string[]): Promise<void> {
    const text = Array.isArray(gcode) ? gcode.join('\n') : gcode;
    const job = this.job;
    let tail = '';
    // the first window starts right away, so input that fits it is parsed
    // before processGCode returns
    let window = budgetWindow();

    for (let offset = 0; offset < text.length; offset += PARSE_SLICE_CHARS) {
      const split = splitChunk(tail, text.slice(offset, offset + PARSE_SLICE_CHARS));
      tail = split.tail;
      // see readStream: parsing '' would still count a line
      if (split.complete !== '') {
        const { commands, metadata } = this.parser.parseGCode(split.complete);
        this.job.metadata = metadata;
        this.executeCommands(commands);
      }

      if (window.timeRemaining() <= 0) {
        window = await nextParseWindow();
        if (this.job !== job) return;
      }
    }

    // a last line without a trailing newline, flushed like readStream does
    if (tail !== '') {
      const { commands } = this.parser.parseGCode(tail);
      this.executeCommands(commands);
    }
  }

  /**
   * Folds parsed commands into the job and announces the result.
   * @param commands - Parsed G-code commands
   */
  private executeCommands(commands: GCodeCommand[]): void {
    this.interpreter.execute(commands, this.job);
    this.onJobUpdated?.(this.job);
  }

  /**
   * Disposes of all resources and cleans up
   */
  dispose(): void {
    // Dispose sceneManager (heaviest resource user)
    this._sceneManager?.dispose();
    this._sceneManager = null;
  }
}

/**
 * Main exports for the G-code preview module
 * @remarks
 * This class provides a simple interface for rendering G-code previews.
 * Most properties and methods are available through the `sceneManager` property.
 */
export { SceneManager, GCodeCommand, Parser, Job };
export type { SceneManagerOptions };

/**
 * Lets the browser draw a frame and handle input before parsing continues.
 * @remarks
 * A MessageChannel task, chosen by measurement (3DBenchy in Chrome):
 * - `scheduler.yield()` resumes ahead of rendering, so no frame got drawn
 *   during the whole parse: no better than not yielding at all.
 * - `setTimeout(0)` is clamped to 4 ms once nested, which made parsing a
 *   third slower on a fast machine.
 * - A posted message runs as an ordinary task, without the clamp, so frames
 *   interleave (~50 fps) and parsing takes as long as without yielding.
 * A resolved promise would not do either: microtasks run before rendering.
 */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

/** A span of time parsing may use: the shape of the IdleDeadline requestIdleCallback hands out. */
interface ParseWindow {
  timeRemaining(): number;
}

/** A window of {@link PARSE_BUDGET_MS}, starting now. */
function budgetWindow(): ParseWindow {
  const end = performance.now() + PARSE_BUDGET_MS;
  return { timeRemaining: () => end - performance.now() };
}

/**
 * Waits for the browser's next chance to parse, and says how long it may run.
 * @remarks
 * Where requestIdleCallback exists, the browser picks the moment and the
 * length: whatever is left of the frame once it has drawn. If it is never
 * idle within {@link IDLE_TIMEOUT_MS}, parsing goes ahead with the fixed
 * budget rather than one slice per timeout. Safari has no
 * requestIdleCallback, so it yields a MessageChannel task and uses the budget.
 */
function nextParseWindow(): Promise<ParseWindow> {
  if (typeof requestIdleCallback !== 'function') return yieldToBrowser().then(budgetWindow);
  return new Promise((resolve) => {
    requestIdleCallback((deadline) => resolve(deadline.didTimeout ? budgetWindow() : deadline), {
      timeout: IDLE_TIMEOUT_MS
    });
  });
}
