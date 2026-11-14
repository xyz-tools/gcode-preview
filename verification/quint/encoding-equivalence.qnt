// -*- mode: Bluespec; -*-
/**
 * Shift-frame encoding equivalence of the gcode-preview interpreter
 * (unit IS-3 of the verification map, ShiftFrameEquivalence half).
 *
 * The module holds TWO copies of the interpreter's printer state, prefixed
 * a/b. Copy A starts clean and receives every command as written. Copy B
 * starts clean too, but the FIRST step ("frame") establishes a G92-shifted
 * workspace: B executes `G92 X<offX> Y<offY> Z<offZ>` while A executes
 * nothing. Every later step picks one logical command; A executes it as-is
 * and B executes the re-encoded version: each present X/Y/Z move word is
 * shifted by the chosen offset (word + off), so the physical target is
 * identical; E words, G28, M82 and M83 are identical in both streams.
 * Further G92s after the frame step are deliberately forbidden, so B's
 * shift is frozen at the frame values for the whole trace.
 *
 * Modeled command semantics:
 *   G0/G1  linear move           (physical = word + shift)
 *   G28    home all axes         (pos := 0, homed, shift kept)
 *   G92    set position          (shift := physical - word)
 *   M82/83 extruder addressing   (absolute / relative E)
 * Units stay 'mm' throughout (G20/G21 are out of scope here), tools are not
 * modeled, and all lengths are integers in centi-millimeters (mm * 100).
 *
 * The cmd, has and word variables record copy A's command line and the
 * bWord variables the re-encoded words of copy B's line, so an ITF trace
 * doubles as TWO G-code programs that a replay harness can feed to two
 * real jobs and compare.
 */
module encoding_equivalence {
  // --- trace-contract variables: the command taken on this step ---
  var cmd: str
  var hasX: bool
  var hasY: bool
  var hasZ: bool
  var hasE: bool
  // copy A's words, as written in the unshifted frame
  var wordX: int
  var wordY: int
  var wordZ: int
  var wordE: int
  // copy B's re-encoded words (X/Y/Z shifted by the frame offset; E identical)
  var bWordX: int
  var bWordY: int
  var bWordZ: int
  var bWordE: int

  // --- the chosen workspace frame of copy B ---
  var frameSet: bool
  var offX: int
  var offY: int
  var offZ: int

  // --- copy A: printer state in the unshifted frame (lengths in centi-mm) ---
  var aXKnown: bool
  var aYKnown: bool
  var aZKnown: bool
  var aPosX: int
  var aPosY: int
  var aPosZ: int
  var aE100: int
  var aRel: bool
  var aHomed: bool

  // --- copy B: printer state in the G92-shifted frame (lengths in centi-mm) ---
  var bXKnown: bool
  var bYKnown: bool
  var bZKnown: bool
  var bPosX: int
  var bPosY: int
  var bPosZ: int
  var bE100: int
  var bShiftX: int
  var bShiftY: int
  var bShiftZ: int
  var bRel: bool
  var bHomed: bool

  // Word domains (in mm, scaled by 100 inside the state)
  pure val XyzWords: Set[int] = (-50).to(50)
  pure val EWords: Set[int] = (-20).to(20)
  pure val OffsetWords: Set[int] = (-30).to(30)

  /// E accounting of copy A (relative accumulates, absolute replaces; always mm)
  def nextAE(he: bool, we: int): int =
    if (not(he)) aE100 else if (aRel) aE100 + we * 100 else we * 100

  /// E accounting of copy B
  def nextBE(he: bool, we: int): int =
    if (not(he)) bE100 else if (bRel) bE100 + we * 100 else we * 100

  // --- bookkeeping helpers ---

  /// Record the step: command, A's words, and B's re-encoded X/Y/Z words.
  /// E is never part of the workspace shift, so bWordE is always wordE.
  action recordStep(c: str, hx: bool, awx: int, bwx: int, hy: bool, awy: int, bwy: int, hz: bool, awz: int, bwz: int, he: bool, we: int): bool = all {
    cmd' = c,
    hasX' = hx, wordX' = awx, bWordX' = bwx,
    hasY' = hy, wordY' = awy, bWordY' = bwy,
    hasZ' = hz, wordZ' = awz, bWordZ' = bwz,
    hasE' = he, wordE' = we, bWordE' = we
  }

