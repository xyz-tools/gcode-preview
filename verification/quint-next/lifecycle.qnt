// -*- mode: Bluespec; -*-
/**
 * lifecycle_next — the NORMATIVE from-scratch design of the GCodePreview
 * public-API lifecycle: construct, process, clear, render, resize, dispose.
 *
 * This is a design artifact, not a pin of current behavior. Its central
 * design decisions, made true by construction and checked as invariants:
 *
 *   - `Disposed` is ABSORBING. dispose() releases every resource exactly
 *     once; a second dispose() is a documented no-op; any OTHER call on a
 *     disposed preview throws `GCodePreviewDisposedError` and mutates
 *     nothing (strong exception guarantee).
 *   - The state carries an explicit resource LEDGER: alloc/released
 *     counters for renderers, scene managers and geometry batches, with
 *     conservation (live = alloc - released >= 0), singleton renderer
 *     (at most one live, and exactly one EVER allocated — no lazy
 *     resurrection exists in the design), and `Disposed implies zero live
 *     resources` as invariants.
 *   - render() and resize() NEVER allocate; process() is the only
 *     geometry allocator; clear() and dispose() are the only releasers.
 *     Idempotency of clear and dispose are invariants over ghost history
 *     (`ghostPre` pre-step snapshot), not just run tests.
 *
 * Temporal-claim audit (STYLE.md rule: checked or OPEN):
 *   - "disposed is absorbing"            — checked: disposedAbsorbing.
 *   - "released at most once, only by
 *     clear/dispose"                     — checked: ledgersConserve,
 *                                          countersMonotone,
 *                                          releaseOnlyByClearOrDispose.
 *   - "every allocation is eventually
 *     released"                          — OPEN: needs fairness (an
 *                                          eventual dispose), which the
 *                                          simulator does not force; the
 *                                          checked approximation is
 *                                          "every allocation is released
 *                                          or still live" (ledgersConserve)
 *                                          plus "dispose releases all"
 *                                          (disposedReleasesAll).
 *
 * Unit: re-design of RL-1 (lifecycle automaton + resource-ownership
 *   ledger) and RL-4 (clear() contract) from
 *   .context/formal-verification/mapping-data.json — reinterpreted
 *   normatively, not pinned to the implementation.
 * Authority policy: verification/quint/STYLE.md ("Authority
 *   annotations"), adapted for a normative bank: no firmware document
 *   governs a host library's object lifecycle, so Authority cites API
 *   conventions (TC39 Explicit Resource Management, .NET IDisposable) or
 *   a charter principle, and Library stance distinguishes `conforms`
 *   (matches the current implementation) from `designed-divergence`
 *   (differs on purpose; see the companion's Divergence ledger).
 * Companion: lifecycle.md.
 *
 * NO REPLAY BINDING, by design (charter P6): the current implementation
 * resurrects after dispose and never throws, so traces of this machine
 * would fail against it. Internal consistency (parse, test, run) is the
 * gate.
 */
module lifecycle_next {
  // --- sum types: phases, operations, outcomes, step labels -------------

  /// Observable phase of the preview. `Disposed` is terminal.
  type Phase = Fresh | HasContent | Disposed

  /// The five public lifecycle calls after construction.
  type Op = Process | Clear | Render | Resize | Dispose

  /// Designed outcome of a call: normal return, or a thrown
  /// GCodePreviewDisposedError (the only designed lifecycle error).
  type Outcome = Accepted | RejectedDisposed

  /// What the last step was (init or one of the five calls) — ghost
  /// history inside `s` so idempotency laws are invariants, not only runs.
  type StepLabel = LInit | LProcess | LClear | LRender | LResize | LDispose

  pure def labelOf(op: Op): StepLabel = match op {
    | Process => LProcess
    | Clear => LClear
    | Render => LRender
    | Resize => LResize
    | Dispose => LDispose
  }

  // `ev` carries only plain values; strings are derived here, in one place.
  pure def labelStr(l: StepLabel): str = match l {
    | LInit => "init"
    | LProcess => "process"
    | LClear => "clear"
    | LRender => "render"
    | LResize => "resize"
    | LDispose => "dispose"
  }

