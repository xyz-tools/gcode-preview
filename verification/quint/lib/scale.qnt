// -*- mode: Bluespec; -*-
/**
 * scale — the length-scaling convention, defined once.
 *
 * Unit: cross-cutting foundation for the interpreter-state map
 *   (IS-1..IS-6 in .context/formal-verification/mapping-data.json);
 *   every machine that handles length words imports this module.
 * Authority policy: see verification/quint/STYLE.md ("Authority
 *   annotations"). This module carries no command semantics of its own;
 *   per-command annotations live in lib/printer-core.qnt.
 * Companion: scale.md.
 *
 * All lengths are integers in centi-millimeters (mm x 100), so specs
 * stay in Int and the replay compares integer-exactly. The two constants
 * below and the conversion defs are the only place the scale is written
 * down; no spec may hard-code 100 or 2540 for a length.
 */
module scale {
  /// Centi-millimeters per millimeter: the integer grid every length
  /// lives on. One model unit is 0.01 mm.
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
 * Self-tests for the scale module.
 *
 * Validate with:
 *   npx quint test verification/quint/lib/scale.qnt --main scale_test
 */
module scale_test {
  import scale.*

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
}
