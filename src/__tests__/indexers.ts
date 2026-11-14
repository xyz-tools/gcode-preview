import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, describe, vi } from 'vitest';
import { Path, PathType } from '../path';
import { Layer } from '../layer';
import {
  LayersIndexer,
  LayersMetadataIndexer,
  NonApplicableIndexer,
  NonPlanarExtrusionError,
  ToolIndexer,
  TravelTypeIndexer
} from '../indexers';
import { LayerMetadata } from '../parser/metadata-parser-base';
import { Parser } from '../parser/gcode-parser';
import { Interpreter } from '../interpreter';
import { Job } from '../job';

function makePath(travelType: PathType, points: [number, number, number][] = [], tool: number = 0): Path {
  const path = new Path(travelType, 0.6, 0.2, tool);
  points.forEach((point) => path.addPoint(...point));
  return path;
}

describe('TravelTypeIndexer', () => {
  test('sorts extrusion paths into the extrusion index', () => {
    const indexes: Record<string, Path[]> = { extrusion: [], travel: [] };
    const indexer = new TravelTypeIndexer(indexes);
    const path = makePath(PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);

    indexer.sortIn(path);

    expect(indexes.extrusion).toEqual([path]);
    expect(indexes.travel).toEqual([]);
  });

  test('sorts travel paths into the travel index', () => {
    const indexes: Record<string, Path[]> = { extrusion: [], travel: [] };
    const indexer = new TravelTypeIndexer(indexes);
    const path = makePath(PathType.Travel, [
      [0, 0, 0],
      [1, 2, 0]
    ]);

    indexer.sortIn(path);

    expect(indexes.extrusion).toEqual([]);
    expect(indexes.travel).toEqual([path]);
  });
});

describe('LayersIndexer', () => {
  test('the first extrusion path creates a layer at the path z, with z as height', () => {
    const layers: Layer[] = [];
    const indexer = new LayersIndexer(layers);
    const path = makePath(PathType.Extrusion, [
      [0, 0, 2],
      [1, 2, 2]
    ]);

    indexer.sortIn(path);

    expect(layers.length).toEqual(1);
    expect(layers[0].z).toEqual(2);
    expect(layers[0].height).toEqual(2);
    expect(layers[0].paths).toEqual([path]);
  });

  test('an extrusion path within tolerance joins the current layer', () => {
    const layers: Layer[] = [];
    const indexer = new LayersIndexer(layers);
    const first = makePath(PathType.Extrusion, [
      [0, 0, 0.2],
      [1, 2, 0.2]
    ]);
    const second = makePath(PathType.Extrusion, [
      [1, 2, 0.2 + LayersIndexer.DEFAULT_TOLERANCE],
      [5, 6, 0.2 + LayersIndexer.DEFAULT_TOLERANCE]
    ]);

    indexer.sortIn(first);
    indexer.sortIn(second);

    expect(layers.length).toEqual(1);
    expect(layers[0].paths).toEqual([first, second]);
  });

  test('an extrusion path above tolerance creates a new layer with the height difference', () => {
    const layers: Layer[] = [];
    const indexer = new LayersIndexer(layers);

    indexer.sortIn(
      makePath(PathType.Extrusion, [
        [0, 0, 0.2],
        [1, 2, 0.2]
      ])
    );
    indexer.sortIn(
      makePath(PathType.Extrusion, [
        [1, 2, 0.5],
        [5, 6, 0.5]
      ])
    );

    expect(layers.length).toEqual(2);
    expect(layers[1].z).toEqual(0.5);
    expect(layers[1].height).toBeCloseTo(0.3);
  });

  test('records the layer index on each sorted path', () => {
    const layers: Layer[] = [];
    const indexer = new LayersIndexer(layers);
    const first = makePath(PathType.Extrusion, [
      [0, 0, 0.2],
      [1, 2, 0.2]
    ]);
    const second = makePath(PathType.Extrusion, [
      [1, 2, 0.5],
      [5, 6, 0.5]
    ]);

    indexer.sortIn(first);
    indexer.sortIn(second);

    expect(first.layerIndex).toEqual(0);
    expect(second.layerIndex).toEqual(1);
  });

  test('travel paths join the current layer without creating one', () => {
    const layers: Layer[] = [];
    const indexer = new LayersIndexer(layers);
    const extrusion = makePath(PathType.Extrusion, [
      [0, 0, 0.2],
      [1, 2, 0.2]
    ]);
    const travel = makePath(PathType.Travel, [
      [1, 2, 0.2],
      [5, 6, 42]
    ]);

    indexer.sortIn(extrusion);
    indexer.sortIn(travel);

    expect(layers.length).toEqual(1);
    expect(layers[0].paths).toEqual([extrusion, travel]);
    expect(travel.layerIndex).toEqual(0);
  });

  test('travel paths before the first extrusion are dropped', () => {
    const layers: Layer[] = [];
    const indexer = new LayersIndexer(layers);
    const travel = makePath(PathType.Travel, [
      [0, 0, 0],
      [1, 2, 5]
    ]);

    indexer.sortIn(travel);

    expect(layers).toEqual([]);
    expect(travel.layerIndex).toBeUndefined();
  });

  test('throws NonPlanarExtrusionError when an extrusion path changes z above tolerance', () => {
    const indexer = new LayersIndexer([]);
    const nonPlanar = makePath(PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 1]
    ]);

    expect(() => indexer.sortIn(nonPlanar)).toThrow(NonPlanarExtrusionError);
    expect(() => indexer.sortIn(nonPlanar)).toThrow(NonApplicableIndexer);
  });

  test('respects a custom tolerance', () => {
    const layers: Layer[] = [];
    const indexer = new LayersIndexer(layers, 0.1);
    const wavy = makePath(PathType.Extrusion, [
      [0, 0, 0.2],
      [1, 2, 0.29]
    ]);
    const next = makePath(PathType.Extrusion, [
      [1, 2, 0.29],
      [5, 6, 0.29]
    ]);

    expect(() => indexer.sortIn(wavy)).not.toThrow();
    indexer.sortIn(next);

    expect(layers.length).toEqual(1);
  });
});

