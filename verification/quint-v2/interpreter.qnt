// -*- mode: Bluespec; -*-
/**
 * interpreter — the v2 interpreter state machine, built on the shared
 * printer core. The machine folds printer_core::applyCommand over a
 * nondeterministic G-code command stream and adds only what the core does
 * not own: the job-statistics fold (through the core's classifyLinear),
 * the event/trace contract, generation weights, ghost state and the
 * invariants and semantic runs over it. All lengths are integers in
 * centi-millimeters (lib/scale.qnt); F words are raw feedrates the
 * modeled library never converts or stores.
 *
 * Unit: IS-1 (applyExtrusion algebra), IS-2 (G92 offset-model laws —
 *   ShiftDefiningEquation is the headline ghost invariant below), IS-4
 *   (safety cluster: homed/known monotonicity, zero-length stats
 *   partition) and IS-6 (command footprint) in
 *   .context/formal-verification/mapping-data.json.
 * Authority policy: verification/quint-v2/STYLE.md ("Authority
 *   annotations"). Command semantics and their per-variant annotation
 *   blocks live on the Command type in lib/printer-core.qnt; this machine
 *   adds no command semantics of its own and annotates only the folds and
 *   scaffolding it introduces.
 * Companion: interpreter.md.
 */
module interpreter {
  import scale.* from "./lib/scale"
  import printer_core.* from "./lib/printer-core"

  // --- state ------------------------------------------------------------

  /// The five job-statistics counters the library tallies alongside the
  /// printer state, in the implementation's field order.
  type Stats = {
    points: int,
    retractions: int,
    deretractions: int,
    feedrateChanges: int,
    others: int
  }

  /// A per-axis integer triple (centi-mm), used by the logical-position ghost.
  type Vec3 = { x: int, y: int, z: int }

  /// Previous-state flags, frozen by every step for the monotonicity
  /// invariants (homed and axis-known never regress).
  type PrevFlags = { homed: bool, xKnown: bool, yKnown: bool, zKnown: bool }

  /// The semantic state: the core's PrinterState, the stats counters, and
  /// the ghost fields. Ghosts exist for property expression only (the
  /// replay never decodes them): ghostLogical is the logical coordinate per
  /// axis, updated from the command words independently of applyCommand, so
  /// the IS-2 defining equation physical == logical + shift is a checkable
  /// invariant rather than a comment; ghostZeroMoves / ghostPointMoves are
  /// conservation counters for the stats partition; ghostPrev carries the
  /// previous step's flags for the monotonicity invariants.
  type SpecState = {
    p: PrinterState,
    stats: Stats,
    ghostLogical: Vec3,
    ghostZeroMoves: int,
    ghostPointMoves: int,
    ghostPrev: PrevFlags
  }

  /// The trace contract: the command taken on this step, in plain values,
  /// so an ITF trace doubles as a G-code program. cmd is printer_core's
  /// canonical tag ("g0".."t7"); absent words read false/0. wordP is the
  /// rendered P value (0 or 1) when hasP — the semantics is presence-only
  /// (pinned, see the Probe annotation in lib/printer-core.qnt), so the
  /// value exists purely to let the replay exercise both P0 and P1.
  /// For g28 the has* axis flags are word-presence flags rendered as bare
  /// letters ("G28 X"); the semantics ignores them (pinned).
  type Event = {
    cmd: str,
    hasX: bool, wordX: int,
    hasY: bool, wordY: int,
    hasZ: bool, wordZ: int,
    hasE: bool, wordE: int,
    hasF: bool, wordF: int,
    hasI: bool, wordI: int,
    hasJ: bool, wordJ: int,
    hasR: bool, wordR: int,
    hasP: bool, wordP: int
  }

  var s: SpecState
  var ev: Event

  // --- event derivation (one place; no free string literals) -------------

  pure def wordVal(w: Word): int =
    match w {
      | Some(v) => v
      | None => 0
    }

  pure val EV_INIT: Event = {
    cmd: "init",
    hasX: false, wordX: 0,
    hasY: false, wordY: 0,
    hasZ: false, wordZ: 0,
    hasE: false, wordE: 0,
    hasF: false, wordF: 0,
    hasI: false, wordI: 0,
    hasJ: false, wordJ: 0,
    hasR: false, wordR: 0,
    hasP: false, wordP: 0
  }

