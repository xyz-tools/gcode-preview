// -*- mode: Bluespec; -*-
/**
 * printer_core — THE single printer-state semantics shared by every v2
 * machine that interprets position/extrusion G-codes.
 *
 * Unit: interpreter-state map, foundations of IS-2 (G92 offset-model laws),
 *   IS-3 (encoding equivalences), IS-4 (safety cluster) and IS-6 (command
 *   footprint) in .context/formal-verification/mapping-data.json.
 * Authority policy: verification/quint-v2/STYLE.md ("Authority
 *   annotations"). Every Command variant below carries its own
 *   Authority / Library stance / Exclusions block; divergences from
 *   firmware documentation are pinned decisions, stated neutrally.
 * Companion: printer-core.md.
 *
 * This module is pure: one record type (PrinterState), one Command sum
 * type, one transition function applyCommand. Machines import it, keep
 * `var s: ...State` records, and reduce actions to recording an event and
 * `s' = ...applyCommand(s, c)...`. Equivalence machines fold the SAME
 * applyCommand over both of their copies, so agreement between two
 * encodings is a theorem about one function, not about two transcriptions.
 *
 * All lengths are centi-millimeters (see lib/scale.qnt). XYZ addressing is
 * always absolute: G90/G91 are unregistered no-ops in the modeled library,
 * so there is exactly one positioning mode — a pinned decision, recorded
 * here once for every machine that imports this module.
 */
module printer_core {
  import scale.* from "./scale"

  // --- optional words -------------------------------------------------

  /// An optional G-code word. Absent words never read as zero by
  /// convention; they are simply Absent, and each consumer states what
  /// absence means for it.
  type Word =
    | Some(int)
    | None

  /// Whether a word is present on the line.
  pure def hasWord(w: Word): bool =
    match w {
      | Some(_) => true
      | None => false
    }

  /// Whether at least one of the three axis words is present.
  pure def hasAxisWord(wx: Word, wy: Word, wz: Word): bool =
    hasWord(wx) or hasWord(wy) or hasWord(wz)

  // --- printer state ---------------------------------------------------

  /// One axis: whether anything has commanded it yet, and its physical
  /// position in centi-mm. An axis that was never commanded reads 0.
  type AxisState = { known: bool, pos: int }

  /// The workspace shift created by G92, per axis, in centi-mm.
  /// Defining equation (checked as a ghost invariant by the machines that
  /// import this module, not here — this module has no state):
  /// physical = logical + shift on every commanded axis.
  type Shift = { x: int, y: int, z: int }

  /// The full printer state every v2 interpreter-flavored machine folds.
  type PrinterState = {
    x: AxisState,
    y: AxisState,
    z: AxisState,
    // Extruder position in centi-mm. Deliberately excluded from Shift.
    e: int,
    shift: Shift,
    // true after M83 (relative E accounting), false after M82 (absolute).
    relExtrude: bool,
    // true after G20 (length words are inches), false after G21 (mm).
    inches: bool,
    // true after G28; nothing un-homes.
    homed: bool,
    // Active tool index, set by T0..T7.
    tool: int
  }

  /// The state before any command: axes unknown at 0, no shift, absolute
  /// extrusion, millimeters, un-homed, tool 0.
  pure val INIT_PRINTER: PrinterState = {
    x: { known: false, pos: 0 },
    y: { known: false, pos: 0 },
    z: { known: false, pos: 0 },
    e: 0,
    shift: { x: 0, y: 0, z: 0 },
    relExtrude: false,
    inches: false,
    homed: false,
    tool: 0
  }

  // --- command alphabet ------------------------------------------------

  /// G0 (travel) vs G1 (feed). Both have identical printer-state effects;
  /// the distinction matters to geometry machines and to the replayed line.
  type LinearCode = G0 | G1

  /// G2 (clockwise) vs G3 (counter-clockwise) arc.
  type ArcCode = G2 | G3

