// -*- mode: Bluespec; -*-
/**
 * encoding_equivalence — v2 shift-frame encoding equivalence of the
 * gcode-preview interpreter, rebuilt to be falsifiable.
 *
 * Unit: IS-3 (encoding equivalences, ShiftFrameEquivalence half) in
 *   .context/formal-verification/mapping-data.json. The UnitsReadTimeOnly
 *   half is OPEN — see the companion's Open items.
 * Authority policy: verification/quint-v2/STYLE.md ("Authority
 *   annotations"). Command semantics and their per-variant annotations live
 *   in lib/printer-core.qnt; this machine only annotates its own
 *   constructs (the re-encoding and the frame step).
 * Companion: encoding-equivalence.md.
 *
 * The machine holds TWO copies of the shared PrinterState. Copy A receives
 * every logical command as written; copy B receives reencode(c, frame) —
 * the same command translated into a G92-shifted workspace. BOTH copies
 * fold the one imported printer_core::applyCommand, so the headline
 * invariant (physicalAgreement) genuinely checks that re-encoding and
 * interpretation commute: a mis-transcription of reencode, of the frame
 * bookkeeping, or an asymmetry smuggled into either fold falsifies it.
 * Nothing here re-transcribes a command's state effect.
 *
 * The alphabet is the full core command set: G0/G1, G2/G3 arcs, G20/G21,
 * G28 (with carried axis-word flags), G31/G38.2-G38.5 probes, G92 in word
 * and bare forms AFTER the frame (re-encoded against the live frame),
 * G92.1 (which collapses both workspaces onto the machine frame, so the
 * live frame offset becomes zero and the streams continue textually
 * identical), M82/M83 and T0-T7.
 *
 * Frame offsets live on the FRAME_QUANTUM grid (12700 centi-mm = 127 mm =
 * 5 in = lcm of the two word grids), so a physical offset re-expresses as
 * an integer word increment under either units mode and the whole trace
 * stays on the integer centi-mm grid.
 */
module encoding_equivalence {
  import scale.* from "./lib/scale"
  import printer_core.* from "./lib/printer-core"

  // --- the frame -------------------------------------------------------

  /// The frame-offset grid: lcm(CENTI, INCH_CENTI) = 12700 centi-mm, the
  /// coarsest grid on which a physical offset divides exactly into whole
  /// words under both G20 and G21 (see scale.qnt; pinned by
  /// frameQuantumTest below).
  pure val FRAME_QUANTUM: int = 127 * CENTI

  pure val ZERO_SHIFT: Shift = { x: 0, y: 0, z: 0 }

  /// The live re-encoding frame: the physical offset (centi-mm) between
  /// copy B's logical workspace and copy A's, plus the units mode the next
  /// line's words will be read in.
  type Frame = { off: Shift, inches: bool }

  /// Word increment that re-expresses a centi-mm frame offset in the
  /// current units. Exact by construction: offC is always a FRAME_QUANTUM
  /// multiple and both length factors divide FRAME_QUANTUM.
  pure def wordOffset(offC: int, inches: bool): int =
    offC / lengthFactor(inches)

  /// Re-encode one optional axis word into the frame: present words gain
  /// the offset re-expressed in the current units, absent words stay
  /// absent.
  pure def shiftWord(w: Word, offC: int, inches: bool): Word =
    match w {
      | Some(v) => Some(v + wordOffset(offC, inches))
      | None => None
    }