  /// Derive the event record for a command. pv is the replay-facing P value
  /// (used only when the command is a probe carrying a P word).
  pure def evOf(c: Command, pv: int): Event =
    match c {
      | Linear(m) => {
          ...EV_INIT,
          cmd: cmdTag(c),
          hasX: hasWord(m.x), wordX: wordVal(m.x),
          hasY: hasWord(m.y), wordY: wordVal(m.y),
          hasZ: hasWord(m.z), wordZ: wordVal(m.z),
          hasE: hasWord(m.e), wordE: wordVal(m.e),
          hasF: hasWord(m.f), wordF: wordVal(m.f)
        }
      | Arc(m) => {
          ...EV_INIT,
          cmd: cmdTag(c),
          hasX: hasWord(m.x), wordX: wordVal(m.x),
          hasY: hasWord(m.y), wordY: wordVal(m.y),
          hasZ: hasWord(m.z), wordZ: wordVal(m.z),
          hasE: hasWord(m.e), wordE: wordVal(m.e),
          hasI: hasWord(m.i), wordI: wordVal(m.i),
          hasJ: hasWord(m.j), wordJ: wordVal(m.j),
          hasR: hasWord(m.r), wordR: wordVal(m.r)
        }
      | Probe(m) => {
          ...EV_INIT,
          cmd: cmdTag(c),
          hasX: hasWord(m.x), wordX: wordVal(m.x),
          hasY: hasWord(m.y), wordY: wordVal(m.y),
          hasZ: hasWord(m.z), wordZ: wordVal(m.z),
          hasP: m.p, wordP: if (m.p) pv else 0
        }
      | SetPosition(m) => {
          ...EV_INIT,
          cmd: cmdTag(c),
          hasX: hasWord(m.x), wordX: wordVal(m.x),
          hasY: hasWord(m.y), wordY: wordVal(m.y),
          hasZ: hasWord(m.z), wordZ: wordVal(m.z),
          hasE: hasWord(m.e), wordE: wordVal(m.e)
        }
      | Home(h) => { ...EV_INIT, cmd: cmdTag(c), hasX: h.x, hasY: h.y, hasZ: h.z }
      | SetUnits(_) => { ...EV_INIT, cmd: cmdTag(c) }
      | ResetShift => { ...EV_INIT, cmd: cmdTag(c) }
      | SetExtrusionMode(_) => { ...EV_INIT, cmd: cmdTag(c) }
      | SelectTool(_) => { ...EV_INIT, cmd: cmdTag(c) }
    }

  // --- the stats fold -----------------------------------------------------

  /**
   * Fold one command into the job-statistics counters, via the core's
   * shared classification (classifyLinear, probeActs).
   *
   * Authority: none — the counters are a library feature with no firmware
   * counterpart.
   * Library stance: library-invented — a zero-length G0/G1 increments
   * exactly one of retractions/deretractions/feedrateChanges/others per
   * classifyLinear's pinned rules; an axis-word G0/G1 and an acting probe
   * each count one path point; arcs and every other command feed no counter.
   * Exclusions: extrusionDistance and the travel/extrusion path partition
   * are not modeled (see the companion's Compared vs ignored table).
   */
  pure def statsAfter(st: Stats, c: Command): Stats =
    match c {
      | Linear(m) =>
          match classifyLinear(m) {
            | CountsPoint => { ...st, points: st.points + 1 }
            | Retraction => { ...st, retractions: st.retractions + 1 }
            | Deretraction => { ...st, deretractions: st.deretractions + 1 }
            | FeedrateChange => { ...st, feedrateChanges: st.feedrateChanges + 1 }
            | OtherZeroMove => { ...st, others: st.others + 1 }
          }
      | Probe(m) => if (probeActs(m)) { ...st, points: st.points + 1 } else st
      | _ => st
    }

  // --- ghost transitions ---------------------------------------------------

  /// Ghost logical coordinate of one axis after a move word: a present word
  /// IS the new logical coordinate (unit-scaled, never shifted); an absent
  /// word holds.
  pure def logicalAfterWord(cur: int, w: Word, inches: bool): int =
    match w {
      | Some(v) => toCenti(v, inches)
      | None => cur
    }

  /**
   * The logical-position ghost, updated from the command words along a
   * derivation path independent of applyCommand: moves set the logical
   * coordinate to the unit-scaled word; G28 lands the logical position on
   * -shift (physical origin); G92 redefines it to its words (bare form: all
   * zero); G92.1 re-bases it onto the physical frame; a clamped probe lands
   * on its physical stop minus the shift. The IS-2 defining equation
   * physical == logical + shift (shiftDefiningEquation below) then fails if
   * either path — applyCommand or this ghost — is mis-transcribed.
   *
   * Authority: none — model scaffolding for property expression.
   * Library stance: library-invented — "logical" is the coordinate the
   * G-code file talks in, i.e. the implementation's resolvePosition()
   * minus-shift view; the probe case reuses the core's probeTargetZ
   * (library-invented z-clamp) because the probe's landing has no
   * commanded logical coordinate when clamped.
   * Exclusions: E has no logical/physical split (excluded from the shift
   * by pinned decision); unknown axes carry a logical 0 that the invariant
   * never reads.
   */
  pure def logicalAfter(st: SpecState, c: Command): Vec3 =
    match c {
      | Linear(m) => {
          x: logicalAfterWord(st.ghostLogical.x, m.x, st.p.inches),
          y: logicalAfterWord(st.ghostLogical.y, m.y, st.p.inches),
          z: logicalAfterWord(st.ghostLogical.z, m.z, st.p.inches)
        }
      | Arc(m) => {
          x: logicalAfterWord(st.ghostLogical.x, m.x, st.p.inches),
          y: logicalAfterWord(st.ghostLogical.y, m.y, st.p.inches),
          z: logicalAfterWord(st.ghostLogical.z, m.z, st.p.inches)
        }
      | Probe(m) =>
          if (not(probeActs(m))) st.ghostLogical
          else {
            x: logicalAfterWord(st.ghostLogical.x, m.x, st.p.inches),
            y: logicalAfterWord(st.ghostLogical.y, m.y, st.p.inches),
            z: match m.z {
              | Some(v) => probeTargetZ(st.p, v) - st.p.shift.z
              | None => st.ghostLogical.z
            }
          }
      | Home(_) => {
          x: 0 - st.p.shift.x,
          y: 0 - st.p.shift.y,
          z: 0 - st.p.shift.z
        }
      | SetPosition(m) =>
          if (not(hasAxisWord(m.x, m.y, m.z) or hasWord(m.e)))
            // bare G92: every axis now reads logical zero
            { x: 0, y: 0, z: 0 }
          else {
            x: match m.x { Some(v) => toCenti(v, st.p.inches) | None => st.ghostLogical.x },
            y: match m.y { Some(v) => toCenti(v, st.p.inches) | None => st.ghostLogical.y },
            z: match m.z { Some(v) => toCenti(v, st.p.inches) | None => st.ghostLogical.z }
          }
      | ResetShift => {
          // the shift collapses into the logical frame: logical becomes what
          // was physical, expressed without reading the physical variables
          x: st.ghostLogical.x + st.p.shift.x,
          y: st.ghostLogical.y + st.p.shift.y,
          z: st.ghostLogical.z + st.p.shift.z
        }
      | SetUnits(_) => st.ghostLogical
      | SetExtrusionMode(_) => st.ghostLogical
      | SelectTool(_) => st.ghostLogical
    }

