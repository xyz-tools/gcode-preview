# Thumbnail comment protocol

A companion to `thumbnail.qnt`, which models the embedded-thumbnail protocol that slicers write into G-code comments. The machine watches the comment stream for `thumbnail begin WxH N` and `thumbnail end` markers, accumulates the payload lines in between, and keeps a finished thumbnail only when the collected characters pass the length and base64 checks.

```mermaid
stateDiagram-v2
    direction LR
    state "Idle" as idle
    state "Collecting" as collecting
    state "Completed, valid" as storedValid
    state "Discarded, invalid" as discardedInvalid

    [*] --> idle
    idle --> idle : end without begin, or any other comment, is ignored
    idle --> collecting : thumbnail begin WxH N
    collecting --> collecting : thumbnail begin restarts a fresh block, old one discarded
    collecting --> collecting : marker-free comment appends its chars, no cap
    collecting --> storedValid : end with collected equal to declared, a multiple of 4, and all chars base64
    collecting --> discardedInvalid : end with length mismatch or non-base64 chars
    storedValid --> idle : stored under its WxH key
    discardedInvalid --> idle : block dropped

    note right of collecting
        tracks expected and collected char counts
        a clean flag turns false once any
        non-base64 comment is appended
        collected may legitimately exceed expected
    end note

    note right of storedValid
        invariant, every stored length is a
        non-negative multiple of 4
    end note
```

Both outcomes of `end` clear the in-progress block and return to idle, where the spec's invariant pins every counter back to zero and the clean flag back to true.

Two quirks are modeled deliberately, not idealized away. Appends have no cap, so the collected count can overshoot the declared count and the mismatch is only caught at `end` (the spec explicitly refuses `collected <= expected` as an invariant). And finished thumbnails are keyed by their `WxH` size, so a later thumbnail with the same dimensions silently overwrites the earlier one.
