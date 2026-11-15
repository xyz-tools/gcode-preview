// -*- mode: Bluespec; -*-
/**
 * printer_core_next — THE single printer-state semantics of the
 * quint-next design bank: the from-scratch, spec-first design of
 * position/extrusion G-code interpretation for gcode-preview.
 *
 * Unit: design-bank counterpart of the interpreter-state map (the ground
 *   covered by IS-2..IS-6 in .context/formal-verification/mapping-data.json),
 *   redesigned per the quint-next charter. This bank is NORMATIVE: where
 *   it differs from the current implementation, the difference is
 *   intentional and recorded in the companion's Divergence ledger.
 * Authority policy: verification/quint/STYLE.md ("Authority
 *   annotations"), adapted for a design bank. Every Command variant below
 *   carries Authority / Design stance / Exclusions. Design stance values:
 *   "conforms" (matches firmware documentation AND the current
 *   implementation), "kept" (a current-implementation design retained on
 *   its merits, with citation), "designed-divergence" (differs from the
 *   current implementation on purpose — see the companion ledger).
 *   Firmware citations verified 2026-11-14 against marlinfw.org
 *   (G028, G038, G090, G091, G092, M083) and the RepRap wiki G-code page.
 * Companion: printer-core.md.
 *
 * This module is pure: one record type (PrinterState), one Command sum
 * type, one transition function applyCommand. quint-next machines import
 * it, keep `var s: ...State` records, and reduce actions to recording an
 * event and `s' = ...applyCommand(s, c)...`.
 *
 * Designed-in properties (charter P2), checked by printer_core_next_props
 * in this file:
 * - Mode independence: a physical endpoint is expressible in G90 or G91,
 *   mm or inches, with identical PrinterState outcome; relative deltas
 *   are frame-free (the G92 shift cancels out of them) by construction.
 * - Partial homing: G28 honors axis words; axis knowledge is per-axis
 *   and monotone.
 * - Physical stats classification: retraction/prime are named by the
 *   sign of the physical extrusion delta, not by raw word sign.
 *
 * All lengths are centi-millimeters (see lib/scale.qnt, module
 * scale_next). This bank has NO trace replay and NO traces by design
 * (charter P6): it would fail against the current code on every ledger
 * row. Internal consistency (parse, test, run) is the gate.
 */
module printer_core_next {
  import scale_next.* from "./scale"

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

  /// The raw value of a word, 0 when absent (for event records only —
  /// semantics never reads an absent word as zero).
  pure def wordVal(w: Word): int =
    match w {
      | Some(v) => v
      | None => 0
    }

  /// Whether at least one of the three axis words is present.
  pure def hasAxisWord(wx: Word, wy: Word, wz: Word): bool =
    hasWord(wx) or hasWord(wy) or hasWord(wz)

  // --- printer state ---------------------------------------------------

  /// One axis: whether its machine-frame position is known (established
  /// by homing or by an absolute move word), and its physical position in
  /// centi-mm. An axis that was never commanded reads 0 by convention.
  /// Knowledge is per-axis — there is no global homed flag — so partial
  /// homing (G28 X) is representable. Designed invariant (checked in
  /// printer_core_next_props): knowledge is monotone, nothing un-knows
  /// an axis.
  type AxisState = { known: bool, pos: int }

  /// The workspace shift created by G92, per axis, in centi-mm.
  /// Defining equation: physical = logical + shift on every axis.
  /// KEPT from the current implementation's positionShift model, which
  /// conforms to Marlin's position_shift workspace offset (Marlin G092
  /// docs; charter P1).
  type Shift = { x: int, y: int, z: int }

  /// G90 absolute vs G91 relative XYZ addressing.
  type PositioningMode = AbsoluteXYZ | RelativeXYZ

  /// M82 absolute vs M83 relative extruder addressing.
  type ExtrusionMode = AbsoluteE | RelativeE

  /// G20 inches vs G21 millimeters.
  type UnitsMode = Inches | Millimeters

  /// The full printer state every quint-next interpreter-flavored machine
  /// folds.
  type PrinterState = {
    x: AxisState,
    y: AxisState,
    z: AxisState,
    // Extruder position in centi-mm. Deliberately excluded from Shift
    // (Marlin G92 sets E directly; there is no E workspace offset).
    e: int,
    shift: Shift,
    // true after G91, false after G90 (relative XYZ addressing).
    relMove: bool,
    // true after M83 or G91, false after M82 or G90 (relative E
    // accounting). Last writer wins: Marlin M083 docs — "G90 and G91
    // clear this mode".
    relExtrude: bool,
    // true after G20 (length words are inches), false after G21 (mm).
    inches: bool,
    // Active tool index, set by T0..T7.
    tool: int
  }

  /// The state before any command: axes unknown at 0, no shift, absolute
  /// XYZ and E (Marlin G090 docs: "Absolute positioning is the default"),
  /// millimeters, tool 0.
  pure val INIT_PRINTER: PrinterState = {
    x: { known: false, pos: 0 },
    y: { known: false, pos: 0 },
    z: { known: false, pos: 0 },
    e: 0,
    shift: { x: 0, y: 0, z: 0 },
    relMove: false,
    relExtrude: false,
    inches: false,
    tool: 0
  }

  /// All three axes known: the designed meaning of "homed" is derived,
  /// never stored.
  pure def fullyHomed(s: PrinterState): bool =
    s.x.known and s.y.known and s.z.known

  // --- command alphabet ------------------------------------------------

  /// G0 (travel) vs G1 (feed). Both have identical printer-state effects;
  /// the distinction matters to geometry machines.
  type LinearCode = G0 | G1

  /// G2 (clockwise) vs G3 (counter-clockwise) arc.
  type ArcCode = G2 | G3

  /// Straight-probe family: the Marlin-documented G38 quartet. G31 is
  /// deliberately excluded from the design (dialect-ambiguous: Marlin G31
  /// is Dock Sled, RepRapFirmware G31 is probe configuration).
  type ProbeCode = G38_2 | G38_3 | G38_4 | G38_5

  /// Word payload of a linear move.
  type LinearWords = { code: LinearCode, x: Word, y: Word, z: Word, e: Word, f: Word }

  /// Word payload of an arc move. I/J/R shape the tessellated polyline
  /// only; they are carried for geometry machines and never touch
  /// PrinterState.
  type ArcWords = { code: ArcCode, x: Word, y: Word, z: Word, e: Word, i: Word, j: Word, r: Word }

