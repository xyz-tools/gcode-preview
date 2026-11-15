// -*- mode: Bluespec; -*-
/**
 * interpreter_next — the from-scratch interpreter machine of the
 * quint-next design bank: it folds printer_core_next::applyCommand over a
 * nondeterministic G-code stream (the full designed alphabet, G90/G91
 * included) and adds only what the core does not own — the job-statistics
 * fold through the core's STATE-AWARE classifyLinear, the ghost logical
 * positions with the defining-equation invariant, the stats conservation
 * ghosts, and the event record. A sibling module in this file,
 * encoding_equivalence_next, carries the mode-independence theorems the
 * design makes possible (see its own header). All lengths are integers in
 * centi-millimeters (lib/scale.qnt, module scale_next).
 *
 * Designed-in properties checked here (charter P2):
 * - The defining equation physical == logical + shift holds UNGUARDED on
 *   every axis in every reachable state — known or unknown, absolute or
 *   relative mode. The main bank can only state it on known axes; the
 *   from-scratch relative semantics (deltas are shift-free, un-commanded
 *   axes read a conventional 0 that deltas accumulate onto) closes the
 *   gap by construction.
 * - The stats partition is physical: every G0/G1 lands in exactly one
 *   counter, and the points counter equals the number of linear moves
 *   that PHYSICALLY displaced the carriage (not the number that carried
 *   axis words).
 *
 * Unit: design-bank counterpart of IS-1/IS-2/IS-4/IS-6 in
 *   .context/formal-verification/mapping-data.json, redesigned per the
 *   quint-next charter (see lib/printer-core.md). This bank is NORMATIVE:
 *   divergences from the current implementation are intentional and
 *   recorded in the companion's Divergence ledger.
 * Authority policy: verification/quint/STYLE.md ("Authority
 *   annotations"), adapted for a design bank. Command semantics and their
 *   per-variant Authority / Design stance / Exclusions blocks live on the
 *   Command type in lib/printer-core.qnt; this machine adds no command
 *   semantics of its own and annotates only the folds and scaffolding it
 *   introduces.
 * Companion: interpreter.md.
 *
 * NO REPLAY BINDING, by design (charter P6): this machine exercises
 * G90/G91, honored G28 axis words, physically-named stats and clamp-free
 * probes — every one a designed divergence from the current code — so a
 * replay would fail by construction. The gate is internal consistency:
 *   npx quint parse verification/quint-next/interpreter.qnt
 *   npx quint test verification/quint-next/interpreter.qnt --main interpreter_next
 *   npx quint run verification/quint-next/interpreter.qnt \
 *     --main interpreter_next --invariant allInvariants \
 *     --max-samples 200 --max-steps 30 --seed=0x67c0de2026
 */
module interpreter_next {
  import scale_next.* from "./lib/scale"
  import printer_core_next.* from "./lib/printer-core"

  // --- state ------------------------------------------------------------

  /// The five job-statistics counters, named by PHYSICAL semantics
  /// (printer_core_next::MoveStatsKind): primes replaces the
  /// raw-sign "deretractions" of the current implementation.
  type Stats = {
    points: int,
    retractions: int,
    primes: int,
    feedrateChanges: int,
    others: int
  }

  /// A per-axis integer triple (centi-mm), used by the logical ghost.
  type Vec3 = { x: int, y: int, z: int }

  /// Previous-step knowledge flags, frozen by every step for the
  /// monotonicity invariant.
  type PrevKnown = { xKnown: bool, yKnown: bool, zKnown: bool }

  /// Semantic state: the core's PrinterState, the stats counters, and the
  /// ghosts. Ghosts exist for property expression only: ghostLogical is
  /// the logical coordinate per axis, updated from the command words
  /// along a path independent of applyCommand, so the defining equation
  /// physical == logical + shift is a checked invariant rather than a
  /// comment; ghostLinearMoves / ghostDisplacedLinear are conservation
  /// counters for the stats partition; ghostPrev carries the previous
  /// step's knowledge flags.
  type SpecState = {
    p: PrinterState,
    stats: Stats,
    ghostLogical: Vec3,
    ghostLinearMoves: int,
    ghostDisplacedLinear: int,
    ghostPrev: PrevKnown
  }

  /// The event record: the command taken on this step in plain values
  /// (str/int/bool only, per STYLE.md). cmd is the core's canonical tag
  /// ("g0".."t7"); kind is the stats classification tag for linear moves
  /// ("" otherwise); for g28 the home* flags are the EFFECTIVE homed axes
  /// (bare form => all three), honored by the designed semantics.
  type Event = {
    cmd: str,
    kind: str,
    hasX: bool, wordX: int,
    hasY: bool, wordY: int,
    hasZ: bool, wordZ: int,
    hasE: bool, wordE: int,
    hasF: bool, wordF: int,
    bare: bool,
    homeX: bool, homeY: bool, homeZ: bool
  }

  var s: SpecState
  var ev: Event

  // --- event derivation (one place; no free string literals) -------------

  pure val EV_INIT: Event = {
    cmd: "init",
    kind: "",
    hasX: false, wordX: 0,
    hasY: false, wordY: 0,
    hasZ: false, wordZ: 0,
    hasE: false, wordE: 0,
    hasF: false, wordF: 0,
    bare: false,
    homeX: false, homeY: false, homeZ: false
  }

  pure def withWords(e: Event, wx: Word, wy: Word, wz: Word, we: Word, wf: Word): Event = {
    ...e,
    hasX: hasWord(wx), wordX: wordVal(wx),
    hasY: hasWord(wy), wordY: wordVal(wy),
    hasZ: hasWord(wz), wordZ: wordVal(wz),
    hasE: hasWord(we), wordE: wordVal(we),
    hasF: hasWord(wf), wordF: wordVal(wf)
  }

  /// Derive the event for a command against the pre-step printer state
  /// (the stats kind of a linear move is state-aware by design).
  pure def evOf(pre: PrinterState, c: Command): Event =
    match c {
      | Linear(m) => {
          ...withWords(EV_INIT, m.x, m.y, m.z, m.e, m.f),
          cmd: cmdTag(c),
          kind: kindTag(classifyLinear(pre, m))
        }
      | Arc(m) =>
          { ...withWords(EV_INIT, m.x, m.y, m.z, m.e, None), cmd: cmdTag(c) }
      | Probe(m) =>
          { ...withWords(EV_INIT, m.x, m.y, m.z, None, m.f), cmd: cmdTag(c) }
      | SetPosition(m) => {
          ...withWords(EV_INIT, m.x, m.y, m.z, m.e, None),
          cmd: cmdTag(c),
          bare: not(hasAxisWord(m.x, m.y, m.z) or hasWord(m.e))
        }
      | Home(m) => {
          ...EV_INIT,
          cmd: cmdTag(c),
          homeX: m.x or homesAll(m),
          homeY: m.y or homesAll(m),
          homeZ: m.z or homesAll(m)
        }
      | _ => { ...EV_INIT, cmd: cmdTag(c) }
    }

