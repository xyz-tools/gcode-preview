// -*- mode: Bluespec; -*-
/**
 * scale_next — the length-scaling convention of the quint-next design
 * bank, defined once.
 *
 * Unit: cross-cutting foundation for every quint-next machine that
 *   handles length words. This bank is NORMATIVE design (see the design
 *   charter in lib/printer-core.md): it is deliberately not bound to the
 *   current implementation and has no trace replay.
 * Authority policy: verification/quint/STYLE.md ("Authority
 *   annotations"), adapted for a design bank — annotations cite firmware
 *   documentation or a charter principle (P1..P6). This module carries no
 *   command semantics; per-command annotations live in
 *   lib/printer-core.qnt.
 * Companion: scale.md.
 *
 * All quint-next lengths are integers in centi-millimeters (mm x 100), so
 * specs stay in Int and comparisons are integer-exact. The constants and
 * conversion defs below are the only place the scale is written down; no
 * spec may hard-code 100 or 2540 for a length. The convention is restated
 * here (rather than imported from quint) because the banks are
 * independent by design: quint-next must parse and run self-contained.
 *
 * Read-time conversion is the designed semantics (charter P1: Marlin and
 * the RepRap wiki document G20/G21 as changing how subsequent length
 * words are interpreted): a word is converted to centi-mm at the moment
 * it is read, under the units flag active on that line. Stored state is
 * always centi-mm; switching units never rewrites stored positions.
 */
module scale_next {
  /// Centi-millimeters per millimeter: the integer grid every quint-next
  /// length lives on. One model unit is 0.01 mm.
  pure val CENTI: int = 100

  /// Centi-millimeters per inch: 1 inch = 25.4 mm = 2540 centi-mm.
  /// The factor is exact on the centi-mm grid, which is why whole-valued
  /// inch words stay integral in the model.
  pure val INCH_CENTI: int = 2540

  /// Current-units -> centi-mm factor, as a pure function of the units
  /// flag (true = G20 inches, false = G21 millimeters).
  pure def lengthFactor(inches: bool): int =
    if (inches) INCH_CENTI else CENTI

  /// Convert a raw G-code length word to centi-mm under the active units
  /// flag. This is the single word-entry point: every axis and E word a
  /// machine consumes goes through here (or through printer-core defs
  /// that call here).
  pure def toCenti(word: int, inches: bool): int =
    word * lengthFactor(inches)

  /// Millimeter-only convenience for specs whose alphabet is pinned to
  /// mm (equal to toCenti(mm, false)).
  pure def mmToCenti(mm: int): int = mm * CENTI
}

/**
 * Self-tests for the scale_next module.
 *
 * Validate with:
 *   npx quint test verification/quint-next/lib/scale.qnt --main scale_next_test
 */
module scale_next_test {
  import scale_next.*

  run scaleConstantsTest =
    assert(and {
      CENTI == 100,
      INCH_CENTI == 2540,
      // 1 inch = 25.4 mm, expressed on the integer grid: 254 mm = 10 inches
      10 * INCH_CENTI == mmToCenti(254)
    })

  run lengthFactorTest =
    assert(and {
      lengthFactor(false) == CENTI,
      lengthFactor(true) == INCH_CENTI
    })

  run toCentiTest =
    assert(and {
      toCenti(2, false) == 200,
      toCenti(2, true) == 5080,
      toCenti(-5, false) == -500,
      toCenti(-5, true) == -12700,
      toCenti(0, true) == 0,
      toCenti(7, false) == mmToCenti(7)
    })

  run readTimeConversionTest =
    // The same word under different flags is two different lengths:
    // conversion happens at read time, per word, never on stored state.
    assert(and {
      toCenti(1, true) == 2540,
      toCenti(1, false) == 100,
      toCenti(1, true) != toCenti(1, false)
    })
}