describe('ToolIndexer', () => {
  test('the first extrusion path for a tool creates its index', () => {
    const indexes: Path[][] = [];
    const indexer = new ToolIndexer(indexes);
    const path = makePath(PathType.Extrusion, [], 0);

    indexer.sortIn(path);

    expect(indexes[0]).toEqual([path]);
  });

  test('subsequent extrusion paths for the same tool are appended', () => {
    const indexes: Path[][] = [];
    const indexer = new ToolIndexer(indexes);
    const first = makePath(PathType.Extrusion, [], 0);
    const second = makePath(PathType.Extrusion, [], 0);

    indexer.sortIn(first);
    indexer.sortIn(second);

    expect(indexes[0]).toEqual([first, second]);
  });

  test('travel paths are not indexed', () => {
    const indexes: Path[][] = [];
    const indexer = new ToolIndexer(indexes);

    indexer.sortIn(makePath(PathType.Travel, [], 0));

    expect(indexes).toEqual([]);
  });

  test('tools are indexed independently', () => {
    const indexes: Path[][] = [];
    const indexer = new ToolIndexer(indexes);
    const tool0 = makePath(PathType.Extrusion, [], 0);
    const tool1 = makePath(PathType.Extrusion, [], 1);
    const tool0Again = makePath(PathType.Extrusion, [], 0);

    indexer.sortIn(tool0);
    indexer.sortIn(tool1);
    indexer.sortIn(tool0Again);

    expect(indexes[0]).toEqual([tool0, tool0Again]);
    expect(indexes[1]).toEqual([tool1]);
  });

  test('sparse tool numbers leave gaps undefined', () => {
    const indexes: Path[][] = [];
    const indexer = new ToolIndexer(indexes);
    const path = makePath(PathType.Extrusion, [], 5);

    indexer.sortIn(path);

    expect(indexes.length).toEqual(6);
    expect(indexes[5]).toEqual([path]);
    expect(indexes[3]).toBeUndefined();
  });
});

