// -*- mode: Bluespec; -*-
/**
 * lifecycle — the public-API lifecycle automaton of the preview facade:
 * process, clear, render, resize and dispose as pinned observable behavior.
 * The central pinned fact: dispose() tears down only the
 * rendering side, the job is retained, and the next call that touches
 * rendering lazily resurrects a fresh scene-manager generation — so the
 * disposed phase is NOT absorbing. "process" draws from a three-snippet
 * menu with declared path-growth deltas, carried in the trace so the
 * replay knows what was fed, and the oracle goes beyond ok/throws + path
 * length to per-step renderer observables: cumulative render and setSize
 * call counts, a
 * renderer-dispose ledger, and the kind of the job's last path. All counts
 * assume the replay harness's inert requestAnimationFrame: the continuous
 * presentation loop contributes exactly its first, synchronous frame per
 * scene-manager generation, and no asynchronous frame ever fires.
 *
 * The no-throw contract ("no lifecycle call ever throws") is deliberately
 * not an in-model invariant — inside the model it could never fail. The
 * replay asserts it on every step instead, including asynchronous
 * rejections of the animated-render promise.
 *
 * Unit: RL-1 (lifecycle automaton + resource-ownership ledger: dispose
 *   idempotence, disposed-to-live resurrection, renderer disposed exactly
 *   once per retired generation) in
 *   .context/formal-verification/mapping-data.json.
 * Authority policy: verification/quint/STYLE.md ("Authority
 *   annotations"); every transition below carries its own block. The
 *   lifecycle itself is host-library machinery, so almost everything here
 *   is library-invented; only the snippet classifications lean on firmware
 *   semantics.
 * Companion: lifecycle.md.
 */
module lifecycle {
  // --- sum types --------------------------------------------------------

  /// The observable phase: an empty live preview, a live preview whose job
  /// holds paths, or a preview whose scene manager has been torn down.
  type Phase = Fresh | HasContent | Disposed

  /// The kind of the job's most recent path (its `travelType` on the
  /// implementation side), or PNone for an empty job.
  type PathKind = PNone | PExtrusion | PTravel

  /// The process-snippet menu. Each snippet has a declared, state-dependent
  /// path-growth delta the replay can bank on:
  ///   Extruding  — "G92 E0" + "G1 X10 Y10 E1": the E reset makes the move
  ///                extrude on every feed, so it opens an extrusion path
  ///                when the last path is not one, and extends it otherwise.
  ///   TravelOnly — "G0 X5 Y5": a travel move; opens a travel path when the
  ///                last path is not one, and extends it otherwise.
  ///   EmptyInput — a bare comment line: parses to no command, grows nothing.
  type Snippet = Extruding | TravelOnly | EmptyInput

  /// One public lifecycle call (plus init for construction).
  type ActKind = AInit | AProcess(Snippet) | AClear | ARender | AResize | ADispose

  // --- strings for the trace contract, derived in one place each ---------

  pure def kindStr(k: ActKind): str = match k {
    | AInit => "init"
    | AProcess(_) => "process"
    | AClear => "clear"
    | ARender => "render"
    | AResize => "resize"
    | ADispose => "dispose"
  }

  pure def snippetStr(k: ActKind): str = match k {
    | AProcess(sn) => match sn {
        | Extruding => "extruding"
        | TravelOnly => "travelOnly"
        | EmptyInput => "empty"
      }
    | _ => ""
  }

  pure def phaseStr(p: Phase): str = match p {
    | Fresh => "fresh"
    | HasContent => "hasContent"
    | Disposed => "disposed"
  }

  pure def pathKindStr(pk: PathKind): str = match pk {
    | PNone => "none"
    | PExtrusion => "Extrusion"
    | PTravel => "Travel"
  }

  // --- state ------------------------------------------------------------

  /// The previous step's values, frozen by every transition. Ghost state for
  /// the monotonicity / frame invariants only; the replay never decodes it.
  type PrevGhost = {
    gen: int,
    paths: int,
    renders: int,
    setSizes: int,
    wasDisposed: bool
  }

