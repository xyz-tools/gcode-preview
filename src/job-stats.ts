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
  /** Total extrusion distance over all extrusion moves */
  public extrusionDistance = 0;
}
