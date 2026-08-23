import { test, expect, describe } from 'vitest';
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
