# Lifecycle automaton

A companion to `lifecycle.qnt`, the spec of the preview's public lifecycle calls: process, clear, render, resize and dispose. The model predicts the preview's observable phase, how many paths one fixed single-move G-code snippet grows per job epoch, and how many scene-manager generations exist, so every trace doubles as a call script for the replay harness.

## Phase machine

```mermaid
stateDiagram-v2
    direction LR
    [*] --> fresh : init
    fresh --> hasContent : process
    fresh --> fresh : clear
    fresh --> fresh : render / resize
    fresh --> disposed : dispose
    hasContent --> hasContent : process
    hasContent --> hasContent : render / resize
    hasContent --> fresh : clear
    hasContent --> disposed : dispose
    disposed --> disposed : dispose
    disposed --> hasContent : process
    disposed --> fresh : clear
    disposed --> fresh : render / resize with an empty job
    disposed --> hasContent : render / resize with retained paths
    note left of fresh
        Predicted outcome of every
        call is ok. No lifecycle
        call ever throws.
    end note
    note right of disposed
        Not absorbing. Every action except
        dispose and stutter resurrects a
        live manager, bumping the manager
        generation, and leaves this phase.
    end note
```

The spec pins two invariants onto this picture: the automaton can only sit in `disposed` immediately after a dispose or a stutter, and the phase always matches the job, so `fresh` means zero paths and `hasContent` means at least one. The `dispose` self-loop and the `clear` self-loop are the idempotent cases the spec tests explicitly. A `stutter` action self-loops on every phase and is omitted above.

## Job growth within an epoch

The job is retained across dispose and only replaced by clear, so path growth has its own small machine. The snippet uses absolute extrusion: the first process of an epoch lays an extrusion path, replaying the same move extrudes nothing and so adds a travel path, and every later process merely extends that travel path.

```mermaid
stateDiagram-v2
    direction LR
    p0 : no paths
    p1 : one extrusion path
    p2 : extrusion plus travel
    [*] --> p0 : init
    p0 --> p1 : process
    p1 --> p2 : process
    p2 --> p2 : process extends the travel path
    p0 --> p0 : clear
    p1 --> p0 : clear
    p2 --> p0 : clear
    note right of p2
        Path count is capped at two and
        never exceeds the total processed
        count. Dispose leaves the job and
        this counter untouched.
    end note
```

Dispose, render, resize and stutter do not appear here because none of them changes the job.
