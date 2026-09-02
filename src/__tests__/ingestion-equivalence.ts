/**
 * Streaming-vs-oneshot ingestion equivalence harness.
 *
 * Every test added inside the describe.each block below automatically runs
 * once per ingestion mode: oneshot `processGCode`, plus `processGCodeStream`
 * fed through chunkers of several sizes. Chunk size 1 is the worst case for
 * the stream splitter (every character is its own chunk), size 7 lands chunk
 * boundaries mid-word, mid-number and mid-comment, and 64k delivers the whole
 * file in a single chunk. This equivalence only holds because splitChunk
 * carries a no-newline chunk into its tail, readStream flushes the leftover
 * tail after the read loop, and empty chunks no longer end the stream early.
 *
 * Keep expected values CONCRETE (exact counts, coordinates and states derived
 * from the fixture line by line) so every mode must independently reproduce
 * them — comparing modes against each other would let a shared bug slip by.
 *
 * Streaming-only behaviors (render throttling, onJobUpdated cadence, …)
 * belong in the gcode-preview.ts tests, not here.
 *
 * All helpers live in this file on purpose: the vitest config collects every
 * .ts file under src/__tests__ as a test suite, so a separate helper module
 * would be picked up as an empty suite and fail the run.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { GCodePreview } from '../gcode-preview';
import { PathType } from '../path';

const { MockWebGLRenderer } = vi.hoisted(() => {
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
    }
  }

  return { MockWebGLRenderer };
});

// Only the WebGLRenderer is replaced so the tests can run without a GPU.
// Everything else — Parser, Interpreter, Job, SceneManager and the actual
// three.js geometry — is real, which is the point of this harness.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

type Ingest = (preview: GCodePreview, gcode: string) => Promise<void>;

/** Wraps pre-cut string chunks in a ReadableStream, delivered in order. */
const makeStream = (chunks: string[]) =>
  new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    }
  });

/** Deterministically cuts the input into fixed-size chunks, in order. */
const chunksOf = (gcode: string, size: number): string[] => {
  const chunks: string[] = [];
  for (let i = 0; i < gcode.length; i += size) {
    chunks.push(gcode.slice(i, i + size));
  }
  return chunks;
};

/** Streams the gcode in fixed-size chunks, skipping progressive draws. */
const streamIngest =
  (size: number): Ingest =>
  async (preview, gcode) => {
    await preview.processGCodeStream(makeStream(chunksOf(gcode, size)), { render: false });
  };

// 856 base64 chars of a 16x16 PNG, same fixture as parse-thumbnail.ts. Copied
// rather than imported: importing another test file would re-register its
// tests inside this suite.
const thumbnailPng =
  `iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAACSElEQVR4AXVSW08TURDuHyHSG9vunS21LaX0okiRQq1tipegwSAQQdNoG1ZBGogBJUo0GIiisIlN2sSEB+KDJvgiMSY+uIn8kf0Hw5mT7LIt9GHOmTnnzPfNd2YcHMcN8DyfFgQhw7Js0vTNOBeVyh9uBY/zMVk9796BDoLgbl6aoPPDinY4E4I/j6LUno4EasW4olZzIbrjG0c75umUoO3fVeBgImABoP0txUBNuaBxJwAUABdRFK+ZibgvjAbr+Hhl0AvVK94mgO08D3s3JNifCEKvyJQc9pLNKiaTvHZwrwfWrjKwdZ2niUezEdgY9cNUuAP+z6fgXzkOfbJfPRegX/aV1KQLdsdEi3V5sAumSfJyuosCfJ+JnEqwa8c4obBqOeGEJ3EnrJIqkHU9w8Dzyx4LYDUr6VYX0LG3c6cowlaOgx/3L8Lj/k542HcB3mVZqBDQT2MS6JUkRCVf2eqCvX0beeUYmV5nfLA2xFgALwgzAjTGFVgk9+Z7hzkDaOs5Wd8tCvCesO8R/egjAAJ+uSmRf/DCIdGe7vbUmgYJHdT0mSSgLZGESsprfCzwUB3wUIBvkyHj51zMeDbSUzP/CttPP3ElI+jI+OtBGN5keePVMEOrmAp1wMsMZ7wl+jdJnJbdmr1bVAIG+Pj3XC/Ub8uUaYcwL1xyw9fxbnIeAQRIie4m5iYJYdG/uF0QaRJWgXY0GyZDxMGQ4qm1TuoZADwI` +
  `8oxaCHTqDcK6mWNhiWhP8E6tNaEtgHkQF1z1hOCut0tojU8AXkBuxgoBg+8AAAAASUVORK5CYII=`;