  /// Straight-probe family: G31 plus the G38.2..G38.5 quartet.
  type ProbeCode = G31 | G38_2 | G38_3 | G38_4 | G38_5

  /// G20 inches vs G21 millimeters.
  type UnitsMode = Inches | Millimeters

  /// M82 absolute vs M83 relative extruder addressing.
  type ExtrusionMode = AbsoluteE | RelativeE

  /// Word payload of a linear move.
  type LinearWords = { code: LinearCode, x: Word, y: Word, z: Word, e: Word, f: Word }

  /// Word payload of an arc move. I/J/R shape the tessellated polyline
  /// only; they are carried so a replay can rebuild the real line, and
  /// they never touch PrinterState.
  type ArcWords = { code: ArcCode, x: Word, y: Word, z: Word, e: Word, i: Word, j: Word, r: Word }

  /// Word payload of a probe. p records the presence of a P word (its
  /// value is irrelevant by pinned decision — see the Probe annotation).
  type ProbeWords = { code: ProbeCode, p: bool, x: Word, y: Word, z: Word }

  /// Word payload of G92. The bare form is the all-None payload.
  type SetPositionWords = { x: Word, y: Word, z: Word, e: Word }

  /// Axis-word PRESENCE flags on a G28 line. Carried for the trace so a
  /// replay can emit "G28 X"; the semantics ignores them (pinned — see
  /// the Home annotation).
  type HomeWords = { x: bool, y: bool, z: bool }