  // --- the stats fold ----------------------------------------------------

  /**
   * Fold one command into the job statistics, via the core's shared
   * state-aware classification. Only G0/G1 feed the counters.
   *
   * Authority: none — the counters are a library feature with no firmware
   *   counterpart; naming per physical filament motion (charter P2/P4).
   * Design stance: designed-divergence — the current implementation
   *   classifies zero-word moves by raw E-word sign (positive raw E
   *   named retraction) and counts a path point on any axis-word
   *   presence; it also counts acting probes as path points. Here the
   *   classification is classifyLinear's physical one, and probes/arcs
   *   feed no counter (an open item, see the companion).
   * Exclusions: extrusionDistance and the travel/extrusion partition.
   */
  pure def statsAfter(pre: PrinterState, st: Stats, c: Command): Stats =
    match c {
      | Linear(m) =>
          match classifyLinear(pre, m) {
            | CountsPoint => { ...st, points: st.points + 1 }
            | Retraction => { ...st, retractions: st.retractions + 1 }
            | Prime => { ...st, primes: st.primes + 1 }
            | FeedrateChange => { ...st, feedrateChanges: st.feedrateChanges + 1 }
            | OtherZeroMove => { ...st, others: st.others + 1 }
          }
      | _ => st
    }

  // --- the logical-position ghost ------------------------------------------

  /// Logical coordinate of one axis after a move word: an absolute word
  /// IS the new logical coordinate (unit-scaled, never shifted); a
  /// relative word adds its scaled delta; an absent word holds.
  pure def logicalAxisAfterMove(cur: int, w: Word, inches: bool, rel: bool): int =
    match w {
      | Some(v) => if (rel) cur + toCenti(v, inches) else toCenti(v, inches)
      | None => cur
    }

  pure def logicalAfterMoveWords(st: SpecState, wx: Word, wy: Word, wz: Word): Vec3 = {
    x: logicalAxisAfterMove(st.ghostLogical.x, wx, st.p.inches, st.p.relMove),
    y: logicalAxisAfterMove(st.ghostLogical.y, wy, st.p.inches, st.p.relMove),
    z: logicalAxisAfterMove(st.ghostLogical.z, wz, st.p.inches, st.p.relMove)
  }

  /**
   * The logical-position ghost, updated from the command words along a
   * derivation path independent of applyCommand: moves and probes update
   * per-axis logical coordinates (absolute words set, relative words
   * add — probes are uniform with moves because the design dropped the
   * z-clamp); G28 lands each EFFECTIVELY homed axis on -shift (physical
   * origin), honoring axis words; G92 redefines worded axes to their
   * scaled words (bare form: all zero); G92.1 re-bases the logical frame
   * onto the physical one. The defining equation physical == logical +
   * shift (shiftDefiningEquation below) then fails if either path —
   * applyCommand or this ghost — is mis-transcribed.
   *
   * Authority: none — model scaffolding for property expression.
   * Design stance: library-invented ghost; "logical" is the coordinate
   *   the G-code file talks in. Unlike the main bank, no clamp case and no
   *   known-axis guard are needed: the equation holds on unknown axes
   *   too, because relative deltas accumulate onto the conventional 0.
   * Exclusions: E has no logical/physical split (excluded from the
   *   shift, per the core's kept G92 model).
   */
  pure def logicalAfter(st: SpecState, c: Command): Vec3 =
    match c {
      | Linear(m) => logicalAfterMoveWords(st, m.x, m.y, m.z)
      | Arc(m) => logicalAfterMoveWords(st, m.x, m.y, m.z)
      | Probe(m) => logicalAfterMoveWords(st, m.x, m.y, m.z)
      | Home(m) => {
          val all0 = homesAll(m)
          {
            x: if (m.x or all0) 0 - st.p.shift.x else st.ghostLogical.x,
            y: if (m.y or all0) 0 - st.p.shift.y else st.ghostLogical.y,
            z: if (m.z or all0) 0 - st.p.shift.z else st.ghostLogical.z
          }
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
          // the shift collapses into the logical frame
          x: st.ghostLogical.x + st.p.shift.x,
          y: st.ghostLogical.y + st.p.shift.y,
          z: st.ghostLogical.z + st.p.shift.z
        }
      | _ => st.ghostLogical
    }

  // --- THE machine transition ----------------------------------------------

  /// The core's applyCommand for the printer state, the stats fold, and
  /// the ghost updates. Pure; actions only record ev and apply this.
  pure def applyStep(st: SpecState, c: Command): SpecState = {
    val post = applyCommand(st.p, c)
    {
      p: post,
      stats: statsAfter(st.p, st.stats, c),
      ghostLogical: logicalAfter(st, c),
      ghostLinearMoves:
        st.ghostLinearMoves + (match c { Linear(_) => 1 | _ => 0 }),
      ghostDisplacedLinear:
        st.ghostDisplacedLinear +
          (match c { Linear(_) => if (xyzDisplaced(st.p, post)) 1 else 0 | _ => 0 }),
      ghostPrev: { xKnown: st.p.x.known, yKnown: st.p.y.known, zKnown: st.p.z.known }
    }
  }

  // --- actions ----------------------------------------------------------------

  action take(c: Command): bool = all {
    ev' = evOf(s.p, c),
    s' = applyStep(s, c)
  }