  /// 1 when the command is a zero-length G0/G1 (no axis word), else 0 —
  /// counted from word presence alone, independently of classifyLinear.
  pure def zeroMoveDelta(c: Command): int =
    match c {
      | Linear(m) => if (hasAxisWord(m.x, m.y, m.z)) 0 else 1
      | _ => 0
    }

  /// 1 when the command counts a path point (axis-word G0/G1 or acting
  /// probe), else 0 — again from word presence, not from statsAfter.
  pure def pointMoveDelta(c: Command): int =
    match c {
      | Linear(m) => if (hasAxisWord(m.x, m.y, m.z)) 1 else 0
      | Probe(m) => if (probeActs(m)) 1 else 0
      | _ => 0
    }

  /// THE machine transition: the core's applyCommand for the printer state,
  /// the stats fold, and the ghost updates. Pure; actions below only record
  /// ev and apply this.
  pure def applyStep(st: SpecState, c: Command): SpecState = {
    p: applyCommand(st.p, c),
    stats: statsAfter(st.stats, c),
    ghostLogical: logicalAfter(st, c),
    ghostZeroMoves: st.ghostZeroMoves + zeroMoveDelta(c),
    ghostPointMoves: st.ghostPointMoves + pointMoveDelta(c),
    ghostPrev: {
      homed: st.p.homed,
      xKnown: st.p.x.known,
      yKnown: st.p.y.known,
      zKnown: st.p.z.known
    }
  }

  // --- actions --------------------------------------------------------------

  /// Take one command, carrying the replay-facing P value (probes only).
  action takeWithP(c: Command, pv: int): bool = all {
    ev' = evOf(c, pv),
    s' = applyStep(s, c)
  }

  /// Take one command; non-probe commands have no P value to carry.
  action take(c: Command): bool = takeWithP(c, 0)

