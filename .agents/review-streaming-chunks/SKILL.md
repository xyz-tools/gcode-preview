---
name: review-streaming-chunks
description: Reviews changes for streaming/chunk-boundary bugs in the parser and stream readers. Use when reviewing changes touching parseGCode/parseStream, readStream/splitChunk, chunked input, or any parser instance state.
---

# Streaming Chunk-Boundary Review

Focused code review of the current changes for ONE class of defect: state and data lost or corrupted at streamed-chunk boundaries. Report findings only for this class — no general style feedback.

**Before reporting, read `.claude/skills/review-checklist/SKILL.md`** — it defines target resolution, empirical verification, severity tags, the Problem/Example/Recommendation format, and the confirm-before-posting protocol.

## What to hunt
- Parser/interpreter state held in a local variable inside a per-chunk function instead of instance state — anything half-built when a chunk ends (thumbnail blocks, multi-line comments, partial lines) is silently lost.
- Newline handling in `slice`/`split`/`indexOf` around chunk tails: off-by-one keeping the separator (`tail = str.slice(idxNewLine)` retains `\n` → spurious blank line + inflated lineCount per boundary) or dropping the last character of a no-newline chunk.
- Missing final-tail flush: after the stream ends, any buffered tail must still be parsed — files without a trailing newline lose their last command otherwise.
- Zero-length/empty chunk treated as end-of-stream (empty chunks are legal mid-stream; only the reader's `done` signals the end).
- Accumulators assigned (`=`) where they must append (`+=`/`push`/concat) — e.g. `parser.lines` overwritten per chunk keeps only the last chunk.
- `lineCount` / index accounting that resets or double-counts across chunks.
- Streaming vs oneshot equivalence: any parsing behavior change must hold for both paths. The equivalence harness from PR #416 exists — new parser features need coverage there, and tests must exercise the real streaming path, not a shortcut.

## Known incidents in this repo
- PR #353: streaming parses overwrote `parser.lines` per chunk (assignment, not append), keeping only the last chunk — 72,055 of 163,474 lines. Its tail-newline off-by-one was flagged in review, not fixed, and shipped.
- PR #415: three data-loss bugs — `splitChunk` split a no-newline chunk before its last character; `readStream` never flushed the final tail; zero-length chunk treated as end-of-stream.
- PR #417: multi-line thumbnail accumulator held in a local variable instead of parser state — thumbnails worked oneshot but vanished under streaming. Caught by the #416 equivalence harness.

## Detection heuristics
- Grep the diff for `slice(`, `split(`, `indexOf('\n')`, `lastIndexOf` near chunk/tail handling; hand-trace a chunk ending exactly at, one before, and one after a newline.
- Grep for `let ` locals in functions called per-chunk that hold partial parse products.
- Grep for `= []`, `= ''`, `= 0` on parser fields inside per-chunk code paths — should they accumulate instead?
- Grep for `done`, `read()`, `length === 0` in stream readers — is empty-chunk conflated with stream end?
- Ask: "what happens if the input arrives in 1-byte chunks?" for every changed parse path; the equivalence harness can answer empirically.

**Example finding:** "chunk boundary mid-thumbnail → streaming yields no thumbnail, oneshot works"