  /**
   * The re-encoding contract: translate a logical command into copy B's
   * workspace. Present X/Y/Z words gain the frame offset (re-expressed in
   * the current units); E and F words, arc I/J/R words (relative offsets),
   * probe P flags, G28 axis flags and every modal command pass through
   * unchanged. A bare G92 (reset all axes and E to zero) re-encodes as the
   * word form that gives the current position B-frame coordinates
   * (off re-expressed as words) with an explicit E0.
   *
   * Authority: Marlin docs (G92 workspace offsets / position_shift) for
   *   what a shifted workspace means; the translation itself is a
   *   spec-level construct with no firmware counterpart.
   * Library stance: library-invented — the re-encoding is the theorem's
   *   witness, pinned so that the pair (reencode, applyCommand) commutes
   *   on physical observables. I/J/R words are deliberately NOT shifted
   *   (they are relative offsets — pinned in the core's Arc annotation).
   * Exclusions: units re-expression (encoding the same program in inches
   *   vs millimeters) is not a frame this function can produce — OPEN, see
   *   the companion; offsets off the FRAME_QUANTUM grid are excluded so
   *   words stay integral.
   */
  pure def reencode(c: Command, fr: Frame): Command =
    match c {
      | Linear(m) => Linear({
          code: m.code,
          x: shiftWord(m.x, fr.off.x, fr.inches),
          y: shiftWord(m.y, fr.off.y, fr.inches),
          z: shiftWord(m.z, fr.off.z, fr.inches),
          e: m.e,
          f: m.f
        })
      | Arc(m) => Arc({
          code: m.code,
          x: shiftWord(m.x, fr.off.x, fr.inches),
          y: shiftWord(m.y, fr.off.y, fr.inches),
          z: shiftWord(m.z, fr.off.z, fr.inches),
          e: m.e,
          i: m.i,
          j: m.j,
          r: m.r
        })
      | Probe(m) => Probe({
          code: m.code,
          p: m.p,
          x: shiftWord(m.x, fr.off.x, fr.inches),
          y: shiftWord(m.y, fr.off.y, fr.inches),
          z: shiftWord(m.z, fr.off.z, fr.inches)
        })
      | SetPosition(m) =>
          if (not(hasAxisWord(m.x, m.y, m.z) or hasWord(m.e)))
            // bare G92: "all logical coordinates and E become zero" means
            // "become the frame offset" in B's workspace, E0 explicit
            SetPosition({
              x: Some(wordOffset(fr.off.x, fr.inches)),
              y: Some(wordOffset(fr.off.y, fr.inches)),
              z: Some(wordOffset(fr.off.z, fr.inches)),
              e: Some(0)
            })
          else
            SetPosition({
              x: shiftWord(m.x, fr.off.x, fr.inches),
              y: shiftWord(m.y, fr.off.y, fr.inches),
              z: shiftWord(m.z, fr.off.z, fr.inches),
              e: m.e
            })
      | SetUnits(u) => SetUnits(u)
      | Home(h) => Home(h)
      | ResetShift => ResetShift
      | SetExtrusionMode(m) => SetExtrusionMode(m)
      | SelectTool(t) => SelectTool(t)
    }

  /// Frame evolution: a G92.1 clears both copies' workspace shifts, so the
  /// offset separating the two encodings collapses to zero and the streams
  /// continue identically; every other command preserves the offset (word
  /// G92s move both shifts in lockstep, bare G92s re-pin both to the same
  /// relation — checked by shiftContract).
  pure def nextOff(off: Shift, c: Command): Shift =
    match c {
      | ResetShift => ZERO_SHIFT
      | _ => off
    }

  // --- machine state ----------------------------------------------------

  /// Both printer-state copies, the live frame offset (centi-mm, on the
  /// FRAME_QUANTUM grid), whether the frame step has run, and a ghost flag
  /// recording that a G92.1 ever fired (for resetCollapsesFrame).
  type SpecState = {
    a: PrinterState,
    b: PrinterState,
    off: Shift,
    framed: bool,
    ghostResetSeen: bool
  }

  /// The trace contract: the step's command tag, copy A's words, copy B's
  /// re-encoded X/Y/Z words, and the shared unshifted words — enough for a
  /// replay to rebuild both real G-code lines. For Home events hasX/Y/Z
  /// are the carried axis-word flags ("G28 X"); for a bare G92 (bare:
  /// true) stream A's line is the bare "G92" and bX/bY/bZ hold B's
  /// translated words.
  type Event = {
    cmd: str,
    bare: bool,
    hasX: bool, hasY: bool, hasZ: bool, hasE: bool, hasF: bool,
    hasI: bool, hasJ: bool, hasR: bool,
    probeP: bool,
    aX: int, aY: int, aZ: int,
    bX: int, bY: int, bZ: int,
    wE: int, wF: int, wI: int, wJ: int, wR: int
  }

  var s: SpecState
  var ev: Event

  // --- event derivation (the only place ev strings are born) ------------

  type EvKind = EInit | EFrame | ECmd(Command)

  pure def evTag(k: EvKind): str =
    match k {
      | EInit => "init"
      | EFrame => "frame"
      | ECmd(c) => cmdTag(c)
    }

  pure def wordOr0(w: Word): int =
    match w {
      | Some(v) => v
      | None => 0
    }

  pure def emptyEv(tag: str): Event = {
    cmd: tag,
    bare: false,
    hasX: false, hasY: false, hasZ: false, hasE: false, hasF: false,
    hasI: false, hasJ: false, hasR: false,
    probeP: false,
    aX: 0, aY: 0, aZ: 0,
    bX: 0, bY: 0, bZ: 0,
    wE: 0, wF: 0, wI: 0, wJ: 0, wR: 0
  }