  /// The designed error name, part of the public contract.
  pure val DISPOSED_ERROR = "GCodePreviewDisposedError"

  pure def outcomeStr(o: Outcome): str = match o {
    | Accepted => "ok"
    | RejectedDisposed => "throws"
  }

  pure def errorStr(o: Outcome): str = match o {
    | Accepted => ""
    | RejectedDisposed => DISPOSED_ERROR
  }

  // --- the resource ledger ----------------------------------------------

  /// One resource class: how many were ever allocated and ever released.
  /// Live instances are the difference — a definition, so conservation
  /// ("every allocation is released or still live") holds by construction
  /// and the invariants police the bounds and who may move each counter.
  type Ledger = { alloc: int, released: int }

  pure def live(l: Ledger): int = l.alloc - l.released

  /// Release every live instance of a class (dispose, and clear for
  /// geometries). Releasing an already-empty class is a no-op.
  pure def releaseAll(l: Ledger): Ledger = { alloc: l.alloc, released: l.alloc }

  // --- state and event records -------------------------------------------

  /// Pre-step snapshot of every observable, kept as ghost state so laws
  /// like "render never allocates" and "a throwing call mutates nothing"
  /// are single-state invariants.
  type Snap = {
    disposed: bool,
    paths: int,
    geom: Ledger,
    rend: Ledger,
    sm: Ledger,
    renders: int,
    processed: int
  }

  type SpecState = {
    phase: Phase,
    paths: int, // paths in the current job (one per accepted process call)
    geom: Ledger, // geometry batches (allocated by process ONLY)
    rend: Ledger, // WebGL renderers (exactly one, ever)
    sm: Ledger, // scene managers (exactly one, ever)
    renders: int, // accepted render() calls (bookkeeping for purity laws)
    processed: int, // accepted process() calls
    ghostEverDisposed: bool, // ghost: dispose() has been called at least once
    ghostLast: StepLabel, // ghost: what the last step was
    ghostPre: Snap // ghost: all observables before the last step
  }

  /// Trace contract: plain values only.
  type Event = {
    kind: str, // labelStr of the step taken
    outcome: str, // "ok" or "throws"
    error: str // "" or DISPOSED_ERROR
  }

  var s: SpecState
  var ev: Event

  pure def snap(st: SpecState): Snap = {
    disposed: st.phase == Disposed,
    paths: st.paths,
    geom: st.geom,
    rend: st.rend,
    sm: st.sm,
    renders: st.renders,
    processed: st.processed
  }

  type StepResult = { post: SpecState, out: Outcome }

