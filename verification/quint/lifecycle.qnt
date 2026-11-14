// -*- mode: Bluespec; -*-
/**
 * Formal specification of the GCodePreview public-API lifecycle automaton.
 *
 * Models the library's observable public-API lifecycle — processGCode,
 * clear, render, resize and dispose, as pinned observable behavior — not
 * three.js internals. The central pinned fact: dispose() tears down only the
 * rendering side (the scene manager and its renderer), and the next
 * lifecycle call that needs rendering lazily resurrects a fresh scene
 * manager (and with it a fresh renderer). So "disposed" is NOT absorbing: every
 * lifecycle action except dispose itself (and stutter) leaves it. The job is
 * retained across dispose() and only replaced by clear(). No lifecycle call
 * throws.
 *
 * The cmd variable records WHICH action was taken on each step, so an ITF
 * trace doubles as a call script: a replay harness applies each call to a
 * real (WebGL-stubbed) GCodePreview and compares the predicted outcome and
 * the observable counters step by step. "process" stands for one fixed
 * one-move G-code snippet ("G1 X10 Y10 E1"). The printer state lives on the
 * retained job and E is absolute by default, so per job epoch (since
 * construction or the last clear) the first process lays an extrusion path,
 * the second adds a travel path (E is already at its absolute target, so the
 * same move extrudes nothing), and every further process extends that travel
 * path: the job's path count is min(processes-in-epoch, 2). All numeric
 * state is plain integer counters (no unit scaling needed).
 */
module lifecycle {
  // --- trace-contract variables: the action taken on this step ---
  /// "init", "process", "clear", "render", "resize", "dispose" or "stutter"
  var cmd: str
  /// predicted result of the call: "ok" or "throws". Pinned behavior: no
  /// lifecycle call ever throws, so this is always "ok".
  var outcome: str

  // --- trace-contract variables: observable lifecycle state ---
  /// abstract phase: "fresh" (empty job), "hasContent", or "disposed"
  var phase: str
  /// total processGCode calls since construction (spec bookkeeping)
  var processedCount: int
  /// paths in the current job: the fixed snippet yields one extrusion path on
  /// the first process of a job epoch, one travel path on the second, and
  /// extends that travel path afterwards, so this is capped at 2 until
  /// clear() swaps in an empty job
  var pathCount: int
  /// how many scene-manager/renderer generations have been created so far:
  /// 1 from construction, +1 each time an action touches the rendering side
  /// while disposed (lazy resurrection)
  var managerGen: int

  pure val Phases: Set[str] = Set("fresh", "hasContent", "disposed")
  pure val Cmds: Set[str] = Set("init", "process", "clear", "render", "resize", "dispose", "stutter")

  /// Record which action this step takes; a lifecycle call never throws
  action recordCmd(c: str): bool = all {
    cmd' = c,
    outcome' = "ok"
  }

  /// Touching the rendering side while disposed builds a fresh scene manager
  /// (lazy resurrection)
  val nextGen: int = if (phase == "disposed") managerGen + 1 else managerGen

  // --- one action per public lifecycle call ---

  /// processGCode(snippet) — parse + execute into the retained job, then an
  /// animated re-render; resurrects the manager when disposed.
  /// The job gains an extrusion path on the epoch's first call, a travel
  /// path on the second (absolute E leaves nothing to extrude on the same
  /// move), and extends that travel path from the third on: capped at 2.
  action doProcess = all {
    recordCmd("process"),
    processedCount' = processedCount + 1,
    pathCount' = if (pathCount < 2) pathCount + 1 else pathCount,
    managerGen' = nextGen,
    phase' = "hasContent"
  }

  /// clear() — fresh parse state and an empty job; touches the rendering
  /// side (clear + re-render), so it resurrects when disposed. Idempotent.
  action doClear = all {
    recordCmd("clear"),
    processedCount' = processedCount,
    pathCount' = 0,
    managerGen' = nextGen,
    phase' = "fresh"
  }

  /// Phase after an action that touches the rendering side without changing
  /// the job: leaving "disposed" lands on whatever the retained job implies
  val touchedPhase: str =
    if (phase == "disposed") (if (pathCount > 0) "hasContent" else "fresh") else phase

  /// render() — full scene rebuild; no job change
  action doRender = all {
    recordCmd("render"),
    processedCount' = processedCount,
    pathCount' = pathCount,
    managerGen' = nextGen,
    phase' = touchedPhase
  }

  /// resize() — camera/renderer resize; no job change
  action doResize = all {
    recordCmd("resize"),
    processedCount' = processedCount,
    pathCount' = pathCount,
    managerGen' = nextGen,
    phase' = touchedPhase
  }

  /// dispose() — tears down the scene manager; the job survives.
  /// A second dispose is a no-op (disposing while already disposed touches
  /// nothing), so it never resurrects anything.
  action doDispose = all {
    recordCmd("dispose"),
    processedCount' = processedCount,
    pathCount' = pathCount,
    managerGen' = managerGen,
    phase' = "disposed"
  }

  /// Explicit stutter so `step` is always enabled; the replay harness skips
  /// these steps without feeding any input to the preview
  action doStutter = all {
    recordCmd("stutter"),
    processedCount' = processedCount,
    pathCount' = pathCount,
    managerGen' = managerGen,
    phase' = phase
  }

