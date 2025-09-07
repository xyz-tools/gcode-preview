import { SceneManager, SceneManagerOptions } from './scene-manager';
import { GCodeCommand, Parser } from './gcode-parser';
import { Interpreter } from './interpreter';
import { Job } from './job';
import { DevGUI, type DevModeOptions } from './dev-gui';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { makeDroppable } from './extra/dom-utils';

/**
 * Options for configuring the G-code preview
 */
type LibOptions = {
  /** Enable developer mode with additional controls */
  devMode?: boolean | DevModeOptions;
  minLayerThreshold?: number;
  /** Enable drag and drop file handling */
  droppable?: boolean;
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
  /** Job containing parsed G-code data */
  job: Job;
  /** The WebGL sceneManager instance for direct access to rendering properties */
  private _sceneManager: SceneManager | null;
  /** The G-code parser instance */
  private _parser: Parser | null;
  private opts: GCodePreviewOptions | null;

  private interpreter = new Interpreter();

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
      this._sceneManager = new SceneManager(this.opts, this.job, () => this.stats?.update());
    }
    return this._sceneManager;
  }

  /** The G-code parser instance */
  get parser(): Parser {
    if (!this._parser) {
      this._parser = new Parser();
    }
    return this._parser;
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
    this._parser = new Parser();
    this.job = new Job({ minLayerThreshold: this.opts.minLayerThreshold });
    this.stats = this.devMode ? new Stats() : undefined;
    this._sceneManager = new SceneManager(this.opts, this.job, () => this.stats?.update());
    this.devMode = opts?.devMode;

    this.initStats();
    if (opts.droppable) makeDroppable(this);
  }

  /**
   * Clears the preview and resets the parser, sceneManager, gui and job
   */
  clear(): void {
    this._parser = new Parser();
    this.job = new Job({ minLayerThreshold: this.opts.minLayerThreshold });
    this.sceneManager.clear();
    this.sceneManager.job = this.job;
    this.sceneManager.render();
    this.devGui?.reset();
  }

  /**
   * Processes G-code and renders the preview
   * @param gcode - G-code string or array of lines
   */
  processGCode(gcode: string | string[]): void {
    // Parse the gcode using our managed parser
    const { commands } = this.parser.parseGCode(gcode);

    // Pass the parsed commands to the sceneManager
    this.interpreter.execute(commands, this.job);

    // Render the result
    this.sceneManager.renderAnimated();
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
      await this.readStream(gcode);
    } else {
      const { commands } = this.parser.parseGCode(gcode);
      this.interpreter.execute(commands, this.job);
    }

    console.debug(
      `out of ${this.interpreter.points} move commands, the following were pruned due to no actual movement:`
    );
    console.debug(this.interpreter.retractions, 'retractions');
    console.debug(this.interpreter.deretractions, 'deretractions');
    console.debug(this.interpreter.feedrateChanges, 'feedrateChanges');
    console.debug(this.interpreter.others, 'other');

    console.debug(Math.round(this.interpreter.extrusionDistance), 'total extrusion distance (mm)');

    if (!this.job.isPlanar) {
      console.warn('Job is non-planar');
    }

    if (options.render) {
      this.sceneManager.renderAnimated();
    }
  }

  async readStream(stream: ReadableStream): Promise<void> {
    const reader = stream.getReader();
    let result;
    let tail = '';
    let size = 0;

    do {
      result = await reader.read();
      const length = result.value?.length ?? 0;
      if (length === 0) {
        break;
      }
      console.debug('reading from stream', Math.floor(length / 1024), 'kB');
      size += length;
      const str = result.value;
      const idxNewLine = str.lastIndexOf('\n');
      const maxFullLine = str.slice(0, idxNewLine);

      // parse increments but don't render yet
      const { commands } = this.parser.parseGCode(tail + maxFullLine);

      // we'll execute the commands immediately, for now
      this.interpreter.execute(commands, this.job);

      tail = str.slice(idxNewLine);
    } while (!result.done);

    console.debug('total read from stream', Math.floor(size / 1024), 'kB');
  }

  /**
   * Renders the current scene
   */
  render(): void {
    this.sceneManager.render();
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
export { SceneManager, DevModeOptions, GCodeCommand, Parser };