  /**
   * The single pure transition for all five public calls.
   *
   * Per-operation contracts (each block follows the Authority-annotation
   * format; `designed-divergence` rows are detailed in the companion's
   * Divergence ledger):
   *
   * Process — parse + execute into the job AND build the geometry batch
   * eagerly, so render stays allocation-free. Adds exactly one path and
   * one geometry.
   *   Authority: none (host-library API); charter P2/P3.
   *   Library stance: designed-divergence — the current processGCode
   *     resurrects the scene manager when disposed and defers geometry
   *     building to render; here it throws when disposed and is the only
   *     allocator.
   *   Exclusions: parse errors, G-code content (one fixed snippet = one
   *     path), streaming entry points.
   *
   * Clear — release every live geometry, swap in an empty job, land in
   * Fresh. Allocates NOTHING (no re-render rebuild) and is idempotent.
   *   Authority: none; charter P3 (RL-4 re-design).
   *   Library stance: designed-divergence — the current clear() touches
   *     the rendering side (clear + render) and therefore resurrects a
   *     disposed preview; here it is a pure release that throws when
   *     disposed.
   *   Exclusions: option/settings re-application (RL-4's field list).
   *
   * Render — draw the already-built scene. Allocates nothing, releases
   * nothing, changes no job state; only the render counter moves.
   *   Authority: none; charter P2 (a designed performance law).
   *   Library stance: designed-divergence — the current render() does a
   *     full scene rebuild (and resurrects when disposed); here drawing
   *     and building are separated by construction.
   *   Exclusions: animated/progressive variants, frame scheduling.
   *
   * Resize — viewport/camera update; no allocation, no job change.
   *   Authority: none.
   *   Library stance: designed-divergence only in the disposed case
   *     (throws instead of resurrecting); otherwise conforms.
   *   Exclusions: actual dimensions (not modeled).
   *
   * Dispose — release every live resource of every class, exactly once,
   * and make the phase terminal. A second dispose() is a documented no-op.
   *   Authority: TC39 Explicit Resource Management (DisposableStack:
   *     dispose() is idempotent; use() on a disposed stack throws
   *     ReferenceError) and the .NET IDisposable convention (Dispose
   *     callable multiple times; other members throw
   *     ObjectDisposedException). Charter P3.
   *   Library stance: designed-divergence — currently dispose() nulls the
   *     scene manager and ANY later lifecycle call silently builds a
   *     fresh SceneManager and WebGLRenderer via the lazy getter; here
   *     Disposed is absorbing and nothing is ever re-allocated
   *     (rend.alloc == 1 is an invariant).
   *   Exclusions: event-listener/rAF teardown detail, DOM ownership.
   *
   * Any op except Dispose, called while Disposed — throws
   * GCodePreviewDisposedError and mutates nothing (strong exception
   * guarantee; checked by `rejectionIsPure`).
   */
  pure def applyOp(st: SpecState, op: Op): StepResult = {
    val pre = snap(st)
    if (st.phase == Disposed and not(op == Dispose)) {
      // use-after-dispose: throw, mutate nothing but the ghosts
      {
        post: {
          phase: Disposed,
          paths: st.paths,
          geom: st.geom,
          rend: st.rend,
          sm: st.sm,
          renders: st.renders,
          processed: st.processed,
          ghostEverDisposed: st.ghostEverDisposed,
          ghostLast: labelOf(op),
          ghostPre: pre
        },
        out: RejectedDisposed
      }
    } else {
      match op {
        | Process => {
            post: {
              phase: HasContent,
              paths: st.paths + 1,
              geom: { alloc: st.geom.alloc + 1, released: st.geom.released },
              rend: st.rend,
              sm: st.sm,
              renders: st.renders,
              processed: st.processed + 1,
              ghostEverDisposed: st.ghostEverDisposed,
              ghostLast: LProcess,
              ghostPre: pre
            },
            out: Accepted
          }
        | Clear => {
            post: {
              phase: Fresh,
              paths: 0,
              geom: releaseAll(st.geom),
              rend: st.rend,
              sm: st.sm,
              renders: st.renders,
              processed: st.processed,
              ghostEverDisposed: st.ghostEverDisposed,
              ghostLast: LClear,
              ghostPre: pre
            },
            out: Accepted
          }
        | Render => {
            post: {
              phase: st.phase,
              paths: st.paths,
              geom: st.geom,
              rend: st.rend,
              sm: st.sm,
              renders: st.renders + 1,
              processed: st.processed,
              ghostEverDisposed: st.ghostEverDisposed,
              ghostLast: LRender,
              ghostPre: pre
            },
            out: Accepted
          }
        | Resize => {
            post: {
              phase: st.phase,
              paths: st.paths,
              geom: st.geom,
              rend: st.rend,
              sm: st.sm,
              renders: st.renders,
              processed: st.processed,
              ghostEverDisposed: st.ghostEverDisposed,
              ghostLast: LResize,
              ghostPre: pre
            },
            out: Accepted
          }
        | Dispose => {
            post: {
              phase: Disposed,
              paths: 0,
              geom: releaseAll(st.geom),
              rend: releaseAll(st.rend),
              sm: releaseAll(st.sm),
              renders: st.renders,
              processed: st.processed,
              ghostEverDisposed: true,
              ghostLast: LDispose,
              ghostPre: pre
            },
            out: Accepted
          }
      }
    }
  }

  pure def mkEvent(l: StepLabel, out: Outcome): Event = {
    kind: labelStr(l),
    outcome: outcomeStr(out),
    error: errorStr(out)
  }

  // --- init and step -------------------------------------------------------

