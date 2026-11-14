// -*- mode: Bluespec; -*-
/**
 * Formal specification of the gcode-preview interpreter state machine.
 *
 * Models the printer-state effects of the position/extrusion G-codes
 * (G0/G1, G2/G3 arcs, G20/G21, G28, G31/G38.2-G38.5 probes, G92, G92.1,
 * M82/M83, T0..T7) as the library observably executes them, plus the job
 * statistics counters tallied alongside; the vitest ITF replay suite keeps
 * the spec bound to the implementation. All lengths are kept as integers in
 * centi-millimeters (mm * 100) so the spec stays in Int; F words are feedrates
 * the library never converts or stores, so wordF carries the raw word value.
 *
 * The cmd, has and word variables record WHICH command was taken on each step,
 * so an ITF trace of this spec doubles as a G-code program: a replay harness
 * can rebuild the line (e.g. "G2 X10 I5 E-3"), feed it to the real
 * interpreter, and compare the real printer state and job statistics
 * against the spec.
 */
module interpreter {
  // --- trace-contract variables: the command taken on this step ---
  var cmd: str
  var hasX: bool
  var hasY: bool
  var hasZ: bool
  var hasE: bool
  var wordX: int
  var wordY: int
  var wordZ: int
  var wordE: int
  // F word (feedrate): only its presence matters to the interpreter state,
  // where it decides the zero-length move classification
  var hasF: bool
  var wordF: int
  // Arc words (G2/G3). They shape the tessellated polyline only, never the
  // printer State, but the replay needs them to rebuild the real arc line.
  var hasI: bool
  var hasJ: bool
  var hasR: bool
  var wordI: int
  var wordJ: int
  var wordR: int
  // P word: RepRapFirmware's set-trigger-values form of G31 (a probe no-op)
  var hasP: bool

  // --- trace-contract variables: printer state (lengths in centi-mm) ---
  var xKnown: bool
  var yKnown: bool
  var zKnown: bool
  var posX: int
  var posY: int
  var posZ: int
  var e100: int
  var shiftX: int
  var shiftY: int
  var shiftZ: int
  var relExtrude: bool
  var inches: bool
  var homed: bool
  var tool: int

  // --- trace-contract variables: job statistics ---
  // points counts linear moves with at least one axis word plus probe moves;
  // arc moves deliberately leave it alone — pinned behavior: an arc never
  // counts a point. The other four classify zero-length G0/G1 moves.
  var points: int
  var retractions: int
  var deretractions: int
  var feedrateChanges: int
  var others: int

  // Word domains per the trace contract
  pure val XyzWords: Set[int] = (-50).to(50)
  pure val EWords: Set[int] = (-20).to(20)
  pure val FWords: Set[int] = 0.to(60)
  pure val IjWords: Set[int] = (-20).to(20)
  pure val RWords: Set[int] = (-10).to(10)

  /// Current-units -> centi-mm factor (1 inch = 25.4 mm, scaled by 100)
  val fac: int = if (inches) 2540 else 100

  /// E accounting of a move: a relative-mode E word accumulates, an
  /// absolute-mode E word is the new extruder position
  def nextE(he: bool, we: int): int =
    if (not(he)) e100
    else if (relExtrude) e100 + we * fac
    else we * fac

  /// Probe Z target with the probe clamp rule: a probe below the origin
  /// plane (shifted target < 0) from a known Z at or above it triggers at
  /// physical Z0; every other probe travels to the commanded shifted target.
  def probeTargetZ(wz: int): int = {
    val raw = wz * fac + shiftZ
    if (raw < 0 and zKnown and posZ >= 0) 0 else raw
  }

  // --- bookkeeping helpers ---

  /// Record the command and its X/Y/Z/E words
  action recordXyzE(c: str, hx: bool, wx: int, hy: bool, wy: int, hz: bool, wz: int, he: bool, we: int): bool = all {
    cmd' = c,
    hasX' = hx, wordX' = wx,
    hasY' = hy, wordY' = wy,
    hasZ' = hz, wordZ' = wz,
    hasE' = he, wordE' = we
  }

