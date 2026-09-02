import { test, expect, describe } from 'vitest';
import { Path, PathType } from '../path';
import { Layer } from '../layer';
import {
  LayersIndexer,
  NonApplicableIndexer,
  NonPlanarExtrusionError,
  ToolIndexer,
  TravelTypeIndexer
} from '../indexers';

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
