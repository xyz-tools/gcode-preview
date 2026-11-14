// -*- mode: Bluespec; -*-
/**
 * Formal specification of the streaming chunk-boundary line splitter
 * (unit ST-1): the carry-buffer machine in src/helpers/split-chunk.ts.
 *
 * The document is a list of integer tokens over a 5-letter alphabet that the
 * replay maps 1:1 to characters:
 *
 *   0 -> 'a'   ordinary letter
 *   1 -> 'b'   ordinary letter
 *   2 -> ' '   blank (isCommentOnly's trimStart() skips it)
 *   3 -> ';'   comment opener
 *   4 -> '\n'  line separator
 *
 * '\n' is the only separator the source splits on (chunk.lastIndexOf('\n'));
 * there is no CRLF handling, so '\r' is not in the alphabet. All state is
 * integer tokens and lists of them; there is no numeric scaling.
 *
 * Each step feeds a nondeterministically sized chunk (possibly empty) of the
 * remaining document to a pure transition `feed` that mirrors splitChunk
 * line by line: no newline in the chunk carries it whole, a trailing run of
 * comment-only lines is held back in the carry (keeping its terminating
 * newline), everything before the run is emitted. Once the document is
 * exhausted, the machine stutters (cmd == "stutter"), so `step` is always
 * enabled.
 *
 * Emitted-line accounting: a line is recorded the moment its terminating
 * newline leaves the splitter. This matches the TS `complete` output split
 * on '\n', with one refinement: when `complete` is '' but a newline was
 * still consumed (tail + chunk == complete + '\n' + newTail), the step
 * records one empty line. That makes conservation exact: every emitted
 * line re-terminated with '\n', then the carry, then the unread input,
 * reconstructs the document.
 *
 * The cmd, chunkTaken and stepLines variables record what each step fed and
 * what came out, so an ITF trace doubles as a chunking schedule: a replay
 * harness can feed the real splitChunk the same chunk strings and compare
 * the emitted lines and the carry after every step.
 */
module streaming {
  // --- alphabet (see the character map above) ---
  pure val T_A = 0
  pure val T_B = 1
  pure val T_SP = 2
  pure val T_SEMI = 3
  pure val T_NL = 4
  pure val Alphabet: Set[int] = Set(T_A, T_B, T_SP, T_SEMI, T_NL)

  pure val MaxDocLen = 10

  // --- trace-contract variables: what this step did ---
  var cmd: str // "init" | "chunk" | "stutter"
  var chunkTaken: List[int] // the chunk fed this step (empty for stutter)
  var stepLines: List[List[int]] // the lines this step completed

  // --- state ---
  var doc: List[int] // the whole document, fixed at init
  var cursor: int // tokens of doc consumed so far
  var carry: List[int] // the splitter's tail: held comment lines + partial line
  var lines: List[List[int]] // every line completed so far, in order

  pure def minInt(a: int, b: int): int = if (a < b) a else b

  /// Index of the last T_NL in xs, or -1 (chunk.lastIndexOf('\n'))
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

  /// line.trimStart().startsWith(';') — src/helpers/split-chunk.ts isCommentOnly
  pure def isCommentOnly(line: List[int]): bool =
    line.foldl(0, (st, t) =>
      if (st != 0) st
      else if (t == T_SP) 0
      else if (t == T_SEMI) 1
      else 2) == 1

  /// Length of the maximal trailing run of comment-only lines
  /// (the runStart loop of splitOffCommentRun, counted in lines)
  pure def trailingCommentRun(lns: List[List[int]]): int =
    lns.foldr((0, true), (line, acc) =>
      if (acc._2 and isCommentOnly(line)) (acc._1 + 1, true) else (acc._1, false))._1

  type SplitResult = { emittedLines: List[List[int]], newCarry: List[int] }

  /// One splitChunk(tail, chunk) call, with lines instead of a joined string.
  /// emittedLines is `complete` split on '\n' whenever a separator was
  /// consumed (so an empty `complete` that consumed one records a single
  /// empty line), and [] when nothing completed.
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

  /// Ghost: the oneshot split of the whole document fed as a single chunk
  val oneshot: SplitResult = feed(List(), doc)

