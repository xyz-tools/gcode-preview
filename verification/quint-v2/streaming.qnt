// -*- mode: Bluespec; -*-
/**
 * v2 formal specification of the streaming chunk-boundary line splitter:
 * the carry-buffer machine that turns arbitrarily chunked input into whole
 * lines while holding back trailing comment-only runs. Independent of the
 * printer core: its whole universe is text, chunks, lines and a carry.
 *
 * The document is a list of integer tokens over a 5-letter alphabet that the
 * replay maps 1:1 to characters (token = array index on the replay side):
 *
 *   0 -> 'a'   ordinary letter
 *   1 -> 'b'   ordinary letter
 *   2 -> ' '   blank (skipped when deciding whether a line is comment-only)
 *   3 -> ';'   comment opener
 *   4 -> '\n'  line separator
 *
 * State shape (the v2 trace contract): exactly two variables.
 *   - `s`  is the semantic machine state as one record, advanced only by
 *     pure transition functions (`applyChunk`, `applyStutter`).
 *   - `ev` is the event record describing what the step did, in plain
 *     strings and token lists so an ITF trace doubles as a chunking
 *     schedule a replay can feed to the real splitter.
 *
 * Emitted-line accounting: a line is recorded the moment its terminating
 * newline leaves the splitter. This matches the splitter's completed output
 * split on '\n', with one refinement: when the completed text is empty but a
 * newline was still consumed (carry + chunk == completed + '\n' + new carry),
 * the step records one empty line. That makes conservation exact: every
 * emitted line re-terminated with '\n', then the carry, then the unread
 * input, reconstructs the document.
 *
 * The headline v2 theorem is checked as an invariant, not narrated: once the
 * cursor reaches the end of the document, the chunked run's emitted lines
 * and carry equal the oneshot split of the whole document fed as one chunk
 * (`terminalConfluence`, over the `oneshot` ghost).
 */
module streaming {
  // --- alphabet (see the character map above; keep it in sync with the
  // --- TOKEN_CHARS table in the replay and the companion .md) ---
  pure val T_A = 0
  pure val T_B = 1
  pure val T_SP = 2
  pure val T_SEMI = 3
  pure val T_NL = 4
  pure val Alphabet: Set[int] = Set(T_A, T_B, T_SP, T_SEMI, T_NL)

  // --- phases and event kinds as sum types; strings exist only inside `ev`,
  // --- derived in one place (`kindStr`) for ITF/replay ergonomics ---
  type Phase = Feeding | Exhausted
  type EvKind = EInit | EChunk | EStutter

  pure def kindStr(k: EvKind): str = match k {
    | EInit => "init"
    | EChunk => "chunk"
    | EStutter => "stutter"
  }

  /// The semantic state. `prevCursor` is a ghost for the monotonicity
  /// invariant; `phase` is the machine mode, kept consistent with the
  /// cursor by an invariant so a mis-transcribed transition is caught.
  type SpecState = {
    doc: List[int], // the whole document, fixed at init
    cursor: int, // tokens of doc consumed so far
    prevCursor: int, // ghost: the cursor before this step
    carry: List[int], // the splitter's tail: held comment lines + partial line
    lines: List[List[int]], // every line completed so far, in order
    phase: Phase // Feeding until the cursor reaches the end
  }

  /// The trace contract: what this step did, in replay-friendly values.
  type Event = {
    kind: str, // kindStr of the event's sum-type kind
    chunk: List[int], // the chunk fed this step (empty for init/stutter)
    emitted: List[List[int]] // the lines this step completed
  }

  var s: SpecState
  var ev: Event

  pure def minInt(a: int, b: int): int = if (a < b) a else b

  /// Index of the last T_NL in xs, or -1 when none (the split point)
  pure def lastNlIndex(xs: List[int]): int =
    xs.foldl((0, -1), (acc, t) => (acc._1 + 1, if (t == T_NL) acc._1 else acc._2))._2