  /**
   * Start before any command: INIT_PRINTER, zero counters, zero ghosts.
   *
   * Authority: none — model scaffolding.
   * Library stance: library-invented — mirrors a fresh Job/State (axes
   * unknown, no shift, absolute E, millimeters, un-homed, tool 0).
   * Exclusions: nothing carries over from a previous job; incremental
   * execute() onto an existing Job is out of this machine.
   */
  action init = all {
    ev' = EV_INIT,
    s' = {
      p: INIT_PRINTER,
      stats: { points: 0, retractions: 0, deretractions: 0, feedrateChanges: 0, others: 0 },
      ghostLogical: { x: 0, y: 0, z: 0 },
      ghostZeroMoves: 0,
      ghostPointMoves: 0,
      ghostPrev: { homed: false, xKnown: false, yKnown: false, zKnown: false }
    }
  }

  // --- word domains ----------------------------------------------------------

  /// Axis words, whole current-units values. Wide enough that shifts,
  /// homes and re-zeroes interleave at distinct coordinates.
  pure val XYZ_WORDS: Set[int] = (-50).to(50)
  /// E words for axis moves; sign matters to nothing but the E account.
  pure val E_WORDS: Set[int] = (-20).to(20)
  /// E words for generated retractions / deretractions (strict signs, so the
  /// zero-move kind menu controls the classification outcome exactly).
  pure val E_POS_WORDS: Set[int] = 1.to(20)
  pure val E_NEG_WORDS: Set[int] = (-20).to(-1)
  /// F words; 0 is included on purpose — presence, not truthiness, decides
  /// the feedrate-change classification, and F0 probes exactly that.
  pure val F_WORDS: Set[int] = 0.to(60)
  /// Arc offset and radius words; they shape no printer state and exist so
  /// the replay rebuilds real arc lines.
  pure val IJ_WORDS: Set[int] = (-20).to(20)
  pure val R_WORDS: Set[int] = (-10).to(10)
  /// Probe Z words, biased negative: the z-clamp fires on shifted targets
  /// below the origin plane, so this domain samples the clamp's
  /// neighborhood densely instead of leaving it to seed luck.
  pure val PROBE_Z_WORDS: Set[int] = (-30).to(10)

  // --- generation menus (weights live in data; see STYLE.md) -----------------

  pure val LINEAR_CODE_MENU: List[LinearCode] = [G0, G1]
  pure val ARC_CODE_MENU: List[ArcCode] = [G2, G3]
  pure val PROBE_CODE_MENU: List[ProbeCode] = [G31, G38_2, G38_3, G38_4, G38_5]
  /// Inches twice as likely as millimeters: v1's corpus under-sampled inch
  /// mode, and the mm default means every trace starts there anyway.
  pure val UNITS_MENU: List[UnitsMode] = [Inches, Inches, Millimeters]
  pure val EMODE_MENU: List[ExtrusionMode] = [AbsoluteE, RelativeE]
  pure val TOOL_MENU: List[int] = [0, 1, 2, 3, 4, 5, 6, 7]

  /// P-word menu for probes: -1 = no P word; 0 / 1 = a P word rendered with
  /// that value, so the replay exercises the zero-valued P form too.
  pure val P_MENU: List[int] = [-1, -1, -1, -1, -1, 0, 1]

  /// Axis-presence patterns for axis-carrying linear moves (x, y, z), XY
  /// moves weighted as the common case.
  pure val AXIS_PATTERNS: List[(bool, bool, bool)] = [
    (true, true, false), (true, true, false), (true, true, true),
    (true, false, false), (false, true, false), (false, false, true),
    (true, false, true), (false, true, true)
  ]

  /// The four zero-length-move kinds, balanced 2/2/2/2 so each statistics
  /// counter accumulates at comparable rates; the independent F coin then
  /// splits the E-absent/E0 half between feedrateChanges and others.
  type ZeroKind = ZRetract | ZDeretract | ZExplicitE0 | ZNoE
  pure val ZERO_MENU: List[ZeroKind] = [
    ZRetract, ZRetract, ZDeretract, ZDeretract,
    ZExplicitE0, ZExplicitE0, ZNoE, ZNoE
  ]

  /// Linear moves split 3:2 between axis moves and zero-length moves — far
  /// above the 1/8 an independent per-axis coin would give, because the
  /// zero-length classification grid is a modeled mode that needs volume.
  type LinearShape = AxisMove | ZeroMove
  pure val LINEAR_MENU: List[LinearShape] = [AxisMove, AxisMove, AxisMove, ZeroMove, ZeroMove]

  /// G92 shapes 4:1 words-to-bare; an independent per-word coin would make
  /// the bare form a 1-in-16 event.
  type G92Shape = G92Words | G92Bare
  pure val G92_MENU: List[G92Shape] = [G92Words, G92Words, G92Words, G92Words, G92Bare]

  // --- nondeterministic generators ------------------------------------------

  /**
   * One linear move carrying at least one axis word.
   *
   * Authority: none — generation scheduling, not semantics.
   * Library stance: library-invented — word shapes drawn from the menus
   * above; semantics is entirely printer_core's Linear clause.
   * Exclusions: fractional words and malformed words (see the companion's
   * Out of model).
   */
  action anyAxisLinear = {
    nondet gi = LINEAR_CODE_MENU.indices().oneOf()
    nondet pi = AXIS_PATTERNS.indices().oneOf()
    nondet wx = XYZ_WORDS.oneOf()
    nondet wy = XYZ_WORDS.oneOf()
    nondet wz = XYZ_WORDS.oneOf()
    nondet he = Bool.oneOf()
    nondet we = E_WORDS.oneOf()
    nondet hf = Bool.oneOf()
    nondet wf = F_WORDS.oneOf()
    take(Linear({
      code: LINEAR_CODE_MENU[gi],
      x: if (AXIS_PATTERNS[pi]._1) Some(wx) else None,
      y: if (AXIS_PATTERNS[pi]._2) Some(wy) else None,
      z: if (AXIS_PATTERNS[pi]._3) Some(wz) else None,
      e: if (he) Some(we) else None,
      f: if (hf) Some(wf) else None
    }))
  }

  /// One zero-length linear move whose kind comes from ZERO_MENU; the F
  /// coin is independent so an F word co-occurs with every E shape
  /// (including the pinned raw-E-sign-outranks-F case).
  action anyZeroLinear = {
    nondet gi = LINEAR_CODE_MENU.indices().oneOf()
    nondet zi = ZERO_MENU.indices().oneOf()
    nondet wep = E_POS_WORDS.oneOf()
    nondet wen = E_NEG_WORDS.oneOf()
    nondet hf = Bool.oneOf()
    nondet wf = F_WORDS.oneOf()
    take(Linear({
      code: LINEAR_CODE_MENU[gi],
      x: None,
      y: None,
      z: None,
      e: match ZERO_MENU[zi] {
        | ZRetract => Some(wep)
        | ZDeretract => Some(wen)
        | ZExplicitE0 => Some(0)
        | ZNoE => None
      },
      f: if (hf) Some(wf) else None
    }))
  }

  action anyLinearMove = {
    nondet li = LINEAR_MENU.indices().oneOf()
    match LINEAR_MENU[li] {
      | AxisMove => anyAxisLinear
      | ZeroMove => anyZeroLinear
    }
  }

  /// One arc move; axis and I/J/R presence are independent coins because
  /// every combination is state-safe in the modeled library (endpoint
  /// semantics only — the tessellation is out of model).
  action anyArcMove = {
    nondet gi = ARC_CODE_MENU.indices().oneOf()
    nondet hx = Bool.oneOf()
    nondet hy = Bool.oneOf()
    nondet hz = Bool.oneOf()
    nondet he = Bool.oneOf()
    nondet hi = Bool.oneOf()
    nondet hj = Bool.oneOf()
    nondet hr = Bool.oneOf()
    nondet wx = XYZ_WORDS.oneOf()
    nondet wy = XYZ_WORDS.oneOf()
    nondet wz = XYZ_WORDS.oneOf()
    nondet we = E_WORDS.oneOf()
    nondet wi = IJ_WORDS.oneOf()
    nondet wj = IJ_WORDS.oneOf()
    nondet wr = R_WORDS.oneOf()
    take(Arc({
      code: ARC_CODE_MENU[gi],
      x: if (hx) Some(wx) else None,
      y: if (hy) Some(wy) else None,
      z: if (hz) Some(wz) else None,
      e: if (he) Some(we) else None,
      i: if (hi) Some(wi) else None,
      j: if (hj) Some(wj) else None,
      r: if (hr) Some(wr) else None
    }))
  }

  /// One probe; the P pick covers the no-P, P0 and P1 forms, and the Z
  /// words come from the clamp-biased domain.
  action anyProbe = {
    nondet ci = PROBE_CODE_MENU.indices().oneOf()
    nondet ppi = P_MENU.indices().oneOf()
    nondet hx = Bool.oneOf()
    nondet hy = Bool.oneOf()
    nondet hz = Bool.oneOf()
    nondet wx = XYZ_WORDS.oneOf()
    nondet wy = XYZ_WORDS.oneOf()
    nondet wz = PROBE_Z_WORDS.oneOf()
    takeWithP(
      Probe({
        code: PROBE_CODE_MENU[ci],
        p: P_MENU[ppi] >= 0,
        x: if (hx) Some(wx) else None,
        y: if (hy) Some(wy) else None,
        z: if (hz) Some(wz) else None
      }),
      if (P_MENU[ppi] >= 0) P_MENU[ppi] else 0
    )
  }

  /// One G92, word form or bare form per G92_MENU.
  action anySetPosition = {
    nondet si = G92_MENU.indices().oneOf()
    nondet hx = Bool.oneOf()
    nondet hy = Bool.oneOf()
    nondet hz = Bool.oneOf()
    nondet he = Bool.oneOf()
    nondet wx = XYZ_WORDS.oneOf()
    nondet wy = XYZ_WORDS.oneOf()
    nondet wz = XYZ_WORDS.oneOf()
    nondet we = E_WORDS.oneOf()
    take(SetPosition(
      match G92_MENU[si] {
        | G92Bare => { x: None, y: None, z: None, e: None }
        | G92Words => {
            x: if (hx) Some(wx) else None,
            y: if (hy) Some(wy) else None,
            z: if (hz) Some(wz) else None,
            e: if (he) Some(we) else None
          }
      }
    ))
  }

  /// One G28 with random axis-presence flags, so the replay emits "G28 X"
  /// and friends and observes the pinned all-axes homing.
  action anyHome = {
    nondet hx = Bool.oneOf()
    nondet hy = Bool.oneOf()
    nondet hz = Bool.oneOf()
    take(Home({ x: hx, y: hy, z: hz }))
  }

  action anySetUnits = {
    nondet ui = UNITS_MENU.indices().oneOf()
    take(SetUnits(UNITS_MENU[ui]))
  }

  action anySetExtrusionMode = {
    nondet mi = EMODE_MENU.indices().oneOf()
    take(SetExtrusionMode(EMODE_MENU[mi]))
  }

  action anySelectTool = {
    nondet ti = TOOL_MENU.indices().oneOf()
    take(SelectTool(TOOL_MENU[ti]))
  }

  // --- step -------------------------------------------------------------------

  type StepKind =
    | KLinear
    | KArc
    | KProbe
    | KSetPosition
    | KUnits
    | KEMode
    | KHome
    | KResetShift
    | KTool

  /**
   * The step menu, 18 entries: linear 4, probe 3, G92 3, arc 2, units 2,
   * E-mode 1, home 1, G92.1 1, tool 1 — moves, workspace shifts and probes
   * dominate, and the doubled units weight repairs v1's inch-mode
   * under-sampling (measured counts live in the companion).
   *
   * Authority: none — generation scheduling.
   * Library stance: library-invented — a G-code stream never runs out of
   * commands, so step is always enabled and the machine has no stutter.
   * Exclusions: command frequencies of real sliced files (this is a
   * coverage schedule, not a workload model).
   */
  pure val STEP_MENU: List[StepKind] = [
    KLinear, KLinear, KLinear, KLinear,
    KArc, KArc,
    KProbe, KProbe, KProbe,
    KSetPosition, KSetPosition, KSetPosition,
    KUnits, KUnits,
    KEMode,
    KHome,
    KResetShift,
    KTool
  ]

  action dispatch(k: StepKind): bool =
    match k {
      | KLinear => anyLinearMove
      | KArc => anyArcMove
      | KProbe => anyProbe
      | KSetPosition => anySetPosition
      | KUnits => anySetUnits
      | KEMode => anySetExtrusionMode
      | KHome => anyHome
      | KResetShift => take(ResetShift)
      | KTool => anySelectTool
    }

  action step = {
    nondet k = STEP_MENU.indices().oneOf()
    dispatch(STEP_MENU[k])
  }

  // --- invariants (over semantic state only; none mention ev) -----------------

  /// IS-2 ShiftDefiningEquation as a ghost invariant: on every known axis
  /// the physical position equals the logical coordinate plus the workspace
  /// shift. ghostLogical is computed from the words along its own path, so
  /// a mis-transcribed move, home, G92, G92.1 or probe clause fails here.
  val shiftDefiningEquation = and {
    s.p.x.known implies s.p.x.pos == s.ghostLogical.x + s.p.shift.x,
    s.p.y.known implies s.p.y.pos == s.ghostLogical.y + s.p.shift.y,
    s.p.z.known implies s.p.z.pos == s.ghostLogical.z + s.p.shift.z
  }

  /// Stats-partition conservation: every zero-length G0/G1 increments
  /// exactly one of the four zero-move counters — their sum equals the
  /// ghost zero-move count derived from word presence alone.
  val statsPartition =
    s.stats.retractions + s.stats.deretractions + s.stats.feedrateChanges + s.stats.others
      == s.ghostZeroMoves

  /// Point conservation: points counts exactly the axis-word linear moves
  /// plus the acting probes (and nothing else — arcs pinned to count none).
  val pointsConservation = s.stats.points == s.ghostPointMoves

  /// IS-4 HomedMonotone: nothing un-homes (checked against the previous
  /// step's flag, frozen in ghostPrev).
  val homedMonotone = s.ghostPrev.homed implies s.p.homed

  /// IS-4 AxisDefinednessMonotone: a known axis never becomes unknown.
  val knownMonotone = and {
    s.ghostPrev.xKnown implies s.p.x.known,
    s.ghostPrev.yKnown implies s.p.y.known,
    s.ghostPrev.zKnown implies s.p.z.known
  }

  /// An axis nothing has commanded yet reads physical 0 by convention.
  val unknownAxisIsZero = and {
    not(s.p.x.known) implies s.p.x.pos == 0,
    not(s.p.y.known) implies s.p.y.pos == 0,
    not(s.p.z.known) implies s.p.z.pos == 0
  }

  /// G28 marks every axis known, and nothing un-homes or un-knows.
  val homedImpliesKnown = s.p.homed implies (s.p.x.known and s.p.y.known and s.p.z.known)

  /// The generators draw tools from TOOL_MENU; the type does not bound the
  /// index, so this pins the generated range.
  val toolInRange = s.p.tool >= 0 and s.p.tool <= 7

  val statsNonNegative = and {
    s.stats.points >= 0,
    s.stats.retractions >= 0,
    s.stats.deretractions >= 0,
    s.stats.feedrateChanges >= 0,
    s.stats.others >= 0
  }

  val allInvariants = and {
    shiftDefiningEquation,
    statsPartition,
    pointsConservation,
    homedMonotone,
    knownMonotone,
    unknownAxisIsZero,
    homedImpliesKnown,
    toolInRange,
    statsNonNegative
  }

  // --- readable command constructors for the semantic runs --------------------

  pure val NO_AXES: HomeWords = { x: false, y: false, z: false }

  pure def g1(wx: Word, wy: Word, wz: Word, we: Word): Command =
    Linear({ code: G1, x: wx, y: wy, z: wz, e: we, f: None })

  pure def g1f(wx: Word, wy: Word, wz: Word, we: Word, wf: Word): Command =
    Linear({ code: G1, x: wx, y: wy, z: wz, e: we, f: wf })

  pure def g92(wx: Word, wy: Word, wz: Word, we: Word): Command =
    SetPosition({ x: wx, y: wy, z: wz, e: we })

  pure def probeCmd(code: ProbeCode, hp: bool, wx: Word, wy: Word, wz: Word): Command =
    Probe({ code: code, p: hp, x: wx, y: wy, z: wz })

  pure def arcCmd(code: ArcCode, wx: Word, wy: Word, wz: Word, we: Word, wi: Word, wj: Word, wr: Word): Command =
    Arc({ code: code, x: wx, y: wy, z: wz, e: we, i: wi, j: wj, r: wr })

  // --- semantic tests, ported from v1 onto the core (run with:
  // ---   npx quint test verification/quint-v2/interpreter.qnt --main interpreter) ---

  /// G92 X10 followed by G1 X10 leaves the physical position unchanged
  run g92RoundtripTest =
    init
      .then(take(Home(NO_AXES)))
      .then(take(g1(Some(5), None, None, None)))
      .expect(s.p.x.pos == 500)
      .then(take(g92(Some(10), None, None, None)))
      .expect(s.p.shift.x == -500 and s.p.x.pos == 500 and allInvariants)
      .then(take(g1(Some(10), None, None, None)))
      .expect(s.p.x.pos == 500 and s.p.x.known and s.p.shift.x == -500 and allInvariants)

  /// bare G92: shift := current physical position, e := 0
  run bareG92Test =
    init
      .then(take(Home(NO_AXES)))
      .then(take(g1(Some(5), Some(-3), Some(2), Some(7))))
      .expect(and { s.p.x.pos == 500, s.p.y.pos == -300, s.p.z.pos == 200, s.p.e == 700 })
      .then(take(g92(None, None, None, None)))
      .expect(and {
        s.p.shift == { x: 500, y: -300, z: 200 },
        s.p.e == 0,
        s.p.x.pos == 500, s.p.y.pos == -300, s.p.z.pos == 200,
        s.p.homed,
        allInvariants
      })

  /// G92.1 clears the XYZ shift and nothing else (E untouched)
  run g92dot1ResetTest =
    init
      .then(take(Home(NO_AXES)))
      .then(take(g1(Some(5), None, None, None)))
      .then(take(g92(Some(10), None, None, Some(3))))
      .expect(s.p.shift.x == -500 and s.p.e == 300)
      .then(take(ResetShift))
      .expect(and {
        s.p.shift == { x: 0, y: 0, z: 0 },
        s.p.e == 300,
        s.p.x.pos == 500,
        allInvariants
      })

  /// M83 accumulates relative E; M82 treats E words as absolute positions
  run extrusionModeTest =
    init
      .then(take(g1(None, None, None, Some(10))))
      .expect(s.p.e == 1000 and not(s.p.relExtrude))
      .then(take(SetExtrusionMode(RelativeE)))
      .then(take(g1(None, None, None, Some(5))))
      .expect(s.p.e == 1500)
      .then(take(g1(None, None, None, Some(-2))))
      .expect(s.p.e == 1300)
      .then(take(SetExtrusionMode(AbsoluteE)))
      .then(take(g1(None, None, None, Some(4))))
      .expect(s.p.e == 400 and allInvariants)

  /// G20 then G1 X2 moves to 2 inches = 2 * 2540 centi-mm; G21 restores mm
  run inchUnitsTest =
    init
      .then(take(SetUnits(Inches)))
      .then(take(g1(Some(2), None, None, Some(1))))
      .expect(and { s.p.x.pos == 5080, s.p.x.known, s.p.e == 2540, s.p.inches, allInvariants })
      .then(take(SetUnits(Millimeters)))
      .then(take(g1(Some(2), None, None, None)))
      .expect(s.p.x.pos == 200 and not(s.p.inches) and allInvariants)

  /// un-homed G92 with words: shift computed against physical 0, position
  /// stays unknown
  run unhomedG92Test =
    init
      .then(take(g92(Some(10), None, None, Some(5))))
      .expect(and {
        s.p.shift.x == -1000,
        s.p.e == 500,
        s.p.x.pos == 0,
        not(s.p.x.known),
        not(s.p.homed),
        allInvariants
      })

  /// un-homed bare G92: shift := physical which is 0 by convention, e := 0
  run unhomedBareG92Test =
    init
      .then(take(g1(None, None, None, Some(6))))
      .expect(s.p.e == 600)
      .then(take(g92(None, None, None, None)))
      .expect(and {
        s.p.shift == { x: 0, y: 0, z: 0 },
        s.p.e == 0,
        not(s.p.homed),
        allInvariants
      })

  /// The zero-length move classification grid: raw E word sign first (even
  /// when the absolute-mode delta has the opposite sign), then F presence,
  /// then "others"; a move with an axis word only counts a point. The
  /// partition and point conservation invariants are re-checked throughout.
  run zeroLengthStatsTest =
    init
      .then(take(g1f(None, None, None, Some(5), None)))
      .expect(s.stats.retractions == 1 and s.stats.points == 0 and s.p.e == 500)
      .then(take(g1f(None, None, None, Some(2), Some(60))))
      // word E2 > 0 counts as a retraction even though the absolute-mode
      // extruder position DROPS from 500 to 200; the F word is outranked
      .expect(s.stats.retractions == 2 and s.stats.feedrateChanges == 0 and s.p.e == 200)
      .then(take(g1f(None, None, None, Some(-3), None)))
      .expect(s.stats.deretractions == 1 and s.p.e == -300)
      .then(take(g1f(None, None, None, None, Some(50))))
      .expect(s.stats.feedrateChanges == 1)
      .then(take(g1f(None, None, None, Some(0), Some(40))))
      // an explicit E0 is neither a retraction nor a deretraction: F wins
      .expect(s.stats.feedrateChanges == 2 and s.stats.retractions == 2 and s.p.e == 0)
      .then(take(g1f(None, None, None, None, None)))
      .expect(s.stats.others == 1 and allInvariants)
      .then(take(g1f(Some(4), None, None, Some(1), Some(30))))
      .expect(and {
        s.stats.points == 1,
        s.stats.retractions == 2,
        s.stats.deretractions == 1,
        s.stats.feedrateChanges == 2,
        s.stats.others == 1,
        s.ghostZeroMoves == 6,
        s.ghostPointMoves == 1,
        s.p.x.pos == 400,
        s.p.e == 100,
        allInvariants
      })

  /// M82 and G21 commute: from an inches/relative state, either order
  /// reaches the same state, observed through an identical G1 X2 E3 after.
  run unitsModeCommuteTest =
    init
      .then(take(SetUnits(Inches)))
      .then(take(SetExtrusionMode(RelativeE)))
      .then(take(SetExtrusionMode(AbsoluteE)))
      .then(take(SetUnits(Millimeters)))
      .then(take(g1(Some(2), None, None, Some(3))))
      .expect(and { s.p.x.pos == 200, s.p.e == 300, not(s.p.inches), not(s.p.relExtrude) })
      .then(init)
      .then(take(SetUnits(Inches)))
      .then(take(SetExtrusionMode(RelativeE)))
      .then(take(SetUnits(Millimeters)))
      .then(take(SetExtrusionMode(AbsoluteE)))
      .then(take(g1(Some(2), None, None, Some(3))))
      .expect(and { s.p.x.pos == 200, s.p.e == 300, not(s.p.inches), not(s.p.relExtrude) })

  /// G92 X5 and G1 X10 do NOT commute: two run prefixes from the same homed
  /// state reach different physical positions depending on the order.
  run g92MoveNonCommuteTest =
    init
      .then(take(Home(NO_AXES)))
      .then(take(g92(Some(5), None, None, None)))
      .then(take(g1(Some(10), None, None, None)))
      .expect(s.p.x.pos == 500 and s.p.shift.x == -500 and allInvariants)
      .then(init)
      .then(take(Home(NO_AXES)))
      .then(take(g1(Some(10), None, None, None)))
      .then(take(g92(Some(5), None, None, None)))
      .expect(s.p.x.pos == 1000 and s.p.shift.x == 500 and allInvariants)

  /// Arc endpoint/E semantics: shifted endpoints, absent axes untouched, E
  /// accounted like a linear move, I/J/R ignored by the printer state, and
  /// the points counter untouched by arcs (pinned: an arc never counts a
  /// point — pointsConservation would fail otherwise).
  run arcStateTest =
    init
      .then(take(Home(NO_AXES)))
      .then(take(g1(Some(10), Some(10), None, Some(1))))
      .expect(s.p.x.pos == 1000 and s.p.y.pos == 1000 and s.p.e == 100 and s.stats.points == 1)
      .then(take(arcCmd(G2, Some(20), Some(10), None, Some(3), Some(5), Some(0), None)))
      .expect(and {
        s.p.x.pos == 2000, s.p.y.pos == 1000, s.p.z.pos == 0,
        s.p.e == 300, s.stats.points == 1, allInvariants
      })
      .then(take(g92(Some(0), None, None, None)))
      .expect(s.p.shift.x == 2000)
      .then(take(arcCmd(G3, Some(5), None, None, None, None, None, Some(4))))
      .expect(s.p.x.pos == 2500 and s.p.y.pos == 1000 and s.p.e == 300 and s.stats.points == 1)
      .then(take(SetUnits(Inches)))
      .then(take(arcCmd(G2, Some(1), None, None, Some(1), Some(1), None, None)))
      .expect(s.p.x.pos == 4540 and s.p.e == 2540 and s.stats.points == 1 and allInvariants)

  /// Probe no-op forms and the probe Z clamp: a P word (any value) or a
  /// lack of axis words leaves everything untouched; a probe below the
  /// origin plane from a known Z at or above it lands on physical Z0;
  /// probes from a negative or unknown Z travel to the commanded target;
  /// each acting probe counts a point.
  run probeTest =
    init
      .then(takeWithP(probeCmd(G31, true, Some(5), None, None), 0))
      .expect(s.stats.points == 0 and not(s.p.x.known) and s.p.x.pos == 0 and ev.wordP == 0)
      .then(take(probeCmd(G38_2, false, None, None, None)))
      .expect(s.stats.points == 0)
      .then(take(Home(NO_AXES)))
      .then(take(probeCmd(G38_2, false, None, None, Some(-5))))
      .expect(s.p.z.pos == 0 and s.stats.points == 1 and allInvariants)
      .then(take(g1(None, None, Some(-3), None)))
      .expect(s.p.z.pos == -300 and s.stats.points == 2)
      .then(take(probeCmd(G31, false, None, None, Some(-5))))
      .expect(s.p.z.pos == -500 and s.stats.points == 3)
      .then(take(probeCmd(G38_4, false, Some(2), None, Some(4))))
      .expect(s.p.x.pos == 200 and s.p.z.pos == 400 and s.stats.points == 4)
      .then(take(g92(None, None, Some(10), None)))
      .expect(s.p.shift.z == -600)
      .then(take(probeCmd(G31, false, None, None, Some(2))))
      // shifted target 200 - 600 = -400 < 0 from z.pos 400 >= 0: clamped
      .expect(s.p.z.pos == 0 and s.stats.points == 5 and allInvariants)
      .then(init)
      .then(take(probeCmd(G38_3, false, None, None, Some(-2))))
      // un-homed Z: the clamp needs a known starting Z, so the probe travels
      .expect(and {
        s.p.z.pos == -200, s.p.z.known, s.stats.points == 1,
        not(s.p.homed), allInvariants
      })
}
