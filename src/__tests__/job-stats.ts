import { test, expect, describe } from 'vitest';
import { JobStats } from '../job-stats';

describe('JobStats', () => {
  describe('.recordExtrusion', () => {
    test('accumulates positive deltas', () => {
      const stats = new JobStats();

      stats.recordExtrusion(4);
      stats.recordExtrusion(6);

      expect(stats.extrusionDistance).toEqual(10);
    });

    test('a retraction consumes no filament and is never subtracted', () => {
      const stats = new JobStats();

      stats.recordExtrusion(10);
      stats.recordExtrusion(-2);

      expect(stats.extrusionDistance).toEqual(10);
    });

    test('repaying a retraction adds nothing, only the excess counts', () => {
      const stats = new JobStats();

      stats.recordExtrusion(10);
      stats.recordExtrusion(-2);
      // 2 of these 3 mm merely undo the retraction
      stats.recordExtrusion(3);

      expect(stats.extrusionDistance).toEqual(11);
    });

    test('a retraction is repaid across several primes', () => {
      const stats = new JobStats();

      stats.recordExtrusion(-3);
      stats.recordExtrusion(1);
      stats.recordExtrusion(1);
      stats.recordExtrusion(2);

      // 3 of the 4 primed mm repay the retraction
      expect(stats.extrusionDistance).toEqual(1);
    });

    test('the outstanding retraction is per instance', () => {
      const retracted = new JobStats();
      const fresh = new JobStats();

      retracted.recordExtrusion(-2);
      fresh.recordExtrusion(3);

      expect(fresh.extrusionDistance).toEqual(3);
    });

    test('stays out of the public stats shape', () => {
      const stats = new JobStats();

      stats.recordExtrusion(-2);

      // The bookkeeping is a private field, so consumers that copy or serialize
      // the stats never see a phantom counter.
      expect(Object.keys(stats)).not.toContain('outstandingRetraction');
      expect(JSON.parse(JSON.stringify(stats))).toEqual({
        retractions: 0,
        deretractions: 0,
        feedrateChanges: 0,
        others: 0,
        points: 0,
        extrusionDistance: 0
      });
    });
  });
});