  /// Split on T_NL; n separators yield n+1 lines (split([]) == [[]])
  pure def splitLines(text: List[int]): List[List[int]] =
    text.foldl(List(List()), (acc, t) =>
      if (t == T_NL) acc.append(List())
      else acc.replaceAt(acc.length() - 1, acc[acc.length() - 1].append(t)))

  /// Rejoin lines with T_NL between them (inverse of splitLines)
  pure def joinNl(lns: List[List[int]]): List[int] =
    if (lns.length() == 0) List()
    else range(1, lns.length()).foldl(lns[0], (acc, i) => acc.append(T_NL).concat(lns[i]))

  /**
   * A comment-only line: optional leading blanks, then the comment opener.
   *
   * Authority: none — comment-only detection is host-library streaming
   * machinery, not governed by any firmware or G-code standard.
   * Library stance: library-invented — mirrors the pinned decision that a
   * line whose first non-blank character is ';' cannot close a slicer's
   * layer description.
   * Exclusions: the model's only blank is ' '; the implementation trims any
   * leading whitespace (tabs included), which the alphabet cannot express.
   */
  pure def isCommentOnly(line: List[int]): bool =
    line.foldl(0, (st, t) =>
      if (st != 0) st
      else if (t == T_SP) 0
      else if (t == T_SEMI) 1
      else 2) == 1

  /// Length of the maximal trailing run of comment-only lines
  /// (counted in lines)
  pure def trailingCommentRun(lns: List[List[int]]): int =
    lns.foldr((0, true), (line, acc) =>
      if (acc._2 and isCommentOnly(line)) (acc._1 + 1, true) else (acc._1, false))._1

  type SplitResult = { emittedLines: List[List[int]], newCarry: List[int] }

  /**
   * One splitter step on (carry, chunk), with lines instead of a joined
   * string. emittedLines is the completed text split on '\n' whenever a
   * separator was consumed (so an empty completion that consumed one records
   * a single empty line), and [] when nothing completed.
   *
   * Authority: none — no firmware or G-code standard governs how a viewer
   * buffers streamed text; chunk splitting is host-library machinery.
   * Library stance: library-invented — models the pinned decisions: a chunk
   * splits at its LAST separator; a chunk with no separator carries whole;
   * a trailing run of comment-only lines is held back, terminating newline
   * kept, until a non-comment line closes it.
   * Exclusions: '\r' (there is no CRLF handling, a pinned decision, so '\r'
   * is not in the alphabet and would simply travel inside a line's
   * characters); multi-byte/UTF-8 chunk boundaries (decoded upstream of the
   * splitter); any character outside the 5-token alphabet.
   */
  pure def feed(carryIn: List[int], chunk: List[int]): SplitResult = {
    val nlIdx = lastNlIndex(chunk)
    if (nlIdx < 0) {
      // no newline: nothing completes, the whole chunk joins the tail
      { emittedLines: List(), newCarry: carryIn.concat(chunk) }
    } else {
      val text = carryIn.concat(chunk.slice(0, nlIdx))
      val partial = chunk.slice(nlIdx + 1, chunk.length())
      val lns = splitLines(text)
      val runLen = trailingCommentRun(lns)
      if (runLen == lns.length() and runLen > 0) {
        // the whole text is one comment run: hold it all, newline included
        { emittedLines: List(), newCarry: text.append(T_NL).concat(partial) }
      } else {
        val kept = lns.slice(0, lns.length() - runLen)
        val held = lns.slice(lns.length() - runLen, lns.length())
        {
          emittedLines: kept,
          newCarry: if (runLen == 0) partial else joinNl(held).append(T_NL).concat(partial)
        }
      }
    }
  }

  /// Pure transition: feed the next chunk through the splitter
  pure def applyChunk(st: SpecState, chunk: List[int]): SpecState = {
    val res = feed(st.carry, chunk)
    val newCursor = st.cursor + chunk.length()
    {
      doc: st.doc,
      cursor: newCursor,
      prevCursor: st.cursor,
      carry: res.newCarry,
      lines: st.lines.concat(res.emittedLines),
      phase: if (newCursor == st.doc.length()) Exhausted else Feeding
    }
  }

