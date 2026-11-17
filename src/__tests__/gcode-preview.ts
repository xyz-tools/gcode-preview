import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
      it('should parse gcode and execute commands', async () => {
        await preview.processGCode('G0 X0 Y0\nG1 X10 Y10');

        // the last line has no newline, so it is flushed on its own after the slice
        expect(preview.parser.parseGCode).toHaveBeenNthCalledWith(1, 'G0 X0 Y0');
        expect(preview.parser.parseGCode).toHaveBeenNthCalledWith(2, 'G1 X10 Y10');
        expect(mockInterpreter.execute).toHaveBeenCalledWith(['G0 X0 Y0', 'G1 X10 Y10'], mockJob);
        expect(mockSceneManager.renderAnimated).toHaveBeenCalled();
      });

      it('should handle array of gcode lines', async () => {
        await preview.processGCode(['G0 X0 Y0', 'G1 X10 Y10']);

        expect(preview.parser.parseGCode).toHaveBeenNthCalledWith(1, 'G0 X0 Y0');
        expect(preview.parser.parseGCode).toHaveBeenNthCalledWith(2, 'G1 X10 Y10');
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

  describe('parsing in slices', () => {
    // 'G1 X1\n' never divides the 16 KB slice evenly, so lines straddle every
    // slice boundary; 20k lines make 120000 chars, i.e. 8 slices
    const LINE = 'G1 X1\n';
    const LINE_COUNT = 20_000;
    const SLICES = Math.ceil((LINE.length * LINE_COUNT) / (16 * 1024));
    const multiSlice = LINE.repeat(LINE_COUNT);

    /**
     * A MessageChannel whose message is only delivered when the test says so,
     * so a test can hold parsing inside a yield.
     */
    class ManualChannel {
      static opened: ManualChannel[] = [];
      port1 = { onmessage: null as (() => void) | null, close: vi.fn() };
      port2 = { postMessage: vi.fn() };

      constructor() {
        ManualChannel.opened.push(this);
      }

      deliver() {
        this.port1.onmessage!();
      }
    }

    /** Advances performance.now() past the 10 ms budget on every read, so every slice yields. */
    const exhaustBudgetOnEveryCheck = () => {
      let now = 0;
      return vi.spyOn(performance, 'now').mockImplementation(() => (now += 10));
    };

    /** Everything parseGCode received, rejoined: the slices must cover the input exactly once. */
    const parsedText = () =>
      vi
        .mocked(preview.parser.parseGCode)
        .mock.calls.map(([text]) => text)
        .join('\n');

    beforeEach(() => {
      ManualChannel.opened = [];
      preview = new GCodePreview({ canvas: mockCanvas });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('parses in slices that cover the input exactly once', async () => {
      exhaustBudgetOnEveryCheck();

      await preview.processGCode(multiSlice);

      expect(preview.parser.parseGCode).toHaveBeenCalledTimes(SLICES);
      // the final newline ends the last line; nothing is left as a tail
      expect(parsedText()).toEqual(multiSlice.slice(0, -1));
      expect(mockInterpreter.execute).toHaveBeenCalledTimes(SLICES);
      expect(mockSceneManager.renderAnimated).toHaveBeenCalledTimes(1);
    });

    it('fills the job asynchronously, firing onJobUpdated once per slice', async () => {
      exhaustBudgetOnEveryCheck();
      const onJobUpdated = vi.fn();
      preview.onJobUpdated = onJobUpdated;

      const parsing = preview.processGCode(multiSlice);

      // only the first slice ran before the first yield
      expect(preview.parser.parseGCode).toHaveBeenCalledTimes(1);
      expect(onJobUpdated).toHaveBeenCalledTimes(1);
      expect(mockSceneManager.renderAnimated).not.toHaveBeenCalled();

      await parsing;

      expect(onJobUpdated).toHaveBeenCalledTimes(SLICES);
      expect(onJobUpdated).toHaveBeenCalledWith(mockJob);
      expect(mockSceneManager.renderAnimated).toHaveBeenCalledTimes(1);
    });

    it('does not yield while the time budget lasts', async () => {
      vi.stubGlobal('MessageChannel', ManualChannel);
      vi.spyOn(performance, 'now').mockReturnValue(0);

      const parsing = preview.processGCode(multiSlice);

      // the clock never moves, so every slice is parsed in one synchronous run
      expect(preview.parser.parseGCode).toHaveBeenCalledTimes(SLICES);
      await parsing;
      expect(ManualChannel.opened).toHaveLength(0);
    });

    it('yields through a MessageChannel task, one per spent budget', async () => {
      vi.stubGlobal('MessageChannel', ManualChannel);
      exhaustBudgetOnEveryCheck();

      const parsing = preview.processGCode(multiSlice);

      for (let slice = 1; slice < SLICES; slice++) {
        // parsing waits on the posted message, and resumes only on its delivery
        await vi.waitFor(() => expect(ManualChannel.opened).toHaveLength(slice));
        const channel = ManualChannel.opened[slice - 1];
        expect(channel.port2.postMessage).toHaveBeenCalledTimes(1);
        expect(preview.parser.parseGCode).toHaveBeenCalledTimes(slice);
        channel.deliver();
        // each channel is closed once used, so none is left open
        expect(channel.port1.close).toHaveBeenCalledTimes(1);
      }

      // the last slice spends the budget too, and so yields once more
      await vi.waitFor(() => expect(ManualChannel.opened).toHaveLength(SLICES));
      ManualChannel.opened[SLICES - 1].deliver();
      await parsing;

      expect(preview.parser.parseGCode).toHaveBeenCalledTimes(SLICES);
    });

    it('yields a real macrotask: queued microtasks all drain before parsing resumes', async () => {
      exhaustBudgetOnEveryCheck();
      // A chain of microtasks, each queueing the next. A promise-based yield
      // (a bare `await` or Promise.resolve()) would resume parsing after a
      // tick or two, midway through the chain; a task resumes only after the
      // whole microtask queue -- and, in a browser, a render -- has run.
      const CHAIN = 100;
      let drained = 0;
      const drain = (): Promise<void> | void => {
        if (++drained < CHAIN) return Promise.resolve().then(drain);
      };
      const drainedAtSlice: number[] = [];
      preview.onJobUpdated = () => {
        drainedAtSlice.push(drained);
        if (drainedAtSlice.length === 1) void Promise.resolve().then(drain);
      };

      await preview.processGCode(multiSlice);

      expect(drainedAtSlice[0]).toEqual(0);
      expect(drainedAtSlice[1]).toEqual(CHAIN);
    });

    it('stops parsing and skips the render when clear() swaps the job during a yield', async () => {
      vi.stubGlobal('MessageChannel', ManualChannel);
      exhaustBudgetOnEveryCheck();
      const onJobUpdated = vi.fn();
      preview.onJobUpdated = onJobUpdated;

      const parsing = preview.processGCode(multiSlice);
      expect(ManualChannel.opened).toHaveLength(1);
      const oldParseGCode = preview.parser.parseGCode;

      // clear() builds a fresh Job; the shared mock would hand back the same
      // object, which would hide the identity change the bail-out relies on
      const freshJob = { ...mockJob };
      vi.mocked(Job).mockImplementationOnce(function () {
        return freshJob;
      } as never);
      preview.clear();
      ManualChannel.opened[0].deliver();
      await parsing;

      // the old job got the first slice and nothing more; the new one nothing
      expect(oldParseGCode).toHaveBeenCalledTimes(1);
      expect(preview.parser.parseGCode).not.toHaveBeenCalled();
      expect(mockInterpreter.execute).toHaveBeenCalledTimes(1);
      expect(mockInterpreter.execute).toHaveBeenCalledWith(expect.anything(), mockJob);
      expect(onJobUpdated).toHaveBeenCalledTimes(1);
      expect(preview.job).toBe(freshJob);
      expect(ManualChannel.opened).toHaveLength(1);
      expect(mockSceneManager.renderAnimated).not.toHaveBeenCalled();
    });

    it('keeps a last line that has no trailing newline', async () => {
      await preview.processGCode('G0 X0 Y0\nG1 X10 Y10');

      expect(preview.parser.parseGCode).toHaveBeenCalledTimes(2);
      expect(preview.parser.parseGCode).toHaveBeenNthCalledWith(1, 'G0 X0 Y0');
      expect(preview.parser.parseGCode).toHaveBeenLastCalledWith('G1 X10 Y10');
      expect(mockInterpreter.execute).toHaveBeenCalledTimes(2);
    });

    it('keeps the metadata from the slices, not from the flushed last line', async () => {
      const sliceMetadata = { thumbnails: {}, slicerName: 'from the slice' };
      const tailMetadata = { thumbnails: {}, slicerName: 'from the tail' };
      vi.mocked(preview.parser.parseGCode)
        .mockReturnValueOnce({ commands: [], metadata: sliceMetadata } as never)
        .mockReturnValueOnce({ commands: [], metadata: tailMetadata } as never);

      await preview.processGCode('G0 X0 Y0\nG1 X10 Y10');

      // like readStream's tail flush: the parser accumulates metadata in one
      // object, so the flush has nothing new to hand the job
      expect(preview.job.metadata).toBe(sliceMetadata);
    });

    it('joins string[] input with newlines before slicing it', async () => {
      await preview.processGCode(['G0 X0 Y0', 'G1 X10 Y10', 'G1 X20 Y20']);

      expect(preview.parser.parseGCode).toHaveBeenNthCalledWith(1, 'G0 X0 Y0\nG1 X10 Y10');
      expect(preview.parser.parseGCode).toHaveBeenLastCalledWith('G1 X20 Y20');
    });

    it('parses string[] input the same as the joined string', async () => {
      exhaustBudgetOnEveryCheck();
      await preview.processGCode(multiSlice);
      const fromString = vi.mocked(preview.parser.parseGCode).mock.calls;

      preview = new GCodePreview({ canvas: mockCanvas });
      await preview.processGCode(multiSlice.split('\n'));

      expect(vi.mocked(preview.parser.parseGCode).mock.calls).toEqual(fromString);
    });

    it('parses nothing for empty input, but still renders', async () => {
      await preview.processGCode('');

      expect(preview.parser.parseGCode).not.toHaveBeenCalled();
      expect(mockSceneManager.renderAnimated).toHaveBeenCalledTimes(1);
    });

    it('resolves only after the animated render has completed', async () => {
      let renderDone = false;
      mockSceneManager.renderAnimated.mockImplementation(() =>
        Promise.resolve().then(() => {
          renderDone = true;
        })
      );

      await preview.processGCode('G0 X0 Y0\n');

      expect(renderDone).toBe(true);
    });

    it('slices string input to processGCodeStream the same way', async () => {
      vi.stubGlobal('MessageChannel', ManualChannel);
      exhaustBudgetOnEveryCheck();

      const parsing = preview.processGCodeStream(multiSlice, { render: false });
      // held in the first yield: only the first slice has been parsed
      expect(preview.parser.parseGCode).toHaveBeenCalledTimes(1);

      for (let slice = 1; slice <= SLICES; slice++) {
        await vi.waitFor(() => expect(ManualChannel.opened).toHaveLength(slice));
        ManualChannel.opened[slice - 1].deliver();
      }
      await parsing;

      expect(preview.parser.parseGCode).toHaveBeenCalledTimes(SLICES);
      expect(parsedText()).toEqual(multiSlice.slice(0, -1));
      expect(mockSceneManager.renderAnimated).not.toHaveBeenCalled();
    });

    describe('where the browser has requestIdleCallback', () => {
      /** Idle requests the test answers by hand, with the deadline it chooses. */
      let idleRequests: { callback: IdleRequestCallback; options?: IdleRequestOptions }[];

      /** A deadline that grants `slices` slices' worth of time: one check per slice. */
      const deadlineFor = (slices: number, didTimeout = false): IdleDeadline => {
        let checks = 0;
        return { didTimeout, timeRemaining: () => (++checks < slices ? 5 : 0) };
      };

      beforeEach(() => {
        idleRequests = [];
        vi.stubGlobal('MessageChannel', ManualChannel);
        vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback, options?: IdleRequestOptions) => {
          idleRequests.push({ callback, options });
          return idleRequests.length;
        });
      });

      it('lets the browser decide how many slices fit before the next pause', async () => {
        exhaustBudgetOnEveryCheck();

        const parsing = preview.processGCode(multiSlice);
        // the first window is the fixed budget, spent by the first slice
        expect(preview.parser.parseGCode).toHaveBeenCalledTimes(1);
        expect(idleRequests).toHaveLength(1);

        // the browser grants room for three slices
        idleRequests[0].callback(deadlineFor(3));
        await vi.waitFor(() => expect(idleRequests).toHaveLength(2));
        expect(preview.parser.parseGCode).toHaveBeenCalledTimes(4);

        // then room for everything that is left
        idleRequests[1].callback(deadlineFor(SLICES));
        await parsing;

        expect(preview.parser.parseGCode).toHaveBeenCalledTimes(SLICES);
        expect(parsedText()).toEqual(multiSlice.slice(0, -1));
        // the browser did the scheduling: no MessageChannel was needed
        expect(ManualChannel.opened).toHaveLength(0);
      });

      it('asks the browser to stop waiting for idle time after 50 ms', async () => {
        exhaustBudgetOnEveryCheck();

        void preview.processGCode(multiSlice);

        expect(idleRequests[0].options).toEqual({ timeout: 50 });
      });

      it('falls back to the fixed budget when the browser was never idle', async () => {
        const now = exhaustBudgetOnEveryCheck();

        const parsing = preview.processGCode(multiSlice);
        expect(preview.parser.parseGCode).toHaveBeenCalledTimes(1);

        // a timed-out deadline reports no time left; parsing must still get a
        // budget of its own, so let the clock stand still for one window
        now.mockImplementation(() => 1000);
        idleRequests[0].callback(deadlineFor(0, true));
        // with the clock stopped the budget never runs out, so the rest goes in one window
        await parsing;

        expect(preview.parser.parseGCode).toHaveBeenCalledTimes(SLICES);
        expect(idleRequests).toHaveLength(1);
      });

      it('stops when clear() swaps the job while waiting for idle time', async () => {
        exhaustBudgetOnEveryCheck();

        const parsing = preview.processGCode(multiSlice);
        const oldParseGCode = preview.parser.parseGCode;
        // a fresh Job, so the identity check sees the swap (see the test above)
        vi.mocked(Job).mockImplementationOnce(function () {
          return { ...mockJob };
        } as never);
        preview.clear();
        idleRequests[0].callback(deadlineFor(SLICES));
        await parsing;

        expect(oldParseGCode).toHaveBeenCalledTimes(1);
        expect(preview.parser.parseGCode).not.toHaveBeenCalled();
        expect(mockSceneManager.renderAnimated).not.toHaveBeenCalled();
      });
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