  type Command =
    // G0/G1 — linear move: each present axis goes to its unit-scaled,
    // shifted target and becomes known; absent axes hold; E follows the
    // extrusion mode.
    // Authority: Marlin docs (G0-G1) and RepRap wiki G0/G1 — move to the
    //   given coordinates.
    // Library stance: conforms for X/Y/Z endpoint and E accounting;
    //   pinned-divergence — XYZ addressing is always absolute (G90/G91
    //   are unregistered no-ops, one positioning mode), and the F word is
    //   carried but never unit-converted or stored as state (Marlin
    //   converts F under G20).
    // Exclusions: fractional/float words, NaN and malformed words,
    //   feedrate modality and kinematics, path/geometry output. F carries
    //   presence and raw value only; its sole semantic role is the
    //   zero-length-move classification (classifyLinear).
    | Linear(LinearWords)
    // G2/G3 — arc move: printer-state effects identical to a linear move
    // on X/Y/Z/E.
    // Authority: Marlin docs (G2-G3) and RepRap wiki.
    // Library stance: conforms for endpoint and E accounting; pinned
    //   decisions — an arc never counts a path point in the job
    //   statistics (see printer-core.md), and I/J/R words are relative
    //   offsets, never workspace-shifted.
    // Exclusions: tessellation, plane selection, degenerate-arc geometry
    //   and the emitted polyline; I/J/R are carried for replay line
    //   reconstruction only and never touch PrinterState. No F word is
    //   modeled on arcs.
    | Arc(ArcWords)
    // G20/G21 — interpret length words as inches / millimeters.
    // Authority: Marlin docs and RepRap wiki (G20 inches, G21 mm).
    // Library stance: conforms for X/Y/Z/E length words (25.4 mm per
    //   inch, 2540 centi-mm — see lib/scale.qnt); pinned-divergence — F
    //   words are never converted.
    // Exclusions: inch words that leave the integer centi-mm grid
    //   (fractions of 0.01 in); see the companion's Out of model section.
    | SetUnits(UnitsMode)
    // G28 — home: all three axes to the physical origin, known, homed.
    // Authority: Marlin docs (G28) and RepRap wiki.
    // Library stance: pinned-divergence — axis words are ignored and G28
    //   always homes all three axes (documented firmware behavior homes
    //   only the named axes). The payload carries the presence flags so a
    //   replay can emit "G28 X" and observe the pinned all-axes effect.
    // Exclusions: homing motion and endstops, M206/M428-style home
    //   offsets, G28's interaction with software endstops. The shift and
    //   E are untouched.
    | Home(HomeWords)
    // G31/G38.2-G38.5 — straight probe.
    // Authority: Marlin docs (G38.2-G38.5 probe toward/away workpiece);
    //   RepRapFirmware docs (G31 with parameters is the set-trigger-values
    //   configuration form).
    // Library stance: library-invented — the z-clamp rule (probeTargetZ)
    //   is a static approximation of physical probe triggering: a probe
    //   whose shifted Z target is below the origin plane, starting from a
    //   known Z at or above it, stops at physical Z0; every other probe
    //   travels to its commanded shifted target. A P word, or the absence
    //   of all axis words, makes the whole command a no-op — pinned.
    // Exclusions: real endstop/probe hardware and failure modes, trigger
    //   values (p is presence-only; the replay renders it as P1 and
    //   should also exercise P0), E and F words (a probe reads neither).
    | Probe(ProbeWords)
    // G92 — set position, word and bare forms.
    // Authority: Marlin docs (G92) for the word form — the position_shift
    //   offset model: logical coordinates are redefined with no physical
    //   motion, shift.axis := physical - word; RepRap wiki dialect for
    //   the bare form — G92 without words resets all axes to zero, i.e.
    //   shift := current physical and E := 0.
    // Library stance: conforms (word form, Marlin offset model);
    //   pinned-divergence (bare form follows the RepRap-wiki reset
    //   dialect). E words set the extruder position directly; E is
    //   excluded from the shift — pinned.
    // Exclusions: G92 never marks an axis known, never homes, never
    //   moves; un-homed axes contribute physical 0 to the shift.
    | SetPosition(SetPositionWords)
    // G92.1 — reset the workspace shift.
    // Authority: RepRap wiki (G92.1: reset G92 offsets to zero) and
    //   Marlin workspace offsets.
    // Library stance: conforms — clears the XYZ shift; E, position and
    //   every flag are untouched.
    // Exclusions: G92.2/G92.3 (suspend/restore offsets) are not modeled.
    | ResetShift
    // M82/M83 — extruder addressing mode.
    // Authority: Marlin docs and RepRap wiki (M82 absolute, M83 relative).
    // Library stance: conforms — one global flag deciding whether an E
    //   word sets the extruder position or accumulates onto it.
    // Exclusions: per-extruder modes and M82/M83 interplay with G90/G91
    //   (out of model: there is one positioning mode).
    | SetExtrusionMode(ExtrusionMode)
    // T0..T7 — select the active tool.
    // Authority: RepRap wiki (Tn: select tool).
    // Library stance: conforms — records the active tool index; nothing
    //   else changes.
    // Exclusions: tool offsets, firmware tool-change macros and moves.
    //   The index is constrained to 0..7 by each machine's generator, not
    //   by this type.
    | SelectTool(int)

  // --- transition helpers ----------------------------------------------

  /// Axis effect of a move word: a present word sends the axis to its
  /// unit-scaled target plus the workspace shift and marks it known; an
  /// absent word leaves the axis untouched.
  pure def axisAfterMove(a: AxisState, w: Word, shiftA: int, inches: bool): AxisState =
    match w {
      | Some(v) => { known: true, pos: toCenti(v, inches) + shiftA }
      | None => a
    }

  /// E accounting of a move: an absent E word holds; a relative-mode E
  /// word accumulates; an absolute-mode E word is the new extruder
  /// position. E words scale with the units flag and are never shifted.
  pure def eAfterMove(s: PrinterState, w: Word): int =
    match w {
      | None => s.e
      | Some(v) => if (s.relExtrude) s.e + toCenti(v, s.inches) else toCenti(v, s.inches)
    }

  /// Probe Z target with the z-clamp rule (library-invented; see the
  /// Probe annotation): a shifted target below the origin plane, from a
  /// known Z at or above it, triggers at physical Z0; every other probe
  /// travels to the commanded shifted target.
  pure def probeTargetZ(s: PrinterState, v: int): int = {
    val raw = toCenti(v, s.inches) + s.shift.z
    if (raw < 0 and s.z.known and s.z.pos >= 0) 0 else raw
  }

