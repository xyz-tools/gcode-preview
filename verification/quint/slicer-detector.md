# Slicer detection latch

This spec models slicer detection over a streaming G-code file as a write-once latch. Each step observes one line; the first line carrying a known slicer marker fixes both the classification and the reported slicer name for the rest of the stream, and no later line is ever examined again.

## The latch

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Unlatched
    Unlatched --> Unlatched: neutral_comment, neutral_move
    Unlatched --> PrusaFamily: prusa_header or prusa_layer_change
    Unlatched --> Simplify3D: simplify3d_header or simplify3d_layer
    Unlatched --> Slic3r: slic3r_header or slic3r_layer
    Unlatched --> Cura: cura_header or cura_layer
    PrusaFamily --> PrusaFamily: any later line
    Simplify3D --> Simplify3D: any later line
    Slic3r --> Slic3r: any later line
    Cura --> Cura: any later line
    note left of Unlatched
        family and detected are none and
        latchLine is -1 exactly while here
    end note
    note right of PrusaFamily
        detected is PrusaSlicer when latched by prusa_header,
        the generic PrusaFamily when latched by prusa_layer_change.
        A later header naming PrusaSlicer never upgrades the name.
    end note
```

Marker lines only latch out of the un-latched state; neutral lines loop there forever without latching. Every latched state self-loops on all later lines, markers for rival slicers included: the latchMonotone invariant pins the classification and the reported name to the first ones ever taken.

## First-match priority within one line

```mermaid
flowchart LR
    line["comment line"] --> tryPrusa{"PrusaFamily pattern"}
    tryPrusa -- match --> latchPrusa["latch PrusaFamily"]
    tryPrusa -- no --> tryS3d{"Simplify3D pattern"}
    tryS3d -- match --> latchS3d["latch Simplify3D"]
    tryS3d -- no --> trySlic3r{"Slic3r pattern"}
    trySlic3r -- match --> latchSlic3r["latch Slic3r"]
    trySlic3r -- no --> tryCura{"Cura pattern"}
    tryCura -- match --> latchCura["latch Cura"]
    tryCura -- no --> stay["no match, stay un-latched"]
```

Detection tries the families in the fixed order PrusaFamily, Simplify3D, Slic3r, Cura and takes the first match. The spec pins one consequence of this order: the PrusaSlicer header text also matches Slic3r's version pattern, yet it always latches PrusaFamily because PrusaFamily is consulted first. Across the stream, though, the latch is strictly first-come — a Cura marker seen before any Prusa marker latches Cura, and the higher-priority family can never displace it.

Beyond monotonicity, the invariants require that the family and the reported name are set together or not at all, that the reported name always belongs to the latched family, with only PrusaFamily resolving to a more specific generator name, and that latchLine names a line that was actually observed.