  // --- init and step ---

  action initWith(d: List[int]): bool = all {
    cmd' = "init",
    chunkTaken' = List(),
    stepLines' = List(),
    doc' = d,
    cursor' = 0,
    carry' = List(),
    lines' = List()
  }

  /// Weighted token bag for random documents: newlines and semicolons are
  /// drawn more often than a uniform pick would give, so simulated documents
  /// actually contain comment-only lines ending at chunk boundaries — the
  /// held-run machinery is the part of the splitter worth stressing
  pure val TokenBag: List[int] = List(T_A, T_B, T_SP, T_SEMI, T_SEMI, T_NL, T_NL)

  /// Document lengths, weighted toward longer documents (0 and 1 stay in so
  /// the degenerate machines are still explored)
  pure val LenBag: List[int] = List(0, 1, 2, 3, 4, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10)

  action init = {
    nondet len = LenBag.indices().oneOf()
    nondet pick = setOfMaps(0.to(MaxDocLen - 1), TokenBag.indices()).oneOf()
    initWith(range(0, LenBag[len]).foldl(List(), (acc, i) => acc.append(TokenBag[pick.get(i)])))
  }

  /// Feed the next `nTokens` tokens of the document through the splitter
  action takeSized(nTokens: int): bool = {
    val chunk = doc.slice(cursor, cursor + nTokens)
    val res = feed(carry, chunk)
    all {
      cmd' = "chunk",
      chunkTaken' = chunk,
      stepLines' = res.emittedLines,
      doc' = doc,
      cursor' = cursor + nTokens,
      carry' = res.newCarry,
      lines' = lines.concat(res.emittedLines)
    }
  }

  /// Chunks are capped at 5 tokens so a 24-step trace crosses several
  /// boundaries per document; empty chunks stay possible on purpose
  pure val MaxChunkLen = 5

  action takeChunk = all {
    cursor < doc.length(),
    {
      nondet nTokens = 0.to(minInt(MaxChunkLen, doc.length() - cursor)).oneOf()
      takeSized(nTokens)
    }
  }

  /// The document is exhausted: nothing left to feed (replay skips these)
  action stutter = all {
    cursor == doc.length(),
    cmd' = "stutter",
    chunkTaken' = List(),
    stepLines' = List(),
    doc' = doc,
    cursor' = cursor,
    carry' = carry,
    lines' = lines
  }

  action step = any { takeChunk, stutter }

  // --- invariants ---

  val cursorInBounds = cursor >= 0 and cursor <= doc.length()

  /// Emitted lines (each with its consumed '\n' restored) + carry + unread
  /// input reconstruct the document exactly
  val conservation =
    lines
      .foldl(List(), (acc, l) => acc.concat(l).append(T_NL))
      .concat(carry)
      .concat(doc.slice(cursor, doc.length())) == doc

  /// Whatever has been emitted so far is a prefix of the oneshot result
  val prefixOfOneshot = {
    val common = minInt(lines.length(), oneshot.emittedLines.length())
    and {
      lines.length() <= oneshot.emittedLines.length(),
      range(0, common).foldl(true, (acc, i) => acc and lines[i] == oneshot.emittedLines[i])
    }
  }

  /// Only comment runs are ever held back: every newline-terminated line
  /// inside the carry (all but the trailing partial) is comment-only
  val carryHoldsOnlyComments = {
    val carryLines = splitLines(carry)
    range(0, carryLines.length() - 1).foldl(true, (acc, i) => acc and isCommentOnly(carryLines[i]))
  }

  /// A completed line never contains the separator that completed it
  val emittedLinesHaveNoNewline =
    lines.foldl(true, (acc, l) => acc and l.foldl(true, (a, t) => a and t != T_NL))

  val allInvariants = and {
    cursorInBounds,
    conservation,
    prefixOfOneshot,
    carryHoldsOnlyComments,
    emittedLinesHaveNoNewline
  }

  // --- semantic tests (run with: npx quint test verification/quint/streaming.qnt) ---

  /// "ab\n;a\nb\na": a letter line, a comment line, a letter line, a partial
  pure val DocMixed: List[int] = List(T_A, T_B, T_NL, T_SEMI, T_A, T_NL, T_B, T_NL, T_A)