  /// Pure transition: the exhausted machine holds still
  pure def applyStutter(st: SpecState): SpecState = {
    doc: st.doc,
    cursor: st.cursor,
    prevCursor: st.cursor,
    carry: st.carry,
    lines: st.lines,
    phase: st.phase
  }

  pure def mkEvent(k: EvKind, chunk: List[int], emitted: List[List[int]]): Event =
    { kind: kindStr(k), chunk: chunk, emitted: emitted }

  /// Ghost: the oneshot split of the whole document fed as a single chunk
  val oneshot: SplitResult = feed(List(), s.doc)

  // --- init and step ---

  /**
   * Start the machine on document d with an empty carry.
   *
   * Authority: none — model scaffolding.
   * Library stance: library-invented — mirrors readStream starting each
   * stream with an empty tail.
   * Exclusions: the final flush (parsing the leftover tail when the stream
   * ends) belongs to the stream driver, not the splitter, and is out of
   * this machine; the replay checks the end-of-document carry instead.
   */
  action initWith(d: List[int]): bool = all {
    ev' = mkEvent(EInit, List(), List()),
    s' = {
      doc: d,
      cursor: 0,
      prevCursor: 0,
      carry: List(),
      lines: List(),
      phase: if (d.length() == 0) Exhausted else Feeding
    }
  }

  /// Weighted token bag for random documents: newlines and semicolons are
  /// drawn more often than a uniform pick would give (P(nl) = 2/7, so lines
  /// average ~2.5 tokens), so simulated documents are dense in line
  /// boundaries and comment-only lines ending at chunk boundaries — the
  /// held-run machinery is the part of the splitter worth stressing.
  pure val TokenBag: List[int] = List(T_A, T_B, T_SP, T_SEMI, T_SEMI, T_NL, T_NL)

  /// Document lengths sized to the 40-step trace budget: chunks average 3
  /// tokens (uniform 0..6), so 40 steps consume ~120 tokens. Lengths
  /// 100..120 make a trace spend nearly all its steps feeding, with most
  /// documents exhausting near the end so `terminalConfluence` is exercised
  /// and only a short stutter tail remains. Degenerate documents (empty,
  /// newline-free) are covered by the *Test runs instead of this bag.
  pure val LenBag: List[int] = List(100, 104, 106, 108, 110, 112, 116, 120)

  pure val MaxDocLen = 120

  action init = {
    nondet len = LenBag.indices().oneOf()
    nondet pick = setOfMaps(0.to(MaxDocLen - 1), TokenBag.indices()).oneOf()
    initWith(range(0, LenBag[len]).foldl(List(), (acc, i) => acc.append(TokenBag[pick.get(i)])))
  }

  /**
   * Feed the next `nTokens` tokens of the document through the splitter.
   *
   * Authority: none — chunk sizes are an artifact of transport (network
   * reads, file I/O), not of any G-code semantics.
   * Library stance: library-invented — models readStream handing each
   * decoded chunk to splitChunk with the previous tail prepended.
   * Exclusions: chunk contents are always a contiguous slice of the
   * document; reordering or loss is transport-layer failure, out of model.
   */
  action takeSized(nTokens: int): bool = {
    val chunk = s.doc.slice(s.cursor, s.cursor + nTokens)
    all {
      ev' = mkEvent(EChunk, chunk, feed(s.carry, chunk).emittedLines),
      s' = applyChunk(s, chunk)
    }
  }

  /// Chunks are capped at 6 tokens (uniform 0..6, mean 3) so a 40-step
  /// trace crosses many line and comment-run boundaries per document;
  /// empty chunks stay possible on purpose.
  pure val MaxChunkLen = 6

  action takeChunk = all {
    s.cursor < s.doc.length(),
    {
      nondet nTokens = 0.to(minInt(MaxChunkLen, s.doc.length() - s.cursor)).oneOf()
      takeSized(nTokens)
    }
  }

  /**
   * The document is exhausted: nothing left to feed (replay skips these).
   *
   * Authority: none — model scaffolding so `step` is always enabled.
   * Library stance: library-invented — the real stream simply ends; the
   * stutter has no implementation counterpart.
   * Exclusions: nothing — the event is a no-op by construction.
   */
  action stutter = all {
    s.cursor == s.doc.length(),
    ev' = mkEvent(EStutter, List(), List()),
    s' = applyStutter(s)
  }

  action step = any { takeChunk, stutter }

  // --- invariants (over semantic state only; none mention `ev`) ---

  val cursorInBounds = s.cursor >= 0 and s.cursor <= s.doc.length()

  /// The phase mode agrees with the cursor: Exhausted exactly at the end
  val phaseMatchesCursor = (s.phase == Exhausted) == (s.cursor == s.doc.length())

  /// Monotonicity ghost: the cursor never rewinds, and never jumps by more
  /// than one chunk
  val cursorMonotone = s.cursor >= s.prevCursor and s.cursor - s.prevCursor <= MaxChunkLen

  /// Emitted lines (each with its consumed '\n' restored) + carry + unread
  /// input reconstruct the document exactly
  val conservation =
    s.lines
      .foldl(List(), (acc, l) => acc.concat(l).append(T_NL))
      .concat(s.carry)
      .concat(s.doc.slice(s.cursor, s.doc.length())) == s.doc

  /// Whatever has been emitted so far is a prefix of the oneshot result
  val prefixOfOneshot = {
    val common = minInt(s.lines.length(), oneshot.emittedLines.length())
    and {
      s.lines.length() <= oneshot.emittedLines.length(),
      range(0, common).foldl(true, (acc, i) => acc and s.lines[i] == oneshot.emittedLines[i])
    }
  }

  /// The confluence theorem, promoted from a v1 run to a checked invariant:
  /// once the whole document has been fed — under ANY chunking the
  /// simulator chose — the emitted lines and the carry equal the oneshot
  /// split of the document fed as a single chunk
  val terminalConfluence =
    s.cursor == s.doc.length() implies and {
      s.lines == oneshot.emittedLines,
      s.carry == oneshot.newCarry
    }

  /// Only comment runs are ever held back: every newline-terminated line
  /// inside the carry (all but the trailing partial) is comment-only
  val carryHoldsOnlyComments = {
    val carryLines = splitLines(s.carry)
    range(0, carryLines.length() - 1).foldl(true, (acc, i) => acc and isCommentOnly(carryLines[i]))
  }

  /// A completed line never contains the separator that completed it
  val emittedLinesHaveNoNewline =
    s.lines.foldl(true, (acc, l) => acc and l.foldl(true, (a, t) => a and t != T_NL))

  val allInvariants = and {
    cursorInBounds,
    phaseMatchesCursor,
    cursorMonotone,
    conservation,
    prefixOfOneshot,
    terminalConfluence,
    carryHoldsOnlyComments,
    emittedLinesHaveNoNewline
  }

  // --- semantic tests (run with:
  // ---   npx quint test verification/quint-v2/streaming.qnt) ---

  /// "ab\n;a\nb\na": a letter line, a comment line, a letter line, a partial
  pure val DocMixed: List[int] = List(T_A, T_B, T_NL, T_SEMI, T_A, T_NL, T_B, T_NL, T_A)

  /// The same document driven through two different chunkings — one chunk of
  /// nine versus 2/3/2/2 with a mid-comment boundary — ends with the same
  /// emitted lines and the same carry; at exhaustion `terminalConfluence`
  /// holds in both runs
  run twoChunkingsAgreeTest =
    initWith(DocMixed)
      .then(takeSized(9))
      .expect(and {
        s.lines == List(List(T_A, T_B), List(T_SEMI, T_A), List(T_B)),
        s.carry == List(T_A),
        s.cursor == 9,
        s.phase == Exhausted,
        terminalConfluence
      })
      .then(stutter)
      .expect(s.lines == List(List(T_A, T_B), List(T_SEMI, T_A), List(T_B)) and s.carry == List(T_A))
      .then(initWith(DocMixed))
      .then(takeSized(2))
      .expect(s.lines == List() and s.carry == List(T_A, T_B))
      .then(takeSized(3))
      .expect(s.lines == List(List(T_A, T_B)) and s.carry == List(T_SEMI, T_A))
      .then(takeSized(2))
      // ';a' alone ends the text, so the run is held with its newline
      .expect(s.lines == List(List(T_A, T_B)) and s.carry == List(T_SEMI, T_A, T_NL, T_B))
      .then(takeSized(2))
      .expect(and {
        s.lines == List(List(T_A, T_B), List(T_SEMI, T_A), List(T_B)),
        s.carry == List(T_A),
        s.cursor == 9,
        terminalConfluence
      })

  /// ";a\n;b\nba\n": a chunk ending inside a comment run holds the whole run
  /// (terminating newline kept); the letter line that closes it releases it
  run holdsAndReleasesCommentRunTest =
    initWith(List(T_SEMI, T_A, T_NL, T_SEMI, T_B, T_NL, T_B, T_A, T_NL))
      .then(takeSized(6))
      .expect(and {
        s.lines == List(),
        s.carry == List(T_SEMI, T_A, T_NL, T_SEMI, T_B, T_NL)
      })
      .then(takeSized(3))
      .expect(and {
        s.lines == List(List(T_SEMI, T_A), List(T_SEMI, T_B), List(T_B, T_A)),
        s.carry == List(),
        s.cursor == 9,
        terminalConfluence
      })
      .then(stutter)
      .expect(ev.kind == "stutter" and s.carry == List() and s.lines.length() == 3)

  /// "a ba" has no newline at all: every chunk (even an empty one) carries
  /// fully into the tail and nothing is ever emitted. Newline-free
  /// documents are outside the random LenBag corpus, so this run is their
  /// deterministic home.
  run noNewlineAllCarriedTest =
    initWith(List(T_A, T_SP, T_B, T_A))
      .then(takeSized(1))
      .expect(s.carry == List(T_A) and s.lines == List())
      .then(takeSized(0))
      .expect(ev.kind == "chunk" and ev.chunk == List() and s.carry == List(T_A) and s.cursor == 1)
      .then(takeSized(3))
      .expect(and { s.lines == List(), s.carry == List(T_A, T_SP, T_B, T_A), s.cursor == 4, terminalConfluence })
      .then(stutter)
      .expect(s.lines == List() and s.carry == List(T_A, T_SP, T_B, T_A))

  /// The empty document starts life Exhausted and only ever stutters; all
  /// invariants (terminal confluence included) hold vacuously-but-checked
  run emptyDocTest =
    initWith(List())
      .expect(s.phase == Exhausted and allInvariants)
      .then(stutter)
      .expect(ev.kind == "stutter" and s.lines == List() and s.carry == List() and allInvariants)

  /// "a\n\nb\n" in 1-token chunks: the lone '\n' chunk completes an empty
  /// line, which the accounting records; the final lines match the oneshot
  run emptyLineIsEmittedTest =
    initWith(List(T_A, T_NL, T_NL, T_B, T_NL))
      .then(takeSized(1))
      .expect(s.carry == List(T_A))
      .then(takeSized(1))
      .expect(ev.emitted == List(List(T_A)) and s.carry == List())
      .then(takeSized(1))
      .expect(ev.emitted == List(List()) and s.lines == List(List(T_A), List()))
      .then(takeSized(1))
      .then(takeSized(1))
      .expect(and {
        s.lines == List(List(T_A), List(), List(T_B)),
        s.lines == oneshot.emittedLines,
        s.carry == List(),
        terminalConfluence
      })

  /// "b\n ;a\nb": a blank before ';' still makes a comment-only line
  /// (trimStart), so ' ;a' is held while 'b' is emitted
  run blankPaddedCommentHeldTest =
    initWith(List(T_B, T_NL, T_SP, T_SEMI, T_A, T_NL, T_B))
      .then(takeSized(7))
      .expect(and {
        s.lines == List(List(T_B)),
        ev.emitted == List(List(T_B)),
        s.carry == List(T_SP, T_SEMI, T_A, T_NL, T_B)
      })
}