  /// The semantic state. The first block is what the replay compares; the
  /// ghost* block exists for property expression only (see the companion):
  /// independent per-action counters make the render/setSize conservation
  /// equations checkable, and the ghostJust* flags turn the "disposed only
  /// right after dispose" and "only clear shrinks the job" temporal claims
  /// into invariants.
  type SpecState = {
    phase: Phase,
    processed: int, // total process calls since construction
    pathCount: int, // finished paths in the retained job
    lastPath: PathKind, // kind of the job's last path
    managerGen: int, // scene-manager generations created so far
    renders: int, // cumulative renderer.render calls, all generations
    setSizes: int, // cumulative renderer.setSize calls, all generations
    rendererDisposes: int, // cumulative renderer.dispose calls
    ghostClears: int, // clear actions taken
    ghostRenderActs: int, // render actions taken
    ghostResizes: int, // resize actions taken
    ghostBusyProcesses: int, // process actions that ended with pathCount > 1
    ghostJustDisposed: bool, // this step was a dispose
    ghostJustCleared: bool, // this step was a clear
    ghostPrev: PrevGhost
  }

  /// The trace contract: plain strings and bools describing the step, so a
  /// trace doubles as a call script. The integers the replay compares live
  /// directly in `s`; `phase` and `lastPath` are mirrored here as strings
  /// because their sum-type forms are model-internal.
  type Event = {
    kind: str, // kindStr of the action
    snippet: str, // snippetStr: which G-code the replay must feed ("" unless process)
    phase: str, // phaseStr of the resulting phase
    lastPath: str, // pathKindStr of the resulting last path
    resurrected: bool // this step rebuilt the scene manager from disposed
  }

  var s: SpecState
  var ev: Event

  // --- pure transitions ---------------------------------------------------

  /// Any call that touches the rendering side while disposed rebuilds the
  /// scene manager: one fresh generation, whose construction performs one
  /// synchronous presentation frame (render) and one initial resize (setSize).
  pure def resurrects(st: SpecState): bool = st.phase == Disposed

  pure def freezePrev(st: SpecState): PrevGhost = {
    gen: st.managerGen,
    paths: st.pathCount,
    renders: st.renders,
    setSizes: st.setSizes,
    wasDisposed: st.phase == Disposed
  }

  /**
   * processGCode(snippet) — parse and execute into the retained job, then
   * start an animated render; resurrects the manager when disposed. The
   * animated render performs one synchronous frame only when the job holds
   * more than one path (a 0-or-1-path job is drawn without an extra
   * renderer.render call); with the harness's inert requestAnimationFrame
   * its later frames never fire and its promise stays pending, which the
   * replay treats as pinned.
   *
   * Authority: Marlin documentation for the snippet semantics the deltas
   * lean on — G92 E sets the extruder position directly and absolute-E
   * extrusion is classified from the applied delta, which is what makes
   * Extruding re-extrude on every feed and TravelOnly always lay travel.
   * Library stance: conforms for that classification; library-invented for
   * everything else (lazy resurrection, render cadence, path continuation
   * across calls).
   * Exclusions: streaming entry points (processGCodeStream/readStream),
   * onJobUpdated/onStreamEnd callbacks, snippets beyond the three-item
   * menu, dimension/tool-driven path breaks (the menu never changes
   * widths, heights or tools).
   */
  pure def applyProcess(st: SpecState, sn: Snippet): SpecState = {
    val r = if (resurrects(st)) 1 else 0
    val delta = match sn {
      | Extruding => if (st.lastPath == PExtrusion) 0 else 1
      | TravelOnly => if (st.lastPath == PTravel) 0 else 1
      | EmptyInput => 0
    }
    val newPaths = st.pathCount + delta
    val busy = if (newPaths > 1) 1 else 0
    {
      ...st,
      phase: if (newPaths > 0) HasContent else Fresh,
      processed: st.processed + 1,
      pathCount: newPaths,
      lastPath: match sn {
        | Extruding => PExtrusion
        | TravelOnly => PTravel
        | EmptyInput => st.lastPath
      },
      managerGen: st.managerGen + r,
      renders: st.renders + r + busy,
      setSizes: st.setSizes + r,
      ghostBusyProcesses: st.ghostBusyProcesses + busy,
      ghostJustDisposed: false,
      ghostJustCleared: false,
      ghostPrev: freezePrev(st)
    }
  }

