/* eslint-disable @typescript-eslint/no-empty-function */

import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'node:path';

import { BatchedMesh } from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';

import { GCodePreview } from '../gcode-preview';
import { listTraceFiles, readTrace, itfBool, itfInt, itfRecord, itfStr, type ItfState } from './helpers/itf-replay';

const SAMPLE_GCODE = [
  'G28',
  'G1 X0 Y0 Z0.2 F1200',
  'G1 X10 Y0 E1',
  'G1 X10 Y10 E2',
  'G1 X0 Y10 E3',
  'G1 X0 Y0 E4'
].join('\n');

const { MockWebGLRenderer, mockRenderers } = vi.hoisted(() => {
  const mockRenderers: MockWebGLRenderer[] = [];

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
      mockRenderers.push(this);
    }
  }

  return { MockWebGLRenderer, mockRenderers };
});

// Only the WebGLRenderer is replaced so the tests can run without a GPU.
// Every other three.js class stays real, meaning the actual BatchedMesh,
// LineSegments2, LineMaterial and OrbitControls get constructed at runtime.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

async function nextFrame(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function createPreview(opts: Record<string, unknown> = {}) {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'offsetWidth', { value: 800, configurable: true });
  Object.defineProperty(canvas, 'offsetHeight', { value: 600, configurable: true });
  return new GCodePreview({ canvas, buildVolume: { x: 200, y: 200, z: 200 }, ...opts });
}

describe('SceneManager runtime smoke test', () => {
  afterEach(() => {
    mockRenderers.forEach((renderer) => {
      renderer.render.mockClear();
      renderer.dispose.mockClear();
    });
    mockRenderers.length = 0;
  });

  it('constructs real three.js objects when rendering lines', async () => {
    const preview = createPreview({ renderExtrusion: true, renderTravel: true, renderTubes: false });
    preview.processGCode(SAMPLE_GCODE);
    await nextFrame();

    const group = preview.sceneManager.scene.getObjectByName('Extrusions');
    expect(group).toBeDefined();
    expect(group?.children.length).toBeGreaterThan(0);

    let lineCount = 0;
    preview.sceneManager.scene.traverse((obj) => {
      if (obj instanceof LineSegments2) lineCount++;
    });
    expect(lineCount).toBeGreaterThan(0);

    // the render loop ran against the mocked renderer
    expect(mockRenderers[0].render).toHaveBeenCalled();

    expect(() => preview.dispose()).not.toThrow();
    expect(mockRenderers[0].dispose).toHaveBeenCalled();
  });

  it('constructs a real BatchedMesh by default', async () => {
    const preview = createPreview({ renderExtrusion: true, renderTravel: false });
    preview.processGCode(SAMPLE_GCODE);
    await nextFrame();

    let batchedMeshCount = 0;
    preview.sceneManager.scene.traverse((obj) => {
      if (obj instanceof BatchedMesh) batchedMeshCount++;
    });
    expect(batchedMeshCount).toBeGreaterThan(0);

    expect(() => preview.dispose()).not.toThrow();
    expect(mockRenderers[0].dispose).toHaveBeenCalled();
  });
});