  action init = all {
    ev' = EV_INIT,
    s' = {
      p: INIT_PRINTER,
      stats: { points: 0, retractions: 0, primes: 0, feedrateChanges: 0, others: 0 },
      ghostLogical: { x: 0, y: 0, z: 0 },
      ghostLinearMoves: 0,
      ghostDisplacedLinear: 0,
      ghostPrev: { xKnown: false, yKnown: false, zKnown: false }
    }
  }

  // --- word domains ------------------------------------------------------------

  /// Axis words, whole current-units values; small enough that repeat
  /// coordinates (physically zero-length absolute moves) actually occur.
  pure val XYZ_WORDS: Set[int] = (-15).to(15)
  pure val E_WORDS: Set[int] = (-10).to(10)
  /// F words; 0 included on purpose — presence, not truthiness, decides.
  pure val F_WORDS: Set[int] = 0.to(60)
  pure val IJ_WORDS: Set[int] = (-10).to(10)

  // --- generation menus (weights live in data; see STYLE.md) --------------------

  pure val LINEAR_CODE_MENU: List[LinearCode] = [G0, G1]
  pure val ARC_CODE_MENU: List[ArcCode] = [G2, G3]
  pure val PROBE_CODE_MENU: List[ProbeCode] = [G38_2, G38_3, G38_4, G38_5]
  pure val UNITS_MENU: List[UnitsMode] = [Inches, Millimeters]
  pure val POS_MODE_MENU: List[PositioningMode] = [AbsoluteXYZ, RelativeXYZ]
  pure val EMODE_MENU: List[ExtrusionMode] = [AbsoluteE, RelativeE]
  pure val TOOL_MENU: List[int] = [0, 1, 2, 3, 4, 5, 6, 7]

  /// Axis-presence patterns for axis-carrying moves (x, y, z); XY twice.
  pure val AXIS_PATTERNS: List[(bool, bool, bool)] = [
    (true, true, false), (true, true, false), (true, true, true),
    (true, false, false), (false, true, false), (false, false, true),
    (true, false, true), (false, true, true)
  ]

  /// E shapes for word-free zero-length moves, balanced so every
  /// classification outcome accumulates.
  type ZeroEKind = ZUp | ZDown | ZZero | ZNone
  pure val ZERO_E_MENU: List[ZeroEKind] = [ZUp, ZUp, ZDown, ZDown, ZZero, ZNone]

  type LinearShape = AxisMove | ZeroMove
  pure val LINEAR_MENU: List[LinearShape] = [AxisMove, AxisMove, AxisMove, ZeroMove, ZeroMove]

  type G92Shape = G92Words | G92Bare
  pure val G92_MENU: List[G92Shape] = [G92Words, G92Words, G92Words, G92Words, G92Bare]

  // --- nondeterministic generators ----------------------------------------------

  /**
   * One linear move carrying at least one axis word. Under G91 the words
   * are deltas; under G90 they are shifted absolute targets — the same
   * generator exercises both because the mode is machine state.
   *
   * Authority: none — generation scheduling, not semantics.
   * Design stance: scheduling only; semantics is printer_core_next's.
   * Exclusions: fractional and malformed words.
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

  /// One axis-word-free linear move; the classification outcome is
  /// state-dependent by design (an E word's raw sign does not decide).
  action anyZeroLinear = {
    nondet gi = LINEAR_CODE_MENU.indices().oneOf()
    nondet zi = ZERO_E_MENU.indices().oneOf()
    nondet wep = 1.to(10).oneOf()
    nondet wen = (-10).to(-1).oneOf()
    nondet hf = Bool.oneOf()
    nondet wf = F_WORDS.oneOf()
    take(Linear({
      code: LINEAR_CODE_MENU[gi],
      x: None, y: None, z: None,
      e: match ZERO_E_MENU[zi] {
        | ZUp => Some(wep)
        | ZDown => Some(wen)
        | ZZero => Some(0)
        | ZNone => None
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

  action anyArcMove = {
    nondet gi = ARC_CODE_MENU.indices().oneOf()
    nondet hx = Bool.oneOf()
    nondet hy = Bool.oneOf()
    nondet he = Bool.oneOf()
    nondet wx = XYZ_WORDS.oneOf()
    nondet wy = XYZ_WORDS.oneOf()
    nondet we = E_WORDS.oneOf()
    nondet wi = IJ_WORDS.oneOf()
    nondet wj = IJ_WORDS.oneOf()
    take(Arc({
      code: ARC_CODE_MENU[gi],
      x: if (hx) Some(wx) else None,
      y: if (hy) Some(wy) else None,
      z: None,
      e: if (he) Some(we) else None,
      i: Some(wi), j: Some(wj), r: None
    }))
  }

  /// One G38.2-G38.5 probe: clamp-free by design, it obeys the same move
  /// laws as G0/G1 (modes, units, shift).
  action anyProbe = {
    nondet ci = PROBE_CODE_MENU.indices().oneOf()
    nondet hx = Bool.oneOf()
    nondet hz = Bool.oneOf()
    nondet wx = XYZ_WORDS.oneOf()
    nondet wz = XYZ_WORDS.oneOf()
    nondet hf = Bool.oneOf()
    nondet wf = F_WORDS.oneOf()
    take(Probe({
      code: PROBE_CODE_MENU[ci],
      x: if (hx) Some(wx) else None,
      y: None,
      z: if (hz) Some(wz) else None,
      f: if (hf) Some(wf) else None
    }))
  }

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

  /// One G28 with random axis words — HONORED by the designed semantics:
  /// only the named axes home; the bare draw homes all three.
  action anyHome = {
    nondet hx = Bool.oneOf()
    nondet hy = Bool.oneOf()
    nondet hz = Bool.oneOf()
    take(Home({ x: hx, y: hy, z: hz }))
  }

  action anyPosMode = {
    nondet mi = POS_MODE_MENU.indices().oneOf()
    take(SetPositioningMode(POS_MODE_MENU[mi]))
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

  // --- step ---------------------------------------------------------------------

  type StepKind =
    | KLinear
    | KArc
    | KProbe
    | KSetPosition
    | KPosMode
    | KUnits
    | KEMode
    | KHome
    | KResetShift
    | KTool

  /**
   * The step menu, 19 entries: linear 5, G92 3, positioning mode 2,
   * probe 2, home 2, arc 1, units 1, E-mode 1, G92.1 1, tool 1 — moves
   * and the mode/frame commands they must compose with dominate, and
   * the doubled KPosMode weight keeps both G90 and G91 segments long
   * enough to carry moves.
   *
   * Authority: none — generation scheduling.
   * Design stance: a G-code stream never runs out of commands, so step
   *   is always enabled and the machine has no stutter.
   * Exclusions: command frequencies of real sliced files.
   */
  pure val STEP_MENU: List[StepKind] = [
    KLinear, KLinear, KLinear, KLinear, KLinear,
    KSetPosition, KSetPosition, KSetPosition,
    KPosMode, KPosMode,
    KProbe, KProbe,
    KHome, KHome,
    KArc,
    KUnits,
    KEMode,
    KResetShift,
    KTool
  ]

  action dispatch(k: StepKind): bool =
    match k {
      | KLinear => anyLinearMove
      | KArc => anyArcMove
      | KProbe => anyProbe
      | KSetPosition => anySetPosition
      | KPosMode => anyPosMode
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

  // --- invariants (over semantic state only; none mention ev) --------------------

  /// THE defining equation, UNGUARDED: physical == logical + shift on
  /// every axis in every reachable state. No known-axis guard is needed
  /// (contrast the main bank): relative deltas accumulate onto the
  /// conventional 0 of un-commanded axes on both sides of the equation.
  val shiftDefiningEquation = and {
    s.p.x.pos == s.ghostLogical.x + s.p.shift.x,
    s.p.y.pos == s.ghostLogical.y + s.p.shift.y,
    s.p.z.pos == s.ghostLogical.z + s.p.shift.z
  }

  /// Physically-named stats partition: every G0/G1 increments exactly
  /// one counter — the five counters sum to the ghost count of linear
  /// moves, maintained independently of the classification.
  val statsPartition =
    s.stats.points + s.stats.retractions + s.stats.primes
      + s.stats.feedrateChanges + s.stats.others
      == s.ghostLinearMoves

  /// Points count physical displacement: the points counter equals the
  /// ghost count of linear moves whose pre/post states differ on X/Y/Z —
  /// cross-checking classifyLinear's internal endpoint recomputation
  /// against the state the machine actually reached.
  val pointsArePhysical = s.stats.points == s.ghostDisplacedLinear

  /// Axis knowledge is monotone (designed: nothing un-knows an axis;
  /// relative moves never mint knowledge, absolute words and homing do).
  val knownMonotone = and {
    s.ghostPrev.xKnown implies s.p.x.known,
    s.ghostPrev.yKnown implies s.p.y.known,
    s.ghostPrev.zKnown implies s.p.z.known
  }

  /// The generators draw tools from TOOL_MENU; the type does not bound
  /// the index, so this pins the generated range.
  val toolInRange = s.p.tool >= 0 and s.p.tool <= 7

  val statsNonNegative = and {
    s.stats.points >= 0,
    s.stats.retractions >= 0,
    s.stats.primes >= 0,
    s.stats.feedrateChanges >= 0,
    s.stats.others >= 0
  }

  val allInvariants = and {
    shiftDefiningEquation,
    statsPartition,
    pointsArePhysical,
    knownMonotone,
    toolInRange,
    statsNonNegative
  }

  // --- readable command constructors for the semantic runs -----------------------

  pure val BARE_HOME: HomeWords = { x: false, y: false, z: false }
  pure val G90C: Command = SetPositioningMode(AbsoluteXYZ)
  pure val G91C: Command = SetPositioningMode(RelativeXYZ)

  pure def g1(wx: Word, wy: Word, wz: Word, we: Word): Command =
    Linear({ code: G1, x: wx, y: wy, z: wz, e: we, f: None })

  pure def g1f(wx: Word, wy: Word, wz: Word, we: Word, wf: Word): Command =
    Linear({ code: G1, x: wx, y: wy, z: wz, e: we, f: wf })

  pure def g92(wx: Word, wy: Word, wz: Word, we: Word): Command =
    SetPosition({ x: wx, y: wy, z: wz, e: we })

  pure def probe(code: ProbeCode, wx: Word, wy: Word, wz: Word): Command =
    Probe({ code: code, x: wx, y: wy, z: wz, f: None })

  // --- semantic runs (each designed divergence appears in at least one;
  // --- run with: npx quint test verification/quint-next/interpreter.qnt
  // ---   --main interpreter_next) -----------------------------------------------

  /// G91 after G92 (designed divergence: G90/G91 exist at all): the
  /// relative delta ignores the live shift, the shift survives, and the
  /// defining-equation ghost tracks the whole composition. G90 then
  /// resumes shifted absolute addressing on the same axis.
  run g91AfterG92Test =
    init
      .then(take(Home(BARE_HOME)))
      .then(take(g1(Some(5), None, None, None)))
      .expect(s.p.x.pos == 500 and allInvariants)
      .then(take(g92(Some(0), None, None, None)))
      .expect(s.p.shift.x == 500 and s.ghostLogical.x == 0 and allInvariants)
      .then(take(G91C))
      .then(take(g1(Some(3), None, None, None)))
      .expect(and {
        ev.cmd == "g1", ev.kind == "point",
        s.p.x.pos == 800,          // delta is shift-free
        s.p.shift.x == 500,
        s.ghostLogical.x == 300,   // logical 3 = physical 8 under the shift
        allInvariants
      })
      .then(take(G90C))
      .then(take(g1(Some(3), None, None, None)))
      // absolute logical 3 under shift 500: same physical point — the
      // encoding-equivalence seed, proven in general by the sibling module
      .expect(s.p.x.pos == 800 and s.stats.points == 2 and allInvariants)

  /// Relative moves on un-homed axes (designed): they accumulate from
  /// the conventional 0, never mint knowledge, and the UNGUARDED
  /// defining equation still holds throughout; a later absolute word is
  /// absolute evidence and mints knowledge.
  run relativeUnhomedMovesTest =
    init
      .then(take(G91C))
      .then(take(g1(Some(5), None, Some(2), None)))
      .expect(and {
        s.p.x.pos == 500, s.p.z.pos == 200,
        not(s.p.x.known), not(s.p.z.known), not(fullyHomed(s.p)),
        s.ghostLogical.x == 500,
        allInvariants
      })
      .then(take(g1(Some(-2), None, None, None)))
      .expect(s.p.x.pos == 300 and not(s.p.x.known) and allInvariants)
      .then(take(G90C))
      .then(take(g1(Some(7), None, None, None)))
      .expect(s.p.x.pos == 700 and s.p.x.known and not(fullyHomed(s.p)) and allInvariants)

  /// Partial-homing composition (designed divergence: axis words are
  /// honored): G28 X after moves and a G92 re-origins only X; Y and Z
  /// keep position and knowledge; the shift and E survive; the ghost
  /// logical of X lands on -shift; fullyHomed stays derived.
  run partialHomingCompositionTest =
    init
      .then(take(Home(BARE_HOME)))
      .expect(fullyHomed(s.p) and allInvariants)
      .then(take(g1(Some(5), Some(6), Some(7), Some(2))))
      .then(take(g92(Some(1), None, None, None)))
      .expect(s.p.shift.x == 400 and allInvariants)
      .then(take(Home({ x: true, y: false, z: false })))
      .expect(and {
        ev.homeX, not(ev.homeY), not(ev.homeZ),
        s.p.x.pos == 0, s.p.x.known,
        s.p.y.pos == 600, s.p.z.pos == 700,
        s.p.shift.x == 400,
        s.p.e == 200,
        s.ghostLogical.x == -400,
        fullyHomed(s.p),
        allInvariants
      })
      .then(init)
      .then(take(Home({ x: false, y: false, z: true })))
      // partial homing from cold: Z known at origin, X/Y untouched
      .expect(and {
        s.p.z.known, not(s.p.x.known), not(fullyHomed(s.p)), allInvariants
      })

  /// Physically-named stats (designed divergence): in absolute E mode a
  /// positive E word BELOW the current position is a retraction; above
  /// is a prime; a move to the already-occupied coordinate counts no
  /// point; the partition and displacement ghosts balance throughout.
  run physicalStatsTest =
    init
      .then(take(Home(BARE_HOME)))
      .then(take(g1(None, None, None, Some(10))))
      .expect(s.stats.primes == 1 and s.p.e == 1000)
      .then(take(g1f(None, None, None, Some(8), Some(60))))
      // raw word +8 but physical delta -200: Retraction, F outranked
      .expect(and {
        ev.kind == "retraction",
        s.stats.retractions == 1, s.stats.feedrateChanges == 0, s.p.e == 800
      })
      .then(take(g1(Some(4), None, None, Some(1))))
      .expect(s.stats.points == 1 and s.p.x.pos == 400)
      .then(take(g1(Some(4), None, None, None)))
      // absolute move to the current coordinate: physically zero-length
      .expect(ev.kind == "other" and s.stats.points == 1 and s.stats.others == 1)
      .then(take(g1f(Some(4), None, None, None, Some(30))))
      .expect(ev.kind == "feedrate" and s.stats.feedrateChanges == 1)
      .then(take(SetExtrusionMode(RelativeE)))
      .then(take(g1(None, None, None, Some(-2))))
      .expect(and {
        ev.kind == "retraction",
        s.stats.retractions == 2,
        s.ghostLinearMoves == 6, s.ghostDisplacedLinear == 1,
        allInvariants
      })

  /// Probe travel without the z-clamp (designed divergence): a
  /// below-origin target is reached; probes resolve under shift, units
  /// and G91 like any move; no stats counter moves; E is untouched.
  run probeTravelTest =
    init
      .then(take(Home(BARE_HOME)))
      .then(take(g1(None, None, None, Some(7))))
      .then(take(probe(G38_2, None, None, Some(-5))))
      .expect(and {
        s.p.z.pos == -500, s.p.z.known, s.p.e == 700,
        s.stats.points == 0,
        allInvariants
      })
      .then(take(g92(None, None, Some(10), None)))
      .expect(s.p.shift.z == -1500)
      .then(take(probe(G38_3, None, None, Some(2))))
      .expect(s.p.z.pos == -1300 and allInvariants)
      .then(take(G91C))
      .then(take(probe(G38_4, None, None, Some(-1))))
      .expect(s.p.z.pos == -1400 and allInvariants)
      .then(take(probe(G38_5, None, None, None)))
      // no axis words: complete no-op
      .expect(s.p.z.pos == -1400 and s.ghostLinearMoves == 1 and allInvariants)

  /// The ghost gauntlet: units switches, arcs, G92.1 and bare G92 all
  /// preserve the unguarded defining equation, and the logical frame
  /// re-bases exactly when the shift changes.
  run logicalGhostGauntletTest =
    init
      .then(take(SetUnits(Inches)))
      .then(take(g1(Some(2), None, None, None)))
      .expect(s.p.x.pos == 5080 and s.ghostLogical.x == 5080 and allInvariants)
      .then(take(g92(Some(1), None, None, None)))
      .expect(s.p.shift.x == 2540 and s.ghostLogical.x == 2540 and allInvariants)
      .then(take(SetUnits(Millimeters)))
      .then(take(Arc({ code: G2, x: Some(5), y: Some(5), z: None, e: None,
                       i: Some(1), j: Some(1), r: None })))
      .expect(s.p.x.pos == 500 + 2540 and allInvariants)
      .then(take(ResetShift))
      .expect(and {
        s.p.shift == { x: 0, y: 0, z: 0 },
        s.ghostLogical.x == 500 + 2540,
        allInvariants
      })
      .then(take(g92(None, None, None, None)))
      .expect(and {
        ev.bare,
        s.ghostLogical == { x: 0, y: 0, z: 0 },
        s.p.e == 0,
        allInvariants
      })
}