  /**
   * clear() — fresh parser and an empty job; touches the rendering side
   * (scene clear + one explicit re-render), so it resurrects when disposed.
   * The only call that replaces the job.
   *
   * Authority: none — host-library machinery.
   * Library stance: library-invented — pins that clear keeps the renderer,
   * camera and controls of the current generation (no generation bump when
   * live) while swapping the job and objects wholesale.
   * Exclusions: the ~11 hand-copied display settings clear() preserves
   * (colors, tube mode, lights); the model carries no display settings.
   */
  pure def applyClear(st: SpecState): SpecState = {
    val r = if (resurrects(st)) 1 else 0
    {
      ...st,
      phase: Fresh,
      pathCount: 0,
      lastPath: PNone,
      managerGen: st.managerGen + r,
      renders: st.renders + r + 1,
      setSizes: st.setSizes + r,
      ghostClears: st.ghostClears + 1,
      ghostJustDisposed: false,
      ghostJustCleared: true,
      ghostPrev: freezePrev(st)
    }
  }

  /// Phase after a job-neutral rendering touch: leaving disposed lands on
  /// whatever the retained job implies.
  pure def touchedPhase(st: SpecState): Phase =
    if (st.phase == Disposed) (if (st.pathCount > 0) HasContent else Fresh) else st.phase

  /**
   * sceneManager.render() — full scene rebuild plus one explicit
   * renderer.render call; no job change.
   *
   * Authority: none — host-library machinery.
   * Library stance: library-invented — pins that render() reaches the
   * renderer exactly once per call on top of the construction frame.
   * Exclusions: scene contents (what the rebuild draws) and camera state;
   * the model sees only the call counts.
   */
  pure def applyRender(st: SpecState): SpecState = {
    val r = if (resurrects(st)) 1 else 0
    {
      ...st,
      phase: touchedPhase(st),
      managerGen: st.managerGen + r,
      renders: st.renders + r + 1,
      setSizes: st.setSizes + r,
      ghostRenderActs: st.ghostRenderActs + 1,
      ghostJustDisposed: false,
      ghostJustCleared: false,
      ghostPrev: freezePrev(st)
    }
  }

  /**
   * sceneManager.resize() — camera frustum update plus one
   * renderer.setSize call; no render call of its own, no job change.
   *
   * Authority: none — host-library machinery.
   * Library stance: library-invented — pins that resize() does not render
   * (the continuous loop, inert here, presents the resized frame).
   * Exclusions: setPixelRatio (called alongside setSize but not counted),
   * canvas dimensions and camera projection values.
   */
  pure def applyResize(st: SpecState): SpecState = {
    val r = if (resurrects(st)) 1 else 0
    {
      ...st,
      phase: touchedPhase(st),
      managerGen: st.managerGen + r,
      renders: st.renders + r,
      setSizes: st.setSizes + r + 1,
      ghostResizes: st.ghostResizes + 1,
      ghostJustDisposed: false,
      ghostJustCleared: false,
      ghostPrev: freezePrev(st)
    }
  }

  /**
   * dispose() — tears down the current scene manager, disposing its
   * renderer exactly once; the job survives. Disposing while already
   * disposed touches nothing (idempotent), so it never resurrects and
   * never double-disposes a renderer.
   *
   * Authority: none — host-library machinery.
   * Library stance: library-invented — pins the resurrection design:
   * dispose nulls the manager reference and the lazy getter rebuilds one,
   * so disposed is exit-able by every other lifecycle call.
   * Exclusions: the wider Disposable ledger (controls, objects manager,
   * geometries); the model tracks the renderer's dispose calls only.
   */
  pure def applyDispose(st: SpecState): SpecState = {
    ...st,
    phase: Disposed,
    rendererDisposes: st.rendererDisposes + (if (st.phase == Disposed) 0 else 1),
    ghostJustDisposed: true,
    ghostJustCleared: false,
    ghostPrev: freezePrev(st)
  }