  /// Shared X/Y/Z/E effect of linear and arc moves.
  pure def applyMoveWords(s: PrinterState, wx: Word, wy: Word, wz: Word, we: Word): PrinterState = {
    ...s,
    x: axisAfterMove(s.x, wx, s.shift.x, s.inches),
    y: axisAfterMove(s.y, wy, s.shift.y, s.inches),
    z: axisAfterMove(s.z, wz, s.shift.z, s.inches),
    e: eAfterMove(s, we)
  }

  /// Whether a probe performs motion at all: no P word and at least one
  /// axis word. A non-acting probe is a complete no-op (and counts
  /// nothing); an acting probe counts one path point in the machines'
  /// statistics.
  pure def probeActs(m: ProbeWords): bool =
    not(m.p) and hasAxisWord(m.x, m.y, m.z)

  pure def applyProbe(s: PrinterState, m: ProbeWords): PrinterState =
    if (not(probeActs(m))) s
    else {
      ...s,
      x: axisAfterMove(s.x, m.x, s.shift.x, s.inches),
      y: axisAfterMove(s.y, m.y, s.shift.y, s.inches),
      z: match m.z {
        | Some(v) => { known: true, pos: probeTargetZ(s, v) }
        | None => s.z
      }
    }

  pure def applySetPosition(s: PrinterState, m: SetPositionWords): PrinterState =
    if (not(hasAxisWord(m.x, m.y, m.z) or hasWord(m.e)))
      // bare G92: shift := current physical (0 on unknown axes), E := 0
      { ...s, shift: { x: s.x.pos, y: s.y.pos, z: s.z.pos }, e: 0 }
    else {
      ...s,
      shift: {
        x: match m.x { Some(v) => s.x.pos - toCenti(v, s.inches) | None => s.shift.x },
        y: match m.y { Some(v) => s.y.pos - toCenti(v, s.inches) | None => s.shift.y },
        z: match m.z { Some(v) => s.z.pos - toCenti(v, s.inches) | None => s.shift.z }
      },
      e: match m.e { Some(v) => toCenti(v, s.inches) | None => s.e }
    }

  // --- THE transition --------------------------------------------------

  /// The one printer-state semantics. Every machine that interprets
  /// position/extrusion G-codes folds this function; no other module may
  /// re-transcribe a command's state effect.
  pure def applyCommand(s: PrinterState, c: Command): PrinterState =
    match c {
      | Linear(m) => applyMoveWords(s, m.x, m.y, m.z, m.e)
      | Arc(m) => applyMoveWords(s, m.x, m.y, m.z, m.e)
      | SetUnits(u) => { ...s, inches: match u { Inches => true | Millimeters => false } }
      | Home(_) => {
          ...s,
          x: { known: true, pos: 0 },
          y: { known: true, pos: 0 },
          z: { known: true, pos: 0 },
          homed: true
        }
      | Probe(m) => applyProbe(s, m)
      | SetPosition(m) => applySetPosition(s, m)
      | ResetShift => { ...s, shift: { x: 0, y: 0, z: 0 } }
      | SetExtrusionMode(m) => { ...s, relExtrude: match m { RelativeE => true | AbsoluteE => false } }
      | SelectTool(t) => { ...s, tool: t }
    }

  /// Fold a command list — handy for ghost oracles and tests.
  pure def applyAll(s: PrinterState, cs: List[Command]): PrinterState =
    cs.foldl(s, applyCommand)

  // --- statistics classification ----------------------------------------

  /// How a single command feeds the job statistics counters. Machines own
  /// the counters (they are ghost/trace state, not printer state); this
  /// classification is the shared semantics they must all use.
  type MoveStatsKind =
    // The move has at least one axis word: it counts one path point and
    // nothing else.
    | CountsPoint
    // Zero-length move with a positive RAW E word. Pinned decision: the
    // raw word sign decides, so in absolute mode a positive E word that
    // lowers the extruder position still classifies here.
    | Retraction
    // Zero-length move with a negative raw E word.
    | Deretraction
    // Zero-length move whose E word is absent or zero, with an F word.
    | FeedrateChange
    // Zero-length move with no deciding word at all.
    | OtherZeroMove

