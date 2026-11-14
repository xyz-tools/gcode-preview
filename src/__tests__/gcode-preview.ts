import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, test, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { GCodePreview } from '../gcode-preview';
import { SceneManager } from '../scene-manager';
import { Parser } from '../parser/gcode-parser';
import { Job } from '../job';
import { Interpreter } from '../interpreter';
import { makeDroppable } from '../extra/dom-utils';

// Mock the dependencies
vi.mock('../scene-manager');
vi.mock('../parser/gcode-parser');
vi.mock('../job');
vi.mock('../interpreter');
vi.mock('../extra/dom-utils');

describe('GCodePreview', () => {
  let mockCanvas: HTMLCanvasElement;
  let preview: GCodePreview;
  let mockSceneManager: ReturnType<typeof vi.fn>;
  let mockJob: ReturnType<typeof vi.fn>;
  let mockInterpreter: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create mock canvas
    mockCanvas = document.createElement('canvas');

    // Setup mock instances
    mockJob = {
      layers: ['layer1', 'layer2'],
      countLayers: 2,
      isPlanar: true
    };

    mockInterpreter = {
      execute: vi.fn()
    };

    mockSceneManager = {
      backgroundColor: '#ffffff',
      extrusionColor: '#ff0000',
      startLayer: 1,
      endLayer: 10,
      clear: vi.fn(),
      resize: vi.fn(),
      processGCode: vi.fn().mockResolvedValue(undefined),
      render: vi.fn(),
      renderAnimated: vi.fn().mockResolvedValue(undefined),
      renderProgressive: vi.fn(),
      dispose: vi.fn()
    };

    // Setup mocks
    // vitest v4 requires function keyword (not arrow functions) in mockImplementation
    // for mocked constructors — arrow functions cannot be called with `new`.
    vi.mocked(Job).mockImplementation(function () {
      return mockJob;
    } as never);
    vi.mocked(Interpreter).mockImplementation(function () {
      return mockInterpreter;
    } as never);
    vi.mocked(SceneManager).mockImplementation(function () {
      return mockSceneManager;
    } as never);
    vi.mocked(Parser).mockImplementation(function () {
      return {
        parseGCode: vi.fn().mockReturnValue({
          commands: ['G0 X0 Y0', 'G1 X10 Y10']
        }),
        metadata: { thumbnails: {} }
      };
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a new instance with provided options', () => {
      const options = { canvas: mockCanvas };
      preview = new GCodePreview(options);

      expect(Job).toHaveBeenCalledWith({ minLayerThreshold: undefined });
      expect(Interpreter).toHaveBeenCalled();
      expect(SceneManager).toHaveBeenCalledWith(options, mockJob);
      expect(Parser).toHaveBeenCalled();
      expect(preview).toBeInstanceOf(GCodePreview);
    });

    it('passes arcChordTolerance to the interpreter', () => {
      preview = new GCodePreview({ canvas: mockCanvas, arcChordTolerance: 0.01 });

      expect(Interpreter).toHaveBeenCalledWith({ arcChordTolerance: 0.01 });
    });

    it('should expose renderer, parser, and job as public properties', () => {
      const options = { canvas: mockCanvas };
      preview = new GCodePreview(options);

      expect(preview.sceneManager).toBe(mockSceneManager);
      expect(preview.parser).toBeDefined();
      expect(preview.parser).toHaveProperty('parseGCode');
      expect(preview.job).toBe(mockJob);
    });

    it('should initialize droppable when droppable option is true', () => {
      const options = { canvas: mockCanvas, droppable: true };
      preview = new GCodePreview(options);

      expect(makeDroppable).toHaveBeenCalledWith(preview);
    });

    it('should not initialize droppable when droppable option is false', () => {
      const options = { canvas: mockCanvas, droppable: false };
      preview = new GCodePreview(options);

      expect(makeDroppable).not.toHaveBeenCalled();
    });

    it('should initialize with minLayerThreshold when provided', () => {
      const options = { canvas: mockCanvas, minLayerThreshold: 0.5 };
      preview = new GCodePreview(options);

      expect(Job).toHaveBeenCalledWith({ minLayerThreshold: 0.5 });
    });
  });

  describe('methods', () => {
    beforeEach(() => {
      preview = new GCodePreview({ canvas: mockCanvas });
    });

    describe('clear', () => {
      it('should clear renderer', () => {
        const originalParser = preview.parser;
        preview.clear();

        expect(mockSceneManager.clear).toHaveBeenCalled();
        expect(preview.parser).not.toBe(originalParser);
        expect(Parser).toHaveBeenCalledTimes(2); // Once in constructor, once in clear
        expect(Job).toHaveBeenCalledTimes(2); // Once in constructor, once in clear
      });
    });

    describe('processGCode', () => {
      it('should parse gcode and execute commands', () => {
        const gcode = 'G0 X0 Y0\nG1 X10 Y10';
        preview.processGCode(gcode);

        expect(preview.parser.parseGCode).toHaveBeenCalledWith(gcode);
        expect(mockInterpreter.execute).toHaveBeenCalledWith(['G0 X0 Y0', 'G1 X10 Y10'], mockJob);
        expect(mockSceneManager.renderAnimated).toHaveBeenCalled();
      });

      it('should handle array of gcode lines', () => {
        const gcode = ['G0 X0 Y0', 'G1 X10 Y10'];
        preview.processGCode(gcode);

        expect(preview.parser.parseGCode).toHaveBeenCalledWith(gcode);
        expect(mockInterpreter.execute).toHaveBeenCalled();
        expect(mockSceneManager.renderAnimated).toHaveBeenCalled();
      });

      it('should resolve only after the animated render has completed', async () => {
        let renderDone = false;
        mockSceneManager.renderAnimated.mockImplementation(() =>
          Promise.resolve().then(() => {
            renderDone = true;
          })
        );

        await preview.processGCode('G0 X0 Y0');

        expect(renderDone).toBe(true);
      });
    });

    describe('processGCodeStream', () => {
      it('should parse and execute gcode with default render option', async () => {
        const gcode = 'G0 X0 Y0';
        await preview.processGCodeStream(gcode);

        expect(preview.parser.parseGCode).toHaveBeenCalledWith(gcode);
        expect(mockInterpreter.execute).toHaveBeenCalled();
        expect(mockSceneManager.renderAnimated).toHaveBeenCalled();
      });

      it('should not render when render option is false', async () => {
        const gcode = 'G0 X0 Y0';
        await preview.processGCodeStream(gcode, { render: false });

        expect(preview.parser.parseGCode).toHaveBeenCalledWith(gcode);
        expect(mockInterpreter.execute).toHaveBeenCalled();
        expect(mockSceneManager.renderAnimated).not.toHaveBeenCalled();
      });

      it('should resolve only after the animated render has completed', async () => {
        let renderDone = false;
        mockSceneManager.renderAnimated.mockImplementation(() =>
          Promise.resolve().then(() => {
            renderDone = true;
          })
        );

        await preview.processGCodeStream('G0 X0 Y0');

        expect(renderDone).toBe(true);
      });

      it('should handle ReadableStream', async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue('G0 X0 Y0\n');
            controller.enqueue('G1 X10 Y10\n');
            controller.close();
          }
        });

        // Mock the readStream method
        const readStreamSpy = vi.spyOn(preview, 'readStream').mockResolvedValue(undefined);

        await preview.processGCodeStream(stream);

        expect(readStreamSpy).toHaveBeenCalledWith(stream, { render: true });
      });

      const makeStream = (chunks: string[]) =>
        new ReadableStream({
          start(controller) {
            chunks.forEach((chunk) => controller.enqueue(chunk));
            controller.close();
          }
        });

      it('should draw progressively while reading a stream', async () => {
        // advance the clock past the throttle interval on every call
        let now = 0;
        const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => (now += 1000));

        await preview.processGCodeStream(makeStream(['G0 X0 Y0\n', 'G1 X10 Y10\n', 'G1 X20 Y20\n']));

        expect(mockSceneManager.renderProgressive).toHaveBeenCalledTimes(3);
        expect(mockSceneManager.renderAnimated).toHaveBeenCalled();
        nowSpy.mockRestore();
      });

      it('should throttle progressive draws to the render interval', async () => {
        // the clock never advances, so only the first chunk triggers a draw
        const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);

        await preview.processGCodeStream(makeStream(['G0 X0 Y0\n', 'G1 X10 Y10\n', 'G1 X20 Y20\n']));

        expect(mockSceneManager.renderProgressive).toHaveBeenCalledTimes(1);
        nowSpy.mockRestore();
      });

      it('should draw on every chunk when liveRenderInterval is 0', async () => {
        // the clock never advances, so only the interval of 0 lets every chunk draw
        const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
        preview = new GCodePreview({ canvas: mockCanvas, liveRenderInterval: 0 });

        await preview.processGCodeStream(makeStream(['G0 X0 Y0\n', 'G1 X10 Y10\n', 'G1 X20 Y20\n']));

        expect(mockSceneManager.renderProgressive).toHaveBeenCalledTimes(3);
        nowSpy.mockRestore();
      });

      it('should not draw progressively when render is false', async () => {
        await preview.processGCodeStream(makeStream(['G0 X0 Y0\n']), { render: false });

        expect(mockSceneManager.renderProgressive).not.toHaveBeenCalled();
      });
    });

    describe('dispose', () => {
      it('should dispose renderer', () => {
        preview.dispose();
        expect(mockSceneManager.dispose).toHaveBeenCalled();
      });
    });
  });

  describe('lazy getters', () => {
    it('should lazily initialize renderer when accessed', () => {
      // Create preview without triggering renderer creation in constructor
      const options = { canvas: mockCanvas };
      // Clear mocks from constructor
      vi.clearAllMocks();

      // Create new preview instance with manual property assignment to test lazy loading
      const lazyPreview = Object.create(GCodePreview.prototype);
      lazyPreview.opts = options;
      lazyPreview.job = mockJob;
      lazyPreview._sceneManager = null;

      // Access renderer getter
      const renderer = lazyPreview.sceneManager;

      expect(SceneManager).toHaveBeenCalledWith(options, mockJob);
      expect(renderer).toBe(mockSceneManager);
    });

    it('should lazily initialize parser when accessed', () => {
      // Create preview without triggering parser creation in constructor
      const options = { canvas: mockCanvas };
      vi.clearAllMocks();

      // Create new preview instance with manual property assignment to test lazy loading
      const lazyPreview = Object.create(GCodePreview.prototype);
      lazyPreview.opts = options;
      lazyPreview._parser = null;

      // Access parser getter
      const parser = lazyPreview.parser;

      expect(Parser).toHaveBeenCalled();
      expect(parser).toBeDefined();
    });

    it('should return countLayers from job', () => {
      preview = new GCodePreview({ canvas: mockCanvas });
      expect(preview.countLayers).toBe(2);
    });
  });

  describe('processGCodeStream with non-planar job', () => {
    it('should warn when job is non-planar', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      preview = new GCodePreview({ canvas: mockCanvas });

      // Make job non-planar
      mockJob.isPlanar = false;

      const gcode = 'G0 X0 Y0';
      await preview.processGCodeStream(gcode);

      expect(consoleWarnSpy).toHaveBeenCalledWith('Job is non-planar');
      consoleWarnSpy.mockRestore();
    });
  });

  describe('readStream method', () => {
    it('should process stream data correctly', async () => {
      preview = new GCodePreview({ canvas: mockCanvas });

      const chunks = ['G0 X0 Y0\nG1 X10', ' Y10\nG1 X20 Y20\n'];
      const stream = new ReadableStream({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(chunk));
          controller.close();
        }
      });

      const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      await preview.readStream(stream);

      // Should have parsed the complete lines
      expect(preview.parser.parseGCode).toHaveBeenCalled();
      expect(mockInterpreter.execute).toHaveBeenCalled();
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('reading from stream'),
        expect.any(Number),
        'kB'
      );
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('total read from stream'),
        expect.any(Number),
        'kB'
      );

      consoleDebugSpy.mockRestore();
    });

    it('should handle empty stream chunks', async () => {
      preview = new GCodePreview({ canvas: mockCanvas });
      const onStreamEnd = vi.fn();
      preview.onStreamEnd = onStreamEnd;

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue('');
          controller.close();
        }
      });

      await preview.readStream(stream);

      // An empty chunk is skipped, not treated as end-of-stream: there is
      // nothing to parse, but the stream still finishes normally
      expect(preview.parser.parseGCode).not.toHaveBeenCalled();
      expect(onStreamEnd).toHaveBeenCalledTimes(1);
    });

    it('should process every chunk after an empty mid-stream chunk', async () => {
      preview = new GCodePreview({ canvas: mockCanvas });
      const onStreamEnd = vi.fn();
      preview.onStreamEnd = onStreamEnd;

      const stream = new ReadableStream({
        start(controller) {
          // TextDecoderStream can emit '' for a chunk holding only a partial
          // multi-byte sequence; it must not truncate the rest of the stream
          controller.enqueue('G1 X0 Y0\n');
          controller.enqueue('');
          controller.enqueue('G1 X10 Y10\n');
          controller.close();
        }
      });

      await preview.readStream(stream);

      expect(preview.parser.parseGCode).toHaveBeenCalledTimes(2);
      expect(preview.parser.parseGCode).toHaveBeenNthCalledWith(1, 'G1 X0 Y0');
      expect(preview.parser.parseGCode).toHaveBeenNthCalledWith(2, 'G1 X10 Y10');
      expect(mockInterpreter.execute).toHaveBeenCalledTimes(2);
      expect(onStreamEnd).toHaveBeenCalledTimes(1);
    });

    it('should handle stream with tail data', async () => {
      preview = new GCodePreview({ canvas: mockCanvas });

      const stream = new ReadableStream({
        start(controller) {
          // Data without ending newline
          controller.enqueue('G0 X0 Y0\nG1 X10 Y10');
          controller.enqueue('\nG1 X20 Y20\n');
          controller.close();
        }
      });

      await preview.readStream(stream);

      // Should process all complete lines
      expect(preview.parser.parseGCode).toHaveBeenCalledTimes(2);
      expect(mockInterpreter.execute).toHaveBeenCalledTimes(2);
    });

    it('should flush and parse the tail when the last chunk has no trailing newline', async () => {
      preview = new GCodePreview({ canvas: mockCanvas });

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue('G0 X0 Y0\n');
          controller.enqueue('G1 X10 Y10');
          controller.close();
        }
      });

      await preview.readStream(stream);

      // chunk 2 has no newline, so it completes nothing and is skipped rather
      // than parsed as an empty line; the tail is flushed after the stream ends
      expect(preview.parser.parseGCode).toHaveBeenCalledTimes(2);
      expect(preview.parser.parseGCode).toHaveBeenNthCalledWith(1, 'G0 X0 Y0');
      expect(preview.parser.parseGCode).toHaveBeenLastCalledWith('G1 X10 Y10');
      expect(mockInterpreter.execute).toHaveBeenCalledTimes(2);
    });

    it('cancels the stream when clear() replaces the job mid-stream', async () => {
      preview = new GCodePreview({ canvas: mockCanvas });
      const onStreamEnd = vi.fn();
      preview.onStreamEnd = onStreamEnd;

      let controller!: ReadableStreamDefaultController<string>;
      let cancelled = false;
      const stream = new ReadableStream<string>({
        start(streamController) {
          controller = streamController;
          controller.enqueue('G0 X0 Y0\n');
        },
        cancel() {
          cancelled = true;
        }
      });

      let firstChunkProcessed!: () => void;
      const firstChunk = new Promise<void>((resolve) => (firstChunkProcessed = resolve));
      preview.onJobUpdated = () => firstChunkProcessed();

      const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const reading = preview.readStream(stream);
      await firstChunk;
      const oldParseGCode = preview.parser.parseGCode;

      // clear() builds a fresh Job; the shared mock would hand back the same
      // object, which would hide the identity change the fix relies on
      vi.mocked(Job).mockImplementationOnce(function () {
        return { ...mockJob };
      } as never);
      preview.clear();

      // simulate a delayed chunk from the old stream arriving after clear()
      controller.enqueue('G1 X999 E1\n');
      await reading;

      // only the pre-clear chunk was parsed and executed; the delayed chunk
      // was dropped and the old reader cancelled without signalling stream end
      expect(oldParseGCode).toHaveBeenCalledTimes(1);
      expect(preview.parser.parseGCode).not.toHaveBeenCalled();
      expect(mockInterpreter.execute).toHaveBeenCalledTimes(1);
      expect(cancelled).toBe(true);
      expect(onStreamEnd).not.toHaveBeenCalled();

      consoleDebugSpy.mockRestore();
    });
  });

  describe('direct renderer access', () => {
    it('should allow direct access to renderer properties', () => {
      preview = new GCodePreview({ canvas: mockCanvas });

      // Add more properties to mock to test advanced access
      mockSceneManager.buildVolume = { x: 200, y: 200, z: 200 };
      mockSceneManager.travelColor = '#00ff00';
      mockSceneManager.renderTubes = true;

      expect(preview.sceneManager.buildVolume).toEqual({ x: 200, y: 200, z: 200 });
      expect(preview.sceneManager.travelColor).toBe('#00ff00');
      expect(preview.sceneManager.renderTubes).toBe(true);
    });
  });
});

