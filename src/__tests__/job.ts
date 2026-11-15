import { join } from 'node:path';
import { test, expect, describe, vi, afterEach } from 'vitest';
import { Job } from '../job';
import { PathType, Path } from '../path';
import { State } from '../state';
import { LayersIndexer, NonApplicableIndexer, TravelTypeIndexer } from '../indexers';
import { Parser } from '../parser/gcode-parser';
import { Interpreter } from '../interpreter';
import {
  listTraceFiles,
  readTrace,
  itfInt,
  itfBool,
  itfStr,
  itfRecord,
  centiMismatch,
  type ItfValue as ReplayItfValue,
  type ItfState as ReplayItfState
} from './helpers/itf-replay';

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
    expect(job.isPlanar).toEqual(false);
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
    append_path(job, PathType.Extrusion, [
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

  test('a previously obtained layers array is emptied when the job turns out non-planar', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);

    const layers = job.layers;
    expect(layers.length).toEqual(1);

    append_path(job, PathType.Extrusion, [
      [5, 6, 0],
      [5, 6, 1]
    ]);

    expect(layers.length).toEqual(0);
    expect(job.layers).toBe(layers);
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

  test('a non-planar extrusion path is still indexed by tool', () => {
    const job = new Job();

    const planar = append_path(job, PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);
    const nonPlanar = append_path(job, PathType.Extrusion, [
      [1, 2, 0],
      [5, 6, 1]
    ]);

    expect(job.isPlanar).toEqual(false);
    expect(job.toolPaths[0]).toEqual([planar, nonPlanar]);
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

  describe('when an indexer throws an error', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    test('rethrows errors that are not NonApplicableIndexer', () => {
      const job = new Job();
      const error = new Error('boom');
      vi.spyOn(TravelTypeIndexer.prototype, 'sortIn').mockImplementation(() => {
        throw error;
      });
      const path = new Path(PathType.Extrusion, 0.6, 0.2, 0);

      expect(() => job.addPath(path)).toThrow(error);
    });

    test('removes an indexer that throws NonApplicableIndexer without clearing layers', () => {
      const job = new Job();
      const sortIn = vi.spyOn(TravelTypeIndexer.prototype, 'sortIn').mockImplementation(() => {
        throw new NonApplicableIndexer('not applicable');
      });

      append_path(job, PathType.Extrusion, [
        [0, 0, 0],
        [1, 2, 0]
      ]);
      append_path(job, PathType.Extrusion, [
        [1, 2, 0],
        [5, 6, 0]
      ]);

      expect(sortIn).toHaveBeenCalledTimes(1);
      expect(job.extrusions).toEqual([]);
      expect(job.layers.length).toEqual(1);
    });
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

describe('.breakPath', () => {
  test('creates a path carrying the state dimensions and tool', () => {
    const job = new Job();
    job.state.extrusionWidth = 0.45;
    job.state.lineHeight = 0.16;
    job.state.tool = 2;

    const path = job.breakPath(PathType.Extrusion);

    expect(path.extrusionWidth).toEqual(0.45);
    expect(path.lineHeight).toEqual(0.16);
    expect(path.tool).toEqual(2);
  });

  test('leaves the dimensions unknown on a fresh state', () => {
    // Unknown dimensions resolve at render time: global setting, then the
    // built-in defaults.
    const path = new Job().breakPath(PathType.Extrusion);

    expect(path.extrusionWidth).toBeUndefined();
    expect(path.lineHeight).toBeUndefined();
  });
});

describe('.beginCommand', () => {
  const metadataWith = (extrusionDimensions: { width?: number; height?: number; lineIndex: number }[]) => ({
    thumbnails: {},
    extrusionDimensions
  });

  test('applies a dimension event once its line has been reached', () => {
    const job = new Job();
    job.metadata = metadataWith([{ width: 0.45, lineIndex: 0 }]);

    job.beginCommand();

    expect(job.state.extrusionWidth).toEqual(0.45);
  });

  test('does not apply events for lines not yet executed', () => {
    const job = new Job();
    job.metadata = metadataWith([{ height: 0.3, lineIndex: 2 }]);

    job.beginCommand();

    expect(job.state.lineHeight).toBeUndefined();

    job.beginCommand();
    job.beginCommand();

    expect(job.state.lineHeight).toEqual(0.3);
  });

  test('applies several pending events in order, last one winning', () => {
    const job = new Job();
    job.metadata = metadataWith([
      { width: 0.4, lineIndex: 0 },
      { width: 0.5, height: 0.25, lineIndex: 0 }
    ]);

    job.beginCommand();

    expect(job.state.extrusionWidth).toEqual(0.5);
    expect(job.state.lineHeight).toEqual(0.25);
  });

  test('keeps its position when the same growing metadata array is re-set', () => {
    // A streaming parse re-assigns job.metadata each chunk with the same,
    // growing array; the cursor must not rewind or events would reapply.
    const job = new Job();
    const extrusionDimensions = [{ width: 0.4, lineIndex: 0 }];
    job.metadata = metadataWith(extrusionDimensions);
    job.beginCommand();
    job.state.extrusionWidth = 0.9; // marker: a rewind would overwrite this

    extrusionDimensions.push({ width: 0.5, lineIndex: 2 });
    job.metadata = metadataWith(extrusionDimensions);
    job.beginCommand();

    expect(job.state.extrusionWidth).toEqual(0.9);
  });

  test('rewinds when a different metadata array is swapped in', () => {
    const job = new Job();
    job.metadata = metadataWith([{ width: 0.4, lineIndex: 0 }]);
    job.beginCommand();

    job.metadata = metadataWith([{ width: 0.55, lineIndex: 0 }]);
    job.beginCommand();

    expect(job.state.extrusionWidth).toEqual(0.55);
  });

  test('is a no-op without dimension metadata', () => {
    const job = new Job();
    job.metadata = { thumbnails: {} };

    job.beginCommand();

    expect(job.state.extrusionWidth).toBeUndefined();
    expect(job.state.lineHeight).toBeUndefined();
  });
});

describe('.continuePath', () => {
  test('breaks a new path when none is in progress', () => {
    const job = new Job();

    const path = job.continuePath(PathType.Extrusion);

    expect(path).toBe(job.inprogressPath);
    expect(path.travelType).toEqual(PathType.Extrusion);
  });

  test('continues the in-progress path while type and dimensions match', () => {
    const job = new Job();
    const path = job.breakPath(PathType.Extrusion);

    expect(job.continuePath(PathType.Extrusion)).toBe(path);
  });

  test('breaks on a path type change', () => {
    const job = new Job();
    const path = job.breakPath(PathType.Extrusion);
    path.addPoint(1, 1, 0);

    const next = job.continuePath(PathType.Travel);

    expect(next).not.toBe(path);
    expect(next.travelType).toEqual(PathType.Travel);
  });

  test('breaks when the state extrusion width changed', () => {
    const job = new Job();
    const path = job.breakPath(PathType.Extrusion);
    path.addPoint(1, 1, 0);
    job.state.extrusionWidth = 0.45;

    const next = job.continuePath(PathType.Extrusion);

    expect(next).not.toBe(path);
    expect(next.extrusionWidth).toEqual(0.45);
    expect(job.paths).toEqual([path]);
  });

  test('breaks when the state line height changed', () => {
    const job = new Job();
    const path = job.breakPath(PathType.Extrusion);
    path.addPoint(1, 1, 0);
    job.state.lineHeight = 0.3;

    const next = job.continuePath(PathType.Extrusion);

    expect(next).not.toBe(path);
    expect(next.lineHeight).toEqual(0.3);
  });

  test('breaks when the state tool changed', () => {
    const job = new Job();
    const path = job.breakPath(PathType.Extrusion);
    path.addPoint(1, 1, 0);
    job.state.tool = 1;

    const next = job.continuePath(PathType.Extrusion);

    expect(next).not.toBe(path);
    expect(next.tool).toEqual(1);
    expect(job.paths).toEqual([path]);
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

  test('the path is removed from the tool index', () => {
    const job = new Job();

    append_path(job, PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);
    job.resumeLastPath();

    expect(job.toolPaths[0]).toEqual([]);
  });

  test('resuming and finishing across chunks does not duplicate tool paths', () => {
    const job = new Job();

    const path = append_path(job, PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);

    // simulate streaming: each chunk resumes the last path, appends and finishes it
    for (let chunk = 0; chunk < 2; chunk++) {
      job.resumeLastPath();
      job.inprogressPath.addPoint(2 + chunk, 2, 0);
      job.finishPath();
    }

    expect(job.paths).toEqual([path]);
    expect(job.extrusions).toEqual([path]);
    expect(job.toolPaths[0]).toEqual([path]);
  });

  test('leaves non-empty indexes that do not contain the resumed path intact', () => {
    const job = new Job();

    const extrusion = append_path(job, PathType.Extrusion, [
      [0, 0, 0],
      [1, 2, 0]
    ]);
    const travel = append_path(job, PathType.Travel, [
      [1, 2, 0],
      [5, 6, 0]
    ]);

    job.resumeLastPath();

    expect(job.inprogressPath).toEqual(travel);
    expect(job.extrusions).toEqual([extrusion]);
    expect(job.travels).toEqual([]);
  });
});

function append_path(job: Job, travelType, points: [number, number, number][], tool: number = 0): Path {
  const path = new Path(travelType, 0.6, 0.2, tool || job.state.tool);
  points.forEach((point: [number, number, number]) => path.addPoint(...point));
  job.addPath(path);
  return path;
}

describe('encoding equivalence spec trace replay', () => {
  // Replays ITF traces produced from verification/quint/encoding-equivalence.qnt.
  // Each trace state holds exactly two records: `s` — two copies of the shared
  // spec printer state (copy A in the logical frame as written, copy B in a
  // G92-shifted workspace) plus the live frame offset — and `ev`, the step's
  // command carrying copy A's words and copy B's re-encoded words. The trace
  // thereby doubles as TWO G-code programs: both run through their own real
  // Parser + Interpreter + Job, each Job is compared to its spec copy, and the
  // two Jobs are compared to each other — all integer-exactly on the
  // centi-millimeter grid via centiMismatch (no epsilon).
  const tracesDir = join(process.cwd(), 'verification', 'quint', 'traces', 'encoding-equivalence');

  type AxisCopy = { known: boolean; pos: number };
  type PrinterCopy = {
    x: AxisCopy;
    y: AxisCopy;
    z: AxisCopy;
    e: number;
    shift: { x: number; y: number; z: number };
    relExtrude: boolean;
    inches: boolean;
    homed: boolean;
    tool: number;
  };
  type SpecEvent = {
    cmd: string;
    bare: boolean;
    hasX: boolean;
    hasY: boolean;
    hasZ: boolean;
    hasE: boolean;
    hasF: boolean;
    hasI: boolean;
    hasJ: boolean;
    hasR: boolean;
    probeP: boolean;
    aX: number;
    aY: number;
    aZ: number;
    bX: number;
    bY: number;
    bZ: number;
    wE: number;
    wF: number;
    wI: number;
    wJ: number;
    wR: number;
  };
  type SpecStep = { ev: SpecEvent; a: PrinterCopy; b: PrinterCopy };

  const decodeAxis = (value: ReplayItfValue | undefined, key: string): AxisCopy => {
    const axis = itfRecord(value, key);
    return { known: itfBool(axis.known, `${key}.known`), pos: itfInt(axis.pos, `${key}.pos`) };
  };

  const decodeCopy = (value: ReplayItfValue | undefined, key: string): PrinterCopy => {
    const copy = itfRecord(value, key);
    const shift = itfRecord(copy.shift, `${key}.shift`);
    return {
      x: decodeAxis(copy.x, `${key}.x`),
      y: decodeAxis(copy.y, `${key}.y`),
      z: decodeAxis(copy.z, `${key}.z`),
      e: itfInt(copy.e, `${key}.e`),
      shift: {
        x: itfInt(shift.x, `${key}.shift.x`),
        y: itfInt(shift.y, `${key}.shift.y`),
        z: itfInt(shift.z, `${key}.shift.z`)
      },
      relExtrude: itfBool(copy.relExtrude, `${key}.relExtrude`),
      inches: itfBool(copy.inches, `${key}.inches`),
      homed: itfBool(copy.homed, `${key}.homed`),
      tool: itfInt(copy.tool, `${key}.tool`)
    };
  };

  // Decodes a raw ITF state; keys starting with '#' (like '#meta') are never
  // read and are thereby ignored. The spec-internal ghost fields (off, framed,
  // ghostResetSeen) are deliberately not decoded: the replay observes the two
  // copies and the event only.
  const decodeStep = (raw: ReplayItfState): SpecStep => {
    const s = itfRecord(raw.s, 's');
    const ev = itfRecord(raw.ev, 'ev');
    return {
      ev: {
        cmd: itfStr(ev.cmd, 'ev.cmd'),
        bare: itfBool(ev.bare, 'ev.bare'),
        hasX: itfBool(ev.hasX, 'ev.hasX'),
        hasY: itfBool(ev.hasY, 'ev.hasY'),
        hasZ: itfBool(ev.hasZ, 'ev.hasZ'),
        hasE: itfBool(ev.hasE, 'ev.hasE'),
        hasF: itfBool(ev.hasF, 'ev.hasF'),
        hasI: itfBool(ev.hasI, 'ev.hasI'),
        hasJ: itfBool(ev.hasJ, 'ev.hasJ'),
        hasR: itfBool(ev.hasR, 'ev.hasR'),
        probeP: itfBool(ev.probeP, 'ev.probeP'),
        aX: itfInt(ev.aX, 'ev.aX'),
        aY: itfInt(ev.aY, 'ev.aY'),
        aZ: itfInt(ev.aZ, 'ev.aZ'),
        bX: itfInt(ev.bX, 'ev.bX'),
        bY: itfInt(ev.bY, 'ev.bY'),
        bZ: itfInt(ev.bZ, 'ev.bZ'),
        wE: itfInt(ev.wE, 'ev.wE'),
        wF: itfInt(ev.wF, 'ev.wF'),
        wI: itfInt(ev.wI, 'ev.wI'),
        wJ: itfInt(ev.wJ, 'ev.wJ'),
        wR: itfInt(ev.wR, 'ev.wR')
      },
      a: decodeCopy(s.a, 's.a'),
      b: decodeCopy(s.b, 's.b')
    };
  };

  /** The spec's lowercase event tag as a G-code: "g38_2" -> "G38.2",
   * "g92_1" -> "G92.1", "t3" -> "T3". */
  const codeOf = (tag: string): string => tag.replace('_', '.').toUpperCase();

  /** Rebuilds the two real G-code lines a step stands for. `null` means the
   * stream receives no line on this step (only the frame step, for stream A). */
  const buildLines = (ev: SpecEvent): { a: string | null; b: string | null } => {
    if (ev.cmd === 'frame') {
      // the workspace-establishing G92 of stream B; stream A gets no line
      return { a: null, b: `G92 X${ev.bX} Y${ev.bY} Z${ev.bZ}` };
    }
    if (ev.cmd === 'g92' && ev.bare) {
      // A's bare G92 re-encodes as the word form pinning B's workspace
      return { a: 'G92', b: `G92 X${ev.bX} Y${ev.bY} Z${ev.bZ} E0` };
    }
    if (ev.cmd === 'g28') {
      // axis words are presence-only flags; the pinned semantics homes all axes
      const flags = `${ev.hasX ? ' X' : ''}${ev.hasY ? ' Y' : ''}${ev.hasZ ? ' Z' : ''}`;
      return { a: `G28${flags}`, b: `G28${flags}` };
    }
    const words = (x: number, y: number, z: number): string =>
      `${ev.hasX ? ` X${x}` : ''}${ev.hasY ? ` Y${y}` : ''}${ev.hasZ ? ` Z${z}` : ''}` +
      `${ev.hasE ? ` E${ev.wE}` : ''}${ev.hasF ? ` F${ev.wF}` : ''}` +
      `${ev.hasI ? ` I${ev.wI}` : ''}${ev.hasJ ? ` J${ev.wJ}` : ''}${ev.hasR ? ` R${ev.wR}` : ''}` +
      `${ev.probeP ? ' P1' : ''}`;
    const code = codeOf(ev.cmd);
    return { a: code + words(ev.aX, ev.aY, ev.aZ), b: code + words(ev.bX, ev.bY, ev.bZ) };
  };

  /** Compares one real Job's State to its spec copy, integer-exactly on the
   * centi-mm grid. Mismatches are collected so one assertion names them all. */
  const compareCopy = (context: string, state: State, copy: PrinterCopy): void => {
    const mismatches: string[] = [];
    const checkCenti = (field: string, actual: number, expectedCenti: number): void => {
      const mismatch = centiMismatch(actual, expectedCenti);
      if (mismatch !== null) mismatches.push(`${field}: ${mismatch}`);
    };

    const axes = [
      { field: 'x', actual: state.x, axis: copy.x },
      { field: 'y', actual: state.y, axis: copy.y },
      { field: 'z', actual: state.z, axis: copy.z }
    ];
    for (const { field, actual, axis } of axes) {
      if (!axis.known) {
        if (actual !== undefined) mismatches.push(`${field}: expected undefined (axis unknown), actual ${actual}`);
      } else if (actual === undefined) {
        mismatches.push(`${field}: expected ${axis.pos / 100}, actual undefined`);
      } else {
        checkCenti(field, actual, axis.pos);
      }
    }

    checkCenti('e', state.e, copy.e);
    checkCenti('positionShift.x', state.positionShift.x, copy.shift.x);
    checkCenti('positionShift.y', state.positionShift.y, copy.shift.y);
    checkCenti('positionShift.z', state.positionShift.z, copy.shift.z);
    if (state.relativeExtrusion !== copy.relExtrude) {
      mismatches.push(`relativeExtrusion: expected ${copy.relExtrude}, actual ${state.relativeExtrusion}`);
    }
    const expectedUnits = copy.inches ? 'in' : 'mm';
    if (state.units !== expectedUnits) mismatches.push(`units: expected ${expectedUnits}, actual ${state.units}`);
    if (state.isHomed !== copy.homed) mismatches.push(`isHomed: expected ${copy.homed}, actual ${state.isHomed}`);
    if (state.tool !== copy.tool) mismatches.push(`tool: expected ${copy.tool}, actual ${state.tool}`);

    expect(mismatches, `${context}: ${mismatches.join('; ')}`).toEqual([]);
  };

  /** The headline check: the two Jobs agree with EACH OTHER. Positions are
   * cross-bound through the other stream's spec integer (each value must sit
   * exactly on the grid point the other stream was verified against); E, the
   * statistics counters and the path shape are identical computations in both
   * streams and compare with ===. */
  const compareJobs = (context: string, jobA: Job, jobB: Job, step: SpecStep): void => {
    const mismatches: string[] = [];

    const axes = [
      { field: 'x', a: jobA.state.x, b: jobB.state.x, aCenti: step.a.x.pos, bCenti: step.b.x.pos },
      { field: 'y', a: jobA.state.y, b: jobB.state.y, aCenti: step.a.y.pos, bCenti: step.b.y.pos },
      { field: 'z', a: jobA.state.z, b: jobB.state.z, aCenti: step.a.z.pos, bCenti: step.b.z.pos }
    ];
    for (const { field, a, b, aCenti, bCenti } of axes) {
      if ((a === undefined) !== (b === undefined)) {
        mismatches.push(`${field}: stream A ${a} differs from stream B ${b} in definedness`);
      } else if (a !== undefined && b !== undefined) {
        const crossBA = centiMismatch(b, aCenti);
        const crossAB = centiMismatch(a, bCenti);
        if (crossBA !== null) mismatches.push(`${field}: stream B off stream A's grid point: ${crossBA}`);
        if (crossAB !== null) mismatches.push(`${field}: stream A off stream B's grid point: ${crossAB}`);
      }
    }

    const exact = (field: string, a: number | boolean, b: number | boolean): void => {
      if (a !== b) mismatches.push(`${field}: stream A ${a} differs from stream B ${b}`);
    };
    exact('e', jobA.state.e, jobB.state.e);
    exact('isHomed', jobA.state.isHomed, jobB.state.isHomed);
    exact('relativeExtrusion', jobA.state.relativeExtrusion, jobB.state.relativeExtrusion);
    exact('tool', jobA.state.tool, jobB.state.tool);
    exact('units match', jobA.state.units === 'in', jobB.state.units === 'in');
    exact('stats.points', jobA.stats.points, jobB.stats.points);
    exact('stats.retractions', jobA.stats.retractions, jobB.stats.retractions);
    exact('stats.deretractions', jobA.stats.deretractions, jobB.stats.deretractions);
    exact('stats.feedrateChanges', jobA.stats.feedrateChanges, jobB.stats.feedrateChanges);
    exact('stats.others', jobA.stats.others, jobB.stats.others);
    exact('stats.extrusionDistance', jobA.stats.extrusionDistance, jobB.stats.extrusionDistance);
    exact('paths.length', jobA.paths.length, jobB.paths.length);
    exact(
      'total path points',
      jobA.paths.reduce((count, path) => count + path.vertices.length / 3, 0),
      jobB.paths.reduce((count, path) => count + path.vertices.length / 3, 0)
    );

    expect(mismatches, `${context}: ${mismatches.join('; ')}`).toEqual([]);
  };

  const traceFiles = listTraceFiles(tracesDir);

  test('the v2 traces directory exists and holds at least one ITF trace', () => {
    // Fails (rather than silently skipping the replay) when the Quint traces
    // have not been generated into verification/quint/traces.
    expect(traceFiles.length, `expected *.itf.json traces in ${tracesDir}`).toBeGreaterThan(0);
  });

  for (const traceFile of traceFiles) {
    test(`replays ${traceFile} as two equivalent G-code streams`, () => {
      const steps = readTrace(tracesDir, traceFile).map(decodeStep);
      expect(steps[0].ev.cmd, `${traceFile} step 0: the first state must be the init state`).toBe('init');

      // One pipeline per stream: state persists across the steps.
      const jobA = new Job();
      const jobB = new Job();
      const parserA = new Parser();
      const parserB = new Parser();
      const interpreterA = new Interpreter();
      const interpreterB = new Interpreter();

      steps.forEach((step, index) => {
        let lineA = '<none>';
        let lineB = '<none>';
        if (step.ev.cmd !== 'init') {
          const lines = buildLines(step.ev);
          if (lines.a !== null) {
            lineA = lines.a;
            interpreterA.execute(parserA.parseGCode(lineA).commands, jobA);
          }
          if (lines.b !== null) {
            lineB = lines.b;
            interpreterB.execute(parserB.parseGCode(lineB).commands, jobB);
          }
        }
        compareCopy(`${traceFile} step ${index} stream A (${lineA})`, jobA.state, step.a);
        compareCopy(`${traceFile} step ${index} stream B (${lineB})`, jobB.state, step.b);
        compareJobs(`${traceFile} step ${index} (A: ${lineA} | B: ${lineB})`, jobA, jobB, step);
      });
    });
  }
});
