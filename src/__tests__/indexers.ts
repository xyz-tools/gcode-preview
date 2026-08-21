import { test, expect } from 'vitest';
import { LayersMetadataIndexer } from '../indexers';
import { Layer } from '../layer';
import { Path, PathType } from '../path';
import { LayerMetadata } from '../parser/metadata-parser-base';

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
