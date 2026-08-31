import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GCodePreview } from '../gcode-preview';
import { SceneManager } from '../scene-manager';
import { Parser } from '../parser/gcode-parser';
import { DevGUI } from '../dev-gui';
import { Job } from '../job';
import { Interpreter } from '../interpreter';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { makeDroppable } from '../extra/dom-utils';

// Mock the dependencies
vi.mock('../scene-manager');
vi.mock('../parser/gcode-parser');
vi.mock('../dev-gui');
vi.mock('../job');
vi.mock('../interpreter');
vi.mock('three/examples/jsm/libs/stats.module.js');
vi.mock('../extra/dom-utils');

describe('GCodePreview', () => {
  let mockCanvas: HTMLCanvasElement;
  let preview: GCodePreview;
  let mockSceneManager: ReturnType<typeof vi.fn>;
  let mockDevGui: ReturnType<typeof vi.fn>;
  let mockJob: ReturnType<typeof vi.fn>;
  let mockInterpreter: ReturnType<typeof vi.fn>;
  let mockStats: { update: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; dom: HTMLDivElement };

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

    mockDevGui = {
      reset: vi.fn(),
      destroy: vi.fn()
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
    vi.mocked(DevGUI).mockImplementation(function () {
      return mockDevGui;
    } as never);
    mockStats = {
      update: vi.fn(),
      end: vi.fn(),
      dom: document.createElement('div')
    };
    vi.mocked(Stats).mockImplementation(function () {
      return mockStats;
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    // initStats appends the stats dom to document.body by default
    mockStats.dom.remove();
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

    it('should expose renderer, parser, and job as public properties', () => {
      const options = { canvas: mockCanvas };
      preview = new GCodePreview(options);

      expect(preview.sceneManager).toBe(mockSceneManager);
      expect(preview.parser).toBeDefined();
      expect(preview.parser).toHaveProperty('parseGCode');
      expect(preview.job).toBe(mockJob);
    });

    it('should initialize dev GUI when devMode is true', () => {
      const options = { canvas: mockCanvas, devMode: true };
      preview = new GCodePreview(options);

      expect(DevGUI).toHaveBeenCalledWith(preview);
      // the devMode setter is the only construction site, so exactly one GUI
      expect(DevGUI).toHaveBeenCalledTimes(1);
    });

    it('should initialize dev GUI with options when devMode is an object', () => {
      const devModeOptions = { camera: false };
      const options = { canvas: mockCanvas, devMode: devModeOptions };
      preview = new GCodePreview(options);

      expect(DevGUI).toHaveBeenCalledWith(preview, devModeOptions);
      expect(DevGUI).toHaveBeenCalledTimes(1);
    });

    it('should not initialize dev GUI when devMode is false', () => {
      const options = { canvas: mockCanvas, devMode: false };
      preview = new GCodePreview(options);

      expect(DevGUI).not.toHaveBeenCalled();
    });

    it('should not initialize dev GUI when devMode is undefined', () => {
      const options = { canvas: mockCanvas };
      preview = new GCodePreview(options);

      expect(DevGUI).not.toHaveBeenCalled();
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

      it('should reset devGui if it exists', () => {
        preview = new GCodePreview({ canvas: mockCanvas, devMode: true });
        preview.clear();

        expect(mockDevGui.reset).toHaveBeenCalled();
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

      it('should destroy and clear devGui if it exists', () => {
        preview = new GCodePreview({ canvas: mockCanvas, devMode: true });
        preview.dispose();

        expect(mockDevGui.destroy).toHaveBeenCalled();
        expect(mockSceneManager.dispose).toHaveBeenCalled();
      });
    });
  });

  describe('devMode getter/setter', () => {
    it('should return devMode from options', () => {
      preview = new GCodePreview({ canvas: mockCanvas, devMode: true });
      expect(preview.devMode).toBe(true);
    });

    it('should update devMode and reinitialize GUI', () => {
      preview = new GCodePreview({ canvas: mockCanvas });
      expect(preview.devMode).toBeUndefined();

      preview.devMode = true;
      expect(preview.devMode).toBe(true);
      expect(DevGUI).toHaveBeenCalledWith(preview);
    });

    it('should destroy existing GUI when changing devMode', () => {
      preview = new GCodePreview({ canvas: mockCanvas, devMode: true });
      const initialGui = mockDevGui;

      // Create new mock for second DevGUI instance
      const newMockDevGui = { reset: vi.fn(), destroy: vi.fn() };
      vi.mocked(DevGUI).mockImplementationOnce(function () {
        return newMockDevGui;
      } as never);

      preview.devMode = false;

      expect(initialGui.destroy).toHaveBeenCalled();
      expect(preview.devMode).toBe(false);
    });

    it('should handle devMode as object with options', () => {
      preview = new GCodePreview({ canvas: mockCanvas });
      const devModeOptions = { camera: true };

      preview.devMode = devModeOptions;
      expect(preview.devMode).toBe(devModeOptions);
      expect(DevGUI).toHaveBeenCalledWith(preview, devModeOptions);
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

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue('');
          controller.close();
        }
      });

      await preview.readStream(stream);

      // Should handle empty chunk gracefully
      expect(preview.parser.parseGCode).not.toHaveBeenCalled();
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
  });

  describe('initStats method', () => {
    it('should not create stats when devMode is false', () => {
      preview = new GCodePreview({ canvas: mockCanvas, devMode: false });
      expect(Stats).not.toHaveBeenCalled();
      expect(preview.stats).toBeUndefined();
    });

    it('should not create stats when devMode is not set', () => {
      preview = new GCodePreview({ canvas: mockCanvas });
      expect(Stats).not.toHaveBeenCalled();
      expect(preview.stats).toBeUndefined();
    });

    // regression: the constructor used to read this.devMode before assigning
    // it from opts, so stats were never created even with devMode enabled
    it('should create stats and append them to document.body when devMode is true', () => {
      preview = new GCodePreview({ canvas: mockCanvas, devMode: true });

      expect(Stats).toHaveBeenCalledTimes(1);
      expect(mockStats.dom.parentElement).toBe(document.body);
      expect(mockStats.dom.classList.contains('stats')).toBe(true);
    });

    it('should append stats to the statsContainer from devMode options', () => {
      const statsContainer = document.createElement('div');
      preview = new GCodePreview({ canvas: mockCanvas, devMode: { statsContainer } });

      expect(mockStats.dom.parentElement).toBe(statsContainer);
      expect(mockStats.dom.classList.contains('stats')).toBe(true);
    });

    it('should fall back to document.body when devMode options have no statsContainer', () => {
      preview = new GCodePreview({ canvas: mockCanvas, devMode: {} });

      expect(mockStats.dom.parentElement).toBe(document.body);
    });
  });

  describe('stats updates on rendered frames', () => {
    it('should update stats when the sceneManager reports a rendered frame', () => {
      preview = new GCodePreview({ canvas: mockCanvas, devMode: true });

      mockSceneManager.onFrameRendered();

      expect(mockStats.update).toHaveBeenCalledTimes(1);
    });

    it('should tolerate rendered frames when stats are disabled', () => {
      preview = new GCodePreview({ canvas: mockCanvas });

      expect(() => mockSceneManager.onFrameRendered()).not.toThrow();
      expect(mockStats.update).not.toHaveBeenCalled();
    });
  });

  describe('dispose with stats', () => {
    it('should handle dispose when stats do not exist', () => {
      preview = new GCodePreview({ canvas: mockCanvas, devMode: false });

      // Verify no stats were created
      expect(preview.stats).toBeUndefined();

      // Should not throw when disposing without stats
      expect(() => preview.dispose()).not.toThrow();
      expect(mockSceneManager.dispose).toHaveBeenCalled();
    });

    it('should stop stats and remove their dom element when stats exist', () => {
      preview = new GCodePreview({ canvas: mockCanvas, devMode: true });
      expect(mockStats.dom.parentElement).toBe(document.body);

      preview.dispose();

      expect(mockStats.end).toHaveBeenCalled();
      expect(mockStats.dom.parentElement).toBeNull();
    });
  });

  describe('initGui edge cases', () => {
    it('should not create a dev GUI once the sceneManager is disposed', () => {
      preview = new GCodePreview({ canvas: mockCanvas });
      preview.dispose();

      preview.devMode = true;

      expect(DevGUI).not.toHaveBeenCalled();
    });

    it('should not create a dev GUI for a truthy devMode that is neither boolean nor object', () => {
      preview = new GCodePreview({ canvas: mockCanvas });

      preview.devMode = 'invalid' as never;

      expect(DevGUI).not.toHaveBeenCalled();
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