  /// Classify a G0/G1 move for the job statistics: axis word => point;
  /// otherwise raw E sign first (an explicit E0 falls through), then F
  /// presence, then OtherZeroMove.
  /// Authority: none (the counters are a library feature).
  /// Library stance: library-invented — pinned as stated, including the
  ///   raw-sign rule.
  /// Exclusions: arcs and probes never reach this classification; an arc
  ///   feeds no counter at all, an acting probe counts one point.
  pure def classifyLinear(m: LinearWords): MoveStatsKind =
    if (hasAxisWord(m.x, m.y, m.z)) CountsPoint
    else match m.e {
      | Some(v) =>
          if (v > 0) Retraction
          else if (v < 0) Deretraction
          else if (hasWord(m.f)) FeedrateChange
          else OtherZeroMove
      | None =>
          if (hasWord(m.f)) FeedrateChange
          else OtherZeroMove
    }

  // --- trace-contract derivation ----------------------------------------

  /// The canonical lowercase command tag for event records (ev.cmd), so
  /// every machine derives identical ITF strings from the same sum type.
  pure def cmdTag(c: Command): str =
    match c {
      | Linear(m) => match m.code { G0 => "g0" | G1 => "g1" }
      | Arc(m) => match m.code { G2 => "g2" | G3 => "g3" }
      | SetUnits(u) => match u { Inches => "g20" | Millimeters => "g21" }
      | Home(_) => "g28"
      | Probe(m) =>
          match m.code {
            | G31 => "g31"
            | G38_2 => "g38_2"
            | G38_3 => "g38_3"
            | G38_4 => "g38_4"
            | G38_5 => "g38_5"
          }
      | SetPosition(_) => "g92"
      | ResetShift => "g92_1"
      | SetExtrusionMode(m) => match m { AbsoluteE => "m82" | RelativeE => "m83" }
      | SelectTool(t) =>
          if (t == 0) "t0"
          else if (t == 1) "t1"
          else if (t == 2) "t2"
          else if (t == 3) "t3"
          else if (t == 4) "t4"
          else if (t == 5) "t5"
          else if (t == 6) "t6"
          else "t7"
    }
}

/**
 * Corner-case tests for printer_core.applyCommand, transcribed from the
 * v1 interpreter spec's semantic runs so the shared core provably encodes
 * the same semantics.
 *
 * Validate with:
 *   npx quint test verification/quint-v2/lib/printer-core.qnt --main printer_core_test
 */
module printer_core_test {
  import scale.* from "./scale"
  import printer_core.*

  // --- readable constructors ---

  pure val NO_AXES: HomeWords = { x: false, y: false, z: false }

  pure def g1(wx: Word, wy: Word, wz: Word, we: Word): Command =
    Linear({ code: G1, x: wx, y: wy, z: wz, e: we, f: None })

  pure def g1f(wx: Word, wy: Word, wz: Word, we: Word, wf: Word): Command =
    Linear({ code: G1, x: wx, y: wy, z: wz, e: we, f: wf })

  pure def g92(wx: Word, wy: Word, wz: Word, we: Word): Command =
    SetPosition({ x: wx, y: wy, z: wz, e: we })

  pure def probe(code: ProbeCode, hp: bool, wx: Word, wy: Word, wz: Word): Command =
    Probe({ code: code, p: hp, x: wx, y: wy, z: wz })

  pure def arc(code: ArcCode, wx: Word, wy: Word, wz: Word, we: Word, wi: Word, wj: Word, wr: Word): Command =
    Arc({ code: code, x: wx, y: wy, z: wz, e: we, i: wi, j: wj, r: wr })

  // --- G92 offset model ---