  /// Word payload of a probe: target coordinates and feedrate, exactly
  /// the parameter list Marlin documents for G38.2-G38.5.
  type ProbeWords = { code: ProbeCode, x: Word, y: Word, z: Word, f: Word }

  /// Word payload of G92. The bare form is the all-None payload.
  type SetPositionWords = { x: Word, y: Word, z: Word, e: Word }

  /// Axis-word presence flags on a G28 line — honored by the semantics:
  /// only the named axes home; the bare form homes all three.
  type HomeWords = { x: bool, y: bool, z: bool }

  type Command =
    // G0/G1 — linear move: each present axis word resolves under the
    // positioning mode (G90: unit-scaled target plus workspace shift,
    // axis becomes known; G91: unit-scaled delta added to the current
    // physical position, knowledge unchanged); absent axes hold; E
    // follows the extrusion mode.
    // Authority: Marlin docs G0-G1, G090 ("coordinates ... interpreted
    //   as positions in the logical coordinate space"), G091 ("all
    //   coordinates are interpreted as relative to the last position").
    // Design stance: conforms for absolute X/Y/Z endpoint and E
    //   accounting; designed-divergence — G90/G91 are designed in (the
    //   current implementation registers neither, leaving exactly one
    //   positioning mode). F is carried but never unit-converted or
    //   stored (a retained simplification: feedrate is out of model, so
    //   F's only semantic role is presence in the zero-move
    //   classification; divergence from Marlin's G20 F conversion is
    //   deliberate — charter P1 reason stated here).
    // Exclusions: fractional/float words, NaN and malformed words,
    //   feedrate modality and kinematics, path/geometry output.
    | Linear(LinearWords)
    // G2/G3 — arc move: printer-state effects identical to a linear move
    // on X/Y/Z/E, including G90/G91 resolution of the endpoint.
    // Authority: Marlin docs G2-G3 and RepRap wiki — endpoint words
    //   follow the current positioning mode; I/J are always relative
    //   offsets from the current position.
    // Design stance: conforms for endpoint and E accounting; I/J/R are
    //   never workspace-shifted and never mode-resolved (always
    //   relative), conforming to firmware.
    // Exclusions: tessellation, plane selection, degenerate-arc geometry
    //   and the emitted polyline; no F word is modeled on arcs. Whether
    //   arcs feed the stats classification is an open item (see
    //   companion).
    | Arc(ArcWords)
    // G20/G21 — interpret subsequent length words as inches/millimeters.
    // Authority: Marlin docs and RepRap wiki (G20 inches, G21 mm).
    // Design stance: conforms — read-time conversion of X/Y/Z/E length
    //   words (see scale_next); stored state never rescales. F words are
    //   never converted (see Linear).
    // Exclusions: inch words that leave the integer centi-mm grid.
    | SetUnits(UnitsMode)
    // G90/G91 — absolute/relative XYZ positioning. Also resets the
    // extruder mode: G90 makes E absolute, G91 makes E relative, until a
    // later M82/M83 overrides.
    // Authority: Marlin docs G090/G091 ("This includes the extruder
    //   position unless overridden by M83"/"by M82") and M083 Notes
    //   ("G90 and G91 clear this mode") — last writer wins.
    // Design stance: designed-divergence — the current implementation
    //   treats G90/G91 as unregistered no-ops (core ledger row).
    // Exclusions: per-axis relative flags beyond the XYZ/E split
    //   (Marlin's axis_relative_modes internals).
    | SetPositioningMode(PositioningMode)
    // G28 — home exactly the named axes; the bare form homes all three.
    // A homed axis is at the physical origin (the model identifies home
    // with origin) and known. Un-named axes keep their position AND
    // their knowledge state: partial homing never invents or destroys
    // knowledge elsewhere. Shift, E, modes and tool are untouched.
    // Authority: Marlin docs G028 — "The default behavior with no
    //   parameters is to home all axes"; "G28 X Z ; Home the X and Z
    //   axes".
    // Design stance: designed-divergence — the current implementation
    //   ignores axis words and homes all three axes (ledger row).
    // Exclusions: homing motion and endstops, M206/M428 home offsets,
    //   G28 O (trusted-position skip), leveling-state side effects,
    //   software endstops.
    | Home(HomeWords)
    // G38.2-G38.5 — straight probe: moves X/Y/Z toward the commanded
    // target exactly like a linear move (modes, units, shift all apply);
    // E is never touched. The model's terminal position is the commanded
    // target — the state Marlin documents when no trigger occurs ("an
    // error if it reaches the target position"); trigger events are
    // hardware and excluded. A probe with no axis words is a no-op.
    // Authority: Marlin docs G038 (probe toward/away, target
    //   coordinates X/Y/Z, optional F).
    // Design stance: designed-divergence — the current implementation's
    //   z-clamp (a probe whose shifted Z target is below the origin
    //   plane, from a known Z at or above it, stops at physical Z0) is
    //   dropped: it is library-invented physics with no firmware
    //   authority (ledger row). G31 is dropped from the family (ledger
    //   row).
    // Exclusions: real probe hardware, trigger positions, error
    //   signaling on G38.2/G38.4 failure, F semantics beyond carriage.
    | Probe(ProbeWords)
    // G92 — set position, word and bare forms. Word form: the named axis
    // keeps its physical position and its logical position becomes the
    // scaled word — shift.axis := physical - scaled word. Independent of
    // G90/G91 (G92 words are always logical positions, never deltas). E
    // words set the extruder position directly. Bare form: shift :=
    // current physical and E := 0 (RepRap wiki reset dialect). G92 never
    // marks an axis known, never homes, never moves.
    // Authority: Marlin docs G092 (position_shift offset model, "New
    //   extruder position" for E) for the word form — KEPT, the current
    //   implementation conforms; RepRap wiki for the bare-form reset
    //   dialect — KEPT from the current implementation.
    // Design stance: conforms / kept.
    // Exclusions: software-endstop adjustment, CNC workspaces G54-G59.
    | SetPosition(SetPositionWords)
    // G92.1 — reset the workspace shift to zero. E, positions and every
    // flag are untouched.
    // Authority: Marlin docs G092 ("G92.1 to reset the selected
    //   workspace to native machine space") and RepRap wiki.
    // Design stance: conforms.
    // Exclusions: G92.2/G92.3 (suspend/restore offsets).
    | ResetShift
    // M82/M83 — extruder addressing mode, overriding the E half of the
    // last G90/G91.
    // Authority: Marlin docs M083 ("override G90 and put the E axis into
    //   relative mode independent of the other axes") and RepRap wiki.
    // Design stance: conforms — one flag deciding whether an E word sets
    //   the extruder position or accumulates onto it.
    // Exclusions: per-extruder modes.
    | SetExtrusionMode(ExtrusionMode)
    // T0..T7 — select the active tool.
    // Authority: RepRap wiki (Tn: select tool).
    // Design stance: conforms — records the active tool index; nothing
    //   else changes.
    // Exclusions: tool offsets, firmware tool-change macros and moves.
    //   The index is constrained to 0..7 by each machine's generator,
    //   not by this type.
    | SelectTool(int)