/**
 * encoding_equivalence_next — THE theorem bank of the from-scratch
 * design: one logical toolpath, four encodings, one applyCommand.
 *
 * A logical path is a sequence of per-axis quantum deltas (one quantum =
 * 12700 centi-mm = 127 mm = 5 in, the lcm of the two word grids, so
 * every encoding's words stay whole in its own units). Pure re-encoding
 * functions derive four G-code streams from the same path:
 *
 *   A  absolute XYZ+E, millimeters, machine frame   (baseline)
 *   B  relative XYZ+E (G91, delta words)            (THE NEW THEOREM)
 *   C  absolute, millimeters, G92-shifted workspace (frame equivalence)
 *   D  absolute, inches (G20)                       (units equivalence)
 *
 * All four fold the SAME printer_core_next::applyCommand, so the
 * headline invariant physicalAgreement genuinely checks that each
 * re-encoding commutes with interpretation: a mis-transcription of any
 * encoder, of the cursor bookkeeping, or an asymmetry smuggled into any
 * fold falsifies it. The B column is the theorem the current
 * implementation cannot state (it has no G91 at all) — which is exactly
 * why this bank has no replay (charter P6).
 *
 * Unit: design-bank counterpart of IS-3 (encoding equivalences) in
 *   .context/formal-verification/mapping-data.json, extended with the
 *   G90/G91 half that only exists in the from-scratch design; the main
 *   bank's UnitsReadTimeOnly OPEN item is discharged here by the D column.
 * Authority policy: verification/quint/STYLE.md ("Authority
 *   annotations"), adapted for a design bank; command semantics live in
 *   lib/printer-core.qnt, and the constructs annotated here are the
 *   encoders and the setup step.
 * Companion: interpreter.md (shared with interpreter_next — one file
 *   set, documented there).
 *
 * Gate:
 *   npx quint test verification/quint-next/interpreter.qnt \
 *     --main encoding_equivalence_next
 *   npx quint run verification/quint-next/interpreter.qnt \
 *     --main encoding_equivalence_next --invariant allInvariants \
 *     --max-samples 200 --max-steps 30 --seed=0x67c0de2026
 */