  /// G92 X10 then G1 X10 leaves the physical position unchanged.
  pure val afterRoundtrip: PrinterState = INIT_PRINTER.applyAll([
    Home(NO_AXES),
    g1(Some(5), None, None, None),
    g92(Some(10), None, None, None),
    g1(Some(10), None, None, None)
  ])

  run g92RoundtripTest =
    assert(and {
      afterRoundtrip.x.pos == 500,
      afterRoundtrip.shift.x == -500,
      afterRoundtrip.x.known
    })

  /// Bare G92: shift := current physical, E := 0, nothing moves.
  pure val afterBareG92: PrinterState = INIT_PRINTER.applyAll([
    Home(NO_AXES),
    g1(Some(5), Some(-3), Some(2), Some(7)),
    g92(None, None, None, None)
  ])

  run bareG92Test =
    assert(and {
      afterBareG92.shift == { x: 500, y: -300, z: 200 },
      afterBareG92.e == 0,
      afterBareG92.x.pos == 500,
      afterBareG92.y.pos == -300,
      afterBareG92.z.pos == 200,
      afterBareG92.homed
    })

  /// G92.1 clears the XYZ shift and nothing else (E untouched).
  pure val afterReset: PrinterState = INIT_PRINTER.applyAll([
    Home(NO_AXES),
    g1(Some(5), None, None, None),
    g92(Some(10), None, None, Some(3)),
    ResetShift
  ])

  run g92dot1ResetTest =
    assert(and {
      afterReset.shift == { x: 0, y: 0, z: 0 },
      afterReset.e == 300,
      afterReset.x.pos == 500
    })

  /// Un-homed G92 with words: shift computed against physical 0, the axis
  /// stays unknown; a G92 E word sets the extruder position directly.
  pure val afterUnhomedG92: PrinterState =
    INIT_PRINTER.applyCommand(g92(Some(10), None, None, Some(5)))

  run unhomedG92Test =
    assert(and {
      afterUnhomedG92.shift.x == -1000,
      afterUnhomedG92.e == 500,
      afterUnhomedG92.x.pos == 0,
      not(afterUnhomedG92.x.known),
      not(afterUnhomedG92.homed)
    })

  /// Un-homed bare G92: shift := physical which is 0 by convention, E := 0.
  pure val afterUnhomedBare: PrinterState = INIT_PRINTER.applyAll([
    g1(None, None, None, Some(6)),
    g92(None, None, None, None)
  ])

  run unhomedBareG92Test =
    assert(and {
      afterUnhomedBare.shift == { x: 0, y: 0, z: 0 },
      afterUnhomedBare.e == 0,
      not(afterUnhomedBare.homed)
    })

  /// G92 X5 and G1 X10 do NOT commute.
  pure val shiftThenMove: PrinterState = INIT_PRINTER.applyAll([
    Home(NO_AXES), g92(Some(5), None, None, None), g1(Some(10), None, None, None)
  ])
  pure val moveThenShift: PrinterState = INIT_PRINTER.applyAll([
    Home(NO_AXES), g1(Some(10), None, None, None), g92(Some(5), None, None, None)
  ])

  run g92MoveNonCommuteTest =
    assert(and {
      shiftThenMove.x.pos == 500, shiftThenMove.shift.x == -500,
      moveThenShift.x.pos == 1000, moveThenShift.shift.x == 500
    })

  // --- extrusion and units modes ---

  /// M83 accumulates relative E; M82 treats E words as absolute positions.
  pure val afterEModes: PrinterState = INIT_PRINTER.applyAll([
    g1(None, None, None, Some(10)),
    SetExtrusionMode(RelativeE),
    g1(None, None, None, Some(5)),
    g1(None, None, None, Some(-2)),
    SetExtrusionMode(AbsoluteE),
    g1(None, None, None, Some(4))
  ])