  /// Pre-snapshot matching the constructed state, so pre-vs-post invariants
  /// hold (as equalities) on the initial state too.
  pure val INIT_SNAP: Snap = {
    disposed: false,
    paths: 0,
    geom: { alloc: 0, released: 0 },
    rend: { alloc: 1, released: 0 },
    sm: { alloc: 1, released: 0 },
    renders: 0,
    processed: 0
  }

  /**
   * new GCodePreview(opts) — the constructor allocates the preview's ONE
   * renderer and ONE scene manager, eagerly. There is no other allocation
   * site for either class in the whole design.
   *
   * Authority: none (host-library API); charter P3.
   * Library stance: conforms — the current constructor also builds the
   *   scene manager (and with it the renderer) eagerly; the divergence is
   *   that here no second one can ever exist.
   * Exclusions: constructor options, canvas acquisition, droppable setup.
   */
  action init = all {
    s' = {
      phase: Fresh,
      paths: 0,
      geom: { alloc: 0, released: 0 },
      rend: { alloc: 1, released: 0 },
      sm: { alloc: 1, released: 0 },
      renders: 0,
      processed: 0,
      ghostEverDisposed: false,
      ghostLast: LInit,
      ghostPre: INIT_SNAP
    },
    ev' = { kind: "init", outcome: "ok", error: "" }
  }

  /// One public call. Always enabled: on a disposed preview the call is
  /// still a step — it throws, and the throw is the modeled outcome. So
  /// `step` needs no stutter.
  action call(op: Op): bool = {
    val r = applyOp(s, op)
    all {
      s' = r.post,
      ev' = mkEvent(labelOf(op), r.out)
    }
  }

  /// Weighted call menu (STYLE.md idiom: weights are data). Process
  /// dominates so jobs grow; dispose is frequent enough that most 30-step
  /// traces cross into Disposed and then exercise the use-after-dispose
  /// contract for the rest of the run.
  pure val STEP_MENU: List[Op] = [
    Process, Process, Process, Process,
    Clear, Clear,
    Render, Render,
    Resize,
    Dispose, Dispose
  ]

  action step = {
    nondet k = STEP_MENU.indices().oneOf()
    call(STEP_MENU[k])
  }

  // --- invariants ----------------------------------------------------------

  /// Conservation and sanity per resource class: nothing is released that
  /// was not allocated, so live = alloc - released is a true count and
  /// "every allocation is released or still live" holds exactly.
  val ledgersConserve = and {
    s.geom.released >= 0, s.geom.released <= s.geom.alloc,
    s.rend.released >= 0, s.rend.released <= s.rend.alloc,
    s.sm.released >= 0, s.sm.released <= s.sm.alloc
  }

  /// At most one live renderer and one live scene manager — and in fact
  /// exactly one EVER: the design has no resurrection path, so the alloc
  /// counters are pinned at the constructor's 1.
  val singletonRenderSide = and {
    s.rend.alloc == 1,
    s.sm.alloc == 1,
    live(s.rend) <= 1,
    live(s.sm) <= 1
  }

  /// dispose implies zero live resources of every class, and no retained
  /// job content (the ledger's "dispose releases everything" row).
  val disposedReleasesAll =
    s.phase == Disposed implies and {
      live(s.rend) == 0,
      live(s.sm) == 0,
      live(s.geom) == 0,
      s.paths == 0
    }

  /// Disposed is absorbing: once dispose has ever run, the phase is
  /// Disposed forever (the ghost makes any escaping transition falsify
  /// this). The reverse direction pins that only dispose enters Disposed.
  val disposedAbsorbing = s.ghostEverDisposed == (s.phase == Disposed)

  /// The phase agrees with the job: Fresh is empty, HasContent is not.
  val phaseMatchesContent = and {
    s.phase == Fresh implies s.paths == 0,
    s.phase == HasContent implies s.paths > 0
  }

  /// Designed law: render and resize never allocate — not geometries, not
  /// renderers, not scene managers (true whether the call returned or
  /// threw).
  val renderNeverAllocates =
    (s.ghostLast == LRender or s.ghostLast == LResize) implies and {
      s.geom.alloc == s.ghostPre.geom.alloc,
      s.rend.alloc == s.ghostPre.rend.alloc,
      s.sm.alloc == s.ghostPre.sm.alloc,
      s.geom.released == s.ghostPre.geom.released
    }

  /// clear() contract: an accepted clear empties the job, releases every
  /// live geometry and allocates nothing.
  val clearContract =
    (s.ghostLast == LClear and not(s.ghostPre.disposed)) implies and {
      s.paths == 0,
      live(s.geom) == 0,
      s.geom.alloc == s.ghostPre.geom.alloc,
      s.rend == s.ghostPre.rend,
      s.sm == s.ghostPre.sm
    }

  /// clear() idempotency as an invariant over ghost history: clearing an
  /// already-empty preview changes no observable at all.
  val clearIdempotent =
    (s.ghostLast == LClear and not(s.ghostPre.disposed) and s.ghostPre.paths == 0)
      implies snap(s) == s.ghostPre

  /// dispose() idempotency as an invariant: a second dispose is a no-op —
  /// every observable equals its pre-step value (release happened exactly
  /// once, on the first dispose).
  val disposeIdempotent =
    (s.ghostLast == LDispose and s.ghostPre.disposed) implies snap(s) == s.ghostPre

  /// Strong exception guarantee: a rejected call (anything but dispose,
  /// on a disposed preview) mutates nothing.
  val rejectionIsPure =
    (s.ghostPre.disposed and not(s.ghostLast == LDispose) and not(s.ghostLast == LInit))
      implies snap(s) == s.ghostPre

  /// process() contract: an accepted process adds exactly one path and
  /// allocates exactly one geometry, nothing else.
  val processContract =
    (s.ghostLast == LProcess and not(s.ghostPre.disposed)) implies and {
      s.phase == HasContent,
      s.paths == s.ghostPre.paths + 1,
      s.geom.alloc == s.ghostPre.geom.alloc + 1,
      s.geom.released == s.ghostPre.geom.released,
      s.processed == s.ghostPre.processed + 1,
      s.rend == s.ghostPre.rend,
      s.sm == s.ghostPre.sm
    }

  /// Allocation and release counters only ever grow (release-exactly-once
  /// is this plus ledgersConserve plus the releaser restriction below).
  val countersMonotone = and {
    s.geom.alloc >= s.ghostPre.geom.alloc,
    s.geom.released >= s.ghostPre.geom.released,
    s.rend.alloc >= s.ghostPre.rend.alloc,
    s.rend.released >= s.ghostPre.rend.released,
    s.sm.alloc >= s.ghostPre.sm.alloc,
    s.sm.released >= s.ghostPre.sm.released,
    s.renders >= s.ghostPre.renders,
    s.processed >= s.ghostPre.processed,
    s.paths >= 0
  }

  /// Only clear and dispose release geometries; only dispose releases the
  /// renderer or the scene manager.
  val releaseOnlyByClearOrDispose = and {
    not(s.geom.released == s.ghostPre.geom.released)
      implies (s.ghostLast == LClear or s.ghostLast == LDispose),
    not(s.rend.released == s.ghostPre.rend.released) implies s.ghostLast == LDispose,
    not(s.sm.released == s.ghostPre.sm.released) implies s.ghostLast == LDispose
  }

  val allInvariants = and {
    ledgersConserve,
    singletonRenderSide,
    disposedReleasesAll,
    disposedAbsorbing,
    phaseMatchesContent,
    renderNeverAllocates,
    clearContract,
    clearIdempotent,
    disposeIdempotent,
    rejectionIsPure,
    processContract,
    countersMonotone,
    releaseOnlyByClearOrDispose
  }

  // --- semantic tests (run with:
  // ---   npx quint test verification/quint-next/lifecycle.qnt) ---

  /// The full happy path: construct, grow content, draw, resize, clear is
  /// never needed — dispose at end of life releases all three classes.
  run happyPathTest =
    init
      .expect(s.phase == Fresh and live(s.rend) == 1 and live(s.sm) == 1 and live(s.geom) == 0)
      .then(call(Process))
      .expect(s.phase == HasContent and s.paths == 1 and live(s.geom) == 1 and ev.outcome == "ok")
      .then(call(Process))
      .expect(s.paths == 2 and s.processed == 2 and s.geom.alloc == 2)
      .then(call(Render))
      .expect(s.renders == 1 and s.geom.alloc == 2 and ev.outcome == "ok")
      .then(call(Resize))
      .expect(s.geom.alloc == 2 and s.paths == 2 and ev.outcome == "ok")
      .then(call(Dispose))
      .expect(and {
        s.phase == Disposed,
        ev.outcome == "ok",
        live(s.rend) == 0 and live(s.sm) == 0 and live(s.geom) == 0,
        s.geom == { alloc: 2, released: 2 },
        s.rend == { alloc: 1, released: 1 },
        allInvariants
      })

  /// Double dispose: the first releases everything exactly once, the
  /// second is a documented no-op — same outcome "ok", zero ledger motion.
  run doubleDisposeTest =
    init
      .then(call(Process))
      .then(call(Dispose))
      .expect(s.phase == Disposed and s.geom == { alloc: 1, released: 1 } and ev.outcome == "ok")
      .then(call(Dispose))
      .expect(and {
        ev.outcome == "ok" and ev.error == "",
        s.geom == { alloc: 1, released: 1 },
        s.rend == { alloc: 1, released: 1 },
        s.sm == { alloc: 1, released: 1 },
        snap(s) == s.ghostPre, // the no-op law, directly
        allInvariants
      })

  /// Use after dispose: every non-dispose call throws the designed error
  /// and mutates nothing — no resurrection, no counter motion, phase stays
  /// Disposed throughout.
  run useAfterDisposeTest =
    init
      .then(call(Process))
      .then(call(Dispose))
      .expect(s.phase == Disposed and s.geom.alloc == 1)
      .then(call(Process))
      .expect(and {
        ev.outcome == "throws" and ev.error == DISPOSED_ERROR,
        s.paths == 0 and s.processed == 1 and s.geom.alloc == 1,
        s.rend == { alloc: 1, released: 1 }
      })
      .then(call(Render))
      .expect(ev.outcome == "throws" and s.renders == 0 and snap(s) == s.ghostPre)
      .then(call(Clear))
      .expect(ev.outcome == "throws" and snap(s) == s.ghostPre)
      .then(call(Resize))
      .expect(and {
        ev.outcome == "throws" and ev.error == DISPOSED_ERROR,
        s.phase == Disposed,
        allInvariants
      })

  /// Clear then rebuild: clear releases the geometries but keeps the
  /// render side alive; a second clear is a no-op; processing afterwards
  /// grows a fresh job while the lifetime counters keep counting.
  run clearThenRebuildTest =
    init
      .then(call(Process))
      .then(call(Process))
      .expect(s.paths == 2 and live(s.geom) == 2)
      .then(call(Clear))
      .expect(and {
        s.phase == Fresh and s.paths == 0,
        s.geom == { alloc: 2, released: 2 } and live(s.geom) == 0,
        s.rend == { alloc: 1, released: 0 } and s.sm == { alloc: 1, released: 0 },
        ev.outcome == "ok"
      })
      .then(call(Clear))
      .expect(ev.outcome == "ok" and snap(s) == s.ghostPre) // idempotent
      .then(call(Process))
      .expect(and {
        s.phase == HasContent and s.paths == 1,
        s.geom.alloc == 3 and live(s.geom) == 1,
        s.processed == 3
      })
      .then(call(Dispose))
      .expect(s.geom == { alloc: 3, released: 3 } and allInvariants)

  /// Render and resize on an empty preview: both succeed, neither
  /// allocates anything — drawing an empty scene needs no geometry.
  run renderAllocatesNothingTest =
    init
      .then(call(Render))
      .expect(and {
        ev.outcome == "ok",
        s.phase == Fresh and s.renders == 1,
        s.geom.alloc == 0 and s.rend.alloc == 1 and s.sm.alloc == 1
      })
      .then(call(Resize))
      .expect(s.geom.alloc == 0 and s.renders == 1 and ev.outcome == "ok" and allInvariants)
}