module encoding_equivalence_next {
  import scale_next.* from "./lib/scale"
  import printer_core_next.* from "./lib/printer-core"

  // --- the quantum grid ---------------------------------------------------

  /// Centi-mm per path quantum: lcm(CENTI, INCH_CENTI) = 12700, the
  /// coarsest grid whose offsets re-express as whole words under both
  /// G20 and G21 (pinned by quantumGridTest).
  pure val QUANTUM_C: int = 12700
  /// Millimeter words per quantum (12700 / 100).
  pure val MM_WORDS_PER_Q: int = 127
  /// Inch words per quantum (12700 / 2540).
  pure val INCH_WORDS_PER_Q: int = 5

  type QVec = { x: int, y: int, z: int }
  pure val Q0: QVec = { x: 0, y: 0, z: 0 }

  /// One logical path step: optional per-axis carriage deltas and an
  /// optional extrusion delta, all in quantum units. This is the single
  /// mode-free description of "what the toolpath does" that every
  /// encoding below is derived from.
  type PathStep = { x: Word, y: Word, z: Word, e: Word }

  pure def qAfter(cur: int, d: Word): int =
    match d { Some(v) => cur + v | None => cur }

  pure def cursorAfter(cur: QVec, st: PathStep): QVec =
    { x: qAfter(cur.x, st.x), y: qAfter(cur.y, st.y), z: qAfter(cur.z, st.z) }

  // --- the pure re-encoders ------------------------------------------------

  /// Absolute encoding of one axis: the post-step cursor, re-expressed
  /// as whole words of the encoding's units. Absent deltas stay absent.
  pure def absWord(cur: int, d: Word, wordsPerQ: int): Word =
    match d { Some(v) => Some((cur + v) * wordsPerQ) | None => None }