  /// The event for a step where copy A executes c. B's axis words are
  /// derived through the same shiftWord/wordOffset defs reencode uses, so
  /// the trace and the transition cannot disagree on the arithmetic;
  /// reencodeShapeTest pins that the unshifted fields (E/F/I/J/R) match
  /// reencode's contract.
  pure def evOf(c: Command, fr: Frame): Event =
    match c {
      | Linear(m) => {
          ...emptyEv(evTag(ECmd(c))),
          hasX: hasWord(m.x), aX: wordOr0(m.x), bX: wordOr0(shiftWord(m.x, fr.off.x, fr.inches)),
          hasY: hasWord(m.y), aY: wordOr0(m.y), bY: wordOr0(shiftWord(m.y, fr.off.y, fr.inches)),
          hasZ: hasWord(m.z), aZ: wordOr0(m.z), bZ: wordOr0(shiftWord(m.z, fr.off.z, fr.inches)),
          hasE: hasWord(m.e), wE: wordOr0(m.e),
          hasF: hasWord(m.f), wF: wordOr0(m.f)
        }
      | Arc(m) => {
          ...emptyEv(evTag(ECmd(c))),
          hasX: hasWord(m.x), aX: wordOr0(m.x), bX: wordOr0(shiftWord(m.x, fr.off.x, fr.inches)),
          hasY: hasWord(m.y), aY: wordOr0(m.y), bY: wordOr0(shiftWord(m.y, fr.off.y, fr.inches)),
          hasZ: hasWord(m.z), aZ: wordOr0(m.z), bZ: wordOr0(shiftWord(m.z, fr.off.z, fr.inches)),
          hasE: hasWord(m.e), wE: wordOr0(m.e),
          hasI: hasWord(m.i), wI: wordOr0(m.i),
          hasJ: hasWord(m.j), wJ: wordOr0(m.j),
          hasR: hasWord(m.r), wR: wordOr0(m.r)
        }
      | Probe(m) => {
          ...emptyEv(evTag(ECmd(c))),
          probeP: m.p,
          hasX: hasWord(m.x), aX: wordOr0(m.x), bX: wordOr0(shiftWord(m.x, fr.off.x, fr.inches)),
          hasY: hasWord(m.y), aY: wordOr0(m.y), bY: wordOr0(shiftWord(m.y, fr.off.y, fr.inches)),
          hasZ: hasWord(m.z), aZ: wordOr0(m.z), bZ: wordOr0(shiftWord(m.z, fr.off.z, fr.inches))
        }
      | SetPosition(m) =>
          if (not(hasAxisWord(m.x, m.y, m.z) or hasWord(m.e)))
            {
              ...emptyEv(evTag(ECmd(c))),
              bare: true,
              bX: wordOffset(fr.off.x, fr.inches),
              bY: wordOffset(fr.off.y, fr.inches),
              bZ: wordOffset(fr.off.z, fr.inches)
            }
          else {
            ...emptyEv(evTag(ECmd(c))),
            hasX: hasWord(m.x), aX: wordOr0(m.x), bX: wordOr0(shiftWord(m.x, fr.off.x, fr.inches)),
            hasY: hasWord(m.y), aY: wordOr0(m.y), bY: wordOr0(shiftWord(m.y, fr.off.y, fr.inches)),
            hasZ: hasWord(m.z), aZ: wordOr0(m.z), bZ: wordOr0(shiftWord(m.z, fr.off.z, fr.inches)),
            hasE: hasWord(m.e), wE: wordOr0(m.e)
          }
      | Home(h) => {
          ...emptyEv(evTag(ECmd(c))),
          hasX: h.x, hasY: h.y, hasZ: h.z
        }
      | _ => emptyEv(evTag(ECmd(c)))
    }

  // --- THE paired transition ---------------------------------------------

  pure def frameOf(st: SpecState): Frame = { off: st.off, inches: st.a.inches }

  /// Both copies advance through the SAME printer_core::applyCommand: A on
  /// the command as written, B on its re-encoding against the live frame.
  pure def nextPair(st: SpecState, c: Command): SpecState = {
    a: applyCommand(st.a, c),
    b: applyCommand(st.b, reencode(c, frameOf(st))),
    off: nextOff(st.off, c),
    framed: st.framed,
    ghostResetSeen: st.ghostResetSeen or (match c { | ResetShift => true | _ => false })
  }

  // --- actions -----------------------------------------------------------

  action init = all {
    s' = { a: INIT_PRINTER, b: INIT_PRINTER, off: ZERO_SHIFT, framed: false, ghostResetSeen: false },
    ev' = emptyEv(evTag(EInit))
  }

