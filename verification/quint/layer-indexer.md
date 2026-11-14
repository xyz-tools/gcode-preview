# Layer assignment across streamed chunks

This spec models how a print job groups extrusion paths into layers while G-code arrives chunk by chunk, one move line or slicer layer-comment block per step. All heights live in centi-millimeters, so the real tolerances, a 0.05 mm fallback break and a 0.01 mm metadata z-match, stay exact under integer comparison.

Two strategies compete. A tolerance fallback infers layers from upward z jumps between extrusions, while slicer LAYER_CHANGE comments feed a metadata mode that files paths against declared boundaries instead. The first path sorted after any metadata exists locks the choice to metadata forever; a non-planar extrusion before that point dissolves layer indexing for good.

## Strategy lifecycle

```mermaid
stateDiagram-v2
    direction LR
    Fallback: Fallback tolerance indexing
    Metadata: Metadata mode
    Collapsed: Collapsed, indexing removed
    [*] --> Fallback
    Fallback --> Fallback: travel, extrude, or a layercomment with no finished path to re-file
    Fallback --> Metadata: first path sort after a layercomment, usually the chunk-resume re-file
    Fallback --> Collapsed: extrudeup before any layercomment
    Metadata --> Metadata: travel, extrude, extrudeup, layercomment
    Collapsed --> Collapsed: every later event
    note right of Metadata
        locking needs at least one metadata entry
        and nothing ever clears the lock,
        adoption rewrites fallback-made layers on entry,
        and only here does the layer pointer advance
    end note
    note right of Collapsed
        absorbing with an empty layer list,
        it never locks and never assigns a path again
    end note
```

A stutter event self-loops in every mode without feeding input. The invariants pin this shape: the lock demands evidence of at least one slicer layer entry, the collapse keeps the layer list empty and the lock unset forever, and the metadata pointer stays at zero until the lock is taken.

## Filing one path

```mermaid
flowchart TD
    A["a finished path is filed, carrying its seed z"] --> W{"metadata exists and strategy still unset"}
    W -- yes --> AD["lock to metadata and adopt declared z and height onto existing layers"]
    W -- no --> T{"travel path"}
    AD --> T
    T -- yes --> TJ["join the last layer, or drop when none exist"]
    T -- no --> L{"locked to metadata"}
    L -- no --> F0{"any layers yet"}
    F0 -- no --> F1["open layer 0 at seed z with height equal to that z"]
    F0 -- yes --> F2{"seed z above the last layer by more than 0.05 mm"}
    F2 -- yes --> F3["append a layer whose height is the z difference"]
    F2 -- no --> F4["join the last layer, even from below it"]
    L -- yes --> S["scan the metadata forward from the pointer"]
    S --> G{"an entry matches within 0.01 mm"}
    G -- yes --> M1["materialize layers up to the match and move the pointer there"]
    G -- no --> M2["above all metadata: bootstrap one layer or join the last, pointer stays"]
```

A path continued across several moves keeps the z it was seeded with, and filing reads that seed, so a non-planar extrusion in metadata mode files quietly by its seed z. Once collapsed, no path reaches this flow at all.

The invariants hold every filed path to exactly one existing layer and keep each layer's z and height in lockstep. While the fallback owns the list, z values climb strictly beyond the tolerance and heights telescope from zero, the first layer's height equaling its own z. The forward scan has one pinned detail: an entry with no declared z claims the path outright when its layer does not exist yet, and an undeclared or bootstrapped height defaults to 0.2 mm.

## A layer-change comment chunk

```mermaid
flowchart TD
    LC["layercomment: a LAYER_CHANGE block parsed as its own chunk"] --> AP["append a metadata entry with its declared z and height, if any"]
    AP --> D{"z declared, height missing, and the previous entry declared z"}
    D -- yes --> DH["derive the height as the z difference between the two entries"]
    D -- no --> KD["keep the entry as written"]
    DH --> H{"HEIGHT line present"}
    KD --> H
    H -- yes --> SH["update the line height that later moves build paths with"]
    H -- no --> R{"a finished path exists and no collapse happened"}
    SH --> R
    R -- yes --> RF["resuming the chunk re-files that path against the grown metadata"]
    R -- no --> NS["nothing is sorted, no layer assigned this step"]
    RF --> LK["this re-sort locks the strategy when it is still unset"]
```

The re-file is the chunk-boundary resume behavior the spec models: executing the comment block as its own chunk re-sorts the last finished path, and that sort is the usual moment the strategy locks and adopts. A HEIGHT line also changes the line height that later moves carry, so the next move starts a fresh path seeded at the current z instead of continuing the old one. Metadata entries keep accumulating even after a collapse; they just never sort anything again.