  /// Record a command that carries no words (identical in both streams)
  action recordBare(c: str): bool = recordStep(c, false, 0, 0, false, 0, 0, false, 0, 0, false, 0)

  action keepFrame = all { frameSet' = frameSet, offX' = offX, offY' = offY, offZ' = offZ }
  action keepAPose = all {
    aXKnown' = aXKnown, aYKnown' = aYKnown, aZKnown' = aZKnown,
    aPosX' = aPosX, aPosY' = aPosY, aPosZ' = aPosZ
  }
  action keepBPose = all {
    bXKnown' = bXKnown, bYKnown' = bYKnown, bZKnown' = bZKnown,
    bPosX' = bPosX, bPosY' = bPosY, bPosZ' = bPosZ
  }
  action keepBShift = all { bShiftX' = bShiftX, bShiftY' = bShiftY, bShiftZ' = bShiftZ }
  action keepEs = all { aE100' = aE100, bE100' = bE100 }
  action keepRels = all { aRel' = aRel, bRel' = bRel }
  action keepHomes = all { aHomed' = aHomed, bHomed' = bHomed }

  // --- one action per step class ---

  /// The frame step: B executes `G92 X(ox) Y(oy) Z(oz)` while B is still
  /// clean (an unknown axis's physical position resolves to 0, the library's
  /// un-homed convention), so bShift becomes -off * 100 by the G92 rule
  /// shift := physical - word.
  /// A executes nothing on this step (the replay feeds A no line).
  action frameWith(ox: int, oy: int, oz: int): bool = all {
    not(frameSet),
    recordStep("frame", true, 0, ox, true, 0, oy, true, 0, oz, false, 0),
    frameSet' = true, offX' = ox, offY' = oy, offZ' = oz,
    bShiftX' = bPosX - ox * 100,
    bShiftY' = bPosY - oy * 100,
    bShiftZ' = bPosZ - oz * 100,
    keepAPose, keepBPose, keepEs, keepRels, keepHomes
  }

  /// G0/G1 linear move.
  /// A executes the words as-is (zero shift); B executes word + off against
  /// its frozen G92 shift, landing on the identical physical target. Also
  /// covers the degenerate zero-length form: with no X/Y/Z words only E moves.
  action moveWith(g: str, hx: bool, wx: int, hy: bool, wy: int, hz: bool, wz: int, he: bool, we: int): bool = all {
    frameSet,
    recordStep(g,
      hx, wx, if (hx) wx + offX else 0,
      hy, wy, if (hy) wy + offY else 0,
      hz, wz, if (hz) wz + offZ else 0,
      he, we),
    aPosX' = if (hx) wx * 100 else aPosX,
    aPosY' = if (hy) wy * 100 else aPosY,
    aPosZ' = if (hz) wz * 100 else aPosZ,
    aXKnown' = (hx or aXKnown),
    aYKnown' = (hy or aYKnown),
    aZKnown' = (hz or aZKnown),
    aE100' = nextAE(he, we),
    bPosX' = if (hx) (wx + offX) * 100 + bShiftX else bPosX,
    bPosY' = if (hy) (wy + offY) * 100 + bShiftY else bPosY,
    bPosZ' = if (hz) (wz + offZ) * 100 + bShiftZ else bPosZ,
    bXKnown' = (hx or bXKnown),
    bYKnown' = (hy or bYKnown),
    bZKnown' = (hz or bZKnown),
    bE100' = nextBE(he, we),
    keepFrame, keepBShift, keepRels, keepHomes
  }

  /// G28 home all axes in BOTH streams.
  /// The physical position goes to 0 in both copies; B's workspace shift is
  /// untouched (mirroring Marlin's position_shift model, homing never clears
  /// the G92 shift), so the frames stay apart.
  action homeBoth = all {
    frameSet,
    recordBare("g28"),
    aPosX' = 0, aPosY' = 0, aPosZ' = 0,
    aXKnown' = true, aYKnown' = true, aZKnown' = true,
    aHomed' = true,
    bPosX' = 0, bPosY' = 0, bPosZ' = 0,
    bXKnown' = true, bYKnown' = true, bZKnown' = true,
    bHomed' = true,
    keepFrame, keepBShift, keepEs, keepRels
  }

  /// M82 — absolute extruder addressing in both streams
  action absoluteE = all {
    frameSet,
    recordBare("m82"),
    aRel' = false, bRel' = false,
    keepFrame, keepAPose, keepBPose, keepBShift, keepEs, keepHomes
  }

  /// M83 — relative extruder addressing in both streams
  action relativeE = all {
    frameSet,
    recordBare("m83"),
    aRel' = true, bRel' = true,
    keepFrame, keepAPose, keepBPose, keepBShift, keepEs, keepHomes
  }

  // --- nondeterministic wrappers for simulation ---

  action anyFrame = {
    nondet ox = OffsetWords.oneOf()
    nondet oy = OffsetWords.oneOf()
    nondet oz = OffsetWords.oneOf()
    frameWith(ox, oy, oz)
  }

  action anyMove = {
    nondet g = Set("g0", "g1").oneOf()
    nondet hx = Bool.oneOf()
    nondet hy = Bool.oneOf()
    nondet hz = Bool.oneOf()
    nondet he = Bool.oneOf()
    nondet wx = XyzWords.oneOf()
    nondet wy = XyzWords.oneOf()
    nondet wz = XyzWords.oneOf()
    nondet we = EWords.oneOf()
    moveWith(g,
      hx, if (hx) wx else 0,
      hy, if (hy) wy else 0,
      hz, if (hz) wz else 0,
      he, if (he) we else 0)
  }

  // --- init and step ---

  action init = all {
    cmd' = "init",
    hasX' = false, hasY' = false, hasZ' = false, hasE' = false,
    wordX' = 0, wordY' = 0, wordZ' = 0, wordE' = 0,
    bWordX' = 0, bWordY' = 0, bWordZ' = 0, bWordE' = 0,
    frameSet' = false, offX' = 0, offY' = 0, offZ' = 0,
    aXKnown' = false, aYKnown' = false, aZKnown' = false,
    aPosX' = 0, aPosY' = 0, aPosZ' = 0,
    aE100' = 0, aRel' = false, aHomed' = false,
    bXKnown' = false, bYKnown' = false, bZKnown' = false,
    bPosX' = 0, bPosY' = 0, bPosZ' = 0,
    bE100' = 0,
    bShiftX' = 0, bShiftY' = 0, bShiftZ' = 0,
    bRel' = false, bHomed' = false
  }

  /// The first step always establishes B's frame; afterwards the step picks
  /// a command, weighted towards moves (70% moves, 20% E mode, 10% homing).
  /// Always enabled: frames, moves, modes and homing are never blocked.
  action step =
    if (not(frameSet)) anyFrame
    else {
      nondet choice = 1.to(10).oneOf()
      if (choice <= 7) anyMove
      else if (choice <= 9) any { absoluteE, relativeE }
      else homeBoth
    }

  // --- invariants ---

  /// The headline equivalence: after the frame step the two copies agree on
  /// every physical observable — positions, known flags, E, mode, homing.
  val frameAgreement = frameSet implies and {
    aPosX == bPosX, aPosY == bPosY, aPosZ == bPosZ,
    aXKnown == bXKnown, aYKnown == bYKnown, aZKnown == bZKnown,
    aE100 == bE100,
    aRel == bRel,
    aHomed == bHomed
  }

  /// No G92 after the frame step, so B's shift stays at the frame values
  val shiftFrozen = frameSet implies and {
    bShiftX == -offX * 100,
    bShiftY == -offY * 100,
    bShiftZ == -offZ * 100
  }

  /// Before the frame step nothing has happened in either copy
  val cleanBeforeFrame = not(frameSet) implies and {
    aPosX == 0, aPosY == 0, aPosZ == 0, not(aXKnown), not(aHomed), aE100 == 0,
    bPosX == 0, bPosY == 0, bPosZ == 0, not(bXKnown), not(bHomed), bE100 == 0,
    bShiftX == 0, bShiftY == 0, bShiftZ == 0
  }

  /// Un-moved, un-homed axes sit at the 0 convention in both copies
  val unknownAxisIsZero = and {
    not(aXKnown) implies aPosX == 0,
    not(aYKnown) implies aPosY == 0,
    not(aZKnown) implies aPosZ == 0,
    not(bXKnown) implies bPosX == 0,
    not(bYKnown) implies bPosY == 0,
    not(bZKnown) implies bPosZ == 0
  }

  val allInvariants = and { frameAgreement, shiftFrozen, cleanBeforeFrame, unknownAxisIsZero }

  // --- semantic tests (run with: npx quint test verification/quint/encoding-equivalence.qnt) ---

  /// Moves through an X+7/Y-4/Z+2 shifted frame land on identical physical
  /// targets, including a partial-axis move that leaves Y untouched
  run frameOffsetMoveTest =
    init
      .then(frameWith(7, -4, 2))
      .expect(and { bShiftX == -700, bShiftY == 400, bShiftZ == -200, frameSet })
      .then(homeBoth)
      .then(moveWith("g1", true, 10, true, 20, true, 1, true, 5))
      .expect(and {
        aPosX == 1000, aPosY == 2000, aPosZ == 100, aE100 == 500,
        bPosX == 1000, bPosY == 2000, bPosZ == 100, bE100 == 500,
        bWordX == 17, bWordY == 16, bWordZ == 3
      })
      .then(moveWith("g0", true, -3, false, 0, false, 0, false, 0))
      .expect(and { aPosX == -300, bPosX == -300, aPosY == 2000, bPosY == 2000 })

  /// G28 resets both frames to the identical physical origin while B's
  /// workspace shift survives, so later shifted moves still agree
  run homeResetsBothFramesTest =
    init
      .then(frameWith(10, 10, 10))
      .then(moveWith("g1", true, 5, true, 5, true, 5, false, 0))
      .expect(and { aPosX == 500, bPosX == 500 })
      .then(homeBoth)
      .expect(and {
        aPosX == 0, aPosY == 0, aPosZ == 0, aHomed,
        bPosX == 0, bPosY == 0, bPosZ == 0, bHomed,
        bShiftX == -1000, bShiftY == -1000, bShiftZ == -1000
      })
      .then(moveWith("g1", true, 8, false, 0, false, 0, false, 0))
      .expect(and { aPosX == 800, bPosX == 800, bWordX == 18 })

  /// M82/M83 switches are frame-independent: E words are never shifted and
  /// the two copies keep identical extruder accounting through both modes
  run extrusionModeFrameIndependentTest =
    init
      .then(frameWith(-9, 3, 0))
      .then(moveWith("g1", false, 0, false, 0, false, 0, true, 10))
      .expect(and { aE100 == 1000, bE100 == 1000, not(aRel), not(bRel) })
      .then(relativeE)
      .expect(aRel and bRel)
      .then(moveWith("g1", true, 4, false, 0, false, 0, true, -2))
      .expect(and { aE100 == 800, bE100 == 800, aPosX == 400, bPosX == 400, bWordX == -5 })
      .then(absoluteE)
      .then(moveWith("g1", false, 0, false, 0, false, 0, true, 3))
      .expect(and { aE100 == 300, bE100 == 300, not(aRel), not(bRel) })

  /// An un-homed start: axes become known one move at a time, identically in
  /// both frames, and the untouched axes stay unknown at the 0 convention
  run unhomedStartTest =
    init
      .then(frameWith(6, 0, -5))
      .expect(and { not(aHomed), not(bHomed), not(aXKnown), not(bXKnown) })
      .then(moveWith("g1", true, 12, false, 0, false, 0, false, 0))
      .expect(and {
        aXKnown, bXKnown, aPosX == 1200, bPosX == 1200,
        not(aYKnown), not(bYKnown), aPosY == 0, bPosY == 0,
        not(aZKnown), not(bZKnown), not(aHomed), not(bHomed),
        bWordX == 18
      })
      .then(moveWith("g1", false, 0, false, 0, true, -7, false, 0))
      .expect(and { aZKnown, bZKnown, aPosZ == -700, bPosZ == -700, not(aYKnown), not(bYKnown) })

  /// A zero offset is a legitimate frame: B's G92 X0 Y0 Z0 pins the current
  /// logical coordinates and both streams carry identical words afterwards
  run zeroOffsetFrameTest =
    init
      .then(frameWith(0, 0, 0))
      .expect(and { bShiftX == 0, bShiftY == 0, bShiftZ == 0, frameSet })
      .then(moveWith("g1", true, 25, true, -25, false, 0, true, 1))
      .expect(and {
        aPosX == 2500, bPosX == 2500, aPosY == -2500, bPosY == -2500,
        aE100 == 100, bE100 == 100,
        bWordX == 25, bWordY == -25
      })
}