  run extrusionModeTest =
    assert(and {
      afterEModes.e == 400,
      not(afterEModes.relExtrude),
      INIT_PRINTER.applyAll([
        g1(None, None, None, Some(10)),
        SetExtrusionMode(RelativeE),
        g1(None, None, None, Some(5))
      ]).e == 1500
    })

  /// G20 then G1 X2 moves to 2 inches = 5080 centi-mm; G21 restores mm.
  pure val inInches: PrinterState = INIT_PRINTER.applyAll([
    SetUnits(Inches),
    g1(Some(2), None, None, Some(1))
  ])

  run inchUnitsTest =
    assert(and {
      inInches.x.pos == toCenti(2, true),
      inInches.x.pos == 5080,
      inInches.e == 2540,
      inInches.inches,
      inInches.applyAll([SetUnits(Millimeters), g1(Some(2), None, None, None)]).x.pos == 200
    })

  /// M82 and G21 commute from an inches/relative state.
  pure val modeOrderA: PrinterState = INIT_PRINTER.applyAll([
    SetUnits(Inches), SetExtrusionMode(RelativeE),
    SetExtrusionMode(AbsoluteE), SetUnits(Millimeters),
    g1(Some(2), None, None, Some(3))
  ])
  pure val modeOrderB: PrinterState = INIT_PRINTER.applyAll([
    SetUnits(Inches), SetExtrusionMode(RelativeE),
    SetUnits(Millimeters), SetExtrusionMode(AbsoluteE),
    g1(Some(2), None, None, Some(3))
  ])

  run unitsModeCommuteTest =
    assert(and {
      modeOrderA == modeOrderB,
      modeOrderA.x.pos == 200,
      modeOrderA.e == 300
    })

  // --- homing ---

  /// G28 axis words are ignored: "G28 X" homes all three axes (pinned).
  pure val afterHomeX: PrinterState = INIT_PRINTER.applyAll([
    g1(Some(5), Some(5), Some(5), None),
    Home({ x: true, y: false, z: false })
  ])

  run homeIgnoresAxisWordsTest =
    assert(and {
      afterHomeX.x == { known: true, pos: 0 },
      afterHomeX.y == { known: true, pos: 0 },
      afterHomeX.z == { known: true, pos: 0 },
      afterHomeX.homed,
      // shift and E survive homing
      INIT_PRINTER.applyAll([
        Home(NO_AXES), g1(Some(4), None, None, Some(2)),
        g92(Some(0), None, None, None), Home({ x: false, y: true, z: true })
      ]).shift.x == 400
    })

  // --- arcs ---

  /// Arc endpoint/E semantics: shifted endpoints, absent axes untouched,
  /// E accounted like a linear move, I/J/R ignored by the printer state.
  pure val afterArcs: PrinterState = INIT_PRINTER.applyAll([
    Home(NO_AXES),
    g1(Some(10), Some(10), None, Some(1)),
    arc(G2, Some(20), Some(10), None, Some(3), Some(5), Some(0), None)
  ])

  run arcStateTest =
    assert(and {
      afterArcs.x.pos == 2000,
      afterArcs.y.pos == 1000,
      afterArcs.z.pos == 0,
      afterArcs.e == 300,
      // shifted arc endpoint after G92 X0
      afterArcs.applyAll([
        g92(Some(0), None, None, None),
        arc(G3, Some(5), None, None, None, None, None, Some(4))
      ]).x.pos == 2500,
      // inch-mode arc
      afterArcs.applyAll([
        g92(Some(0), None, None, None),
        SetUnits(Inches),
        arc(G2, Some(1), None, None, Some(1), Some(1), None, None)
      ]).x.pos == 4540
    })

  // --- probes ---

  pure val homedS: PrinterState = INIT_PRINTER.applyCommand(Home(NO_AXES))

  /// P-word and no-axis-word probes are complete no-ops.
  run probeNoOpTest =
    assert(and {
      INIT_PRINTER.applyCommand(probe(G31, true, Some(5), None, None)) == INIT_PRINTER,
      homedS.applyCommand(probe(G38_2, false, None, None, None)) == homedS,
      not(probeActs({ code: G31, p: true, x: Some(5), y: None, z: None })),
      not(probeActs({ code: G38_2, p: false, x: None, y: None, z: None })),
      probeActs({ code: G38_4, p: false, x: Some(2), y: None, z: Some(4) })
    })

