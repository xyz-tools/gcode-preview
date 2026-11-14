# Shift-Frame Encoding Equivalence

This spec runs two copies of the same printer in lockstep. Copy A reads a G-code program exactly as written; copy B reads the same program re-encoded into a workspace that was shifted once, up front, by a single `G92 X Y Z` — every later X, Y and Z move word carries the offset, so both machines should trace the identical physical path.

All lengths are whole centi-millimeters, E words and `G28`/`M82`/`M83` are identical in both streams, and the frame is frozen for the entire trace: no second `G92` is ever issued.

```mermaid
flowchart LR
  INIT["init: both copies clean at physical zero"]

  subgraph laneA["stream A - plain frame"]
    AFRAME["frame step: no line"]
    ALOOP["command loop: G0 G1, G28, M82, M83 as written"]
    AFRAME --> ALOOP
  end

  subgraph laneB["stream B - G92-shifted frame"]
    BFRAME["frame step: G92 X offX Y offY Z offZ"]
    BLOOP["command loop: same commands, every X Y Z word shifted by the offset"]
    BFRAME --> BLOOP
  end

  INIT --> AFRAME
  INIT --> BFRAME

  AGREE["frameAgreement invariant: identical physical position, known-axis flags, extruded length, extrusion mode and homed flag"]
  ALOOP --> AGREE
  BLOOP --> AGREE
  AGREE -. next command, lockstep .-> ALOOP
  AGREE -. next command, lockstep .-> BLOOP

  FROZEN["frozen frame: no further G92, so stream B keeps the frame shift for the whole trace"]
  BLOOP -.- FROZEN
```

After the frame step, every step feeds one logical command to both streams at once, and the two copies must agree on every physical observable before the next command is drawn. Homing with `G28` sends both copies to the physical origin but leaves stream B's workspace shift untouched, so the frames stay apart while the physical states stay equal.

```mermaid
stateDiagram-v2
  [*] --> Unframed : init
  Unframed --> Framed : frame - stream B executes its one G92
  Framed --> Framed : anyMove - G0 or G1, any subset of X Y Z E words
  Framed --> Framed : absoluteE M82 or relativeE M83
  Framed --> Framed : homeBoth G28 - both home, shift kept
  note right of Unframed
    cleanBeforeFrame - nothing has
    happened in either copy yet
  end note
  note right of Framed
    frameAgreement and shiftFrozen hold here
    unknownAxisIsZero holds everywhere -
    an untouched axis sits at the 0 convention
  end note
```

The scheduler always frames first, then draws commands at random, weighted towards moves over mode flips and homing. Each simulated trace records both command lines side by side, so it doubles as two G-code programs a replay harness can feed to two real interpreters and compare.
