# Interpreter state machine, at a glance

A visual companion to `interpreter.qnt`, the formal spec of how a G-code stream drives printer state. The spec models the effects of motion commands, workspace offsets, unit and extrusion modes, homing, straight probes and tool selection on the tracked position, extruder axis and job statistics — firmware semantics only, independent of any implementation.

## Homing and axis knowledge

Each axis starts unknown and becomes known the first time something commands it. The diagram follows one axis; `G28` acts on all three at once.

```mermaid
stateDiagram-v2
  direction LR
  Unknown: Axis unknown
  KnownMove: Known via move
  Homed: Homed
  [*] --> Unknown
  Unknown --> KnownMove : G0 G1 G2 G3 or probe with this axis word
  Unknown --> Homed : G28
  KnownMove --> Homed : G28
  KnownMove --> KnownMove : further moves and probes
  Homed --> Homed : moves keep axes known
  note right of Unknown
    Position reads zero while unknown.
    G92 reshapes the workspace shift
    but never makes an axis known.
  end note
  note right of Homed
    G28 zeroes all three axes.
    Homed implies every axis is known
    and nothing un-homes.
  end note
```

The notes carry the spec's invariants: an unknown axis always reads zero (`unknownAxisIsZero`) and the homed flag implies all three axes are known (`homedImpliesKnown`).

## What each command class touches

This is a data-state machine, so the clearest map is which state fields each command class writes. Move targets are always computed through the current units factor and workspace shift.

```mermaid
flowchart LR
  cLin["G0 G1 linear move"]
  cArc["G2 G3 arc move"]
  cUnits["G20 G21"]
  cHome["G28"]
  cProbe["G31 G38.2 to G38.5"]
  cSet["G92"]
  cReset["G92.1"]
  cExt["M82 M83"]
  cTool["T0 to T7"]

  fPos["position and axis-known flags"]
  fShift["workspace shift"]
  fE["extruder position"]
  fUnits["units flag"]
  fRel["extrusion mode flag"]
  fHomed["homed flag"]
  fTool["active tool"]
  fPts["points counter"]
  fCls["zero-length move counters"]

  cLin --> fPos
  cLin --> fE
  cLin -->|any axis word| fPts
  cLin -->|no axis words| fCls
  cArc --> fPos
  cArc --> fE
  cUnits --> fUnits
  cHome --> fPos
  cHome --> fHomed
  cProbe -->|unless P word or no axis words| fPos
  cProbe -->|unless P word or no axis words| fPts
  cSet --> fShift
  cSet --> fE
  cReset --> fShift
  cExt --> fRel
  cTool --> fTool
```

A few pinned behaviors the arrows cannot show. Arc moves share a linear move's endpoint and extruder accounting but never touch the points counter. A zero-length linear move is classified by the raw sign of its E word first — a positive E word counts as a retraction even when, in absolute mode, the extruder position drops — then by F presence as a feedrate change, and otherwise as "others"; an explicit E0 falls through to the F check. A bare `G92` captures the current physical position as the shift and zeroes the extruder, while `G92.1` clears the shift and leaves the extruder alone. A probe aiming its shifted Z target below the origin plane, starting from a known Z at or above it, triggers at physical Z0 instead of traveling through.

## Units and extrusion modes

Two independent flags form a small lattice. Flipping one never disturbs the other, so opposite edges commute — the spec's `unitsModeCommuteTest` pins this down. Re-issuing the mode you are already in is a self-loop, omitted here for readability.

```mermaid
stateDiagram-v2
  direction LR
  MmAbs: mm and absolute E
  MmRel: mm and relative E
  InAbs: inches and absolute E
  InRel: inches and relative E
  [*] --> MmAbs
  MmAbs --> InAbs : G20
  InAbs --> MmAbs : G21
  MmRel --> InRel : G20
  InRel --> MmRel : G21
  MmAbs --> MmRel : M83
  MmRel --> MmAbs : M82
  InAbs --> InRel : M83
  InRel --> InAbs : M82
```

The active corner scales every incoming axis and E word — inches multiply by 25.4 — and decides whether an E word sets the extruder position outright or adds to it.