  /// Relative encoding of one axis: the delta itself as mm words.
  pure def relWord(d: Word): Word =
    match d { Some(v) => Some(v * MM_WORDS_PER_Q) | None => None }

  /// Framed absolute encoding of one axis: the post-step cursor plus the
  /// workspace offset, as mm words (the workspace was established by an
  /// ordinary G92 in the setup step).
  pure def framedWord(cur: int, d: Word, offQ: int): Word =
    match d { Some(v) => Some((cur + v + offQ) * MM_WORDS_PER_Q) | None => None }

  /**
   * The four encodings of one logical path step.
   *
   * Authority: Marlin docs G090/G091 (what the two addressing modes
   *   mean), G092 (workspace offsets), G20/G21 (units) — the encoders
   *   are the spec-level witnesses of those documented equivalences.
   * Design stance: the theorem's construction; each encoder is pinned so
   *   that (encode, applyCommand) commutes on physical observables.
   * Exclusions: F words (out of the semantic model); arcs and probes
   *   (their endpoint semantics equals Linear's in the core, so Linear
   *   carries the theorem); mid-path mode switches (each copy's mode is
   *   fixed by construction — that IS the statement "the same path in
   *   either mode").
   */
  pure def encodeAbs(cur: QVec, eCur: int, st: PathStep, wordsPerQ: int): Command =
    Linear({
      code: G1,
      x: absWord(cur.x, st.x, wordsPerQ),
      y: absWord(cur.y, st.y, wordsPerQ),
      z: absWord(cur.z, st.z, wordsPerQ),
      e: absWord(eCur, st.e, wordsPerQ),
      f: None
    })

  pure def encodeRel(st: PathStep): Command =
    Linear({
      code: G1,
      x: relWord(st.x), y: relWord(st.y), z: relWord(st.z),
      e: relWord(st.e),
      f: None
    })

  pure def encodeFramed(cur: QVec, eCur: int, st: PathStep, off: QVec): Command =
    Linear({
      code: G1,
      x: framedWord(cur.x, st.x, off.x),
      y: framedWord(cur.y, st.y, off.y),
      z: framedWord(cur.z, st.z, off.z),
      // E is never workspace-shifted (core's kept G92 model)
      e: absWord(eCur, st.e, MM_WORDS_PER_Q),
      f: None
    })

  // --- machine state --------------------------------------------------------

  /// The four printer-state copies, the logical cursor (quantum units),
  /// the extruder cursor (quantum units), copy C's workspace offset
  /// (quantum units) and the setup flag. The cursor pair is ghost-like:
  /// it is the one description of the path, and cursorDefinesPhysical
  /// pins it to what the copies actually reached.
  type SpecState = {
    a: PrinterState,
    b: PrinterState,
    c: PrinterState,
    d: PrinterState,
    cursor: QVec,
    eCursor: int,
    off: QVec,
    ready: bool
  }

  /// The event record (flat, per STYLE.md): the step kind, the path
  /// deltas in quantum units, and the X/E words each encoding produced —
  /// enough to read the four G-code lines straight out of a trace.
  type Event = {
    cmd: str,
    hasX: bool, hasY: bool, hasZ: bool, hasE: bool,
    dX: int, dY: int, dZ: int, dE: int,
    wAX: int, wBX: int, wCX: int, wDX: int,
    wAE: int, wBE: int,
    offX: int, offY: int, offZ: int
  }

  var s: SpecState
  var ev: Event

  // --- event derivation (the only place ev strings are born) ----------------

  type EvKind = EInit | ESetup | EMove | EHome

  pure def evTag(k: EvKind): str =
    match k {
      | EInit => "init"
      | ESetup => "setup"
      | EMove => "move"
      | EHome => "home"
    }

  pure def emptyEv(k: EvKind): Event = {
    cmd: evTag(k),
    hasX: false, hasY: false, hasZ: false, hasE: false,
    dX: 0, dY: 0, dZ: 0, dE: 0,
    wAX: 0, wBX: 0, wCX: 0, wDX: 0,
    wAE: 0, wBE: 0,
    offX: 0, offY: 0, offZ: 0
  }

  pure def evMove(st: SpecState, p: PathStep): Event = {
    ...emptyEv(EMove),
    hasX: hasWord(p.x), hasY: hasWord(p.y), hasZ: hasWord(p.z), hasE: hasWord(p.e),
    dX: wordVal(p.x), dY: wordVal(p.y), dZ: wordVal(p.z), dE: wordVal(p.e),
    wAX: wordVal(absWord(st.cursor.x, p.x, MM_WORDS_PER_Q)),
    wBX: wordVal(relWord(p.x)),
    wCX: wordVal(framedWord(st.cursor.x, p.x, st.off.x)),
    wDX: wordVal(absWord(st.cursor.x, p.x, INCH_WORDS_PER_Q)),
    wAE: wordVal(absWord(st.eCursor, p.e, MM_WORDS_PER_Q)),
    wBE: wordVal(relWord(p.e)),
    offX: st.off.x, offY: st.off.y, offZ: st.off.z
  }

  // --- actions ---------------------------------------------------------------

  pure val BARE_HOME: HomeWords = { x: false, y: false, z: false }

