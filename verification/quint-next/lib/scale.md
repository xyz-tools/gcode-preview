# scale.qnt — the length-scaling convention

Companion to `lib/scale.qnt` (modules `scale_next`, `scale_next_test`).

## What it specifies

All quint-next lengths are integers in centi-millimeters (0.01 mm). The two
constants (`CENTI = 100`, `INCH_CENTI = 2540`) and the conversion defs
(`lengthFactor`, `toCenti`, `mmToCenti`) are the only place the scale is
written down; no spec may hard-code 100 or 2540 for a length.

Conversion happens at read time, per word, under the units flag active on that
line. Stored state is always centi-mm and never rescales when G20/G21 switch —
`readTimeConversionTest` and the units run in `printer_core_next_test` pin
this down.

## Why it is restated here

The quint-next bank is self-contained by design: it never imports from
quint, so the two banks can evolve independently. The convention itself is
unchanged from v2 — it conforms to Marlin/RepRap G20/G21 semantics (length
words interpreted under the active unit) and 25.4 mm per inch is exact on the
centi-mm grid.

## Open items

Inch words that leave the integer centi-mm grid (fractions finer than 0.01 in)
are out of model, as in v2. Nothing else is open.