describe('lifecycle spec trace replay', () => {
  // Replays ITF traces produced from verification/quint/lifecycle.qnt
  // against a real GCodePreview with only the WebGL boundary stubbed (the
  // module-level 'three' mock above — no un-mocking machinery). Each trace
  // state holds exactly two records: `s` (the machine state: path counters
  // and cumulative renderer observables) and `ev` (the step's event: which
  // lifecycle call ran and, for process, which snippet it fed), so a trace
  // doubles as a call script. All comparisons are integer-exact via ===.
  //
  // requestAnimationFrame is stubbed inert for this suite: callbacks are
  // swallowed, so the continuous presentation loop contributes exactly its
  // first synchronous frame per scene-manager generation, the animated
  // render contributes exactly its first frame per multi-path process (its
  // promise stays pending, which the suite treats as pinned), and the
  // renderer call counts become deterministic.
  const tracesDir = join(process.cwd(), 'verification', 'quint', 'traces', 'lifecycle');

  // The spec's snippet menu mapped to real G-code; keep in sync with the
  // Snippet type in lifecycle.qnt and lifecycle.md. The G92 E reset is what
  // makes the extruding snippet lay material on every feed.
  const SNIPPETS: Record<string, string> = {
    extruding: 'G92 E0\nG1 X10 Y10 E1',
    travelOnly: 'G0 X5 Y5',
    empty: '; lifecycle no-op'
  };

  const LIFECYCLE_CALLS = ['process', 'clear', 'render', 'resize', 'dispose'];

  // The decoded step: everything the replay compares. The spec's
  // model-internal ghosts (ghost*, ghostPrev) are deliberately not decoded.
  type SpecStep = {
    kind: string;
    snippet: string;
    phase: string;
    lastPath: string;
    resurrected: boolean;
    processed: number;
    pathCount: number;
    managerGen: number;
    renders: number;
    setSizes: number;
    rendererDisposes: number;
  };

  const decodeStep = (raw: ItfState): SpecStep => {
    const s = itfRecord(raw.s, 's');
    const ev = itfRecord(raw.ev, 'ev');
    return {
      kind: itfStr(ev.kind, 'ev.kind'),
      snippet: itfStr(ev.snippet, 'ev.snippet'),
      phase: itfStr(ev.phase, 'ev.phase'),
      lastPath: itfStr(ev.lastPath, 'ev.lastPath'),
      resurrected: itfBool(ev.resurrected, 'ev.resurrected'),
      processed: itfInt(s.processed, 's.processed'),
      pathCount: itfInt(s.pathCount, 's.pathCount'),
      managerGen: itfInt(s.managerGen, 's.managerGen'),
      renders: itfInt(s.renders, 's.renders'),
      setSizes: itfInt(s.setSizes, 's.setSizes'),
      rendererDisposes: itfInt(s.rendererDisposes, 's.rendererDisposes')
    };
  };

  beforeAll(() => {
    // Inert frame scheduling: ids are handed out, callbacks never fire.
    let frameId = 0;
    vi.stubGlobal('requestAnimationFrame', () => ++frameId);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterAll(() => {
    vi.unstubAllGlobals();
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
  const liveManager = (preview: GCodePreview): unknown =>
    (preview as unknown as { _sceneManager: unknown })._sceneManager;

  const traceFiles = listTraceFiles(tracesDir);

  it('the traces directory exists and holds at least one ITF trace', () => {
    // Fails (rather than silently skipping the replay) when the Quint traces
    // have not been generated into verification/quint/traces/lifecycle.
    expect(traceFiles.length, `expected *.itf.json traces in ${tracesDir}`).toBeGreaterThan(0);
  });

  for (const traceFile of traceFiles) {
    it(`replays ${traceFile} against a real stubbed GCodePreview`, async () => {
      const states = readTrace(tracesDir, traceFile).map(decodeStep);

      // One real preview per trace: lifecycle state persists across the
      // steps. The renderer window starts at this trace's first renderer, so
      // the spec's cumulative counters sum over every generation it created.
      const rendererBase = mockRenderers.length;
      const renderersOf = () => mockRenderers.slice(rendererBase);
      const callSum = (calls: (renderer: InstanceType<typeof MockWebGLRenderer>) => number) =>
        renderersOf().reduce((total, renderer) => total + calls(renderer), 0);

      // Asynchronous rejections of the (pinned-pending) animated-render
      // promises; the no-throw contract covers these too.
      const asyncErrors: unknown[] = [];

      const preview = createPreview();
      let lastLiveManager = liveManager(preview);

      /** Applies one spec action to the real preview, observing ok vs throws. */
      const applyAction = (cmd: string, snippet: string): 'ok' | 'throws' => {
        if (!LIFECYCLE_CALLS.includes(cmd)) throw new Error(`unknown spec command "${cmd}"`);
        try {
          if (cmd === 'process') {
            const text = SNIPPETS[snippet];
            if (text === undefined) throw new Error(`unknown spec snippet "${snippet}"`);
            void preview.processGCode(text).catch((error) => asyncErrors.push(error));
          } else if (cmd === 'clear') preview.clear();
          else if (cmd === 'render') preview.sceneManager.render();
          else if (cmd === 'resize') preview.sceneManager.resize();
          else preview.dispose();
          return 'ok';
        } catch {
          return 'throws';
        }
      };

      // The full per-step comparison from the trace contract. Every assertion
      // message names the trace file, step index, lifecycle call, field, and
      // the expected vs actual values.
      const compareStep = (stepIndex: number, input: string, actualOutcome: string, spec: SpecStep): void => {
        const at = (field: string, expected: unknown, actual: unknown) =>
          `${traceFile} step ${stepIndex} (${input}) field ${field}: expected ${String(expected)}, actual ${String(actual)}`;

        // pinned behavior: no lifecycle call ever throws
        expect(actualOutcome, at('outcome', 'ok', actualOutcome)).toBe('ok');

        const paths = preview.job.paths.length;
        expect(paths, at('pathCount', spec.pathCount, paths)).toBe(spec.pathCount);

        const lastType = preview.job.paths[paths - 1]?.travelType ?? 'none';
        expect(lastType, at('lastPath', spec.lastPath, lastType)).toBe(spec.lastPath);

        const generations = renderersOf().length;
        expect(generations, at('managerGen', spec.managerGen, generations)).toBe(spec.managerGen);

        const renders = callSum((renderer) => renderer.render.mock.calls.length);
        expect(renders, at('renders', spec.renders, renders)).toBe(spec.renders);

        const setSizes = callSum((renderer) => renderer.setSize.mock.calls.length);
        expect(setSizes, at('setSizes', spec.setSizes, setSizes)).toBe(spec.setSizes);

        const disposes = callSum((renderer) => renderer.dispose.mock.calls.length);
        expect(disposes, at('rendererDisposes', spec.rendererDisposes, disposes)).toBe(spec.rendererDisposes);

        // phase: "disposed" iff no scene manager is live; "hasContent" iff one
        // is live and the job holds paths; "fresh" otherwise
        const manager = liveManager(preview);
        const live = manager !== null;
        const expectedLive = spec.phase !== 'disposed';
        expect(live, at('phase/managerLive', expectedLive, live)).toBe(expectedLive);
        const expectedHasContent = spec.phase === 'hasContent';
        const actualHasContent = live && paths > 0;
        expect(actualHasContent, at('phase/hasContent', expectedHasContent, actualHasContent)).toBe(expectedHasContent);

        // generation identity: a resurrecting step installs a brand-new scene
        // manager; any other live-to-live step keeps the same instance
        if (live) {
          const changed = manager !== lastLiveManager;
          expect(changed, at('resurrected/identity', spec.resurrected, changed)).toBe(spec.resurrected);
          lastLiveManager = manager;
        } else {
          expect(spec.resurrected, at('resurrected', false, spec.resurrected)).toBe(false);
        }
      };

      try {
        expect(states[0].kind, `${traceFile} step 0: the first state must be the init state`).toBe('init');
        compareStep(0, '<init>', 'ok', states[0]);

        for (let step = 1; step < states.length; step++) {
          const spec = states[step];
          const actualOutcome = applyAction(spec.kind, spec.snippet);
          compareStep(step, spec.snippet === '' ? spec.kind : `${spec.kind}:${spec.snippet}`, actualOutcome, spec);
        }

        // let the settled animated-render promises (0-or-1-path processes)
        // deliver any rejection before the no-throw contract is finalized
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(asyncErrors, `${traceFile}: an animated render rejected asynchronously`).toEqual([]);
      } finally {
        // stop the bookkeeping of whichever SceneManager is currently live
        preview.dispose();
      }
    });
  }
});