  action recordF(hf: bool, wf: int): bool = all { hasF' = hf, wordF' = wf }

  action recordArcWords(hi: bool, wi: int, hj: bool, wj: int, hr: bool, wr: int): bool = all {
    hasI' = hi, wordI' = wi,
    hasJ' = hj, wordJ' = wj,
    hasR' = hr, wordR' = wr
  }

  action recordP(hp: bool): bool = hasP' = hp

  /// Record a command that carries X/Y/Z/E words at most
  action recordCmd(c: str, hx: bool, wx: int, hy: bool, wy: int, hz: bool, wz: int, he: bool, we: int): bool = all {
    recordXyzE(c, hx, wx, hy, wy, hz, wz, he, we),
    recordF(false, 0),
    recordArcWords(false, 0, false, 0, false, 0),
    recordP(false)
  }

  /// Record a command that carries no words
  action recordBare(c: str): bool = recordCmd(c, false, 0, false, 0, false, 0, false, 0)

  action keepPose = all {
    xKnown' = xKnown, yKnown' = yKnown, zKnown' = zKnown,
    posX' = posX, posY' = posY, posZ' = posZ
  }
  action keepShift = all { shiftX' = shiftX, shiftY' = shiftY, shiftZ' = shiftZ }
  action keepE = e100' = e100
  action keepRel = relExtrude' = relExtrude
  action keepUnits = inches' = inches
  action keepHomed = homed' = homed
  action keepTool = tool' = tool
  action keepCounts = all {
    retractions' = retractions, deretractions' = deretractions,
    feedrateChanges' = feedrateChanges, others' = others
  }
  action keepStats = all { points' = points, keepCounts }

  // --- one action per command class ---

  /// G0/G1 linear move
  action linearMoveFullWith(g: str, hx: bool, wx: int, hy: bool, wy: int, hz: bool, wz: int, he: bool, we: int, hf: bool, wf: int): bool = all {
    recordXyzE(g, hx, wx, hy, wy, hz, wz, he, we),
    recordF(hf, wf),
    recordArcWords(false, 0, false, 0, false, 0),
    recordP(false),
    // each present axis moves to word*fac + shift and becomes known; absent
    // axes are untouched
    posX' = if (hx) wx * fac + shiftX else posX,
    posY' = if (hy) wy * fac + shiftY else posY,
    posZ' = if (hz) wz * fac + shiftZ else posZ,
    xKnown' = (hx or xKnown),
    yKnown' = (hy or yKnown),
    zKnown' = (hz or zKnown),
    e100' = nextE(he, we),
    // Stats, exactly as the library tallies them. A move without axis words
    // is classified by the RAW E word's sign (not the extruded delta, so in
    // absolute mode a positive E that decreases the extruder position still
    // counts as a retraction), falling back to the F word, then "others".
    // A move with at least one axis word only counts a point.
    if (not(hx or hy or hz)) all {
      points' = points,
      retractions' = if (he and we > 0) retractions + 1 else retractions,
      deretractions' = if (he and we < 0) deretractions + 1 else deretractions,
      feedrateChanges' = if (not(he and we != 0) and hf) feedrateChanges + 1 else feedrateChanges,
      others' = if (not(he and we != 0) and not(hf)) others + 1 else others
    } else all {
      points' = points + 1,
      keepCounts
    },
    keepShift, keepRel, keepUnits, keepHomed, keepTool
  }

  /// G0/G1 without an F word, the form the older runs use
  action linearMoveWith(g: str, hx: bool, wx: int, hy: bool, wy: int, hz: bool, wz: int, he: bool, we: int): bool =
    linearMoveFullWith(g, hx, wx, hy, wy, hz, wz, he, we, false, 0)

  /// G2/G3 arc move, printer-state effects only.
  /// The endpoint and E accounting are exactly a linear move's; the I/J/R words
  /// feed the arc tessellation, which emits path points but never writes the
  /// printer state. Degenerate parameter investigation: the tessellation guards
  /// an R-mode whole circle (coincident start and end), a zero radius (I and J
  /// absent or zero), and non-finite segment counts by emitting only the
  /// endpoint, so within the bounded integer word domains above NO combination
  /// of present/absent I/J/R/X/Y/Z/E words aborts the real pipeline — the only
  /// generation constraint the replay needs is those bounded domains themselves.
  /// Stats: an arc increments none of the modeled counters (no points++).
  action arcMoveWith(g: str, hx: bool, wx: int, hy: bool, wy: int, hz: bool, wz: int, he: bool, we: int, hi: bool, wi: int, hj: bool, wj: int, hr: bool, wr: int): bool = all {
    recordXyzE(g, hx, wx, hy, wy, hz, wz, he, we),
    recordF(false, 0),
    recordArcWords(hi, wi, hj, wj, hr, wr),
    recordP(false),
    posX' = if (hx) wx * fac + shiftX else posX,
    posY' = if (hy) wy * fac + shiftY else posY,
    posZ' = if (hz) wz * fac + shiftZ else posZ,
    xKnown' = (hx or xKnown),
    yKnown' = (hy or yKnown),
    zKnown' = (hz or zKnown),
    e100' = nextE(he, we),
    keepStats,
    keepShift, keepRel, keepUnits, keepHomed, keepTool
  }

  /// G31/G38.2-G38.5 straight probe.
  /// A P word (RRF set-trigger-values form) is a no-op before anything else;
  /// so is a probe without any axis words. Otherwise the probe travels to the
  /// shifted targets, with the Z clamp of probeTargetZ, counts a point, and
  /// never touches E (a probe reads no E or F word at all).
  action probeWith(c: str, hp: bool, hx: bool, wx: int, hy: bool, wy: int, hz: bool, wz: int): bool = all {
    recordXyzE(c, hx, wx, hy, wy, hz, wz, false, 0),
    recordF(false, 0),
    recordArcWords(false, 0, false, 0, false, 0),
    recordP(hp),
    if (hp or not(hx or hy or hz)) all {
      keepPose,
      points' = points
    } else all {
      posX' = if (hx) wx * fac + shiftX else posX,
      posY' = if (hy) wy * fac + shiftY else posY,
      posZ' = if (hz) probeTargetZ(wz) else posZ,
      xKnown' = (hx or xKnown),
      yKnown' = (hy or yKnown),
      zKnown' = (hz or zKnown),
      points' = points + 1
    },
    keepCounts,
    keepE, keepShift, keepRel, keepUnits, keepHomed, keepTool
  }

  /// G92 set position — mirrors Marlin's position_shift model: redefines the
  /// logical coordinates without any physical motion
  action setPositionWith(hx: bool, wx: int, hy: bool, wy: int, hz: bool, wz: int, he: bool, we: int): bool = all {
    recordCmd("g92", hx, wx, hy, wy, hz, wz, he, we),
    if (not(hx or hy or hz or he)) all {
      // bare G92: shift := current physical (0 on unknown axes), e := 0
      shiftX' = posX, shiftY' = posY, shiftZ' = posZ,
      e100' = 0
    } else all {
      shiftX' = if (hx) posX - wx * fac else shiftX,
      shiftY' = if (hy) posY - wy * fac else shiftY,
      shiftZ' = if (hz) posZ - wz * fac else shiftZ,
      e100' = if (he) we * fac else e100
    },
    keepPose, keepRel, keepUnits, keepHomed, keepTool, keepStats
  }

  /// G20 — interpret length words as inches
  action inchUnits = all {
    recordBare("g20"), inches' = true,
    keepPose, keepShift, keepE, keepRel, keepHomed, keepTool, keepStats
  }

  /// G21 — interpret length words as millimeters
  action mmUnits = all {
    recordBare("g21"), inches' = false,
    keepPose, keepShift, keepE, keepRel, keepHomed, keepTool, keepStats
  }

  /// G28 — home all axes to the physical origin
  action homeAll = all {
    recordBare("g28"),
    posX' = 0, posY' = 0, posZ' = 0,
    xKnown' = true, yKnown' = true, zKnown' = true,
    homed' = true,
    keepShift, keepE, keepRel, keepUnits, keepTool, keepStats
  }

  /// G92.1 — RepRap bare-reset semantics: clear the workspace shift so
  /// logical coordinates are purely physical again
  action resetShift = all {
    recordBare("g92_1"),
    shiftX' = 0, shiftY' = 0, shiftZ' = 0,
    keepPose, keepE, keepRel, keepUnits, keepHomed, keepTool, keepStats
  }

  /// M82 — absolute extruder addressing
  action absoluteE = all {
    recordBare("m82"), relExtrude' = false,
    keepPose, keepShift, keepE, keepUnits, keepHomed, keepTool, keepStats
  }

  /// M83 — relative extruder addressing
  action relativeE = all {
    recordBare("m83"), relExtrude' = true,
    keepPose, keepShift, keepE, keepUnits, keepHomed, keepTool, keepStats
  }

  /// T0..T7 — select the active tool
  action selectToolWith(c: str, t: int): bool = all {
    recordBare(c), tool' = t,
    keepPose, keepShift, keepE, keepRel, keepUnits, keepHomed, keepStats
  }

  // --- nondeterministic wrappers for simulation ---

  action anyLinearMove = {
    nondet g = Set("g0", "g1").oneOf()
    nondet hx = Bool.oneOf()
    nondet hy = Bool.oneOf()
    nondet hz = Bool.oneOf()
    nondet he = Bool.oneOf()
    nondet hf = Bool.oneOf()
    nondet wx = XyzWords.oneOf()
    nondet wy = XyzWords.oneOf()
    nondet wz = XyzWords.oneOf()
    nondet we = EWords.oneOf()
    nondet wf = FWords.oneOf()
    linearMoveFullWith(g,
      hx, if (hx) wx else 0,
      hy, if (hy) wy else 0,
      hz, if (hz) wz else 0,
      he, if (he) we else 0,
      hf, if (hf) wf else 0)
  }

  action anyArcMove = {
    nondet g = Set("g2", "g3").oneOf()
    nondet hx = Bool.oneOf()
    nondet hy = Bool.oneOf()
    nondet hz = Bool.oneOf()
    nondet he = Bool.oneOf()
    nondet hi = Bool.oneOf()
    nondet hj = Bool.oneOf()
    nondet hr = Bool.oneOf()
    nondet wx = XyzWords.oneOf()
    nondet wy = XyzWords.oneOf()
    nondet wz = XyzWords.oneOf()
    nondet we = EWords.oneOf()
    nondet wi = IjWords.oneOf()
    nondet wj = IjWords.oneOf()
    nondet wr = RWords.oneOf()
    arcMoveWith(g,
      hx, if (hx) wx else 0,
      hy, if (hy) wy else 0,
      hz, if (hz) wz else 0,
      he, if (he) we else 0,
      hi, if (hi) wi else 0,
      hj, if (hj) wj else 0,
      hr, if (hr) wr else 0)
  }

  action anyProbe = {
    nondet c = Set("g31", "g38_2", "g38_3", "g38_4", "g38_5").oneOf()
    nondet hp = Bool.oneOf()
    nondet hx = Bool.oneOf()
    nondet hy = Bool.oneOf()
    nondet hz = Bool.oneOf()
    nondet wx = XyzWords.oneOf()
    nondet wy = XyzWords.oneOf()
    nondet wz = XyzWords.oneOf()
    probeWith(c, hp,
      hx, if (hx) wx else 0,
      hy, if (hy) wy else 0,
      hz, if (hz) wz else 0)
  }

  action anySetPosition = {
    nondet hx = Bool.oneOf()
    nondet hy = Bool.oneOf()
    nondet hz = Bool.oneOf()
    nondet he = Bool.oneOf()
    nondet wx = XyzWords.oneOf()
    nondet wy = XyzWords.oneOf()
    nondet wz = XyzWords.oneOf()
    nondet we = EWords.oneOf()
    setPositionWith(
      hx, if (hx) wx else 0,
      hy, if (hy) wy else 0,
      hz, if (hz) wz else 0,
      he, if (he) we else 0)
  }

  action anySelectTool = {
    nondet pick = Set(
      ("t0", 0), ("t1", 1), ("t2", 2), ("t3", 3),
      ("t4", 4), ("t5", 5), ("t6", 6), ("t7", 7)
    ).oneOf()
    selectToolWith(pick._1, pick._2)
  }

  // --- init and step ---

  action init = all {
    cmd' = "init",
    hasX' = false, hasY' = false, hasZ' = false, hasE' = false,
    wordX' = 0, wordY' = 0, wordZ' = 0, wordE' = 0,
    hasF' = false, wordF' = 0,
    hasI' = false, hasJ' = false, hasR' = false,
    wordI' = 0, wordJ' = 0, wordR' = 0,
    hasP' = false,
    xKnown' = false, yKnown' = false, zKnown' = false,
    posX' = 0, posY' = 0, posZ' = 0,
    e100' = 0,
    shiftX' = 0, shiftY' = 0, shiftZ' = 0,
    relExtrude' = false, inches' = false, homed' = false, tool' = 0,
    points' = 0, retractions' = 0, deretractions' = 0,
    feedrateChanges' = 0, others' = 0
  }

  /// Weighted command pick: moves (linear + arc) ~42%, G92 ~17%, probes ~17%,
  /// the rest shares the remainder, so traces exercise moves, workspace shifts
  /// and probes heavily. Always enabled: a G-code stream never runs out of
  /// commands to take, so no stutter step is needed.
  action step = {
    nondet choice = 1.to(12).oneOf()
    if (choice <= 3) anyLinearMove
    else if (choice <= 5) anyArcMove
    else if (choice <= 7) anySetPosition
    else if (choice <= 9) anyProbe
    else if (choice == 10) any { inchUnits, mmUnits, absoluteE, relativeE }
    else if (choice == 11) any { homeAll, resetShift }
    else anySelectTool
  }

  // --- invariants ---

  val toolInRange = tool >= 0 and tool <= 7

  val unknownAxisIsZero = and {
    not(xKnown) implies posX == 0,
    not(yKnown) implies posY == 0,
    not(zKnown) implies posZ == 0
  }

  val homedImpliesKnown = homed implies (xKnown and yKnown and zKnown)

  val statsNonNegative = and {
    points >= 0, retractions >= 0, deretractions >= 0,
    feedrateChanges >= 0, others >= 0
  }

  val allInvariants = and { toolInRange, unknownAxisIsZero, homedImpliesKnown, statsNonNegative }

  // --- semantic tests (run with: npx quint test verification/quint/interpreter.qnt) ---

  /// G92 X10 followed by G1 X10 leaves the physical position unchanged
  run g92RoundtripTest =
    init
      .then(homeAll)
      .then(linearMoveWith("g1", true, 5, false, 0, false, 0, false, 0))
      .expect(posX == 500)
      .then(setPositionWith(true, 10, false, 0, false, 0, false, 0))
      .expect(shiftX == -500 and posX == 500)
      .then(linearMoveWith("g1", true, 10, false, 0, false, 0, false, 0))
      .expect(posX == 500 and xKnown and shiftX == -500)

  /// bare G92: shift := current physical position, e := 0
  run bareG92Test =
    init
      .then(homeAll)
      .then(linearMoveWith("g1", true, 5, true, -3, true, 2, true, 7))
      .expect(and { posX == 500, posY == -300, posZ == 200, e100 == 700 })
      .then(setPositionWith(false, 0, false, 0, false, 0, false, 0))
      .expect(and {
        shiftX == 500, shiftY == -300, shiftZ == 200, e100 == 0,
        posX == 500, posY == -300, posZ == 200, homed
      })

  /// G92.1 clears the XYZ shift and nothing else (E untouched)
  run g92dot1ResetTest =
    init
      .then(homeAll)
      .then(linearMoveWith("g1", true, 5, false, 0, false, 0, false, 0))
      .then(setPositionWith(true, 10, false, 0, false, 0, true, 3))
      .expect(shiftX == -500 and e100 == 300)
      .then(resetShift)
      .expect(and { shiftX == 0, shiftY == 0, shiftZ == 0, e100 == 300, posX == 500 })

  /// M83 accumulates relative E; M82 treats E words as absolute positions
  run extrusionModeTest =
    init
      .then(linearMoveWith("g1", false, 0, false, 0, false, 0, true, 10))
      .expect(e100 == 1000 and not(relExtrude))
      .then(relativeE)
      .then(linearMoveWith("g1", false, 0, false, 0, false, 0, true, 5))
      .expect(e100 == 1500)
      .then(linearMoveWith("g1", false, 0, false, 0, false, 0, true, -2))
      .expect(e100 == 1300)
      .then(absoluteE)
      .then(linearMoveWith("g1", false, 0, false, 0, false, 0, true, 4))
      .expect(e100 == 400)

  /// G20 then G1 X2 moves to 2 inches = 2 * 2540 centi-mm; G21 restores mm
  run inchUnitsTest =
    init
      .then(inchUnits)
      .then(linearMoveWith("g1", true, 2, false, 0, false, 0, true, 1))
      .expect(and { posX == 5080, xKnown, e100 == 2540, inches })
      .then(mmUnits)
      .then(linearMoveWith("g1", true, 2, false, 0, false, 0, false, 0))
      .expect(posX == 200 and not(inches))

  /// un-homed G92 with words: shift computed against physical 0, position stays unknown
  run unhomedG92Test =
    init
      .then(setPositionWith(true, 10, false, 0, false, 0, true, 5))
      .expect(and {
        shiftX == -1000, e100 == 500,
        posX == 0, not(xKnown), not(homed)
      })

  /// un-homed bare G92: shift := physical which is 0 by convention, e := 0
  run unhomedBareG92Test =
    init
      .then(linearMoveWith("g1", false, 0, false, 0, false, 0, true, 6))
      .expect(e100 == 600)
      .then(setPositionWith(false, 0, false, 0, false, 0, false, 0))
      .expect(and { shiftX == 0, shiftY == 0, shiftZ == 0, e100 == 0, not(homed) })

  /// The zero-length move classification grid: raw E word sign first (even
  /// when the absolute-mode delta has the opposite sign), then F presence,
  /// then "others"; a move with an axis word only counts a point.
  run zeroLengthStatsTest =
    init
      .then(linearMoveFullWith("g1", false, 0, false, 0, false, 0, true, 5, false, 0))
      .expect(retractions == 1 and points == 0 and e100 == 500)
      .then(linearMoveFullWith("g1", false, 0, false, 0, false, 0, true, 2, true, 60))
      // word E2 > 0 counts as a retraction even though the absolute-mode
      // extruder position DROPS from 500 to 200; the F word is outranked
      .expect(retractions == 2 and feedrateChanges == 0 and e100 == 200)
      .then(linearMoveFullWith("g1", false, 0, false, 0, false, 0, true, -3, false, 0))
      .expect(deretractions == 1 and e100 == -300)
      .then(linearMoveFullWith("g1", false, 0, false, 0, false, 0, false, 0, true, 50))
      .expect(feedrateChanges == 1)
      .then(linearMoveFullWith("g1", false, 0, false, 0, false, 0, true, 0, true, 40))
      // an explicit E0 is neither a retraction nor a deretraction: F wins
      .expect(feedrateChanges == 2 and retractions == 2 and e100 == 0)
      .then(linearMoveFullWith("g1", false, 0, false, 0, false, 0, false, 0, false, 0))
      .expect(others == 1)
      .then(linearMoveFullWith("g1", true, 4, false, 0, false, 0, true, 1, true, 30))
      .expect(and {
        points == 1, retractions == 2, deretractions == 1,
        feedrateChanges == 2, others == 1, posX == 400, e100 == 100
      })

  /// M82 and G21 commute: from an inches/relative state, either order reaches
  /// the same state, observed through an identical G1 X2 E3 afterwards.
  run unitsModeCommuteTest =
    init
      .then(inchUnits)
      .then(relativeE)
      .then(absoluteE)
      .then(mmUnits)
      .then(linearMoveWith("g1", true, 2, false, 0, false, 0, true, 3))
      .expect(and { posX == 200, e100 == 300, not(inches), not(relExtrude) })
      .then(init)
      .then(inchUnits)
      .then(relativeE)
      .then(mmUnits)
      .then(absoluteE)
      .then(linearMoveWith("g1", true, 2, false, 0, false, 0, true, 3))
      .expect(and { posX == 200, e100 == 300, not(inches), not(relExtrude) })

  /// G92 X5 and G1 X10 do NOT commute: two run prefixes from the same homed
  /// state reach different physical positions depending on the order.
  run g92MoveNonCommuteTest =
    init
      .then(homeAll)
      .then(setPositionWith(true, 5, false, 0, false, 0, false, 0))
      .then(linearMoveWith("g1", true, 10, false, 0, false, 0, false, 0))
      .expect(posX == 500 and shiftX == -500)
      .then(init)
      .then(homeAll)
      .then(linearMoveWith("g1", true, 10, false, 0, false, 0, false, 0))
      .then(setPositionWith(true, 5, false, 0, false, 0, false, 0))
      .expect(posX == 1000 and shiftX == 500)

  /// Arc endpoint/E semantics: shifted endpoints, absent axes untouched, E
  /// accounted like a linear move, I/J/R ignored by the printer state, and the
  /// points counter untouched by arcs (pinned: an arc never counts a point).
  run arcStateTest =
    init
      .then(homeAll)
      .then(linearMoveWith("g1", true, 10, true, 10, false, 0, true, 1))
      .expect(posX == 1000 and posY == 1000 and e100 == 100 and points == 1)
      .then(arcMoveWith("g2", true, 20, true, 10, false, 0, true, 3, true, 5, true, 0, false, 0))
      .expect(and { posX == 2000, posY == 1000, posZ == 0, e100 == 300, points == 1 })
      .then(setPositionWith(true, 0, false, 0, false, 0, false, 0))
      .expect(shiftX == 2000)
      .then(arcMoveWith("g3", true, 5, false, 0, false, 0, false, 0, false, 0, false, 0, true, 4))
      .expect(and { posX == 2500, posY == 1000, e100 == 300, points == 1 })
      .then(inchUnits)
      .then(arcMoveWith("g2", true, 1, false, 0, false, 0, true, 1, true, 1, false, 0, false, 0))
      .expect(and { posX == 4540, e100 == 2540, points == 1 })

  /// Probe no-op forms and the probe Z clamp: a P word or a lack of axis
  /// words leaves everything untouched; a probe below the origin plane from a
  /// known Z at or above it lands on physical Z0; probes from a negative or
  /// unknown Z travel to the commanded target; each probe move counts a point.
  run probeTest =
    init
      .then(probeWith("g31", true, true, 5, false, 0, false, 0))
      .expect(points == 0 and not(xKnown) and posX == 0)
      .then(probeWith("g38_2", false, false, 0, false, 0, false, 0))
      .expect(points == 0)
      .then(homeAll)
      .then(probeWith("g38_2", false, false, 0, false, 0, true, -5))
      .expect(posZ == 0 and points == 1)
      .then(linearMoveWith("g1", false, 0, false, 0, true, -3, false, 0))
      .expect(posZ == -300 and points == 2)
      .then(probeWith("g31", false, false, 0, false, 0, true, -5))
      .expect(posZ == -500 and points == 3)
      .then(probeWith("g38_4", false, true, 2, false, 0, true, 4))
      .expect(posX == 200 and posZ == 400 and points == 4)
      .then(setPositionWith(false, 0, false, 0, true, 10, false, 0))
      .expect(shiftZ == -600)
      .then(probeWith("g31", false, false, 0, false, 0, true, 2))
      // shifted target 200 - 600 = -400 < 0 from posZ 400 >= 0: clamped to Z0
      .expect(posZ == 0 and points == 5)
      .then(init)
      .then(probeWith("g38_3", false, false, 0, false, 0, true, -2))
      // un-homed Z: the clamp needs a known starting Z, so the probe travels
      .expect(posZ == -200 and zKnown and points == 1 and not(homed))
}