  // --- transition helpers ----------------------------------------------

  /// Axis effect of a move word under the positioning mode. Absolute: the
  /// axis goes to its unit-scaled target plus the workspace shift and
  /// becomes known (an absolute word is absolute evidence of position).
  /// Relative: the unit-scaled delta is added to the current physical
  /// position; the shift cancels out of the delta (physical = logical +
  /// shift on both ends), so it is not applied; knowledge is unchanged (a
  /// delta from an unknown position is still unknown). An absent word
  /// leaves the axis untouched.
  pure def axisAfterMove(a: AxisState, w: Word, shiftA: int, inches: bool, rel: bool): AxisState =
    match w {
      | Some(v) =>
          if (rel) { known: a.known, pos: a.pos + toCenti(v, inches) }
          else { known: true, pos: toCenti(v, inches) + shiftA }
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

  /// Shared X/Y/Z/E effect of linear and arc moves.
  pure def applyMoveWords(s: PrinterState, wx: Word, wy: Word, wz: Word, we: Word): PrinterState = {
    ...s,
    x: axisAfterMove(s.x, wx, s.shift.x, s.inches, s.relMove),
    y: axisAfterMove(s.y, wy, s.shift.y, s.inches, s.relMove),
    z: axisAfterMove(s.z, wz, s.shift.z, s.inches, s.relMove),
    e: eAfterMove(s, we)
  }

  /// Whether a probe performs motion at all: at least one axis word.
  /// A non-acting probe is a complete no-op.
  pure def probeActs(m: ProbeWords): bool =
    hasAxisWord(m.x, m.y, m.z)

  /// Probe motion: the commanded target resolves exactly like a linear
  /// move's (modes, units, shift), with no E word and no z-clamp.
  pure def applyProbe(s: PrinterState, m: ProbeWords): PrinterState =
    if (not(probeActs(m))) s
    else applyMoveWords(s, m.x, m.y, m.z, None)

  /// Home effect on one axis: a named axis (or any axis under the bare
  /// form) lands known at the physical origin; the rest hold.
  pure def axisAfterHome(a: AxisState, named: bool): AxisState =
    if (named) { known: true, pos: 0 } else a

  /// Whether a G28 line homes all axes (no axis words at all).
  pure def homesAll(m: HomeWords): bool =
    not(m.x or m.y or m.z)

  pure def applyHome(s: PrinterState, m: HomeWords): PrinterState = {
    val allAxes = homesAll(m)
    {
      ...s,
      x: axisAfterHome(s.x, m.x or allAxes),
      y: axisAfterHome(s.y, m.y or allAxes),
      z: axisAfterHome(s.z, m.z or allAxes)
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

  /// The one printer-state semantics of the design bank. Every quint-next
  /// machine that interprets position/extrusion G-codes folds this
  /// function; no other module may re-transcribe a command's state
  /// effect.
  pure def applyCommand(s: PrinterState, c: Command): PrinterState =
    match c {
      | Linear(m) => applyMoveWords(s, m.x, m.y, m.z, m.e)
      | Arc(m) => applyMoveWords(s, m.x, m.y, m.z, m.e)
      | SetUnits(u) => { ...s, inches: match u { Inches => true | Millimeters => false } }
      | SetPositioningMode(m) =>
          match m {
            | AbsoluteXYZ => { ...s, relMove: false, relExtrude: false }
            | RelativeXYZ => { ...s, relMove: true, relExtrude: true }
          }
      | SetExtrusionMode(m) => { ...s, relExtrude: match m { RelativeE => true | AbsoluteE => false } }
      | Home(m) => applyHome(s, m)
      | Probe(m) => applyProbe(s, m)
      | SetPosition(m) => applySetPosition(s, m)
      | ResetShift => { ...s, shift: { x: 0, y: 0, z: 0 } }
      | SelectTool(t) => { ...s, tool: t }
    }

  /// Fold a command list — handy for ghost oracles and tests.
  pure def applyAll(s: PrinterState, cs: List[Command]): PrinterState =
    cs.foldl(s, applyCommand)

  // --- statistics classification ----------------------------------------

  /// Whether a command physically displaced the carriage.
  pure def xyzDisplaced(before: PrinterState, after: PrinterState): bool =
    or {
      before.x.pos != after.x.pos,
      before.y.pos != after.y.pos,
      before.z.pos != after.z.pos
    }

  /// How a single linear move feeds the job statistics counters, named by
  /// PHYSICAL semantics. Machines own the counters; this classification
  /// is the shared semantics they must all use.
  type MoveStatsKind =
    // The move physically displaced the carriage: one path point.
    | CountsPoint
    // Zero-displacement move whose physical extrusion delta is negative:
    // filament is pulled back.
    | Retraction
    // Zero-displacement move whose physical extrusion delta is positive:
    // filament is pushed forward (prime / deretraction).
    | Prime
    // Zero-displacement, zero-delta move with an F word.
    | FeedrateChange
    // Zero-displacement move with no deciding word at all.
    | OtherZeroMove

  /// Classify a G0/G1 move for the job statistics. The classification is
  /// state-aware by design: it looks at what the move physically DOES
  /// (carriage displacement, signed extrusion delta), not at which words
  /// appear on the line or their raw signs. Under M83 a retraction is
  /// "G1 E-2" and under M82 it is an E word below the current position —
  /// both classify as Retraction here, by construction.
  /// Authority: none for the counters themselves (a library feature);
  ///   naming per physical filament motion (charter P2/P4).
  /// Design stance: designed-divergence — the current implementation
  ///   classifies by raw E-word sign on zero-word moves (positive raw E
  ///   named retraction) and counts a path point on any axis-word
  ///   presence (ledger rows).
  /// Exclusions: arcs and probes never reach this classification in this
  ///   module; whether they should is an open item.
  pure def classifyLinear(s: PrinterState, m: LinearWords): MoveStatsKind = {
    val after = applyMoveWords(s, m.x, m.y, m.z, m.e)
    val dE = after.e - s.e
    if (xyzDisplaced(s, after)) CountsPoint
    else if (dE < 0) Retraction
    else if (dE > 0) Prime
    else if (hasWord(m.f)) FeedrateChange
    else OtherZeroMove
  }

  // --- event-record derivation -------------------------------------------

  /// The canonical lowercase command tag for event records (ev.cmd), so
  /// every machine derives identical strings from the same sum type.
  pure def cmdTag(c: Command): str =
    match c {
      | Linear(m) => match m.code { G0 => "g0" | G1 => "g1" }
      | Arc(m) => match m.code { G2 => "g2" | G3 => "g3" }
      | SetUnits(u) => match u { Inches => "g20" | Millimeters => "g21" }
      | SetPositioningMode(m) => match m { AbsoluteXYZ => "g90" | RelativeXYZ => "g91" }
      | Home(_) => "g28"
      | Probe(m) =>
          match m.code {
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

  /// The canonical lowercase tag of a stats classification.
  pure def kindTag(k: MoveStatsKind): str =
    match k {
      | CountsPoint => "point"
      | Retraction => "retraction"
      | Prime => "prime"
      | FeedrateChange => "feedrate"
      | OtherZeroMove => "other"
    }
}

/**
 * Corner-case tests for printer_core_next.applyCommand, covering every
 * designed divergence: G91 composition with the shift and homing, partial
 * homing, physically-named extrusion classification, probe travel without
 * the z-clamp, plus the kept Marlin laws (G92 offset model, units,
 * arcs, tools).
 *
 * Validate with:
 *   npx quint test verification/quint-next/lib/printer-core.qnt --main printer_core_next_test
 */
module printer_core_next_test {
  import scale_next.* from "./scale"
  import printer_core_next.*

  // --- readable constructors ---

  pure val BARE_HOME: HomeWords = { x: false, y: false, z: false }

  pure def g1(wx: Word, wy: Word, wz: Word, we: Word): Command =
    Linear({ code: G1, x: wx, y: wy, z: wz, e: we, f: None })

  pure def g1words(wx: Word, wy: Word, wz: Word, we: Word, wf: Word): LinearWords =
    { code: G1, x: wx, y: wy, z: wz, e: we, f: wf }

  pure def g92(wx: Word, wy: Word, wz: Word, we: Word): Command =
    SetPosition({ x: wx, y: wy, z: wz, e: we })

  pure def probe(code: ProbeCode, wx: Word, wy: Word, wz: Word): Command =
    Probe({ code: code, x: wx, y: wy, z: wz, f: None })

  pure def arc(code: ArcCode, wx: Word, wy: Word, wz: Word, we: Word, wi: Word, wj: Word, wr: Word): Command =
    Arc({ code: code, x: wx, y: wy, z: wz, e: we, i: wi, j: wj, r: wr })

  pure val G90C: Command = SetPositioningMode(AbsoluteXYZ)
  pure val G91C: Command = SetPositioningMode(RelativeXYZ)

  // --- G90/G91: relative composition with shift and homing ---

  /// The same physical endpoint is reachable in G90 and in G91, and the
  /// G92 shift cancels out of relative deltas: home, G1 X5 (phys 500),
  /// G92 X0 (shift 500); then "G91; G1 X3" and "G90; G1 X3" both land at
  /// physical 800 (logical 3 = physical 8 under the shift).
  pure val shifted: PrinterState = INIT_PRINTER.applyAll([
    Home(BARE_HOME),
    g1(Some(5), None, None, None),
    g92(Some(0), None, None, None)
  ])
  pure val viaRelative: PrinterState =
    shifted.applyAll([G91C, g1(Some(3), None, None, None)])
  pure val viaAbsolute: PrinterState =
    shifted.applyAll([G90C, g1(Some(3), None, None, None)])

  run g91ComposesWithShiftTest =
    assert(and {
      shifted.x.pos == 500,
      shifted.shift.x == 500,
      viaRelative.x.pos == 800,
      viaAbsolute.x.pos == 800,
      viaRelative.x.pos == viaAbsolute.x.pos,
      // the shift itself is untouched by moves in either mode
      viaRelative.shift.x == 500,
      viaAbsolute.shift.x == 500,
      // and relative mode persists until G90
      viaRelative.relMove,
      not(viaAbsolute.relMove)
    })

  /// Relative moves on an un-homed axis accumulate from the conventional
  /// 0 and never mint knowledge; an absolute word is absolute evidence.
  pure val relUnhomed: PrinterState = INIT_PRINTER.applyAll([
    G91C,
    g1(Some(5), None, None, None),
    g1(Some(-2), None, None, None)
  ])

  run relativeUnhomedTest =
    assert(and {
      relUnhomed.x.pos == 300,
      not(relUnhomed.x.known),
      not(fullyHomed(relUnhomed)),
      relUnhomed.applyAll([G90C, g1(Some(5), None, None, None)]).x.known,
      relUnhomed.applyAll([G90C, g1(Some(5), None, None, None)]).x.pos == 500
    })

  /// G90/G91 set the E mode too; a later M82/M83 overrides (last writer
  /// wins — Marlin M083: "G90 and G91 clear this mode").
  pure val g91ThenM82: PrinterState = INIT_PRINTER.applyAll([
    G91C, SetExtrusionMode(AbsoluteE)
  ])

  run g90g91EModeCouplingTest =
    assert(and {
      INIT_PRINTER.applyCommand(G91C).relExtrude,
      INIT_PRINTER.applyCommand(G91C).relMove,
      // M82 after G91: XYZ stay relative, E becomes absolute
      g91ThenM82.relMove,
      not(g91ThenM82.relExtrude),
      g91ThenM82.applyAll([
        g1(None, None, None, Some(5)), g1(None, None, None, Some(5))
      ]).e == 500,
      // G90 clears both; M83 then re-enables relative E only
      INIT_PRINTER.applyAll([G91C, G90C]).relMove == false,
      INIT_PRINTER.applyAll([G91C, G90C]).relExtrude == false,
      INIT_PRINTER.applyAll([G90C, SetExtrusionMode(RelativeE)]).relExtrude,
      not(INIT_PRINTER.applyAll([G90C, SetExtrusionMode(RelativeE)]).relMove)
    })

  // --- partial homing ---

  /// G28 X homes only X; Y and Z keep position AND knowledge; bare G28
  /// homes all three; shift, E and modes survive homing.
  pure val wandered: PrinterState = INIT_PRINTER.applyAll([
    Home(BARE_HOME),
    g1(Some(5), Some(6), Some(7), Some(2)),
    g92(Some(1), None, None, None)
  ])
  pure val homedX: PrinterState =
    wandered.applyCommand(Home({ x: true, y: false, z: false }))
  pure val partialFromCold: PrinterState =
    INIT_PRINTER.applyCommand(Home({ x: false, y: false, z: true }))

  run partialHomingTest =
    assert(and {
      homedX.x == { known: true, pos: 0 },
      homedX.y == { known: true, pos: 600 },
      homedX.z == { known: true, pos: 700 },
      homedX.shift.x == 400,
      homedX.e == 200,
      // partial homing from cold: Z known at origin, X/Y still unknown
      partialFromCold.z == { known: true, pos: 0 },
      not(partialFromCold.x.known),
      not(partialFromCold.y.known),
      not(fullyHomed(partialFromCold)),
      fullyHomed(INIT_PRINTER.applyCommand(Home(BARE_HOME))),
      // G28 in relative mode does not disturb the mode flags
      wandered.applyAll([G91C, Home({ x: true, y: false, z: false })]).relMove
    })

  // --- G92 offset model (kept Marlin law) ---

  /// G92 X10 then G1 X10 leaves the physical position unchanged.
  pure val afterRoundtrip: PrinterState = INIT_PRINTER.applyAll([
    Home(BARE_HOME),
    g1(Some(5), None, None, None),
    g92(Some(10), None, None, None),
    g1(Some(10), None, None, None)
  ])

  run g92RoundtripTest =
    assert(and {
      afterRoundtrip.x.pos == 500,
      afterRoundtrip.shift.x == -500,
      // logical readback equals the G92 word
      afterRoundtrip.x.pos - afterRoundtrip.shift.x == 1000,
      afterRoundtrip.x.known
    })

  /// Bare G92 resets (shift := physical, E := 0) with no motion; G92.1
  /// clears the shift and nothing else; G92 words are logical positions
  /// even in G91 (G92 is modeless).
  pure val roamed: PrinterState = INIT_PRINTER.applyAll([
    Home(BARE_HOME),
    g1(Some(5), Some(-3), Some(2), Some(7))
  ])

  run bareG92AndResetTest =
    assert(and {
      roamed.applyCommand(g92(None, None, None, None)).shift == { x: 500, y: -300, z: 200 },
      roamed.applyCommand(g92(None, None, None, None)).e == 0,
      roamed.applyCommand(g92(None, None, None, None)).x.pos == 500,
      roamed.applyAll([g92(Some(10), None, None, Some(3)), ResetShift]).shift == { x: 0, y: 0, z: 0 },
      roamed.applyAll([g92(Some(10), None, None, Some(3)), ResetShift]).e == 300,
      // modeless G92: under G91 the word is still a logical position
      roamed.applyAll([G91C, g92(Some(10), None, None, None)]).shift.x == -500,
      roamed.applyAll([G91C, g92(Some(10), None, None, None)]).x.pos == 500
    })

  // --- physically-named extrusion classification ---

  pure def zl(we: Word, wf: Word): LinearWords = g1words(None, None, None, we, wf)

  pure val absAt10: PrinterState = INIT_PRINTER.applyAll([
    Home(BARE_HOME), g1(None, None, None, Some(10))
  ])
  pure val relAt10: PrinterState = absAt10.applyCommand(SetExtrusionMode(RelativeE))

  run physicalClassificationTest =
    assert(and {
      // absolute mode: an E word BELOW the current position is a
      // retraction (delta -200) even though the raw word is positive
      classifyLinear(absAt10, zl(Some(8), None)) == Retraction,
      // absolute mode: an E word above the current position primes
      classifyLinear(absAt10, zl(Some(12), None)) == Prime,
      // relative mode: negative word retracts, positive word primes
      classifyLinear(relAt10, zl(Some(-2), None)) == Retraction,
      classifyLinear(relAt10, zl(Some(2), None)) == Prime,
      // zero physical delta: F presence decides, then OtherZeroMove
      classifyLinear(absAt10, zl(Some(10), Some(40))) == FeedrateChange,
      classifyLinear(relAt10, zl(Some(0), Some(40))) == FeedrateChange,
      classifyLinear(absAt10, zl(None, Some(50))) == FeedrateChange,
      classifyLinear(absAt10, zl(None, None)) == OtherZeroMove,
      // displacement counts a point, by physics not word presence:
      classifyLinear(absAt10, g1words(Some(4), None, None, Some(1), None)) == CountsPoint,
      // an axis word that goes nowhere does NOT count a point; the
      // extrusion delta still classifies physically
      classifyLinear(absAt10, g1words(Some(0), None, None, Some(8), None)) == Retraction,
      // a relative zero-delta axis word goes nowhere too
      classifyLinear(relAt10.applyCommand(SetPositioningMode(RelativeXYZ)),
        g1words(Some(0), None, None, None, None)) == OtherZeroMove
    })

  // --- probes: documented travel, no z-clamp ---

  pure val homedS: PrinterState = INIT_PRINTER.applyCommand(Home(BARE_HOME))

  run probeTravelTest =
    assert(and {
      // a below-origin Z target is reached, not clamped to 0
      homedS.applyCommand(probe(G38_2, None, None, Some(-5))).z.pos == -500,
      homedS.applyCommand(probe(G38_2, None, None, Some(-5))).z.known,
      // probe targets resolve under the workspace shift like any move
      homedS.applyAll([
        g92(None, None, Some(10), None), probe(G38_3, None, None, Some(2))
      ]).z.pos == -800,
      // and under G91 as relative deltas
      homedS.applyAll([
        g1(None, None, Some(4), None), G91C, probe(G38_4, None, None, Some(-1))
      ]).z.pos == 300,
      // no axis words: complete no-op
      homedS.applyCommand(probe(G38_5, None, None, None)) == homedS,
      not(probeActs({ code: G38_5, x: None, y: None, z: None, f: Some(30) })),
      // probes never touch E
      homedS.applyAll([
        g1(None, None, None, Some(7)), probe(G38_2, None, None, Some(-5))
      ]).e == 700
    })

  // --- arcs: endpoint semantics under modes, units, shift ---

  pure val arcBase: PrinterState = INIT_PRINTER.applyAll([
    Home(BARE_HOME),
    g1(Some(10), Some(10), None, Some(1))
  ])

  run arcStateTest =
    assert(and {
      // absolute arc endpoint; E accounted like a linear move
      arcBase.applyCommand(
        arc(G2, Some(20), Some(10), None, Some(3), Some(5), Some(0), None)
      ).x.pos == 2000,
      arcBase.applyCommand(
        arc(G2, Some(20), Some(10), None, Some(3), Some(5), Some(0), None)
      ).e == 300,
      // shifted arc endpoint after G92 X0
      arcBase.applyAll([
        g92(Some(0), None, None, None),
        arc(G3, Some(5), None, None, None, None, None, Some(4))
      ]).x.pos == 1500,
      // relative arc endpoint: delta from the current position, no shift
      arcBase.applyAll([
        g92(Some(0), None, None, None), G91C,
        arc(G2, Some(5), None, None, None, Some(2), Some(2), None)
      ]).x.pos == 1500,
      // inch-mode arc
      arcBase.applyAll([
        SetUnits(Inches),
        arc(G2, Some(1), None, None, Some(1), Some(1), None, None)
      ]).x.pos == 2540,
      // I/J/R never touch the printer state
      arcBase.applyCommand(arc(G2, None, None, None, None, Some(9), Some(9), Some(9))) == arcBase
    })

  // --- units and tools ---

  run unitsAndToolTest =
    assert(and {
      INIT_PRINTER.applyAll([SetUnits(Inches), g1(Some(2), None, None, Some(1))]).x.pos == 5080,
      INIT_PRINTER.applyAll([SetUnits(Inches), g1(Some(2), None, None, Some(1))]).e == 2540,
      // read-time conversion: switching back never rescales stored state
      INIT_PRINTER.applyAll([
        SetUnits(Inches), g1(Some(2), None, None, None), SetUnits(Millimeters)
      ]).x.pos == 5080,
      // relative inch delta
      INIT_PRINTER.applyAll([
        Home(BARE_HOME), G91C, SetUnits(Inches), g1(Some(1), None, None, None)
      ]).x.pos == 2540,
      INIT_PRINTER.applyCommand(SelectTool(3)).tool == 3,
      INIT_PRINTER.applyCommand(SelectTool(3)).e == 0
    })

  // --- event tags ---

  run cmdTagTest =
    assert(and {
      cmdTag(g1(None, None, None, None)) == "g1",
      cmdTag(Linear({ code: G0, x: None, y: None, z: None, e: None, f: None })) == "g0",
      cmdTag(arc(G3, None, None, None, None, None, None, None)) == "g3",
      cmdTag(SetUnits(Inches)) == "g20",
      cmdTag(SetUnits(Millimeters)) == "g21",
      cmdTag(G90C) == "g90",
      cmdTag(G91C) == "g91",
      cmdTag(Home(BARE_HOME)) == "g28",
      cmdTag(probe(G38_5, None, None, None)) == "g38_5",
      cmdTag(g92(None, None, None, None)) == "g92",
      cmdTag(ResetShift) == "g92_1",
      cmdTag(SetExtrusionMode(AbsoluteE)) == "m82",
      cmdTag(SetExtrusionMode(RelativeE)) == "m83",
      cmdTag(SelectTool(0)) == "t0",
      cmdTag(SelectTool(7)) == "t7",
      kindTag(CountsPoint) == "point",
      kindTag(Retraction) == "retraction",
      kindTag(Prime) == "prime",
      kindTag(FeedrateChange) == "feedrate",
      kindTag(OtherZeroMove) == "other"
    })
}

/**
 * printer_core_next_props — the validation machine for the design: a
 * random-walk exerciser whose invariants ARE the charter's designed-in
 * properties (P2), expressed over ghost previous-state and a flat event
 * record. It lives in this file (rather than at the bank root) because it
 * validates the library itself, like the sibling test module — a
 * deliberate deviation from the v2 lib-files-are-pure rule, recorded in
 * the companion.
 *
 * Validate with:
 *   npx quint run verification/quint-next/lib/printer-core.qnt \
 *     --main printer_core_next_props --invariant allInvariants \
 *     --max-samples 200 --max-steps 30 --seed=0x67c0de2026
 */
module printer_core_next_props {
  import scale_next.* from "./scale"
  import printer_core_next.*

  // --- state and event records ---

  /// Semantic state plus a ghost copy of the previous printer state,
  /// kept so invariants can speak about single-step effects.
  type PropsState = { p: PrinterState, ghostPrev: PrinterState }

  /// Flat event record (str/int/bool only): the step just taken, with the
  /// pre-step mode context the laws need.
  type Event = {
    cmd: str,
    kind: str,
    moved: bool,
    deltaE: int,
    hasX: bool, wordX: int,
    hasY: bool, wordY: int,
    hasZ: bool, wordZ: int,
    hasE: bool, wordE: int,
    homeX: bool, homeY: bool, homeZ: bool,
    bare: bool,
    preRel: bool, preRelE: bool, preFactor: int,
    preShiftX: int, preShiftY: int, preShiftZ: int
  }

  var s: PropsState
  var ev: Event

  // --- event derivation ---

  pure def baseEv(pre: PrinterState, c: Command): Event = {
    val post = applyCommand(pre, c)
    {
      cmd: cmdTag(c),
      kind: "",
      moved: xyzDisplaced(pre, post),
      deltaE: post.e - pre.e,
      hasX: false, wordX: 0,
      hasY: false, wordY: 0,
      hasZ: false, wordZ: 0,
      hasE: false, wordE: 0,
      homeX: false, homeY: false, homeZ: false,
      bare: false,
      preRel: pre.relMove, preRelE: pre.relExtrude,
      preFactor: lengthFactor(pre.inches),
      preShiftX: pre.shift.x, preShiftY: pre.shift.y, preShiftZ: pre.shift.z
    }
  }

  pure def withAxisWords(e: Event, wx: Word, wy: Word, wz: Word, we: Word): Event = {
    ...e,
    hasX: hasWord(wx), wordX: wordVal(wx),
    hasY: hasWord(wy), wordY: wordVal(wy),
    hasZ: hasWord(wz), wordZ: wordVal(wz),
    hasE: hasWord(we), wordE: wordVal(we)
  }

  // --- generation ---

  pure val WORDS: List[Word] =
    [None, Some(-3), Some(-1), Some(0), Some(1), Some(2), Some(5)]

  type StepKind = KMove | KArc | KMode | KEMode | KUnits | KHome | KShift | KReset | KProbe | KTool

  pure val STEP_MENU: List[StepKind] = [
    KMove, KMove, KMove, KMove,
    KArc,
    KMode, KMode,
    KEMode,
    KUnits,
    KHome, KHome,
    KShift, KShift,
    KReset,
    KProbe, KProbe,
    KTool
  ]

  action fire(c: Command, e: Event): bool = all {
    s' = { p: applyCommand(s.p, c), ghostPrev: s.p },
    ev' = e
  }

  action stepMove = {
    nondet xi = WORDS.indices().oneOf()
    nondet yi = WORDS.indices().oneOf()
    nondet zi = WORDS.indices().oneOf()
    nondet ei = WORDS.indices().oneOf()
    nondet fi = WORDS.indices().oneOf()
    val m: LinearWords =
      { code: G1, x: WORDS[xi], y: WORDS[yi], z: WORDS[zi], e: WORDS[ei], f: WORDS[fi] }
    fire(
      Linear(m),
      { ...baseEv(s.p, Linear(m)).withAxisWords(m.x, m.y, m.z, m.e),
        kind: kindTag(classifyLinear(s.p, m)) }
    )
  }

  action stepArc = {
    nondet xi = WORDS.indices().oneOf()
    nondet yi = WORDS.indices().oneOf()
    nondet ei = WORDS.indices().oneOf()
    val m: ArcWords =
      { code: G2, x: WORDS[xi], y: WORDS[yi], z: None, e: WORDS[ei],
        i: Some(1), j: Some(1), r: None }
    fire(Arc(m), baseEv(s.p, Arc(m)).withAxisWords(m.x, m.y, m.z, m.e))
  }

  action stepMode = {
    nondet m = Set(AbsoluteXYZ, RelativeXYZ).oneOf()
    fire(SetPositioningMode(m), baseEv(s.p, SetPositioningMode(m)))
  }

  action stepEMode = {
    nondet m = Set(AbsoluteE, RelativeE).oneOf()
    fire(SetExtrusionMode(m), baseEv(s.p, SetExtrusionMode(m)))
  }

  action stepUnits = {
    nondet u = Set(Inches, Millimeters).oneOf()
    fire(SetUnits(u), baseEv(s.p, SetUnits(u)))
  }

  action stepHome = {
    nondet hx = Set(true, false).oneOf()
    nondet hy = Set(true, false).oneOf()
    nondet hz = Set(true, false).oneOf()
    val m: HomeWords = { x: hx, y: hy, z: hz }
    val all0 = homesAll(m)
    fire(
      Home(m),
      { ...baseEv(s.p, Home(m)),
        homeX: hx or all0, homeY: hy or all0, homeZ: hz or all0 }
    )
  }

  action stepShift = {
    nondet xi = WORDS.indices().oneOf()
    nondet yi = WORDS.indices().oneOf()
    nondet ei = WORDS.indices().oneOf()
    val m: SetPositionWords = { x: WORDS[xi], y: WORDS[yi], z: None, e: WORDS[ei] }
    fire(
      SetPosition(m),
      { ...baseEv(s.p, SetPosition(m)).withAxisWords(m.x, m.y, m.z, m.e),
        bare: not(hasAxisWord(m.x, m.y, m.z) or hasWord(m.e)) }
    )
  }

  action stepReset =
    fire(ResetShift, baseEv(s.p, ResetShift))

  action stepProbe = {
    nondet code = Set(G38_2, G38_3, G38_4, G38_5).oneOf()
    nondet xi = WORDS.indices().oneOf()
    nondet zi = WORDS.indices().oneOf()
    val m: ProbeWords = { code: code, x: WORDS[xi], y: None, z: WORDS[zi], f: None }
    fire(Probe(m), baseEv(s.p, Probe(m)).withAxisWords(m.x, m.y, m.z, None))
  }

  action stepTool = {
    nondet t = 0.to(3).oneOf()
    fire(SelectTool(t), baseEv(s.p, SelectTool(t)))
  }

  action dispatch(k: StepKind): bool =
    match k {
      | KMove => stepMove
      | KArc => stepArc
      | KMode => stepMode
      | KEMode => stepEMode
      | KUnits => stepUnits
      | KHome => stepHome
      | KShift => stepShift
      | KReset => stepReset
      | KProbe => stepProbe
      | KTool => stepTool
    }

  action init = all {
    s' = { p: INIT_PRINTER, ghostPrev: INIT_PRINTER },
    ev' = {
      cmd: "init", kind: "", moved: false, deltaE: 0,
      hasX: false, wordX: 0, hasY: false, wordY: 0,
      hasZ: false, wordZ: 0, hasE: false, wordE: 0,
      homeX: false, homeY: false, homeZ: false, bare: false,
      preRel: false, preRelE: false, preFactor: CENTI,
      preShiftX: 0, preShiftY: 0, preShiftZ: 0
    }
  }

  action step = {
    nondet k = STEP_MENU.indices().oneOf()
    dispatch(STEP_MENU[k])
  }

  // --- designed-in properties, checked ---

  /// Commands whose axis words move the carriage.
  pure def isMoveTag(t: str): bool =
    Set("g0", "g1", "g2", "g3", "g38_2", "g38_3", "g38_4", "g38_5").contains(t)

  /// Mode-independence law, X axis: a present absolute word lands at
  /// scaled word + shift; a present relative word adds the scaled delta
  /// to the previous physical position — shift-free by construction. The
  /// same physical endpoint is therefore expressible in either mode.
  val moveLawX =
    (isMoveTag(ev.cmd) and ev.hasX) implies (
      if (ev.preRel) s.p.x.pos == s.ghostPrev.x.pos + ev.wordX * ev.preFactor
      else s.p.x.pos == ev.wordX * ev.preFactor + ev.preShiftX
    )

  val moveLawY =
    (isMoveTag(ev.cmd) and ev.hasY) implies (
      if (ev.preRel) s.p.y.pos == s.ghostPrev.y.pos + ev.wordY * ev.preFactor
      else s.p.y.pos == ev.wordY * ev.preFactor + ev.preShiftY
    )

  val moveLawZ =
    (isMoveTag(ev.cmd) and ev.hasZ) implies (
      if (ev.preRel) s.p.z.pos == s.ghostPrev.z.pos + ev.wordZ * ev.preFactor
      else s.p.z.pos == ev.wordZ * ev.preFactor + ev.preShiftZ
    )

  /// Extrusion law: E words scale with units, follow the E mode, and are
  /// NEVER workspace-shifted; absent E words hold on every move.
  val moveLawE =
    isMoveTag(ev.cmd) implies (
      if (ev.hasE)
        if (ev.preRelE) s.p.e == s.ghostPrev.e + ev.wordE * ev.preFactor
        else s.p.e == ev.wordE * ev.preFactor
      else s.p.e == s.ghostPrev.e
    )

  /// Absent axis words hold the axis entirely (position and knowledge).
  val absentWordsHold =
    isMoveTag(ev.cmd) implies and {
      not(ev.hasX) implies s.p.x == s.ghostPrev.x,
      not(ev.hasY) implies s.p.y == s.ghostPrev.y,
      not(ev.hasZ) implies s.p.z == s.ghostPrev.z
    }

  /// Axis knowledge is monotone: nothing un-knows an axis.
  val knowledgeMonotone = and {
    s.ghostPrev.x.known implies s.p.x.known,
    s.ghostPrev.y.known implies s.p.y.known,
    s.ghostPrev.z.known implies s.p.z.known
  }

  /// Partial homing: exactly the effective axes land known at the
  /// origin; the others are untouched; shift, E, modes and tool survive.
  val partialHomeLaw =
    (ev.cmd == "g28") implies and {
      if (ev.homeX) s.p.x == { known: true, pos: 0 } else s.p.x == s.ghostPrev.x,
      if (ev.homeY) s.p.y == { known: true, pos: 0 } else s.p.y == s.ghostPrev.y,
      if (ev.homeZ) s.p.z == { known: true, pos: 0 } else s.p.z == s.ghostPrev.z,
      s.p.shift == s.ghostPrev.shift,
      s.p.e == s.ghostPrev.e,
      s.p.relMove == s.ghostPrev.relMove,
      s.p.relExtrude == s.ghostPrev.relExtrude,
      s.p.inches == s.ghostPrev.inches,
      s.p.tool == s.ghostPrev.tool
    }

  /// Physical stats naming: a retraction really pulled filament back on
  /// a stationary carriage; a prime really pushed it forward; a point
  /// really displaced the carriage.
  val statsPhysical = and {
    (ev.kind == "retraction") implies (not(ev.moved) and ev.deltaE < 0),
    (ev.kind == "prime") implies (not(ev.moved) and ev.deltaE > 0),
    (ev.kind == "point") implies ev.moved,
    (ev.kind == "feedrate" or ev.kind == "other")
      implies (not(ev.moved) and ev.deltaE == 0)
  }

  /// G92 laws: motionless; a worded axis reads back the word as its
  /// logical position; unworded axes keep their shift; the bare form is
  /// the RepRap reset; a G92 E word sets the extruder position.
  val g92Law =
    (ev.cmd == "g92") implies and {
      not(ev.moved),
      s.p.x.pos == s.ghostPrev.x.pos,
      s.p.y.pos == s.ghostPrev.y.pos,
      s.p.z.pos == s.ghostPrev.z.pos,
      ev.hasX implies (s.p.x.pos - s.p.shift.x == ev.wordX * ev.preFactor),
      ev.hasY implies (s.p.y.pos - s.p.shift.y == ev.wordY * ev.preFactor),
      ev.hasE implies (s.p.e == ev.wordE * ev.preFactor),
      (not(ev.hasX) and not(ev.bare)) implies s.p.shift.x == s.ghostPrev.shift.x,
      (not(ev.hasY) and not(ev.bare)) implies s.p.shift.y == s.ghostPrev.shift.y,
      ev.bare implies and {
        s.p.shift == { x: s.ghostPrev.x.pos, y: s.ghostPrev.y.pos, z: s.ghostPrev.z.pos },
        s.p.e == 0
      },
      // G92 never mints knowledge
      s.p.x.known == s.ghostPrev.x.known,
      s.p.y.known == s.ghostPrev.y.known,
      s.p.z.known == s.ghostPrev.z.known
    }

  /// G92.1 clears the shift and touches nothing else.
  val resetLaw =
    (ev.cmd == "g92_1") implies
      s.p == { ...s.ghostPrev, shift: { x: 0, y: 0, z: 0 } }

  /// Mode flags change only through their commands.
  val modeFlagsOnlyByCommand = and {
    (s.p.relMove != s.ghostPrev.relMove)
      implies (ev.cmd == "g90" or ev.cmd == "g91"),
    (s.p.relExtrude != s.ghostPrev.relExtrude)
      implies Set("g90", "g91", "m82", "m83").contains(ev.cmd),
    (s.p.inches != s.ghostPrev.inches)
      implies (ev.cmd == "g20" or ev.cmd == "g21"),
    (s.p.tool != s.ghostPrev.tool)
      implies Set("t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7").contains(ev.cmd)
  }

  /// A probe with no axis words is a complete no-op, and probes never
  /// touch the extruder.
  val probeLaw =
    Set("g38_2", "g38_3", "g38_4", "g38_5").contains(ev.cmd) implies and {
      s.p.e == s.ghostPrev.e,
      (not(ev.hasX) and not(ev.hasY) and not(ev.hasZ)) implies s.p == s.ghostPrev
    }

  val allInvariants = and {
    moveLawX,
    moveLawY,
    moveLawZ,
    moveLawE,
    absentWordsHold,
    knowledgeMonotone,
    partialHomeLaw,
    statsPhysical,
    g92Law,
    resetLaw,
    modeFlagsOnlyByCommand,
    probeLaw
  }
}