  // --- init and step ---

  /// new GCodePreview(opts) — parser, job and scene manager all exist
  /// eagerly from the start
  action init = all {
    cmd' = "init",
    outcome' = "ok",
    phase' = "fresh",
    processedCount' = 0,
    pathCount' = 0,
    managerGen' = 1
  }

  /// Weighted pick: processing and disposal dominate so traces exercise
  /// content growth and the resurrect-after-dispose paths heavily.
  action step = {
    nondet choice = 1.to(10).oneOf()
    if (choice <= 3) doProcess
    else if (choice <= 5) doDispose
    else if (choice <= 7) doClear
    else if (choice == 8) doRender
    else if (choice == 9) doResize
    else doStutter
  }

  // --- invariants ---

  val cmdWellFormed = Cmds.contains(cmd)

  val phaseWellFormed = Phases.contains(phase)

  /// pinned behavior: no lifecycle call ever throws
  val neverThrows = outcome == "ok"

  /// fresh means an empty job; hasContent means a non-empty one
  val phaseMatchesContent = and {
    phase == "fresh" implies pathCount == 0,
    phase == "hasContent" implies pathCount > 0
  }

  /// disposed is NOT absorbing: only dispose itself (or a stutter) can leave
  /// the automaton disposed — every other action resurrects the manager
  val disposedOnlyAfterDispose = phase == "disposed" implies (cmd == "dispose" or cmd == "stutter")

  val countersSane = and {
    managerGen >= 1,
    processedCount >= 0,
    pathCount >= 0,
    // the fixed snippet never grows a job epoch past extrusion + travel
    pathCount <= 2,
    pathCount <= processedCount
  }

  val allInvariants = and {
    cmdWellFormed,
    phaseWellFormed,
    neverThrows,
    phaseMatchesContent,
    disposedOnlyAfterDispose,
    countersSane
  }

  // --- semantic tests (run with: npx quint test verification/quint/lifecycle.qnt) ---

  /// dispose is idempotent and never resurrects: the second dispose is a
  /// no-op, and the retained job keeps its paths across both
  run disposeIdempotencyTest =
    init
      .then(doProcess)
      .expect(phase == "hasContent" and pathCount == 1 and managerGen == 1)
      .then(doDispose)
      .expect(phase == "disposed" and pathCount == 1 and managerGen == 1)
      .then(doDispose)
      .expect(phase == "disposed" and pathCount == 1 and managerGen == 1 and outcome == "ok")

  /// clear replaces the job wholesale; processing afterwards grows content
  /// from scratch while the total processed count keeps counting. A third
  /// process of the same snippet extends the travel path: the count caps at 2.
  run clearThenProcessTest =
    init
      .then(doProcess)
      .then(doProcess)
      .expect(phase == "hasContent" and pathCount == 2 and processedCount == 2)
      .then(doProcess)
      .expect(phase == "hasContent" and pathCount == 2 and processedCount == 3)
      .then(doClear)
      .expect(phase == "fresh" and pathCount == 0 and processedCount == 3)
      .then(doProcess)
      .expect(phase == "hasContent" and pathCount == 1 and processedCount == 4)

  /// render works in every phase; after dispose it resurrects the manager,
  /// and the retained content makes the preview hasContent again
  run renderInEachPhaseTest =
    init
      .then(doRender)
      .expect(phase == "fresh" and managerGen == 1 and outcome == "ok")
      .then(doProcess)
      .then(doRender)
      .expect(phase == "hasContent" and managerGen == 1)
      .then(doDispose)
      .then(doRender)
      .expect(phase == "hasContent" and pathCount == 1 and managerGen == 2 and outcome == "ok")

  /// clear twice is a no-op the second time; clear on a disposed preview
  /// resurrects the manager and lands back in fresh
  run clearIdempotencyTest =
    init
      .then(doProcess)
      .then(doClear)
      .expect(phase == "fresh" and pathCount == 0 and managerGen == 1)
      .then(doClear)
      .expect(phase == "fresh" and pathCount == 0 and managerGen == 1 and outcome == "ok")
      .then(doDispose)
      .then(doClear)
      .expect(phase == "fresh" and pathCount == 0 and managerGen == 2)

  /// the job survives dispose(); processing while disposed resurrects the
  /// manager and keeps appending to the retained job
  run processAfterDisposeTest =
    init
      .then(doProcess)
      .then(doDispose)
      .expect(phase == "disposed" and pathCount == 1)
      .then(doProcess)
      .expect(phase == "hasContent" and pathCount == 2 and processedCount == 2 and managerGen == 2)

  /// resize works in every phase; on a disposed empty preview it resurrects
  /// into fresh, on a disposed non-empty one into hasContent; stutter changes
  /// nothing
  run resizeAfterDisposeTest =
    init
      .then(doResize)
      .expect(phase == "fresh" and managerGen == 1)
      .then(doDispose)
      .then(doResize)
      .expect(phase == "fresh" and managerGen == 2 and outcome == "ok")
      .then(doProcess)
      .then(doDispose)
      .then(doResize)
      .expect(phase == "hasContent" and pathCount == 1 and managerGen == 3)
      .then(doStutter)
      .expect(phase == "hasContent" and pathCount == 1 and managerGen == 3 and cmd == "stutter")
}