function createPath(z: number, pathType: PathType = PathType.Extrusion): Path {
  const path = new Path(pathType, 0.6, 0.2, 0);
  path.addPoint(0, 0, z);
  return path;
}

test('LayersMetadataIndexer uses metadata when available', () => {
  const layers: Layer[] = [];
  const metadata: LayerMetadata[] = [
    { layerIndex: 0, z: 0.3, height: 0.3, lineIndex: 0 },
    { layerIndex: 1, z: 0.6, height: 0.3, lineIndex: 5 }
  ];

  const indexer = new LayersMetadataIndexer(layers, metadata);

  const path1 = createPath(0.3);
  const path2 = createPath(0.6);

  indexer.sortIn(path1);
  indexer.sortIn(path2);

  expect(layers).toHaveLength(2);
  expect(layers[0].z).toBe(0.3);
  expect(layers[0].height).toBe(0.3);
  expect(layers[0].paths).toContain(path1);

  expect(layers[1].z).toBe(0.6);
  expect(layers[1].height).toBe(0.3);
  expect(layers[1].paths).toContain(path2);
});

test('LayersMetadataIndexer falls back to tolerance when no metadata', () => {
  const layers: Layer[] = [];
  const metadata: LayerMetadata[] = [];

  const indexer = new LayersMetadataIndexer(layers, metadata);

  const path1 = createPath(0.3);
  const path2 = createPath(0.6);

  indexer.sortIn(path1);
  indexer.sortIn(path2);

  expect(layers.length).toBeGreaterThan(0);
  // Should use tolerance-based detection
});

test('LayersMetadataIndexer handles travel paths', () => {
  const layers: Layer[] = [];
  const metadata: LayerMetadata[] = [{ layerIndex: 0, z: 0.3, height: 0.3, lineIndex: 0 }];

  const indexer = new LayersMetadataIndexer(layers, metadata);

  const extrusionPath = createPath(0.3, PathType.Extrusion);
  const travelPath = createPath(0.3, PathType.Travel);

  indexer.sortIn(extrusionPath);
  indexer.sortIn(travelPath);

  expect(layers).toHaveLength(1);
  expect(layers[0].paths).toContain(extrusionPath);
  expect(layers[0].paths).toContain(travelPath);
});

test('LayersMetadataIndexer creates layers as needed', () => {
  const layers: Layer[] = [];
  const metadata: LayerMetadata[] = [
    { layerIndex: 0, z: 0.3, height: 0.3, lineIndex: 0 },
    { layerIndex: 1, z: 0.6, height: 0.3, lineIndex: 5 },
    { layerIndex: 2, z: 0.9, height: 0.3, lineIndex: 10 }
  ];

  const indexer = new LayersMetadataIndexer(layers, metadata);

  // Add path to layer 2 first (skipping layers 0 and 1)
  const path = createPath(0.9);
  indexer.sortIn(path);

  expect(layers).toHaveLength(3); // Should create all layers up to index 2
  expect(layers[0].z).toBe(0.3);
  expect(layers[1].z).toBe(0.6);
  expect(layers[2].z).toBe(0.9);
  expect(layers[2].paths).toContain(path);
});

test('LayersMetadataIndexer handles missing Z values in metadata', () => {
  const layers: Layer[] = [];
  const metadata: LayerMetadata[] = [
    { layerIndex: 0, height: 0.3, lineIndex: 0 } // Missing Z
  ];

  const indexer = new LayersMetadataIndexer(layers, metadata);

  const path = createPath(0.3);
  indexer.sortIn(path);

  expect(layers).toHaveLength(1);
  expect(layers[0].z).toBe(0.3); // Path Z value used when metadata Z missing
  expect(layers[0].height).toBe(0.3);
});

