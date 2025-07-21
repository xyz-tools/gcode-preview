import { test, expect, describe } from 'vitest';
import { Job } from '../job';
import { PathType, Path } from '../path';
import { State } from '../state';
import { LayersIndexer } from '../indexers';

test('it has an initial state', () => {
  const job = new Job();

  expect(job.state).toEqual(State.initial);
});

describe('.isPlanar', () => {
  test('if all extrusions are on the same plane (Z=0)', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);
    append_path(job, PathType.Extrusion, [
      [1, 2, 0],
      [5, 6, 0]
    ]);

    expect(job.isPlanar).toEqual(true);
  });

  test('if all extrusions are on the same plane (Z=1)', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [0, 0, 1],
      [1, 2, 1]
    ]);
    append_path(job, PathType.Extrusion, [
      [1, 2, 1],
      [5, 6, 1]
    ]);

    expect(job.isPlanar).toEqual(true);
  });

  test('if any extrusion path has a Z value that exceeds the default tolerance', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [1, 2, 0],
      [5, 6, 1]
    ]);

    expect(job.isPlanar).toEqual(false);
  });

  test('if any extrusion path has a delta Z that exceeds the default tolerance', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [1, 2, 0],
      [5, 6, 1]
    ]);

    expect(job.isPlanar).toEqual(false);
  });

  test('ignores travel paths', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);
    append_path(job, PathType.Travel, [
      [5, 6, 0],
      [5, 6, 1],
      [1, 2, 0]
    ]);
    append_path(job, PathType.Extrusion, [
      [1, 2, 0],
      [5, 6, 0]
    ]);

    expect(job.isPlanar).toEqual(true);
  });
});