  action init = all {
    s' = {
      a: INIT_PRINTER, b: INIT_PRINTER, c: INIT_PRINTER, d: INIT_PRINTER,
      cursor: Q0, eCursor: 0, off: Q0, ready: false
    },
    ev' = emptyEv(EInit)
  }

  /**
   * The setup step, taken exactly once before any path step: every copy
   * homes (identical physical start), then each receives only its own
   * mode/frame prologue — B a G91, C an ordinary G92 that establishes
   * the workspace offset, D a G20. All through the same applyCommand.
   *
   * Authority: Marlin docs — each prologue line is an ordinary
   *   documented command to the interpreter.
   * Design stance: the equivalence construction itself; the offset is
   *   drawn on the quantum grid so C's words stay whole.
   * Exclusions: re-framing or re-moding mid-path (see the encoder
   *   annotation above).
   */
  action setupWith(ox: int, oy: int, oz: int): bool = all {
    not(s.ready),
    s' = {
      a: applyCommand(INIT_PRINTER, Home(BARE_HOME)),
      b: applyAll(INIT_PRINTER, [Home(BARE_HOME), SetPositioningMode(RelativeXYZ)]),
      c: applyAll(INIT_PRINTER, [
        Home(BARE_HOME),
        SetPosition({
          x: Some(ox * MM_WORDS_PER_Q),
          y: Some(oy * MM_WORDS_PER_Q),
          z: Some(oz * MM_WORDS_PER_Q),
          e: None
        })
      ]),
      d: applyAll(INIT_PRINTER, [Home(BARE_HOME), SetUnits(Inches)]),
      cursor: Q0, eCursor: 0,
      off: { x: ox, y: oy, z: oz },
      ready: true
    },
    ev' = { ...emptyEv(ESetup), offX: ox, offY: oy, offZ: oz }
  }

  /// One logical path step: each copy folds its own encoding of the SAME
  /// step through the same applyCommand; the cursors advance along the
  /// mode-free description.
  action moveStep(p: PathStep): bool = all {
    s.ready,
    s' = {
      ...s,
      a: applyCommand(s.a, encodeAbs(s.cursor, s.eCursor, p, MM_WORDS_PER_Q)),
      b: applyCommand(s.b, encodeRel(p)),
      c: applyCommand(s.c, encodeFramed(s.cursor, s.eCursor, p, s.off)),
      d: applyCommand(s.d, encodeAbs(s.cursor, s.eCursor, p, INCH_WORDS_PER_Q)),
      cursor: cursorAfter(s.cursor, p),
      eCursor: qAfter(s.eCursor, p.e)
    },
    ev' = evMove(s, p)
  }

  /// A mid-path bare G28 in all four streams: every copy re-origins
  /// physically, the logical cursor re-bases to zero, C's workspace and
  /// D's units survive (the core homes without touching shift or modes),
  /// and the path continues equivalent.
  action homeAll = all {
    s.ready,
    s' = {
      ...s,
      a: applyCommand(s.a, Home(BARE_HOME)),
      b: applyCommand(s.b, Home(BARE_HOME)),
      c: applyCommand(s.c, Home(BARE_HOME)),
      d: applyCommand(s.d, Home(BARE_HOME)),
      cursor: Q0
      // eCursor unchanged: G28 never touches E
    },
    ev' = emptyEv(EHome)
  }

  // --- generation -------------------------------------------------------------

  /// Path deltas in quantum units; small, signed, zero included (a zero
  /// delta is a physically zero-length word — every encoding must agree
  /// on that too).
  pure val DELTA_WORDS: Set[int] = (-2).to(2)
  /// Per-axis workspace offsets for copy C, in quantum units.
  pure val OFF_BAG: List[int] = [-2, -1, -1, 0, 1, 1, 2]

  action anySetup = {
    nondet ix = OFF_BAG.indices().oneOf()
    nondet iy = OFF_BAG.indices().oneOf()
    nondet iz = OFF_BAG.indices().oneOf()
    setupWith(OFF_BAG[ix], OFF_BAG[iy], OFF_BAG[iz])
  }

  action anyMove = {
    nondet hx = Bool.oneOf()
    nondet hy = Bool.oneOf()
    nondet hz = Bool.oneOf()
    nondet he = Bool.oneOf()
    nondet dx = DELTA_WORDS.oneOf()
    nondet dy = DELTA_WORDS.oneOf()
    nondet dz = DELTA_WORDS.oneOf()
    nondet de = DELTA_WORDS.oneOf()
    moveStep({
      x: if (hx) Some(dx) else None,
      y: if (hy) Some(dy) else None,
      z: if (hz) Some(dz) else None,
      e: if (he) Some(de) else None
    })
  }

  type StepKind = KMove | KHome

  /// Moves dominate; the occasional mid-path home exercises re-basing.
  pure val STEP_MENU: List[StepKind] = [
    KMove, KMove, KMove, KMove, KMove, KMove, KHome
  ]

  /// Always enabled: the first step is the setup, every later step draws
  /// from the menu. No stutter.
  action step =
    if (not(s.ready)) anySetup
    else {
      nondet k = STEP_MENU.indices().oneOf()
      match STEP_MENU[k] {
        | KMove => anyMove
        | KHome => homeAll
      }
    }

  // --- invariants ---------------------------------------------------------------

  /// THE theorem: all four encodings of the same logical path agree on
  /// every physical observable — positions and extruder position — in
  /// every reachable state. The A/B pair is the G90/G91 encoding
  /// equivalence; A/C is the frame equivalence; A/D the units
  /// equivalence. Falsifiable: all copies run the same applyCommand, so
  /// any disagreement can only come from an encoder being wrong.
  val physicalAgreement = and {
    s.a.x.pos == s.b.x.pos, s.a.y.pos == s.b.y.pos, s.a.z.pos == s.b.z.pos,
    s.a.x.pos == s.c.x.pos, s.a.y.pos == s.c.y.pos, s.a.z.pos == s.c.z.pos,
    s.a.x.pos == s.d.x.pos, s.a.y.pos == s.d.y.pos, s.a.z.pos == s.d.z.pos,
    s.a.e == s.b.e, s.a.e == s.c.e, s.a.e == s.d.e
  }

  /// The cursor is the path: the baseline copy's physical state is
  /// exactly the quantum cursor on the centi-mm grid. Together with
  /// physicalAgreement this pins all four copies to the mode-free path
  /// description.
  val cursorDefinesPhysical = s.ready implies and {
    s.a.x.pos == QUANTUM_C * s.cursor.x,
    s.a.y.pos == QUANTUM_C * s.cursor.y,
    s.a.z.pos == QUANTUM_C * s.cursor.z,
    s.a.e == QUANTUM_C * s.eCursor
  }

  /// Each copy keeps the mode/frame its encoding assumes: A plain
  /// absolute mm, B relative XYZ AND relative E (G91 set both — the
  /// core's documented coupling), C's shift exactly -off on the
  /// centi-mm grid, D inches. No command in the path alphabet may
  /// disturb them.
  val encodingModesStable = s.ready implies and {
    not(s.a.relMove), not(s.a.relExtrude), not(s.a.inches),
    s.a.shift == { x: 0, y: 0, z: 0 },
    s.b.relMove, s.b.relExtrude, not(s.b.inches),
    s.b.shift == { x: 0, y: 0, z: 0 },
    not(s.c.relMove), not(s.c.inches),
    s.c.shift == { x: 0 - QUANTUM_C * s.off.x,
                   y: 0 - QUANTUM_C * s.off.y,
                   z: 0 - QUANTUM_C * s.off.z },
    not(s.d.relMove), s.d.inches,
    s.d.shift == { x: 0, y: 0, z: 0 }
  }

  /// Every axis of every copy is known after setup: homing minted the
  /// knowledge and the designed semantics never destroys it — including
  /// in the relative copy, whose moves mint nothing themselves.
  val allAxesKnown = s.ready implies and {
    s.a.x.known, s.a.y.known, s.a.z.known,
    s.b.x.known, s.b.y.known, s.b.z.known,
    s.c.x.known, s.c.y.known, s.c.z.known,
    s.d.x.known, s.d.y.known, s.d.z.known
  }

  /// Before setup nothing has happened in any copy.
  val cleanBeforeSetup = not(s.ready) implies and {
    s.a == INIT_PRINTER, s.b == INIT_PRINTER,
    s.c == INIT_PRINTER, s.d == INIT_PRINTER,
    s.cursor == Q0, s.eCursor == 0, s.off == Q0
  }

  val allInvariants = and {
    physicalAgreement,
    cursorDefinesPhysical,
    encodingModesStable,
    allAxesKnown,
    cleanBeforeSetup
  }

  // --- semantic runs (run with:
  // ---   npx quint test verification/quint-next/interpreter.qnt
  // ---     --main encoding_equivalence_next) -------------------------------------

  /// The quantum is the lcm of the two word grids and the encoders put
  /// every stream on whole words of its own units.
  run quantumGridTest =
    assert(and {
      QUANTUM_C == 12700,
      MM_WORDS_PER_Q * CENTI == QUANTUM_C,
      INCH_WORDS_PER_Q * INCH_CENTI == QUANTUM_C,
      // one step of +2 quanta from cursor 1: the four X words
      absWord(1, Some(2), MM_WORDS_PER_Q) == Some(381),
      relWord(Some(2)) == Some(254),
      framedWord(1, Some(2), -1) == Some(254),
      absWord(1, Some(2), INCH_WORDS_PER_Q) == Some(15),
      // absent deltas encode to absent words everywhere
      absWord(5, None, MM_WORDS_PER_Q) == None,
      relWord(None) == None,
      framedWord(5, None, 2) == None
    })

  /// THE G90/G91 encoding equivalence, concretely: the same two-step
  /// path as absolute targets (A) and as deltas (B) reaches the
  /// identical physical state, through the one applyCommand.
  run g90g91EquivalenceTest =
    init
      .then(setupWith(0, 0, 0))
      .expect(s.ready and s.b.relMove and s.b.relExtrude and allInvariants)
      .then(moveStep({ x: Some(2), y: Some(1), z: None, e: Some(1) }))
      .expect(and {
        // A said "G1 X254 Y127 E127"; B said "G1 X254 Y127 E127" too
        // (first step from origin: target equals delta) — and agreed
        ev.wAX == 254, ev.wBX == 254,
        s.a.x.pos == 2 * QUANTUM_C, s.b.x.pos == 2 * QUANTUM_C,
        s.a.e == QUANTUM_C, s.b.e == QUANTUM_C,
        allInvariants
      })
      .then(moveStep({ x: Some(-1), y: None, z: Some(2), e: Some(-1) }))
      .expect(and {
        // now the words genuinely differ: A re-states targets, B deltas
        ev.wAX == 127, ev.wBX == -127,
        ev.wAE == 0, ev.wBE == -127,
        s.a.x.pos == QUANTUM_C, s.b.x.pos == QUANTUM_C,
        s.a.z.pos == 2 * QUANTUM_C, s.b.z.pos == 2 * QUANTUM_C,
        s.a.e == 0, s.b.e == 0,
        allInvariants
      })

  /// The frame and units columns: through a nonzero G92 workspace and
  /// under G20, the same path lands on the same physical points while
  /// every stream's words differ.
  run frameAndUnitsEquivalenceTest =
    init
      .then(setupWith(1, -1, 0))
      .expect(and {
        s.c.shift == { x: -QUANTUM_C, y: QUANTUM_C, z: 0 },
        s.d.inches,
        allInvariants
      })
      .then(moveStep({ x: Some(2), y: Some(-1), z: None, e: Some(2) }))
      .expect(and {
        ev.wAX == 254, ev.wCX == 381, ev.wDX == 10,
        s.a.x.pos == 2 * QUANTUM_C,
        s.c.x.pos == 2 * QUANTUM_C,
        s.d.x.pos == 2 * QUANTUM_C,
        s.a.y.pos == -QUANTUM_C, s.c.y.pos == -QUANTUM_C,
        s.a.e == 2 * QUANTUM_C, s.d.e == 2 * QUANTUM_C,
        allInvariants
      })
      .then(moveStep({ x: None, y: Some(1), z: Some(-1), e: None }))
      .expect(and {
        s.a.y.pos == 0, s.b.y.pos == 0, s.c.y.pos == 0, s.d.y.pos == 0,
        s.a.z.pos == -QUANTUM_C, s.d.z.pos == -QUANTUM_C,
        allInvariants
      })

  /// A retraction is the same physical event in every encoding: the
  /// state-aware classification agrees across the absolute-word and
  /// delta-word renderings of the same path step (the current
  /// implementation's raw-sign rule would split them).
  run classificationAgreementTest =
    init
      .then(setupWith(0, 0, 0))
      .then(moveStep({ x: None, y: None, z: None, e: Some(2) }))
      .expect(s.a.e == 2 * QUANTUM_C and s.b.e == 2 * QUANTUM_C and allInvariants)
      .then(moveStep({ x: None, y: None, z: None, e: Some(-1) }))
      .expect(and {
        // A's raw E word was positive (127, absolute target below
        // current); B's was negative (-127, delta): same physical pull
        ev.wAE == 127, ev.wBE == -127,
        s.a.e == QUANTUM_C, s.b.e == QUANTUM_C,
        allInvariants
      })
      // and the classification, evaluated per encoding on the PRE state,
      // names both a Retraction
      .expect(and {
        classifyLinear(
          applyAll(INIT_PRINTER, [Home(BARE_HOME), g1e(Some(254))]),
          { code: G1, x: None, y: None, z: None, e: Some(127), f: None }
        ) == Retraction,
        classifyLinear(
          applyAll(INIT_PRINTER,
            [Home(BARE_HOME), SetPositioningMode(RelativeXYZ), g1e(Some(254))]),
          { code: G1, x: None, y: None, z: None, e: Some(-127), f: None }
        ) == Retraction
      })

  /// A mid-path bare G28 re-origins all four copies at once: the cursor
  /// re-bases to zero, C's workspace and D's units survive the homing,
  /// and the continued path still agrees.
  run homeMidPathTest =
    init
      .then(setupWith(2, 0, 0))
      .then(moveStep({ x: Some(1), y: Some(1), z: None, e: Some(1) }))
      .expect(s.a.x.pos == QUANTUM_C and allInvariants)
      .then(homeAll)
      .expect(and {
        ev.cmd == "home",
        s.a.x.pos == 0, s.b.x.pos == 0, s.c.x.pos == 0, s.d.x.pos == 0,
        s.cursor == Q0,
        s.eCursor == 1,                      // E survives homing
        s.a.e == QUANTUM_C, s.b.e == QUANTUM_C,
        s.c.shift.x == -2 * QUANTUM_C,       // workspace survives homing
        s.d.inches,                          // units survive homing
        allInvariants
      })
      .then(moveStep({ x: Some(-1), y: None, z: Some(1), e: None }))
      .expect(and {
        s.a.x.pos == -QUANTUM_C, s.b.x.pos == -QUANTUM_C,
        s.c.x.pos == -QUANTUM_C, s.d.x.pos == -QUANTUM_C,
        ev.wCX == 127,                       // (-1 + off 2) * 127
        allInvariants
      })

  // --- helper for classificationAgreementTest ------------------------------

  pure def g1e(we: Word): Command =
    Linear({ code: G1, x: None, y: None, z: None, e: we, f: None })
}