test('LayersMetadataIndexer advances past a layer whose metadata has no Z', () => {
  const layers: Layer[] = [];
  const metadata: LayerMetadata[] = [
    { layerIndex: 0, height: 0.2, lineIndex: 0 }, // Missing Z
    { layerIndex: 1, z: 0.4, height: 0.2, lineIndex: 4 }
  ];

  const indexer = new LayersMetadataIndexer(layers, metadata);

  // The Z-less entry takes its Z from the first path, so the second path at
  // that same Z joins it and only the third, higher, path moves on. Matching
  // on layer order alone kept returning index 0 here and swallowed all three.
  const first = createPath(0.2);
  const second = createPath(0.2);
  const third = createPath(0.4);
  [first, second, third].forEach((path) => indexer.sortIn(path));

  expect(layers).toHaveLength(2);
  expect(layers[0].z).toBe(0.2);
  expect(layers[0].paths).toEqual([first, second]);
  expect(layers[1].z).toBe(0.4);
  expect(layers[1].paths).toEqual([third]);
});

test('LayersMetadataIndexer handles missing height values in metadata', () => {
  const layers: Layer[] = [];
  const metadata: LayerMetadata[] = [
    { layerIndex: 0, z: 0.3, lineIndex: 0 } // Missing height
  ];

  const indexer = new LayersMetadataIndexer(layers, metadata);

  const path = createPath(0.3);
  indexer.sortIn(path);

  expect(layers).toHaveLength(1);
  expect(layers[0].z).toBe(0.3);
  expect(layers[0].height).toBe(0.2); // Should use default height
});

test('LayersMetadataIndexer adds unmatched paths to last layer', () => {
  const layers: Layer[] = [];
  const metadata: LayerMetadata[] = [{ layerIndex: 0, z: 0.3, height: 0.3, lineIndex: 0 }];

  const indexer = new LayersMetadataIndexer(layers, metadata);

  const matchedPath = createPath(0.3);
  const unmatchedPath = createPath(1.0); // Z too high to match metadata

  indexer.sortIn(matchedPath);
  indexer.sortIn(unmatchedPath);

  expect(layers).toHaveLength(1);
  expect(layers[0].paths).toContain(matchedPath);
  expect(layers[0].paths).toContain(unmatchedPath); // Should be added to last layer
});

test('LayersMetadataIndexer creates initial layer for unmatched paths when no layers exist', () => {
  const layers: Layer[] = [];
  const metadata: LayerMetadata[] = [{ layerIndex: 0, z: 0.3, height: 0.3, lineIndex: 0 }];

  const indexer = new LayersMetadataIndexer(layers, metadata);

  const unmatchedPath = createPath(1.0); // Z too high to match metadata

  indexer.sortIn(unmatchedPath);

  expect(layers).toHaveLength(1);
  expect(layers[0].z).toBe(1.0); // Should create layer at path Z
  expect(layers[0].height).toBe(0.2); // Default height
  expect(layers[0].paths).toContain(unmatchedPath);
});

test('LayersMetadataIndexer.hasMetadata reflects available metadata', () => {
  expect(new LayersMetadataIndexer([], []).hasMetadata).toBe(false);
  expect(new LayersMetadataIndexer([], [{ layerIndex: 0, z: 0.3, lineIndex: 0 }]).hasMetadata).toBe(true);
});

test('LayersMetadataIndexer.setLayerMetadata switches from fallback to metadata mode', () => {
  const layers: Layer[] = [];
  const indexer = new LayersMetadataIndexer(layers, []);

  expect(indexer.hasMetadata).toBe(false);

  indexer.setLayerMetadata([
    { layerIndex: 0, z: 0.3, height: 0.3, lineIndex: 0 },
    { layerIndex: 1, z: 0.6, height: 0.3, lineIndex: 5 }
  ]);

  expect(indexer.hasMetadata).toBe(true);

  indexer.sortIn(createPath(0.3));
  indexer.sortIn(createPath(0.6));

  expect(layers).toHaveLength(2);
  expect(layers[0].z).toBe(0.3);
  expect(layers[1].z).toBe(0.6);
});