describe('.layers', () => {

  test('returns empty list if no paths are present', () => {
    const job = new Job();

    expect(job.layers).toEqual([]);
  });

  test('returns empty list if no extrusion is present', () => {
    const job = new Job();

    append_path(job, PathType.Travel, [
      [0, 0, 0],
      [1, 2, 0]
    ]);

    expect(job.layers).toEqual([]);
  });  

  test('returns empty list if the job is not planar', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);
    append_path(job, PathType.Extrusion, [
      [5, 6, 0],
      [5, 6, 1]
    ]);

    expect(job.layers).toEqual([]);
  });

  test('extrusions with same Z value are on the same layer', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);
    append_path(job, PathType.Extrusion, [
      [5, 6, 0],
      [5, 6, 0]
    ]);

    const layers = job.layers;

    expect(layers).not.toBeNull();
    expect(layers).toBeInstanceOf(Array);
    expect(layers.length).toEqual(1);
    expect(layers[0].paths.length).toEqual(2);
  });

  test('extrusion paths moving z above the default tolerance create a new layer', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);
    append_path(job, PathType.Extrusion, [
      [5, 6, LayersIndexer.DEFAULT_TOLERANCE + 0.02],
      [5, 6, LayersIndexer.DEFAULT_TOLERANCE + 0.02]
    ]);

    const layers = job.layers;

    expect(layers).not.toBeNull();
    expect(layers).toBeInstanceOf(Array);
    expect(layers.length).toEqual(2);
    expect(layers[0].paths.length).toEqual(1);
    expect(layers[1].paths.length).toEqual(1);
  });

  test('travel with a z component is still on the same layer', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);
    append_path(job, PathType.Travel, [
      [5, 6, 0],
      [5, 6, 42]
    ]);

    const layers = job.layers;

    expect(layers).not.toBeNull();
    expect(layers).toBeInstanceOf(Array);
    expect(layers.length).toEqual(1);
    expect(layers[0].paths.length).toEqual(2);
  });

  test('Tolerance can be set', () => {
    const job = new Job({ minLayerThreshold: 0.1 });

    append_path(job, PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);
    append_path(job, PathType.Travel, [
      [5, 6, 0],
      [5, 6, 0.09]
    ]);

    const layers = job.layers;

    expect(layers).not.toBeNull();
    expect(layers).toBeInstanceOf(Array);
    expect(layers.length).toEqual(1);
    expect(layers[0].paths.length).toEqual(2);
  });

  test('multiple travels in a row are on the same layer', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);
    append_path(job, PathType.Travel, [
      [5, 6, 0],
      [5, 6, 2]
    ]);
    append_path(job, PathType.Travel, [
      [5, 6, 2],
      [5, 6, 0]
    ]);
    append_path(job, PathType.Travel, [
      [5, 6, 0],
      [5, 6, 2]
    ]);

    const layers = job.layers;

    expect(layers).not.toBeNull();
    expect(layers).toBeInstanceOf(Array);
    expect(layers.length).toEqual(1);
    expect(layers[0].paths.length).toEqual(4);
  });

  test('extrusions after travels are on the same layer', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);
    append_path(job, PathType.Travel, [
      [5, 6, 0],
      [5, 6, 2]
    ]);
    append_path(job, PathType.Travel, [
      [5, 6, 2],
      [5, 6, 0]
    ]);
    append_path(job, PathType.Travel, [
      [5, 6, 0],
      [5, 6, 2]
    ]);
    append_path(job, PathType.Extrusion, [
      [5, 6, 0],
      [5, 6, 0]
    ]);

    const layers = job.layers;

    expect(layers).not.toBeNull();
    expect(layers).toBeInstanceOf(Array);
    expect(layers.length).toEqual(1);
    expect(layers[0].paths.length).toEqual(5);
  });

  test('extrusions with a new Z value after travels are on a new layer', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);
    append_path(job, PathType.Travel, [
      [5, 6, 0],
      [5, 6, 2]
    ]);
    append_path(job, PathType.Travel, [
      [5, 6, 2],
      [5, 6, 0]
    ]);
    append_path(job, PathType.Travel, [
      [5, 6, 0],
      [5, 6, 2]
    ]);
    append_path(job, PathType.Extrusion, [
      [5, 6, 2],
      [5, 6, 2]
    ]);

    const layers = job.layers;

    expect(layers).not.toBeNull();
    expect(layers).toBeInstanceOf(Array);
    expect(layers.length).toEqual(2);
    expect(layers[0].paths.length).toEqual(4);
    expect(layers[1].paths.length).toEqual(1);
  });

  test('travel paths before the first extrusion are not indexed', () => {
    const job = new Job();

    append_path(job, PathType.Travel, [
      [5, 6, 0],
      [5, 6, 0]
    ]);
    append_path(job, PathType.Travel, [
      [5, 6, 2],
      [5, 6, 0]
    ]);
    append_path(job, PathType.Travel, [
      [5, 6, 0],
      [5, 6, 2]
    ]);
    append_path(job, PathType.Extrusion, [
      [5, 6, 2],
      [5, 6, 2]
    ]);

    const layers = job.layers;

    expect(layers).not.toBeNull();
    expect(layers.length).toEqual(1);
    expect(layers[0].paths.length).toEqual(1);
  });

  test('layer z must equal path z', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [5, 6, 2],
      [5, 6, 2]
    ]);

    const layers = job.layers;

    expect(layers).not.toBeNull();
    expect(layers.length).toEqual(1);
    expect(layers[0].z).toEqual(2);
  });

   test('layer z must equal extrusion path z', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [5, 6, 2],
      [5, 6, 2]
    ]);

    append_path(job, PathType.Travel, [
      [5, 6, 4],
      [5, 6, 4]
    ]);

    const layers = job.layers;

    expect(layers).not.toBeNull();
    expect(layers.length).toEqual(1);
    expect(layers[0].z).toEqual(2);
  });


  test('layer z must equal path z, for second layer', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [5, 6, 2],
      [5, 6, 2]
    ]);
    append_path(job, PathType.Extrusion, [
      [5, 6, 4],
      [5, 6, 4]
    ]);

    const layers = job.layers;

    expect(layers).not.toBeNull();
    expect(layers.length).toEqual(2);
    expect(layers[1].z).toEqual(4);
  });
});

describe('.extrusions', () => {
  test('returns all extrusion paths', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);
    append_path(job, PathType.Travel, [
      [5, 6, 0],
      [5, 6, 0]
    ]);
    append_path(job, PathType.Extrusion, [
      [1, 2, 0],
      [5, 6, 0]
    ]);

    const extrusions = job.extrusions;

    expect(extrusions).not.toBeNull();
    expect(extrusions).toBeInstanceOf(Array);
    expect(extrusions.length).toEqual(2);
    extrusions.forEach((path) => {
      expect(path.travelType).toEqual(PathType.Extrusion);
    });
  });
});