  /// The same document driven through two different chunkings — one chunk of
  /// nine versus 2/3/2/2 with a mid-comment boundary — ends with the same
  /// emitted lines and the same carry (unit ST-1 in miniature)
  run twoChunkingsAgreeTest =
    initWith(DocMixed)
      .then(takeSized(9))
      .expect(and {
        lines == List(List(T_A, T_B), List(T_SEMI, T_A), List(T_B)),
        carry == List(T_A),
        cursor == 9
      })
      .then(stutter)
      .expect(lines == List(List(T_A, T_B), List(T_SEMI, T_A), List(T_B)) and carry == List(T_A))
      .then(initWith(DocMixed))
      .then(takeSized(2))
      .expect(lines == List() and carry == List(T_A, T_B))
      .then(takeSized(3))
      .expect(lines == List(List(T_A, T_B)) and carry == List(T_SEMI, T_A))
      .then(takeSized(2))
      // ';a' alone ends the text, so the run is held with its newline
      .expect(lines == List(List(T_A, T_B)) and carry == List(T_SEMI, T_A, T_NL, T_B))
      .then(takeSized(2))
      .expect(and {
        lines == List(List(T_A, T_B), List(T_SEMI, T_A), List(T_B)),
        carry == List(T_A),
        cursor == 9
      })

  /// ";a\n;b\nba\n": a chunk ending inside a comment run holds the whole run
  /// (terminating newline kept); the letter line that closes it releases it
  run holdsAndReleasesCommentRunTest =
    initWith(List(T_SEMI, T_A, T_NL, T_SEMI, T_B, T_NL, T_B, T_A, T_NL))
      .then(takeSized(6))
      .expect(and {
        lines == List(),
        carry == List(T_SEMI, T_A, T_NL, T_SEMI, T_B, T_NL)
      })
      .then(takeSized(3))
      .expect(and {
        lines == List(List(T_SEMI, T_A), List(T_SEMI, T_B), List(T_B, T_A)),
        carry == List(),
        cursor == 9
      })
      .then(stutter)
      .expect(cmd == "stutter" and carry == List() and lines.length() == 3)

  /// "a ba" has no newline at all: every chunk (even an empty one) carries
  /// fully into the tail and nothing is ever emitted
  run noNewlineAllCarriedTest =
    initWith(List(T_A, T_SP, T_B, T_A))
      .then(takeSized(1))
      .expect(carry == List(T_A) and lines == List())
      .then(takeSized(0))
      .expect(cmd == "chunk" and chunkTaken == List() and carry == List(T_A) and cursor == 1)
      .then(takeSized(3))
      .expect(and { lines == List(), carry == List(T_A, T_SP, T_B, T_A), cursor == 4 })
      .then(stutter)
      .expect(lines == List() and carry == List(T_A, T_SP, T_B, T_A))

  /// "a\n\nb\n" in 1-token chunks: the lone '\n' chunk completes an empty
  /// line, which the accounting records; the final lines match the oneshot
  run emptyLineIsEmittedTest =
    initWith(List(T_A, T_NL, T_NL, T_B, T_NL))
      .then(takeSized(1))
      .expect(carry == List(T_A))
      .then(takeSized(1))
      .expect(stepLines == List(List(T_A)) and carry == List())
      .then(takeSized(1))
      .expect(stepLines == List(List()) and lines == List(List(T_A), List()))
      .then(takeSized(1))
      .then(takeSized(1))
      .expect(and {
        lines == List(List(T_A), List(), List(T_B)),
        lines == oneshot.emittedLines,
        carry == List()
      })

  /// "b\n ;a\nb": a blank before ';' still makes a comment-only line
  /// (trimStart), so ' ;a' is held while 'b' is emitted
  run blankPaddedCommentHeldTest =
    initWith(List(T_B, T_NL, T_SP, T_SEMI, T_A, T_NL, T_B))
      .then(takeSized(7))
      .expect(and {
        lines == List(List(T_B)),
        stepLines == List(List(T_B)),
        carry == List(T_SP, T_SEMI, T_A, T_NL, T_B)
      })
}
