import { SceneManager, SceneManagerOptions } from './scene-manager';
import { GCodeCommand, Parser } from './gcode-parser';
import { Interpreter } from './interpreter';
import { Job } from './job';
import { DevGUI, type DevModeOptions } from './dev-gui';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { makeDroppable } from './extra/dom-utils';
import { splitChunk } from './helpers/split-chunk';

/** While streaming, how often (at most) the paths parsed so far are drawn. */
const LIVE_RENDER_INTERVAL_MS = 250;

/**
 * Options for configuring the G-code preview
 */
type LibOptions = {
  /** Enable developer mode with additional controls */
  devMode?: boolean | DevModeOptions;
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
};

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

  // dev mode
  /** Developer mode configuration */
  private _devMode?: boolean | DevModeOptions = false;
  /** Performance stats */
  private stats?: Stats;
  /** Container for stats display */
  private statsContainer?: HTMLElement;
  private devGui?: DevGUI;

  /** The WebGL sceneManager instance for direct access to rendering properties */
  get sceneManager(): SceneManager {
    if (!this._sceneManager) {
      this._sceneManager = this.createSceneManager();
    }
    return this._sceneManager;
  }

  /** Builds a SceneManager wired to feed the stats display. */
  private createSceneManager(): SceneManager {
    const sceneManager = new SceneManager(this.opts, this.job);
    sceneManager.onFrameRendered = () => this.stats?.update();

    return sceneManager;
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

  get devMode(): boolean | DevModeOptions | undefined {
    return this._devMode;
  }

  set devMode(value: boolean | DevModeOptions | undefined) {
    this._devMode = value;
    this.devGui?.destroy();
    this.initGui();
  }

  /**
   * Creates a new GCodePreview instance
   * @param opts - Configuration options for the preview
   */
  constructor(opts: GCodePreviewOptions) {
    this.opts = opts;
    this._parser = this.createParser();
    this.job = new Job({ minLayerThreshold: this.opts.minLayerThreshold });
    // note: reads opts.devMode because this.devMode is only assigned below,
    // once the scene manager needed by its setter exists
    this.stats = opts.devMode ? new Stats() : undefined;
    this._sceneManager = this.createSceneManager();
    // the devMode setter also creates the dev GUI, so no separate initGui() call
    this.devMode = opts?.devMode;
    this.interpreter = new Interpreter();

    this.initStats();
    if (opts.droppable) makeDroppable(this);
  }

  /**
   * Clears the preview and resets the parser, sceneManager, gui and job
   */
  clear(): void {
    this._parser = this.createParser();
    this.job = new Job({ minLayerThreshold: this.opts.minLayerThreshold });
    this.sceneManager.clear();
    this.sceneManager.job = this.job;
    this.sceneManager.render();
    this.devGui?.reset();
  }

  /**
   * Processes G-code and renders the preview
   * @param gcode - G-code string or array of lines
   * @returns Promise that resolves when the animated render has completed
   */
  processGCode(gcode: string | string[]): Promise<void> {
    // Parse the gcode using our managed parser
    const { commands } = this.parser.parseGCode(gcode);

    // Pass the parsed commands to the sceneManager
    this.executeCommands(commands);

    // Render the result
    return this.sceneManager.renderAnimated();
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
      const { commands } = this.parser.parseGCode(gcode);
      this.executeCommands(commands);
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
    let result;
    let tail = '';
    let size = 0;
    let lastDrawnAt = -Infinity;

    do {
      result = await reader.read();
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

      const { commands } = this.parser.parseGCode(split.complete);

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
    this.devGui?.destroy();
    this.devGui = undefined;

    // Dispose sceneManager (heaviest resource user)
    this._sceneManager?.dispose();
    this._sceneManager = null;

    this.stats?.end();
    this.stats?.dom?.remove();
    this.stats = undefined;
  }

  /**
   * Initializes the development GUI if enabled
   * @private
   */
  private initGui(): void {
    if (!this.opts || !this._sceneManager) return;
    if (this.devMode === false || this.devMode === undefined) return;

    if (typeof this.devMode === 'boolean' && this.devMode === true) {
      this.devGui = new DevGUI(this);
    } else if (typeof this.devMode === 'object') {
      this.devGui = new DevGUI(this, this.devMode);
    }
  }

  /**
   * Initializes performance statistics display if enabled
   */
  private initStats() {
    if (this.stats) {
      if (typeof this.devMode === 'object') {
        this.statsContainer = this.devMode.statsContainer;
      }
      (this.statsContainer ?? document.body).appendChild(this.stats.dom);
      this.stats.dom.classList.add('stats');
    }
  }
}

/**
 * Main exports for the G-code preview module
 * @remarks
 * This class provides a simple interface for rendering G-code previews.
 * Most properties and methods are available through the `sceneManager` property.
 */
export { SceneManager, DevModeOptions, GCodeCommand, Parser, Job };
export type { SceneManagerOptions };