describe('.travels', () => {
  test('returns all travel paths', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);
    append_path(job, PathType.Travel, [
      [5, 6, 0],
      [5, 6, 0]
    ]);
    append_path(job, PathType.Extrusion, [
      [1, 2, 0],
      [5, 6, 0]
    ]);
    append_path(job, PathType.Travel, [
      [5, 6, 0],
      [5, 6, 0]
    ]);

    const travels = job.travels;

    expect(travels).not.toBeNull();
    expect(travels).toBeInstanceOf(Array);
    expect(travels.length).toEqual(2);
    travels.forEach((path) => {
      expect(path.travelType).toEqual(PathType.Travel);
    });
  });
});

describe('.toolPaths', () => {
  test('Extrusions using the same tool are indexed', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [], 0);
    append_path(job, PathType.Extrusion, [], 1);
    append_path(job, PathType.Extrusion, [], 0);
    append_path(job, PathType.Extrusion, [], 1);
    append_path(job, PathType.Extrusion, [], 5);
    append_path(job, PathType.Extrusion, [], 2);
    append_path(job, PathType.Extrusion, [], 2);

    const toolPaths = job.toolPaths;

    expect(toolPaths).not.toBeNull();
    expect(toolPaths).toBeInstanceOf(Array);
    expect(toolPaths.length).toEqual(6);
    expect(toolPaths[0].length).toEqual(2);
    expect(toolPaths[1].length).toEqual(2);
    expect(toolPaths[2].length).toEqual(2);
    expect(toolPaths[3]).toBeUndefined();
    expect(toolPaths[4]).toBeUndefined();
    expect(toolPaths[5].length).toEqual(1);
  });
});

describe('.addPath', () => {
  test('adds the path to the job', () => {
    const job = new Job();
    const path = new Path(PathType.Extrusion, 0.6, 0.2, 0);

    job.addPath(path);

    expect(job.paths).toEqual([path]);
  });

  test('indexes the path', () => {
    const job = new Job();
    const path = new Path(PathType.Extrusion, 0.6, 0.2, 0);

    job.addPath(path);

    expect(job.extrusions).toEqual([path]);
  });
});

describe('.finishPath', () => {
  test('does nothing if there is no in progress path', () => {
    const job = new Job();

    job.finishPath();

    expect(job.paths).toEqual([]);
  });

  test('adds the in progress path to the job', () => {
    const job = new Job();
    const path = new Path(PathType.Extrusion, 0.6, 0.2, 0);

    path.addPoint(0, 0, 0);

    job.inprogressPath = path;
    job.finishPath();

    expect(job.paths).toEqual([path]);
  });

  test('ignores empty paths', () => {
    const job = new Job();
    const path = new Path(PathType.Extrusion, 0.6, 0.2, 0);

    job.inprogressPath = path;
    job.finishPath();

    expect(job.paths).toEqual([]);
  });

  test('clears the in progress path', () => {
    const job = new Job();
    const path = new Path(PathType.Extrusion, 0.6, 0.2, 0);

    path.addPoint(0, 0, 0);

    job.inprogressPath = path;
    job.finishPath();

    expect(job.inprogressPath).toBeUndefined();
  });
});

describe('.resumeLastPath', () => {
  test('pops the last path and makes it in progress', () => {
    const job = new Job();

    job.resumeLastPath();

    expect(job.paths).toEqual([]);
  });

  test('adds the in progress path to the job', () => {
    const job = new Job();

    const path = append_path(job, PathType.Extrusion, [[0, 0, 0]]);

    job.resumeLastPath();

    expect(job.inprogressPath).toEqual(path);
    expect(job.paths).toEqual([]);
  });

  test('the path is removed from indexes to not appear twice', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [[0, 0, 0]]);
    job.resumeLastPath();

    expect(job.extrusions).toEqual([]);
    expect(job.layers[job.layers.length - 1].paths).toEqual([]);
  });
});

function append_path(job: Job, travelType, points: [number, number, number][], tool: number = 0): Path {
  const path = new Path(travelType, 0.6, 0.2, tool || job.state.tool);
  points.forEach((point: [number, number, number]) => path.addPoint(...point));
  job.addPath(path);
  return path;
}
