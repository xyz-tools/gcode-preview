# Streaming line splitter: the carry-buffer machine

A diagram companion to `streaming.qnt`.

The spec models how a G-code document, arriving as a stream of arbitrarily sized chunks, is cut into complete lines. Chunk boundaries can fall anywhere — mid-line, inside a comment block, or around an empty chunk — so the machine keeps an unfinished tail in a carry buffer and emits a line only once its terminating newline has arrived.

## The step loop

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Feeding: init picks a random document
    Feeding --> Feeding: takeChunk feeds 0 to 5 tokens
    Feeding --> Exhausted: takeChunk consumes the last token
    Exhausted --> Exhausted: stutter
    note right of Feeding
        Conservation invariant, checked in every state.
        The emitted lines, each with its newline restored,
        then the carry, then the unread input,
        reconstruct the document exactly.
    end note
```

Each step either feeds the next chunk — whose size is chosen nondeterministically, zero included — or stutters once the document is exhausted, so a step is always enabled. A zero-length document begins life already exhausted.

## Inside one step: the feed transition

```mermaid
flowchart TD
    Take["Take the next chunk, 0 to 5 tokens"] --> HasNl{"Does the chunk contain a newline?"}
    HasNl -- "no" --> CarryAll["Nothing completes. The whole chunk joins the carry"]
    HasNl -- "yes" --> Text["Completed text is the carry plus the chunk up to its last newline"]
    Text --> Run{"How much of that text is a trailing run of comment-only lines?"}
    Run -- "all of it" --> HoldAll["Emit nothing. The whole text stays in the carry, final newline kept"]
    Run -- "part of it" --> HoldSome["Emit the lines before the run. The run stays in the carry, newline kept"]
    Run -- "none of it" --> EmitAll["Emit every completed line"]
    HoldAll --> Partial["The partial text after the last newline joins the new carry"]
    HoldSome --> Partial
    EmitAll --> Partial
    CarryAll --> Next["Next step"]
    Partial --> Next
```

A comment-only line is one whose first non-blank character is the `;` comment opener. Trailing runs of such lines are deliberately held back, terminating newline included, until a non-comment line closes the run — so a chunk boundary inside a comment block emits nothing yet.

One accounting refinement is pinned by the spec: a step that completes nothing but still consumes a newline records a single empty line. That is what makes conservation exact.

## What the other invariants pin down

The emitted lines are always a prefix of what a single oneshot feed of the whole document would produce, so chunking never changes the result. Every newline-terminated line sitting inside the carry is comment-only — nothing else is ever held back. And no emitted line contains the newline that completed it.