test('LayersMetadataIndexer.setLayerMetadata tolerates null/undefined', () => {
  const indexer = new LayersMetadataIndexer([], [{ layerIndex: 0, z: 0.3, lineIndex: 0 }]);
  indexer.setLayerMetadata(undefined as unknown as LayerMetadata[]);
  expect(indexer.hasMetadata).toBe(false);
});

// A streaming parse re-sets the *same* (growing) metadata array on every chunk, and the
// pointer that findLayerIndexForZ scans from must survive that. Setting a different array
// has to rewind it instead, so positions from the previous metadata cannot leak. Only the
// same-instance vs swapped-instance contrast catches this: both run the same lines.
test('LayersMetadataIndexer.setLayerMetadata keeps the layer pointer for the same array, rewinds for a new one', () => {
  const metadata: LayerMetadata[] = [
    { layerIndex: 0, z: 0.3, height: 0.3, lineIndex: 0 },
    { layerIndex: 1, z: 0.6, height: 0.3, lineIndex: 5 },
    { layerIndex: 2, z: 0.9, height: 0.3, lineIndex: 10 }
  ];
  // Walks the pointer up to metadata layer 2.
  const advancePointer = (indexer: LayersMetadataIndexer): void => {
    [0.3, 0.6, 0.9].forEach((z) => indexer.sortIn(createPath(z)));
  };

  // Same instance: the pointer stays at layer 2, so a path low in the stack is filed
  // into the current layer rather than rediscovering layer 0.
  const kept = new LayersMetadataIndexer([], metadata);
  advancePointer(kept);
  kept.setLayerMetadata(metadata);
  const afterRestate = createPath(0.3);
  kept.sortIn(afterRestate);

  expect(afterRestate.layerIndex).toBe(2);

  // Same history, different instance: the pointer rewinds and the scan starts over.
  const swapped = new LayersMetadataIndexer([], metadata);
  advancePointer(swapped);
  swapped.setLayerMetadata([...metadata]);
  const afterSwap = createPath(0.3);
  swapped.sortIn(afterSwap);

  expect(afterSwap.layerIndex).toBe(0);
});

describe('LayersMetadataIndexer strategy selection', () => {
  test('takes up metadata as soon as it arrives, not only on the first path', () => {
    const layers: Layer[] = [];
    const indexer = new LayersMetadataIndexer(layers, []);

    // A slicer states its layers after its start G-code, so a streamed parse
    // reaches the prime line before any of them have been read. Settling the
    // strategy here would leave the whole file on tolerance detection.
    const prime = createPath(0.28);
    indexer.sortIn(prime);
    expect(layers).toHaveLength(1);

    indexer.setLayerMetadata([
      { layerIndex: 0, z: 0.3, height: 0.3, lineIndex: 0 },
      { layerIndex: 1, z: 0.6, height: 0.3, lineIndex: 9 }
    ]);
    indexer.sortIn(createPath(0.3));
    indexer.sortIn(createPath(0.6));

    expect(layers).toHaveLength(2);
    // the prime line's layer is restated by the slicer's own values, so the
    // layers match what a parse holding the whole file produces
    expect(layers[0].z).toBe(0.3);
    expect(layers[0].height).toBe(0.3);
    expect(layers[0].paths).toHaveLength(2);
    expect(layers[1].z).toBe(0.6);
  });

  test('keeps using metadata once it has, even if the array is replaced', () => {
    const layers: Layer[] = [];
    const indexer = new LayersMetadataIndexer(layers, [{ layerIndex: 0, z: 0.2, height: 0.2, lineIndex: 0 }]);

    indexer.sortIn(createPath(0.2));
    // Swapping in an empty array must not send the file back to tolerance
    // detection: the layers already filed are metadata positions.
    indexer.setLayerMetadata([]);
    indexer.sortIn(createPath(0.2));

    expect(layers).toHaveLength(1);
    expect(layers[0].paths).toHaveLength(2);
  });

  test('leaves the observed values in place where the metadata states none', () => {
    const layers: Layer[] = [];
    const indexer = new LayersMetadataIndexer(layers, []);

    indexer.sortIn(createPath(0.28));
    // A layer entry the slicer left incomplete has nothing better to offer, so
    // what the move observed stands.
    indexer.setLayerMetadata([
      { layerIndex: 0, lineIndex: 0 },
      { layerIndex: 1, z: 0.6, lineIndex: 9 }
    ]);
    indexer.sortIn(createPath(0.28));

    expect(layers).toHaveLength(1);
    expect(layers[0].z).toBe(0.28);
    expect(layers[0].height).toBe(0.28);
  });
});