  /**
   * The frame step: copy B alone executes `G92 X.. Y.. Z..` (the offset
   * re-expressed as words) while A receives no line, establishing the
   * workspace that separates the two encodings. Only ever taken as the
   * first step, while both copies are still at INIT_PRINTER, so B's
   * resulting shift is exactly -off and shiftContract starts true.
   *
   * Authority: Marlin docs (G92) — the frame is an ordinary G92 to the
   *   real interpreter.
   * Library stance: library-invented — the asymmetric step (a line for B,
   *   none for A) is the equivalence construction itself, pinned.
   * Exclusions: re-framing mid-trace (after content or after a G92.1) is
   *   not modeled — word integrality cannot be guaranteed against an
   *   arbitrary reached position; OPEN in the companion.
   */
  action frameWith(ox: int, oy: int, oz: int): bool = all {
    not(s.framed),
    s' = {
      a: s.a,
      b: applyCommand(s.b, SetPosition({
        x: Some(wordOffset(ox, s.a.inches)),
        y: Some(wordOffset(oy, s.a.inches)),
        z: Some(wordOffset(oz, s.a.inches)),
        e: None
      })),
      off: { x: ox, y: oy, z: oz },
      framed: true,
      ghostResetSeen: s.ghostResetSeen
    },
    ev' = {
      ...emptyEv(evTag(EFrame)),
      hasX: true, hasY: true, hasZ: true,
      bX: wordOffset(ox, s.a.inches),
      bY: wordOffset(oy, s.a.inches),
      bZ: wordOffset(oz, s.a.inches)
    }
  }

  /// One post-frame step: A executes c, B executes its re-encoding.
  action take(c: Command): bool = all {
    s.framed,
    s' = nextPair(s, c),
    ev' = evOf(c, frameOf(s))
  }

  // --- generators ---------------------------------------------------------

  pure def mkWord(present: bool, v: int): Word =
    if (present) Some(v) else None

  pure val XYZ_WORDS: Set[int] = (-50).to(50)
  pure val E_WORDS: Set[int] = (-20).to(20)
  pure val F_WORDS: Set[int] = Set(300, 900, 1500, 3000, 6000)
  pure val ARC_IJ_WORDS: Set[int] = (-20).to(20)

  /// Per-axis frame offsets in FRAME_QUANTUM multiples, weighted toward
  /// nonzero (a zero axis offset is legitimate but exercises less).
  pure val OFF_BAG: List[int] = [-2, -1, -1, 0, 1, 1, 2]

  /// P-word presence on probes: mostly acting probes, some pinned no-ops.
  pure val PROBE_P_BAG: List[bool] = [false, false, false, true]

  action anyFrame = {
    nondet ix = OFF_BAG.indices().oneOf()
    nondet iy = OFF_BAG.indices().oneOf()
    nondet iz = OFF_BAG.indices().oneOf()
    frameWith(OFF_BAG[ix] * FRAME_QUANTUM, OFF_BAG[iy] * FRAME_QUANTUM, OFF_BAG[iz] * FRAME_QUANTUM)
  }

  action anyLinear = {
    nondet code = Set(G0, G1).oneOf()
    nondet hx = Bool.oneOf()
    nondet hy = Bool.oneOf()
    nondet hz = Bool.oneOf()
    nondet he = Bool.oneOf()
    nondet hf = Bool.oneOf()
    nondet wx = XYZ_WORDS.oneOf()
    nondet wy = XYZ_WORDS.oneOf()
    nondet wz = XYZ_WORDS.oneOf()
    nondet we = E_WORDS.oneOf()
    nondet wf = F_WORDS.oneOf()
    take(Linear({
      code: code,
      x: mkWord(hx, wx), y: mkWord(hy, wy), z: mkWord(hz, wz),
      e: mkWord(he, we), f: mkWord(hf, wf)
    }))
  }

  /// Arcs carry both X and Y endpoints and an I/J center (never both zero),
  /// the form every slicer emits; R-form arcs are excluded from the random
  /// corpus (reencodeShapeTest pins that R passes through unshifted) —
  /// see the companion's Open items.
  action anyArc = {
    nondet code = Set(G2, G3).oneOf()
    nondet wx = XYZ_WORDS.oneOf()
    nondet wy = XYZ_WORDS.oneOf()
    nondet hz = Bool.oneOf()
    nondet wz = XYZ_WORDS.oneOf()
    nondet he = Bool.oneOf()
    nondet we = E_WORDS.oneOf()
    nondet wi = ARC_IJ_WORDS.oneOf()
    nondet wj = ARC_IJ_WORDS.oneOf()
    take(Arc({
      code: code,
      x: Some(wx), y: Some(wy), z: mkWord(hz, wz), e: mkWord(he, we),
      i: Some(wi),
      j: Some(if (wi == 0 and wj == 0) 5 else wj),
      r: None
    }))
  }

  action anyProbe = {
    nondet code = Set(G31, G38_2, G38_3, G38_4, G38_5).oneOf()
    nondet ip = PROBE_P_BAG.indices().oneOf()
    nondet hx = Bool.oneOf()
    nondet hy = Bool.oneOf()
    nondet hz = Bool.oneOf()
    nondet wx = XYZ_WORDS.oneOf()
    nondet wy = XYZ_WORDS.oneOf()
    nondet wz = XYZ_WORDS.oneOf()
    take(Probe({
      code: code,
      p: PROBE_P_BAG[ip],
      x: mkWord(hx, wx), y: mkWord(hy, wy), z: mkWord(hz, wz)
    }))
  }

  /// Word-form G92 with at least one word (X is forced present when the
  /// draw picked none, so the bare form stays the dedicated step kind).
  action anySetPos = {
    nondet hx = Bool.oneOf()
    nondet hy = Bool.oneOf()
    nondet hz = Bool.oneOf()
    nondet he = Bool.oneOf()
    nondet wx = XYZ_WORDS.oneOf()
    nondet wy = XYZ_WORDS.oneOf()
    nondet wz = XYZ_WORDS.oneOf()
    nondet we = E_WORDS.oneOf()
    take(SetPosition({
      x: mkWord(hx or not(hx or hy or hz or he), wx),
      y: mkWord(hy, wy),
      z: mkWord(hz, wz),
      e: mkWord(he, we)
    }))
  }

  action bareSetPos = take(SetPosition({ x: None, y: None, z: None, e: None }))

  action anyUnits = {
    nondet u = Set(Inches, Millimeters).oneOf()
    take(SetUnits(u))
  }

  action anyHome = {
    nondet hx = Bool.oneOf()
    nondet hy = Bool.oneOf()
    nondet hz = Bool.oneOf()
    take(Home({ x: hx, y: hy, z: hz }))
  }

  action anyEMode = {
    nondet m = Set(AbsoluteE, RelativeE).oneOf()
    take(SetExtrusionMode(m))
  }

  action anyTool = {
    nondet t = 0.to(7).oneOf()
    take(SelectTool(t))
  }

  // --- weighted step ------------------------------------------------------

  type StepKind = KLinear | KArc | KProbe | KSetPos | KBareSetPos | KReset
    | KUnits | KHome | KEMode | KTool

  /// Weights live in data: each kind appears as many times as its weight
  /// (25 entries). Moves dominate; G92.1 is deliberately rare because it
  /// permanently collapses the frame, after which the streams are
  /// identical (still replayed, but exercising less of the re-encoding).
  pure val STEP_MENU: List[StepKind] = [
    KLinear, KLinear, KLinear, KLinear, KLinear, KLinear, KLinear,
    KArc, KArc, KArc,
    KProbe, KProbe,
    KSetPos, KSetPos, KSetPos,
    KBareSetPos,
    KReset,
    KUnits, KUnits, KUnits,
    KHome, KHome,
    KEMode, KEMode,
    KTool
  ]

  action dispatch(k: StepKind): bool =
    match k {
      | KLinear => anyLinear
      | KArc => anyArc
      | KProbe => anyProbe
      | KSetPos => anySetPos
      | KBareSetPos => bareSetPos
      | KReset => take(ResetShift)
      | KUnits => anyUnits
      | KHome => anyHome
      | KEMode => anyEMode
      | KTool => anyTool
    }

  /// Always enabled: the first step establishes the frame, every later
  /// step draws from the weighted menu. The machine never exhausts, so
  /// there is no stutter.
  action step =
    if (not(s.framed)) anyFrame
    else {
      nondet k = STEP_MENU.indices().oneOf()
      dispatch(STEP_MENU[k])
    }

  // --- invariants ----------------------------------------------------------

  /// The headline theorem: the two copies agree on every physical
  /// observable — positions with their known flags, extruder position,
  /// extrusion mode, units mode, homed flag and active tool. Falsifiable:
  /// both copies run the same applyCommand, so any divergence can only
  /// come from the re-encoding contract being wrong.
  val physicalAgreement = and {
    s.a.x == s.b.x,
    s.a.y == s.b.y,
    s.a.z == s.b.z,
    s.a.e == s.b.e,
    s.a.relExtrude == s.b.relExtrude,
    s.a.inches == s.b.inches,
    s.a.homed == s.b.homed,
    s.a.tool == s.b.tool
  }

  /// The re-encoding contract on workspaces: B's shift trails A's by
  /// exactly the live frame offset on every axis, through word G92s, bare
  /// G92s, G92.1 and homing alike.
  val shiftContract = s.framed implies and {
    s.b.shift.x == s.a.shift.x - s.off.x,
    s.b.shift.y == s.a.shift.y - s.off.y,
    s.b.shift.z == s.a.shift.z - s.off.z
  }

  /// The live offset never leaves the FRAME_QUANTUM grid (what keeps every
  /// re-encoded word integral under both units modes).
  val offOnQuantum = and {
    (s.off.x / FRAME_QUANTUM) * FRAME_QUANTUM == s.off.x,
    (s.off.y / FRAME_QUANTUM) * FRAME_QUANTUM == s.off.y,
    (s.off.z / FRAME_QUANTUM) * FRAME_QUANTUM == s.off.z
  }

  /// Ghost: once a G92.1 has fired, the frame offset is zero forever —
  /// nothing in the alphabet can re-establish a divergent frame.
  val resetCollapsesFrame = s.ghostResetSeen implies s.off == ZERO_SHIFT

  /// Before the frame step nothing has happened in either copy.
  val cleanBeforeFrame = not(s.framed) implies and {
    s.a == INIT_PRINTER,
    s.b == INIT_PRINTER,
    s.off == ZERO_SHIFT,
    not(s.ghostResetSeen)
  }

  /// The library's un-commanded-axis convention, in both copies: an axis
  /// nothing has addressed reads physical zero.
  val unknownAxisReadsZero = and {
    not(s.a.x.known) implies s.a.x.pos == 0,
    not(s.a.y.known) implies s.a.y.pos == 0,
    not(s.a.z.known) implies s.a.z.pos == 0,
    not(s.b.x.known) implies s.b.x.pos == 0,
    not(s.b.y.known) implies s.b.y.pos == 0,
    not(s.b.z.known) implies s.b.z.pos == 0
  }

  val allInvariants = and {
    physicalAgreement,
    shiftContract,
    offOnQuantum,
    resetCollapsesFrame,
    cleanBeforeFrame,
    unknownAxisReadsZero
  }

  // --- semantic tests (run with:
  // ---   npx quint test verification/quint-v2/encoding-equivalence.qnt) ---

  pure val HOME_BARE: HomeWords = { x: false, y: false, z: false }

  pure def g1(wx: Word, wy: Word, wz: Word, we: Word): Command =
    Linear({ code: G1, x: wx, y: wy, z: wz, e: we, f: None })

  pure def g92w(wx: Word, wy: Word, wz: Word, we: Word): Command =
    SetPosition({ x: wx, y: wy, z: wz, e: we })

  pure val BARE_G92: Command = SetPosition({ x: None, y: None, z: None, e: None })

  /// The quantum is exactly the lcm of the two word grids, so offsets
  /// re-express as whole words under both G20 and G21.
  run frameQuantumTest =
    assert(and {
      FRAME_QUANTUM == 12700,
      (FRAME_QUANTUM / CENTI) * CENTI == FRAME_QUANTUM,
      (FRAME_QUANTUM / INCH_CENTI) * INCH_CENTI == FRAME_QUANTUM,
      wordOffset(FRAME_QUANTUM, false) == 127,
      wordOffset(FRAME_QUANTUM, true) == 5,
      wordOffset(-2 * FRAME_QUANTUM, true) == -10
    })

  /// The re-encoding's shape: XYZ words gain the offset, E/F/I/J/R and P
  /// pass through, bare G92 becomes the word form with E0, and modal
  /// commands re-encode to themselves.
  run reencodeShapeTest = {
    val fr: Frame = { off: { x: FRAME_QUANTUM, y: -FRAME_QUANTUM, z: 0 }, inches: false }
    assert(and {
      reencode(Arc({ code: G2, x: Some(10), y: Some(5), z: None, e: Some(2), i: Some(3), j: Some(-4), r: None }), fr)
        == Arc({ code: G2, x: Some(137), y: Some(-122), z: None, e: Some(2), i: Some(3), j: Some(-4), r: None }),
      reencode(Arc({ code: G3, x: Some(1), y: Some(1), z: None, e: None, i: None, j: None, r: Some(20) }), fr)
        == Arc({ code: G3, x: Some(128), y: Some(-126), z: None, e: None, i: None, j: None, r: Some(20) }),
      reencode(Linear({ code: G0, x: None, y: None, z: None, e: Some(-3), f: Some(900) }), fr)
        == Linear({ code: G0, x: None, y: None, z: None, e: Some(-3), f: Some(900) }),
      reencode(Probe({ code: G38_2, p: true, x: Some(4), y: None, z: Some(-6) }), fr)
        == Probe({ code: G38_2, p: true, x: Some(131), y: None, z: Some(-6) }),
      reencode(BARE_G92, fr) == g92w(Some(127), Some(-127), Some(0), Some(0)),
      reencode(g92w(None, None, None, Some(7)), fr) == g92w(None, None, None, Some(7)),
      reencode(SetUnits(Inches), fr) == SetUnits(Inches),
      reencode(Home({ x: true, y: false, z: false }), fr) == Home({ x: true, y: false, z: false }),
      reencode(ResetShift, fr) == ResetShift,
      reencode(SetExtrusionMode(RelativeE), fr) == SetExtrusionMode(RelativeE),
      reencode(SelectTool(3), fr) == SelectTool(3)
    })
  }

  /// Moves through an X+127/Y-127 shifted frame land on identical physical
  /// targets, including a partial-axis move; the trace carries B's words.
  run framedMoveAgreementTest =
    init
      .then(frameWith(FRAME_QUANTUM, -FRAME_QUANTUM, 0))
      .expect(and {
        s.framed,
        s.b.shift == { x: -FRAME_QUANTUM, y: FRAME_QUANTUM, z: 0 },
        ev.cmd == "frame", ev.bX == 127, ev.bY == -127, ev.bZ == 0,
        allInvariants
      })
      .then(take(Home(HOME_BARE)))
      .expect(and { s.a.homed, s.b.homed, allInvariants })
      .then(take(g1(Some(10), Some(20), None, Some(5))))
      .expect(and {
        s.a.x.pos == 1000, s.b.x.pos == 1000,
        s.a.y.pos == 2000, s.b.y.pos == 2000,
        s.a.e == 500, s.b.e == 500,
        ev.aX == 10, ev.bX == 137, ev.aY == 20, ev.bY == -107,
        allInvariants
      })
      .then(take(g1(Some(-3), None, None, None)))
      .expect(and { s.a.x.pos == -300, s.b.x.pos == -300, s.a.y.pos == 2000, s.b.y.pos == 2000, allInvariants })

  /// A word G92 AFTER content moves both shifts in lockstep; later moves
  /// still agree. This is the post-frame G92 v1 forbade.
  run postFrameG92Test =
    init
      .then(frameWith(FRAME_QUANTUM, 0, 0))
      .then(take(Home(HOME_BARE)))
      .then(take(g1(Some(10), None, None, None)))
      .expect(and { s.a.x.pos == 1000, s.b.x.pos == 1000, allInvariants })
      .then(take(g92w(Some(2), None, None, None)))
      .expect(and {
        s.a.shift.x == 800,
        s.b.shift.x == 800 - FRAME_QUANTUM,
        ev.aX == 2, ev.bX == 129,
        allInvariants
      })
      .then(take(g1(Some(5), None, None, None)))
      .expect(and { s.a.x.pos == 1300, s.b.x.pos == 1300, allInvariants })

  /// A bare G92 re-encodes as the word form that re-pins B's workspace:
  /// E goes to zero in both copies and the shift contract survives.
  run bareG92ReencodedTest =
    init
      .then(frameWith(0, FRAME_QUANTUM, 0))
      .then(take(g1(Some(10), Some(10), None, Some(7))))
      .expect(and { s.a.y.pos == 1000, s.b.y.pos == 1000, s.a.e == 700, allInvariants })
      .then(take(BARE_G92))
      .expect(and {
        ev.bare, ev.cmd == "g92", ev.bY == 127,
        s.a.e == 0, s.b.e == 0,
        s.a.shift == { x: 1000, y: 1000, z: 0 },
        s.b.shift == { x: 1000, y: 1000 - FRAME_QUANTUM, z: 0 },
        allInvariants
      })
      .then(take(g1(None, Some(3), None, None)))
      .expect(and { s.a.y.pos == 1300, s.b.y.pos == 1300, allInvariants })

  /// G92.1 collapses both workspaces onto the machine frame: the live
  /// offset becomes zero, the streams continue textually identical, and a
  /// later bare G92 re-pins both copies in lockstep.
  run resetCollapseTest =
    init
      .then(frameWith(FRAME_QUANTUM, FRAME_QUANTUM, FRAME_QUANTUM))
      .then(take(Home(HOME_BARE)))
      .then(take(g1(Some(10), None, None, None)))
      .expect(and { s.a.x.pos == 1000, s.b.x.pos == 1000, allInvariants })
      .then(take(ResetShift))
      .expect(and {
        s.off == ZERO_SHIFT,
        s.ghostResetSeen,
        s.a.shift == ZERO_SHIFT, s.b.shift == ZERO_SHIFT,
        allInvariants
      })
      .then(take(g1(Some(4), None, None, None)))
      .expect(and { ev.aX == 4, ev.bX == 4, s.a.x.pos == 400, s.b.x.pos == 400, allInvariants })
      .then(take(BARE_G92))
      .expect(and {
        ev.bare, ev.bX == 0, ev.bY == 0, ev.bZ == 0,
        s.a.shift == s.b.shift,
        allInvariants
      })

  /// G20 re-expresses the frame offset as whole inch words: the same
  /// physical targets under inch words, then back to millimeters.
  run inchModeFrameTest =
    init
      .then(frameWith(FRAME_QUANTUM, 0, 0))
      .then(take(SetUnits(Inches)))
      .expect(and { s.a.inches, s.b.inches, allInvariants })
      .then(take(g1(Some(2), None, None, Some(1))))
      .expect(and {
        s.a.x.pos == 5080, s.b.x.pos == 5080,
        s.a.e == 2540, s.b.e == 2540,
        ev.aX == 2, ev.bX == 7,
        allInvariants
      })
      .then(take(SetUnits(Millimeters)))
      .then(take(g1(Some(2), None, None, None)))
      .expect(and { s.a.x.pos == 200, s.b.x.pos == 200, ev.bX == 129, allInvariants })

  /// A bare G92 under G20: the offset re-expresses as inch words and the
  /// shift contract holds on the inch grid too.
  run inchBareG92Test =
    init
      .then(frameWith(FRAME_QUANTUM, 0, 0))
      .then(take(SetUnits(Inches)))
      .then(take(g1(Some(2), None, None, None)))
      .expect(and { s.a.x.pos == 5080, s.b.x.pos == 5080, allInvariants })
      .then(take(BARE_G92))
      .expect(and {
        ev.bare, ev.bX == 5,
        s.a.shift.x == 5080,
        s.b.shift.x == 5080 - FRAME_QUANTUM,
        allInvariants
      })
      .then(take(g1(Some(1), None, None, None)))
      .expect(and { s.a.x.pos == 7620, s.b.x.pos == 7620, ev.bX == 6, allInvariants })

  /// The probe z-clamp fires identically in both encodings: the shifted
  /// targets resolve to the same physical plane crossing.
  run probeClampUnderFrameTest =
    init
      .then(frameWith(0, 0, -FRAME_QUANTUM))
      .then(take(Home(HOME_BARE)))
      .then(take(Probe({ code: G38_2, p: false, x: None, y: None, z: Some(-5) })))
      .expect(and {
        s.a.z.pos == 0, s.b.z.pos == 0, s.a.z.known, s.b.z.known,
        ev.aZ == -5, ev.bZ == -132,
        allInvariants
      })
      .then(take(Probe({ code: G31, p: true, x: Some(9), y: None, z: None })))
      // the P word makes the probe a pinned no-op: X stays at the homed origin
      .expect(and { ev.probeP, s.a.x == s.b.x, s.a.x.pos == 0, s.a.x.known, allInvariants })

  /// G28 rehomes both copies to the same physical origin while the frame
  /// offset and both workspace shifts survive, so later moves still agree.
  run homeKeepsFrameTest =
    init
      .then(frameWith(FRAME_QUANTUM, 0, 0))
      .then(take(g1(Some(5), Some(5), Some(5), None)))
      .then(take(Home({ x: true, y: false, z: false })))
      .expect(and {
        ev.cmd == "g28", ev.hasX, not(ev.hasY),
        s.a.x.pos == 0, s.b.x.pos == 0, s.a.homed, s.b.homed,
        s.b.shift.x == -FRAME_QUANTUM,
        allInvariants
      })
      .then(take(g1(Some(8), None, None, None)))
      .expect(and { s.a.x.pos == 800, s.b.x.pos == 800, ev.bX == 135, allInvariants })

  /// A zero offset on every axis is a legitimate frame: B's G92 X0 Y0 Z0
  /// pins the current logical coordinates and both streams carry identical
  /// words afterwards.
  run zeroOffsetFrameTest =
    init
      .then(frameWith(0, 0, 0))
      .expect(and { s.b.shift == ZERO_SHIFT, s.framed, allInvariants })
      .then(take(g1(Some(25), Some(-25), None, Some(1))))
      .expect(and {
        s.a.x.pos == 2500, s.b.x.pos == 2500,
        ev.aX == 25, ev.bX == 25,
        allInvariants
      })

  /// Arc endpoints re-encode like linear endpoints while I/J stay relative
  /// and unshifted; the state agreement and E accounting carry through.
  run arcUnderFrameTest =
    init
      .then(frameWith(FRAME_QUANTUM, -FRAME_QUANTUM, 0))
      .then(take(Home(HOME_BARE)))
      .then(take(g1(Some(10), Some(10), None, Some(1))))
      .then(take(Arc({ code: G2, x: Some(20), y: Some(10), z: None, e: Some(3), i: Some(5), j: Some(0), r: None })))
      .expect(and {
        s.a.x.pos == 2000, s.b.x.pos == 2000,
        s.a.y.pos == 1000, s.b.y.pos == 1000,
        s.a.e == 300, s.b.e == 300,
        ev.cmd == "g2", ev.bX == 147, ev.bY == -117,
        ev.hasI, ev.wI == 5, ev.hasJ, ev.wJ == 0, not(ev.hasR),
        allInvariants
      })

  /// Modal commands and tools re-encode to themselves and stay in lockstep
  /// across the frame.
  run modesAndToolsTest =
    init
      .then(frameWith(-FRAME_QUANTUM, 0, 0))
      .then(take(SetExtrusionMode(RelativeE)))
      .expect(and { s.a.relExtrude, s.b.relExtrude, ev.cmd == "m83", allInvariants })
      .then(take(g1(None, None, None, Some(10))))
      .then(take(g1(None, None, None, Some(-2))))
      .expect(and { s.a.e == 800, s.b.e == 800, allInvariants })
      .then(take(SetExtrusionMode(AbsoluteE)))
      .then(take(g1(None, None, None, Some(4))))
      .expect(and { s.a.e == 400, s.b.e == 400, allInvariants })
      .then(take(SelectTool(6)))
      .expect(and { s.a.tool == 6, s.b.tool == 6, ev.cmd == "t6", allInvariants })
}
