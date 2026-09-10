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

  /**
   * Filament still owed back after a retraction, in millimeters.
   *
   * @remarks
   * Private so it stays out of the public stats shape: it is bookkeeping for
   * {@link recordExtrusion}, not a statistic callers should read.
   */
  #outstandingRetraction = 0;

  /**
   * Accounts a signed filament delta without changing rendering classification
   * @param delta - Filament advanced (positive) or retracted (negative), in millimeters
   * @remarks
   * Only filament beyond what a previous retraction still owes counts as newly
   * consumed, so a retract/prime pair nets to zero instead of double-counting
   * the primed length.
   */
  public recordExtrusion(delta: number): void {
    const retracted = this.#outstandingRetraction;
    this.extrusionDistance += Math.max(0, delta - retracted);
    this.#outstandingRetraction = Math.max(0, retracted - delta);
  }
}