/** The fixture PNG as a slicer would embed it: begin marker, data lines, end. */
const thumbnailBlock = [
  '; thumbnail begin 16x16 856',
  ...chunksOf(thumbnailPng, 78).map((part) => `; ${part}`),
  '; thumbnail end'
].join('\n');

const MODES: [name: string, ingest: Ingest][] = [
  [
    'oneshot',
    async (preview, gcode) => {
      await preview.processGCode(gcode);
    }
  ],
  ['stream chunk=1', streamIngest(1)],
  ['stream chunk=7', streamIngest(7)],
  // 64k delivers the whole file in a single chunk (65536 > every fixture here)
  ['stream chunk=64k', streamIngest(64 * 1024)]
];

function createPreview(): GCodePreview {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'offsetWidth', { value: 800, configurable: true });
  Object.defineProperty(canvas, 'offsetHeight', { value: 600, configurable: true });
  return new GCodePreview({ canvas, buildVolume: { x: 200, y: 200, z: 200 } });
}

describe.each(MODES)('ingestion via %s', (_name, ingest) => {
  let preview: GCodePreview;

  beforeEach(() => {
    preview = createPreview();
    // readStream logs a debug line per chunk; chunk=1 would emit one per byte
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    // the SceneManager constructor starts a rAF loop; dispose cancels it
    preview.dispose();
    vi.restoreAllMocks();
  });

  test('a multi-move file yields the exact same paths and vertices', async () => {
    // G28 homes to (0,0,0). The G0 opens a travel path from the origin; the
    // first G1 with E>0 breaks it and opens an extrusion path that starts at
    // the travel's endpoint and collects one vertex per move.
    const gcode = ['G28', 'G0 X10 Y10 Z0.2', 'G1 X20 Y10 E1', 'G1 X20 Y20 E1', 'G1 X10 Y20 E1'].join('\n');

    await ingest(preview, gcode);

    expect(preview.job.paths.length).toEqual(2);
    expect(preview.job.paths[0].travelType).toEqual(PathType.Travel);
    expect(preview.job.paths[0].vertices).toEqual([0, 0, 0, 10, 10, 0.2]);
    expect(preview.job.paths[1].travelType).toEqual(PathType.Extrusion);
    expect(preview.job.paths[1].vertices).toEqual([10, 10, 0.2, 20, 10, 0.2, 20, 20, 0.2, 10, 20, 0.2]);
  });

  test('a file without a trailing newline keeps its final command', async () => {
    // No '\n' after the last G1: streaming modes only see this command when
    // readStream flushes the leftover tail after the read loop.
    const gcode = 'G28\nG0 X5 Y5 Z0.2\nG1 X15 Y5 E1';

    await ingest(preview, gcode);

    expect(preview.job.paths.length).toEqual(2);
    expect(preview.job.paths[1].vertices).toEqual([5, 5, 0.2, 15, 5, 0.2]);
    expect(preview.job.state.x).toEqual(15);
    expect(preview.job.state.y).toEqual(5);
  });

  test('a two-layer print indexes the same layers and paths per layer', async () => {
    const gcode = [
      'G28',
      'G0 X10 Y10 Z0.2', // travel; no layer exists yet, so it lands in none
      'G1 X20 Y10 E1', // extrusion at Z0.2 creates layer 1
      'G1 X20 Y20 E1',
      'G0 X20 Y20 Z0.4', // travel up; still indexed into layer 1
      'G1 X10 Y20 E1' // extrusion at Z0.4 creates layer 2
    ].join('\n');

    await ingest(preview, gcode);

    expect(preview.countLayers).toEqual(2);
    expect(preview.job.layers[0].z).toEqual(0.2);
    expect(preview.job.layers[1].z).toEqual(0.4);
    // layer 1 holds the first extrusion and the travel up to the next layer
    expect(preview.job.layers[0].paths.length).toEqual(2);
    expect(preview.job.layers[1].paths.length).toEqual(1);
    expect(preview.job.layers[1].paths[0].travelType).toEqual(PathType.Extrusion);
    expect(preview.job.layers[1].paths[0].vertices).toEqual([20, 20, 0.4, 10, 20, 0.4]);
  });

  test('tool changes land on the same paths', async () => {
    const gcode = [
      'G28',
      'T0',
      'G0 X10 Y10 Z0.2',
      'G1 X20 Y10 E1', // extruded with tool 0
      'G0 X20 Y15', // travel so the tool change starts a fresh path
      'T1',
      'G1 X30 Y15 E1' // extruded with tool 1
    ].join('\n');

    await ingest(preview, gcode);

    expect(preview.job.state.tool).toEqual(1);
    expect(preview.job.paths.length).toEqual(4);
    expect(preview.job.paths[1].tool).toEqual(0);
    expect(preview.job.paths[3].tool).toEqual(1);
    expect(preview.job.toolPaths[0]).toEqual([preview.job.paths[1]]);
    expect(preview.job.toolPaths[1]).toEqual([preview.job.paths[3]]);
    expect(preview.job.paths[3].vertices).toEqual([20, 15, 0.2, 30, 15, 0.2]);
  });

  test('comments and blank lines leave the command stream untouched', async () => {
    // The long standalone comment guarantees the 7-byte chunker cuts inside
    // comment text; the blank lines exercise empty-line handling per chunk.
    const gcode = [
      '; header comment long enough that a seven-byte chunker slices it mid-sentence',
      'G28',
      '',
      'G0 X10 Y10 Z0.5',
      '; standalone comment between two moves',
      'G1 X20 Y10 E1 ; inline comment',
      '',
      'G1 X20 Y20 E1'
    ].join('\n');

    await ingest(preview, gcode);

    expect(preview.job.paths.length).toEqual(2);
    expect(preview.job.paths[0].vertices).toEqual([0, 0, 0, 10, 10, 0.5]);
    expect(preview.job.paths[1].vertices).toEqual([10, 10, 0.5, 20, 10, 0.5, 20, 20, 0.5]);
    expect(preview.job.state.x).toEqual(20);
    expect(preview.job.state.y).toEqual(20);
    expect(preview.job.state.z).toEqual(0.5);
  });

  test('an embedded multi-line thumbnail parses identically', async () => {
    // The 13-line thumbnail block guarantees the streaming modes deliver it
    // across many parseGCode calls, so the parser must carry its in-progress
    // thumbnail between calls. Regression test: it used to keep that state in
    // a local variable, so streaming silently yielded no thumbnail at all
    // while oneshot parsed it fine.
    const gcode = [thumbnailBlock, 'G28', 'G0 X10 Y10 Z0.2', 'G1 X20 Y10 E1'].join('\n');

    await ingest(preview, gcode);

    const thumbnails = preview.parser.metadata.thumbnails;
    expect(Object.keys(thumbnails)).toEqual(['16x16']);
    expect(thumbnails['16x16'].chars.length).toEqual(856);
    expect(thumbnails['16x16'].isValid).toBe(true);
    // the surrounding commands still parse as usual
    expect(preview.job.paths.length).toEqual(2);
  });

  test('known extrusion coordinates produce the exact same bounding box', async () => {
    // The bounding box only tracks extrusion endpoints, so the corners come
    // straight from the three G1 targets below.
    const gcode = ['G28', 'G0 X10 Y10 Z1', 'G1 X30 Y10 E1', 'G1 X30 Y25 E1', 'G1 X10 Y10 E1'].join('\n');

    await ingest(preview, gcode);

    expect(preview.job.boundingBox.isValid).toBe(true);
    expect(preview.job.boundingBox.corners).toEqual({
      min: expect.objectContaining({ x: 10, y: 10, z: 1 }),
      max: expect.objectContaining({ x: 30, y: 25, z: 1 })
    });
  });
});