describe('Quint layer-indexer spec trace replay', () => {
  // Replays ITF traces produced from verification/quint/layer-indexer.qnt
  // against the real parser + interpreter + job pipeline. Each trace state
  // carries the event that produced it (cmd plus z/height words) and the
  // spec's expected layer observables, with lengths in centi-millimeters
  // (mm * 100) as integers. Each step is rebuilt as its own chunk — a move
  // line or a PrusaSlicer-style layer-comment block — and fed through one
  // streaming Parser/Job, which is exactly how GCodePreview.processGCode
  // drives the layer indexer.
  const tracesDir = join(process.cwd(), 'verification', 'quint', 'traces', 'layer-indexer');

  // An ITF value: booleans and strings are plain JSON; integers arrive either
  // as plain numbers or in Apalache's { "#bigint": "123" } wrapping; lists
  // arrive as JSON arrays of ITF values.
  type ItfScalar = boolean | string | number | { '#bigint': string };
  type ItfValue = ItfScalar | ItfValue[] | { [key: string]: ItfValue } | undefined;
  type ItfState = Record<string, ItfValue>;

  const itfInt = (value: ItfValue, key: string): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && typeof value['#bigint'] === 'string') {
      return Number(value['#bigint']);
    }
    throw new Error(`expected an ITF integer for "${key}", got ${JSON.stringify(value)}`);
  };
  const itfBool = (value: ItfValue, key: string): boolean => {
    if (typeof value !== 'boolean') throw new Error(`expected a boolean for "${key}", got ${JSON.stringify(value)}`);
    return value;
  };
  const itfStr = (value: ItfValue, key: string): string => {
    if (typeof value !== 'string') throw new Error(`expected a string for "${key}", got ${JSON.stringify(value)}`);
    return value;
  };
  const itfIntList = (value: ItfValue, key: string): number[] => {
    if (!Array.isArray(value)) throw new Error(`expected an ITF list for "${key}", got ${JSON.stringify(value)}`);
    return value.map((element, i) => itfInt(element, `${key}[${i}]`));
  };

  // The spec's trace-contract variables, decoded; internal model variables
  // (locked, pointer, metaLayers, ...) and keys starting with '#' (like
  // '#meta') are never read and are thereby ignored.
  type SpecState = {
    cmd: string;
    hasZWord: boolean;
    zWord: number;
    hasHWord: boolean;
    hWord: number;
    assignedLayer: number;
    layersZ: number[];
    layersH: number[];
  };

  const decodeState = (raw: ItfState): SpecState => ({
    cmd: itfStr(raw.cmd, 'cmd'),
    hasZWord: itfBool(raw.hasZWord, 'hasZWord'),
    zWord: itfInt(raw.zWord, 'zWord'),
    hasHWord: itfBool(raw.hasHWord, 'hasHWord'),
    hWord: itfInt(raw.hWord, 'hWord'),
    assignedLayer: itfInt(raw.assignedLayer, 'assignedLayer'),
    layersZ: itfIntList(raw.layersZ, 'layersZ'),
    layersH: itfIntList(raw.layersH, 'layersH')
  });

  // Builds the input chunk a spec state's event describes. Moves get a fresh
  // X destination and a monotonically growing absolute E from the step index,
  // so every move adds a vertex and every E word reads as a real extrusion.
  // "stutter" steps feed nothing (null).
  const buildChunk = (spec: SpecState, stepIndex: number): string | null => {
    switch (spec.cmd) {
      case 'travel':
        return `G0 X${stepIndex} Z${spec.zWord}`;
      case 'extrude':
        return `G1 X${stepIndex} E${stepIndex}`;
      case 'extrudeup':
        return `G1 X${stepIndex} Z${spec.zWord} E${stepIndex}`;
      case 'layercomment': {
        const lines = [';LAYER_CHANGE'];
        if (spec.hasZWord) lines.push(`;Z:${spec.zWord}`);
        if (spec.hasHWord) lines.push(`;HEIGHT:${spec.hWord}`);
        return lines.join('\n');
      }
      case 'stutter':
        return null;
      default:
        throw new Error(`unknown spec event "${spec.cmd}"`);
    }
  };

  // The full per-step comparison from the trace contract: the job's layer
  // partition (count, z, height per layer) and, when the spec filed a path
  // into a layer, the layerIndex the last finished path was assigned. Every
  // assertion message names the trace file, step index, input, field, and
  // the expected vs actual values.
  const compareStep = (traceFile: string, stepIndex: number, input: string, job: Job, spec: SpecState): void => {
    const at = (field: string, expected: unknown, actual: unknown) =>
      `${traceFile} step ${stepIndex} (${input}) field ${field}: expected ${String(expected)}, actual ${String(actual)}`;

    expect(job.layers.length, at('layers.length', spec.layersZ.length, job.layers.length)).toBe(spec.layersZ.length);

    for (let i = 0; i < spec.layersZ.length; i++) {
      const expectedZ = spec.layersZ[i] / 100;
      const actualZ = job.layers[i].z;
      expect(Math.abs(actualZ - expectedZ) <= 1e-6, at(`layers[${i}].z`, expectedZ, actualZ)).toBe(true);

      const expectedHeight = spec.layersH[i] / 100;
      const actualHeight = job.layers[i].height;
      expect(
        Math.abs(actualHeight - expectedHeight) <= 1e-6,
        at(`layers[${i}].height`, expectedHeight, actualHeight)
      ).toBe(true);
    }

    // assignedLayer == -1 means no layer received the step's path (dropped
    // travel, collapsed index, or a comment step with nothing to re-file);
    // a stale layerIndex from an earlier assignment may remain on the path,
    // so only positive assignments are asserted.
    if (spec.assignedLayer >= 0) {
      const lastPath = job.paths[job.paths.length - 1];
      expect(lastPath, at('paths[last]', 'a finished path', lastPath)).toBeDefined();
      expect(lastPath.layerIndex, at('paths[last].layerIndex', spec.assignedLayer, lastPath.layerIndex)).toBe(
        spec.assignedLayer
      );
    }
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
    test(`replays ${traceFile} through the parser + interpreter + job`, () => {
      const parsed = JSON.parse(readFileSync(join(tracesDir, traceFile), 'utf8')) as { states: ItfState[] };
      expect(Array.isArray(parsed.states), `${traceFile}: ITF file has no states array`).toBe(true);
      expect(parsed.states.length, `${traceFile}: trace has no states`).toBeGreaterThan(0);
      const states = parsed.states.map(decodeState);

      // One job, parser and interpreter per trace: layer state, the streaming
      // metadata array and the strategy lock all persist across the steps.
      const job = new Job();
      const interpreter = new Interpreter();
      const parser = new Parser();

      // A non-planar extrusion makes the job warn once while it clears the
      // layer index; that collapse is part of the modeled behavior.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(states[0].cmd, `${traceFile} step 0: the first state must be the init state`).toBe('init');
        compareStep(traceFile, 0, '<init>', job, states[0]);

        for (let step = 1; step < states.length; step++) {
          const spec = states[step];
          const input = buildChunk(spec, step);
          if (input !== null) {
            const { commands, metadata } = parser.parseGCode(input);
            // forward metadata before executing, like GCodePreview.processGCode
            job.metadata = metadata;
            interpreter.execute(commands, job);
          }
          compareStep(traceFile, step, input ?? '<stutter>', job, spec);
        }
      } finally {
        warnSpy.mockRestore();
      }
    });
  }
});