  /// The one transition dispatcher: every action is pure state-to-state.
  pure def nextState(st: SpecState, k: ActKind): SpecState = match k {
    | AInit => st // unreachable from step; init builds its state directly
    | AProcess(sn) => applyProcess(st, sn)
    | AClear => applyClear(st)
    | ARender => applyRender(st)
    | AResize => applyResize(st)
    | ADispose => applyDispose(st)
  }

  pure def mkEvent(k: ActKind, after: SpecState): Event = {
    kind: kindStr(k),
    snippet: snippetStr(k),
    phase: phaseStr(after.phase),
    lastPath: pathKindStr(after.lastPath),
    resurrected: after.managerGen > after.ghostPrev.gen
  }

  // --- init and step ------------------------------------------------------

  pure val INIT_STATE: SpecState = {
    phase: Fresh,
    processed: 0,
    pathCount: 0,
    lastPath: PNone,
    managerGen: 1,
    renders: 1, // the construction frame of the initial generation
    setSizes: 1, // the construction resize of the initial generation
    rendererDisposes: 0,
    ghostClears: 0,
    ghostRenderActs: 0,
    ghostResizes: 0,
    ghostBusyProcesses: 0,
    ghostJustDisposed: false,
    ghostJustCleared: false,
    ghostPrev: { gen: 1, paths: 0, renders: 1, setSizes: 1, wasDisposed: false }
  }