describe('Quint lifecycle spec trace replay', () => {
  // Replays ITF traces produced from verification/quint/lifecycle.qnt against
  // a REAL GCodePreview. The module mocks at the top of this file are undone
  // for this suite (vi.doUnmock + vi.resetModules + a fresh dynamic import),
  // so the real SceneManager, ObjectsManager, Parser, Interpreter and Job are
  // driven; only three's WebGLRenderer is replaced — the same stubbing the
  // renderer smoke test uses — so the suite runs without a GPU. Each trace
  // state carries the lifecycle call that produced it (cmd), the spec's
  // predicted outcome ("ok" vs "throws"), and the observable counters.
  const tracesDir = join(process.cwd(), 'verification', 'quint', 'traces', 'lifecycle');

  // The fixed snippet the spec's "process" action stands for: one extrusion
  // move, which adds exactly one path to the job per processGCode call.
  const PROCESS_SNIPPET = 'G1 X10 Y10 E1';

  // An ITF value: strings are plain JSON; integers arrive either as plain
  // numbers or in Apalache's { "#bigint": "123" } wrapping.
  type ItfValue = boolean | string | number | { '#bigint': string } | undefined;
  type ItfState = Record<string, ItfValue>;

  const itfInt = (value: ItfValue, key: string): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && value !== null && typeof value['#bigint'] === 'string') {
      return Number(value['#bigint']);
    }
    throw new Error(`expected an ITF integer for "${key}", got ${JSON.stringify(value)}`);
  };
  const itfStr = (value: ItfValue, key: string): string => {
    if (typeof value !== 'string') throw new Error(`expected a string for "${key}", got ${JSON.stringify(value)}`);
    return value;
  };

  // The spec's state variables, decoded; keys starting with '#' (like '#meta')
  // are never read and are thereby ignored.
  type SpecState = {
    cmd: string;
    outcome: string;
    phase: string;
    processedCount: number;
    pathCount: number;
    managerGen: number;
  };

  const decodeState = (raw: ItfState): SpecState => ({
    cmd: itfStr(raw.cmd, 'cmd'),
    outcome: itfStr(raw.outcome, 'outcome'),
    phase: itfStr(raw.phase, 'phase'),
    processedCount: itfInt(raw.processedCount, 'processedCount'),
    pathCount: itfInt(raw.pathCount, 'pathCount'),
    managerGen: itfInt(raw.managerGen, 'managerGen')
  });

  // Every WebGLRenderer the stub hands out, in construction order: the spec's
  // managerGen counts SceneManager/renderer pairs, so resurrection after
  // dispose() is observable as this list growing.
  const createdRenderers: object[] = [];
  let RealGCodePreview: typeof GCodePreview;

  beforeAll(async () => {
    vi.doUnmock('../scene-manager');
    vi.doUnmock('../parser/gcode-parser');
    vi.doUnmock('../job');
    vi.doUnmock('../interpreter');
    vi.doUnmock('../extra/dom-utils');
    // Only the WebGLRenderer is replaced so the replay can run without a GPU.
    // Every other three.js class stays real, as in renderer-smoke.ts.
    vi.doMock('three', async (importOriginal) => {
      const actual = await importOriginal<typeof import('three')>();
      class MockWebGLRenderer {
        domElement: HTMLElement;
        info = {
          render: { triangles: 0, calls: 0, lines: 0, points: 0 },
          memory: { geometries: 0, textures: 0 }
        };
        localClippingEnabled = false;
        setPixelRatio = vi.fn();
        setSize = vi.fn();
        render = vi.fn();
        dispose = vi.fn();

        constructor(opts: { canvas?: HTMLElement } = {}) {
          this.domElement = opts.canvas ?? document.createElement('canvas');
          createdRenderers.push(this);
        }
      }
      return { ...actual, WebGLRenderer: MockWebGLRenderer };
    });
    vi.resetModules();
    RealGCodePreview = (await import('../gcode-preview')).GCodePreview;
  });

  afterAll(() => {
    vi.doUnmock('three');
    vi.resetModules();
  });

  // The real SceneManager logs its three.js revision and options on every
  // construction (including each resurrection); keep the test output clean.
  let consoleSpies: Array<{ mockRestore: () => void }> = [];
  beforeEach(() => {
    consoleSpies = [
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'debug').mockImplementation(() => {})
    ];
  });
  afterEach(() => {
    consoleSpies.forEach((spy) => spy.mockRestore());
  });

  /** dispose() nulls the private _sceneManager; "disposed" means exactly that. */
  const managerLive = (preview: GCodePreview): boolean =>
    (preview as unknown as { _sceneManager: unknown })._sceneManager !== null;

  const LIFECYCLE_CALLS = ['process', 'clear', 'render', 'resize', 'dispose'];

  /** Applies one spec action to the real preview, observing ok vs throws. */
  const applyAction = async (preview: GCodePreview, cmd: string): Promise<'ok' | 'throws'> => {
    if (!LIFECYCLE_CALLS.includes(cmd)) throw new Error(`unknown spec command "${cmd}"`);
    try {
      if (cmd === 'process') await preview.processGCode(PROCESS_SNIPPET);
      else if (cmd === 'clear') preview.clear();
      else if (cmd === 'render') preview.sceneManager.render();
      else if (cmd === 'resize') preview.sceneManager.resize();
      else preview.dispose();
      return 'ok';
    } catch {
      return 'throws';
    }
  };

  // The full per-step comparison from the trace contract. Every assertion
  // message names the trace file, step index, lifecycle call, field, and the
  // expected vs actual values.
  const compareStep = (
    traceFile: string,
    stepIndex: number,
    input: string,
    preview: GCodePreview,
    actualOutcome: string,
    rendererBase: number,
    spec: SpecState
  ): void => {
    const at = (field: string, expected: unknown, actual: unknown) =>
      `${traceFile} step ${stepIndex} (${input}) field ${field}: expected ${String(expected)}, actual ${String(actual)}`;

    expect(actualOutcome, at('outcome', spec.outcome, actualOutcome)).toBe(spec.outcome);

    const paths = preview.job.paths.length;
    expect(paths, at('pathCount', spec.pathCount, paths)).toBe(spec.pathCount);

    const gen = createdRenderers.length - rendererBase;
    expect(gen, at('managerGen', spec.managerGen, gen)).toBe(spec.managerGen);

    // phase: "disposed" iff no scene manager is live; "hasContent" iff one is
    // live and the job holds paths; "fresh" otherwise
    const live = managerLive(preview);
    const expectedLive = spec.phase !== 'disposed';
    expect(live, at('phase/managerLive', expectedLive, live)).toBe(expectedLive);
    const expectedHasContent = spec.phase === 'hasContent';
    const actualHasContent = live && paths > 0;
    expect(actualHasContent, at('phase/hasContent', expectedHasContent, actualHasContent)).toBe(expectedHasContent);
  };

  let traceFiles: string[] = [];
  try {
    traceFiles = readdirSync(tracesDir)
      .filter((file) => file.endsWith('.itf.json'))
      .sort();
  } catch {
    // Missing directory: the guard test below fails with a clear message.
  }

  test('the traces directory exists and holds at least one ITF trace', () => {
    // Fails (rather than silently skipping the replay) when the Quint traces
    // have not been generated into verification/quint/traces.
    expect(traceFiles.length, `expected *.itf.json traces in ${tracesDir}`).toBeGreaterThan(0);
  });

  for (const traceFile of traceFiles) {
    test(`replays ${traceFile} against a real stubbed GCodePreview`, async () => {
      const parsed = JSON.parse(readFileSync(join(tracesDir, traceFile), 'utf8')) as { states: ItfState[] };
      expect(Array.isArray(parsed.states), `${traceFile}: ITF file has no states array`).toBe(true);
      expect(parsed.states.length, `${traceFile}: trace has no states`).toBeGreaterThan(0);
      const states = parsed.states.map(decodeState);

      // One real preview per trace: lifecycle state persists across the steps.
      const rendererBase = createdRenderers.length;
      const canvas = document.createElement('canvas');
      Object.defineProperty(canvas, 'offsetWidth', { value: 800, configurable: true });
      Object.defineProperty(canvas, 'offsetHeight', { value: 600, configurable: true });
      const preview = new RealGCodePreview({ canvas, buildVolume: { x: 200, y: 200, z: 200 } });

      try {
        expect(states[0].cmd, `${traceFile} step 0: the first state must be the init state`).toBe('init');
        compareStep(traceFile, 0, '<init>', preview, 'ok', rendererBase, states[0]);

        for (let step = 1; step < states.length; step++) {
          const spec = states[step];
          // a stutter step feeds no input: the preview must simply stay put
          const actualOutcome = spec.cmd === 'stutter' ? 'ok' : await applyAction(preview, spec.cmd);
          compareStep(traceFile, step, spec.cmd, preview, actualOutcome, rendererBase, spec);
        }
      } finally {
        // stop the animation loop of whichever SceneManager is currently live
        preview.dispose();
      }
    });
  }
});
