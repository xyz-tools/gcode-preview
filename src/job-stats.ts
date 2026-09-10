/**
 * Statistics accumulated while interpreting a job's G-code
 *
 * @remarks
 * The command handlers tally into these fields as they execute; the counts
 * reset naturally with each new `Job`.
 */
export class JobStats {
  /** Number of retraction moves (zero-length moves with positive E) */
  public retractions = 0;
  /** Number of deretraction moves (zero-length moves with negative E) */
  public deretractions = 0;
  /** Number of bare feedrate changes (F with no movement) */
  public feedrateChanges = 0;
  /** Number of zero-length moves that were neither a retraction nor a feedrate change */
  public others = 0;
  /** For reference, how many points were added to the job */
  public points = 0;
  /**
   * Cumulative newly advanced filament length in millimeters, including E-only
   * purges and primes. Recovery of previously retracted filament is excluded;
   * retracting never subtracts filament already consumed.
   */
  public extrusionDistance = 0;
}

// Keep accounting state private without adding fields to the public stats shape.
const outstandingRetraction = new WeakMap<JobStats, number>();

/** Accounts a signed filament delta without changing rendering classification. */
export function recordExtrusion(stats: JobStats, delta: number): void {
  const retracted = outstandingRetraction.get(stats) ?? 0;
  stats.extrusionDistance += Math.max(0, delta - retracted);
  outstandingRetraction.set(stats, Math.max(0, retracted - delta));
}