  /**
   * new GCodePreview(opts) — parser, job and the first scene-manager
   * generation all exist eagerly; construction performs one synchronous
   * presentation frame and one resize.
   *
   * Authority: none — model scaffolding.
   * Library stance: library-invented — mirrors the eager constructor.
   * Exclusions: constructor options (droppable, colors, build volume);
   * the replay constructs with one fixed options record.
   */
  action init = all {
    s' = INIT_STATE,
    ev' = {
      kind: "init",
      snippet: "",
      phase: phaseStr(Fresh),
      lastPath: pathKindStr(PNone),
      resurrected: false
    }
  }

  action dispatch(k: ActKind): bool = all {
    s' = nextState(s, k),
    ev' = mkEvent(k, nextState(s, k))
  }

  /// Weights live in data: process dominates (extruding doubled, so both
  /// continue-same-kind and open-new-kind deltas recur), dispose is heavy so
  /// disposed-phase steps — and with them every dispose-then-X resurrection
  /// pair — are common rather than rare. See the companion's coverage table.
  pure val STEP_MENU: List[ActKind] = [
    AProcess(Extruding),
    AProcess(Extruding),
    AProcess(TravelOnly),
    AProcess(EmptyInput),
    ADispose,
    ADispose,
    ADispose,
    AClear,
    ARender,
    AResize
  ]

  /// Always enabled (every lifecycle call is total), so there is no stutter.
  action step = {
    nondet k = STEP_MENU.indices().oneOf()
    dispatch(STEP_MENU[k])
  }

  // --- invariants (over semantic state only; none mention `ev`) -----------

  /// fresh means an empty job; hasContent means a non-empty one
  val phaseMatchesContent = and {
    s.phase == Fresh implies s.pathCount == 0,
    s.phase == HasContent implies s.pathCount > 0
  }

  /// the job is empty exactly when it has no last path
  val emptyIffNoLastPath = (s.pathCount == 0) == (s.lastPath == PNone)

  /// disposed is NOT absorbing, as a checked equivalence: the machine sits
  /// in Disposed exactly when the step just taken was a dispose
  val disposedExactlyAfterDispose = (s.phase == Disposed) == s.ghostJustDisposed

  /// render-call conservation: every renderer.render is one construction
  /// frame (per generation), one explicit render(), one clear() re-render,
  /// or one animated-render first frame of a process that left > 1 path
  val renderConservation =
    s.renders == s.managerGen + s.ghostClears + s.ghostRenderActs + s.ghostBusyProcesses

  /// setSize conservation: one per generation construction plus one per
  /// resize action
  val setSizeConservation = s.setSizes == s.managerGen + s.ghostResizes

  /// every retired generation's renderer was disposed exactly once, and the
  /// live generation's renderer not yet
  val rendererDisposeLedger =
    s.rendererDisposes == (if (s.phase == Disposed) s.managerGen else s.managerGen - 1)

  /// generations only ever grow, at most one per step
  val genMonotone = and {
    s.ghostPrev.gen <= s.managerGen,
    s.managerGen <= s.ghostPrev.gen + 1
  }

  /// a generation is created exactly by leaving the disposed phase
  val resurrectionExactlyFromDisposed = and {
    s.managerGen == s.ghostPrev.gen + 1 implies s.ghostPrev.wasDisposed,
    (s.ghostPrev.wasDisposed and s.phase != Disposed) implies s.managerGen == s.ghostPrev.gen + 1
  }

  /// the job survives dispose() untouched
  val disposeRetainsJob = s.ghostJustDisposed implies s.pathCount == s.ghostPrev.paths

  /// only clear() ever shrinks the job
  val onlyClearShrinksJob = s.pathCount < s.ghostPrev.paths implies s.ghostJustCleared

  /// the renderer observables never decrease, and never jump by more than a
  /// resurrection plus one call
  val observablesMonotone = and {
    s.renders >= s.ghostPrev.renders,
    s.renders <= s.ghostPrev.renders + 2,
    s.setSizes >= s.ghostPrev.setSizes,
    s.setSizes <= s.ghostPrev.setSizes + 2
  }

  val countersSane = and {
    s.managerGen >= 1,
    s.processed >= 0,
    s.pathCount >= 0,
    // each process call grows the job by at most one path
    s.pathCount <= s.processed
  }

  val allInvariants = and {
    phaseMatchesContent,
    emptyIffNoLastPath,
    disposedExactlyAfterDispose,
    renderConservation,
    setSizeConservation,
    rendererDisposeLedger,
    genMonotone,
    resurrectionExactlyFromDisposed,
    disposeRetainsJob,
    onlyClearShrinksJob,
    observablesMonotone,
    countersSane
  }

  // --- semantic tests (run with:
  // ---   npx quint test verification/quint/lifecycle.qnt) ---

  /// The snippet menu drives path growth by last-path kind, not by a call
  /// cap: extruding twice extends one extrusion path, travel opens a second
  /// path (and the animated render starts billing one frame per process),
  /// extruding again opens a third, and an empty snippet grows nothing but
  /// still re-renders the now-multi-path job
  run snippetMenuTest =
    init
      .expect(s.renders == 1 and s.setSizes == 1 and s.managerGen == 1)
      .then(dispatch(AProcess(Extruding)))
      .expect(s.pathCount == 1 and s.lastPath == PExtrusion and s.renders == 1)
      .then(dispatch(AProcess(Extruding)))
      .expect(s.pathCount == 1 and s.renders == 1 and s.processed == 2)
      .then(dispatch(AProcess(TravelOnly)))
      .expect(s.pathCount == 2 and s.lastPath == PTravel and s.renders == 2)
      .then(dispatch(AProcess(TravelOnly)))
      .expect(s.pathCount == 2 and s.renders == 3)
      .then(dispatch(AProcess(Extruding)))
      .expect(s.pathCount == 3 and s.lastPath == PExtrusion and s.renders == 4)
      .then(dispatch(AProcess(EmptyInput)))
      .expect(and {
        s.pathCount == 3,
        s.lastPath == PExtrusion,
        s.renders == 5,
        s.processed == 6,
        ev.snippet == "empty"
      })

  /// dispose is idempotent: the second dispose changes nothing, disposes no
  /// renderer twice, and the retained job keeps its paths across both
  run disposeIdempotencyTest =
    init
      .then(dispatch(AProcess(Extruding)))
      .expect(s.phase == HasContent and s.pathCount == 1 and s.rendererDisposes == 0)
      .then(dispatch(ADispose))
      .expect(s.phase == Disposed and s.pathCount == 1 and s.managerGen == 1 and s.rendererDisposes == 1)
      .then(dispatch(ADispose))
      .expect(and {
        s.phase == Disposed,
        s.pathCount == 1,
        s.managerGen == 1,
        s.rendererDisposes == 1,
        ev.resurrected == false
      })

  /// every dispose-then-X pair resurrects with its own observable bill:
  /// process adds a construction frame plus the multi-path animated frame,
  /// render adds a construction frame plus its explicit one, resize adds a
  /// construction setSize plus its own, clear adds a construction frame
  /// plus its re-render and empties the job
  run resurrectionPairsTest =
    init
      .then(dispatch(AProcess(Extruding)))
      .then(dispatch(AProcess(TravelOnly)))
      .expect(s.pathCount == 2 and s.renders == 2 and s.setSizes == 1)
      .then(dispatch(ADispose))
      .then(dispatch(AProcess(Extruding)))
      .expect(and {
        ev.resurrected == true,
        s.phase == HasContent,
        s.pathCount == 3,
        s.managerGen == 2,
        s.renders == 4, // +1 construction frame, +1 animated frame
        s.setSizes == 2,
        s.rendererDisposes == 1
      })
      .then(dispatch(ADispose))
      .then(dispatch(ARender))
      .expect(and {
        ev.resurrected == true,
        s.phase == HasContent,
        s.managerGen == 3,
        s.renders == 6, // +1 construction frame, +1 explicit render
        s.setSizes == 3,
        s.rendererDisposes == 2
      })
      .then(dispatch(ADispose))
      .then(dispatch(AResize))
      .expect(and {
        ev.resurrected == true,
        s.managerGen == 4,
        s.renders == 7, // construction frame only
        s.setSizes == 5, // +1 construction resize, +1 explicit resize
        s.rendererDisposes == 3
      })
      .then(dispatch(ADispose))
      .then(dispatch(AClear))
      .expect(and {
        ev.resurrected == true,
        s.phase == Fresh,
        s.pathCount == 0,
        s.lastPath == PNone,
        s.managerGen == 5,
        s.renders == 9, // +1 construction frame, +1 clear re-render
        s.setSizes == 6,
        s.rendererDisposes == 4
      })

  /// an empty snippet on a fresh job keeps the preview fresh (phase follows
  /// content, not the fact that process was called) and draws nothing extra;
  /// the first real path of the epoch is billed without an animated frame
  run emptyFirstKeepsFreshTest =
    init
      .then(dispatch(AProcess(EmptyInput)))
      .expect(and {
        s.phase == Fresh,
        s.pathCount == 0,
        s.lastPath == PNone,
        s.processed == 1,
        s.renders == 1
      })
      .then(dispatch(AProcess(TravelOnly)))
      .expect(s.phase == HasContent and s.pathCount == 1 and s.lastPath == PTravel and s.renders == 1)

  /// clear replaces the job wholesale while the total processed count keeps
  /// counting; each clear costs one explicit re-render even when the job is
  /// already empty, and a job-neutral render/resize after it stays fresh
  run clearEpochTest =
    init
      .then(dispatch(AProcess(Extruding)))
      .then(dispatch(AProcess(TravelOnly)))
      .expect(s.pathCount == 2 and s.processed == 2)
      .then(dispatch(AClear))
      .expect(s.phase == Fresh and s.pathCount == 0 and s.processed == 2 and s.renders == 3)
      .then(dispatch(AClear))
      .expect(s.phase == Fresh and s.pathCount == 0 and s.renders == 4 and s.managerGen == 1)
      .then(dispatch(ARender))
      .expect(s.phase == Fresh and s.renders == 5)
      .then(dispatch(AResize))
      .expect(s.phase == Fresh and s.setSizes == 2 and s.renders == 5)
      .then(dispatch(AProcess(Extruding)))
      .expect(s.phase == HasContent and s.pathCount == 1 and s.processed == 3)
}