  /// The z-clamp grid: below-plane targets from a known Z at or above the
  /// plane stop at Z0; probes from below or from an unknown Z travel.
  pure val clampFromAbove: PrinterState =
    homedS.applyCommand(probe(G38_2, false, None, None, Some(-5)))
  pure val fromBelow: PrinterState = homedS.applyAll([
    g1(None, None, Some(-3), None),
    probe(G31, false, None, None, Some(-5))
  ])
  pure val shiftedClamp: PrinterState = homedS.applyAll([
    probe(G38_4, false, Some(2), None, Some(4)),
    g92(None, None, Some(10), None),
    probe(G31, false, None, None, Some(2))
  ])
  pure val unknownZProbe: PrinterState =
    INIT_PRINTER.applyCommand(probe(G38_3, false, None, None, Some(-2)))

  run probeClampTest =
    assert(and {
      clampFromAbove.z.pos == 0,
      clampFromAbove.z.known,
      fromBelow.z.pos == -500,
      // shifted target 200 - 600 = -400 < 0 from z.pos 400 >= 0: clamped
      shiftedClamp.shift.z == -600,
      shiftedClamp.z.pos == 0,
      // un-homed Z: the clamp needs a known starting Z, so the probe travels
      unknownZProbe.z.pos == -200,
      unknownZProbe.z.known,
      not(unknownZProbe.homed),
      // probes never touch E
      homedS.applyAll([g1(None, None, None, Some(7)), probe(G31, false, None, None, Some(-5))]).e == 700
    })

  // --- zero-length move classification ---

  pure def zl(we: Word, wf: Word): LinearWords =
    { code: G1, x: None, y: None, z: None, e: we, f: wf }

  /// Raw E sign first (even when the absolute-mode delta has the opposite
  /// sign), explicit E0 falls through to F presence, then OtherZeroMove;
  /// any axis word counts a point instead.
  run classifyLinearTest =
    assert(and {
      classifyLinear(zl(Some(5), None)) == Retraction,
      // raw E2 > 0 outranks the F word even though absolute-mode E drops
      classifyLinear(zl(Some(2), Some(60))) == Retraction,
      classifyLinear(zl(Some(-3), None)) == Deretraction,
      classifyLinear(zl(None, Some(50))) == FeedrateChange,
      // an explicit E0 is neither retraction nor deretraction: F wins
      classifyLinear(zl(Some(0), Some(40))) == FeedrateChange,
      classifyLinear(zl(Some(0), None)) == OtherZeroMove,
      classifyLinear(zl(None, None)) == OtherZeroMove,
      classifyLinear({ code: G1, x: Some(4), y: None, z: None, e: Some(1), f: Some(30) }) == CountsPoint
    })

  // --- trace-contract tags ---

  run cmdTagTest =
    assert(and {
      cmdTag(g1(None, None, None, None)) == "g1",
      cmdTag(Linear({ code: G0, x: None, y: None, z: None, e: None, f: None })) == "g0",
      cmdTag(arc(G3, None, None, None, None, None, None, None)) == "g3",
      cmdTag(SetUnits(Inches)) == "g20",
      cmdTag(SetUnits(Millimeters)) == "g21",
      cmdTag(Home(NO_AXES)) == "g28",
      cmdTag(probe(G38_5, false, None, None, None)) == "g38_5",
      cmdTag(g92(None, None, None, None)) == "g92",
      cmdTag(ResetShift) == "g92_1",
      cmdTag(SetExtrusionMode(AbsoluteE)) == "m82",
      cmdTag(SetExtrusionMode(RelativeE)) == "m83",
      cmdTag(SelectTool(0)) == "t0",
      cmdTag(SelectTool(7)) == "t7"
    })
}
