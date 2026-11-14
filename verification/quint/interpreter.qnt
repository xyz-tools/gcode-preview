// -*- mode: Bluespec; -*-
/**
 * Formal specification of the gcode-preview interpreter state machine.
 *
 * Models the printer-state effects of the position/extrusion G-codes
 * (G0/G1, G20/G21, G28, G92, G92.1, M82/M83, T0..T7) exactly as implemented
 * by the TypeScript handlers in src/interpreter/commands/*. All lengths are
 * kept as integers in centi-millimeters (mm * 100) so the spec stays in Int.
 *
 * The cmd, has and word variables record WHICH command was taken on each step,
 * so an ITF trace of this spec doubles as a G-code program: a replay harness
 * can rebuild the line (e.g. "G1 X10 E-3"), feed it to the real interpreter,
 * and compare the real State against the spec's printer state.
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

  // Word domains per the trace contract
  pure val XyzWords: Set[int] = (-50).to(50)
  pure val EWords: Set[int] = (-20).to(20)

  /// Current-units -> centi-mm factor (src/units.ts toMillimeters, scaled by 100)
  val fac: int = if (inches) 2540 else 100

  /// E accounting of a move (src/state.ts State.applyExtrusion)
  def nextE(he: bool, we: int): int =
    if (not(he)) e100
    else if (relExtrude) e100 + we * fac
    else we * fac

  // --- bookkeeping helpers ---

  /// Record which command (and which words) this step takes
  action recordCmd(c: str, hx: bool, wx: int, hy: bool, wy: int, hz: bool, wz: int, he: bool, we: int): bool = all {
    cmd' = c,
    hasX' = hx, wordX' = wx,
    hasY' = hy, wordY' = wy,
    hasZ' = hz, wordZ' = wz,
    hasE' = he, wordE' = we
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

  // --- one action per command class ---

  /// G0/G1 linear move — src/interpreter/commands/linear-move.ts
  action linearMoveWith(g: str, hx: bool, wx: int, hy: bool, wy: int, hz: bool, wz: int, he: bool, we: int): bool = all {
    recordCmd(g, hx, wx, hy, wy, hz, wz, he, we),
    // each present axis moves to word*fac + shift and becomes known; absent
    // axes are untouched (also covers the zero-length early return in TS)
    posX' = if (hx) wx * fac + shiftX else posX,
    posY' = if (hy) wy * fac + shiftY else posY,
    posZ' = if (hz) wz * fac + shiftZ else posZ,
    xKnown' = (hx or xKnown),
    yKnown' = (hy or yKnown),
    zKnown' = (hz or zKnown),
    e100' = nextE(he, we),
    keepShift, keepRel, keepUnits, keepHomed, keepTool
  }

  /// G92 set position — src/interpreter/commands/set-position.ts
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
    keepPose, keepRel, keepUnits, keepHomed, keepTool
  }

  /// G20 inches — src/interpreter/commands/set-units.ts (setInchUnits)
  action inchUnits = all {
    recordBare("g20"), inches' = true,
    keepPose, keepShift, keepE, keepRel, keepHomed, keepTool
  }

  /// G21 millimeters — src/interpreter/commands/set-units.ts (setMillimeterUnits)
  action mmUnits = all {
    recordBare("g21"), inches' = false,
    keepPose, keepShift, keepE, keepRel, keepHomed, keepTool
  }

  /// G28 home all axes — src/interpreter/commands/home.ts
  action homeAll = all {
    recordBare("g28"),
    posX' = 0, posY' = 0, posZ' = 0,
    xKnown' = true, yKnown' = true, zKnown' = true,
    homed' = true,
    keepShift, keepE, keepRel, keepUnits, keepTool
  }

  /// G92.1 reset workspace shift — src/interpreter/commands/reset-position-shift.ts
  action resetShift = all {
    recordBare("g92_1"),
    shiftX' = 0, shiftY' = 0, shiftZ' = 0,
    keepPose, keepE, keepRel, keepUnits, keepHomed, keepTool
  }

  /// M82 absolute E — src/interpreter/commands/set-extrusion-mode.ts (setAbsoluteExtrusion)
  action absoluteE = all {
    recordBare("m82"), relExtrude' = false,
    keepPose, keepShift, keepE, keepUnits, keepHomed, keepTool
  }

  /// M83 relative E — src/interpreter/commands/set-extrusion-mode.ts (setRelativeExtrusion)
  action relativeE = all {
    recordBare("m83"), relExtrude' = true,
    keepPose, keepShift, keepE, keepUnits, keepHomed, keepTool
  }

  /// T0..T7 tool select — src/interpreter/commands/select-tool.ts
  action selectToolWith(c: str, t: int): bool = all {
    recordBare(c), tool' = t,
    keepPose, keepShift, keepE, keepRel, keepUnits, keepHomed
  }

  // --- nondeterministic wrappers for simulation ---

  action anyLinearMove = {
    nondet g = Set("g0", "g1").oneOf()
    nondet hx = Bool.oneOf()
    nondet hy = Bool.oneOf()
    nondet hz = Bool.oneOf()
    nondet he = Bool.oneOf()
    nondet wx = XyzWords.oneOf()
    nondet wy = XyzWords.oneOf()
    nondet wz = XyzWords.oneOf()
    nondet we = EWords.oneOf()
    linearMoveWith(g,
      hx, if (hx) wx else 0,
      hy, if (hy) wy else 0,
      hz, if (hz) wz else 0,
      he, if (he) we else 0)
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
    xKnown' = false, yKnown' = false, zKnown' = false,
    posX' = 0, posY' = 0, posZ' = 0,
    e100' = 0,
    shiftX' = 0, shiftY' = 0, shiftZ' = 0,
    relExtrude' = false, inches' = false, homed' = false, tool' = 0
  }

  /// Weighted command pick: moves 40%, G92 30%, the rest shares the remainder,
  /// so traces exercise moves and workspace shifts heavily.
  action step = {
    nondet choice = 1.to(10).oneOf()
    if (choice <= 4) anyLinearMove
    else if (choice <= 7) anySetPosition
    else if (choice == 8) any { inchUnits, mmUnits, absoluteE, relativeE }
    else if (choice == 9) any { homeAll, resetShift }
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

  val allInvariants = and { toolInRange, unknownAxisIsZero, homedImpliesKnown }

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
}
