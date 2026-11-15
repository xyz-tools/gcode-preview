// -*- mode: Bluespec; -*-
/**
 * streaming_next — the from-scratch streaming-ingestion design: a
 * three-layer pipeline (nondeterministic chunker, canonicalizing line
 * splitter with an explicit end-of-stream flush, sequence-numbered line
 * consumer) designed so that ANY chunking refines the oneshot result at
 * every layer, by construction. Independent of the printer core: its
 * whole universe is text, chunks, lines and sequence numbers.
 *
 * The document is a list of integer tokens over a 6-letter alphabet:
 *
 *   0 -> 'a'   ordinary letter
 *   1 -> 'b'   ordinary letter
 *   2 -> ' '   blank (skipped when classifying a comment-only line)
 *   3 -> ';'   comment opener
 *   4 -> '\n'  line separator
 *   5 -> '\r'  carriage return (consumed only as the CR of a CRLF pair)
 *
 * Design core (normative): the splitter's only state is the raw text
 * after the last '\n' it has consumed. Every completed line is emitted
 * the moment its '\n' arrives — there is no content-dependent holdback —
 * and is canonicalized once, at emission, by stripping a single trailing
 * '\r'. End of stream is an explicit flush step that delivers the final
 * unterminated line (canonicalized the same way) when one exists. Each
 * delivered line carries a sequence number assigned at emission, equal to
 * its 0-based line index in the whole document, so any downstream join
 * (metadata to line) is chunking-invariant by construction.
 *
 * The headline theorem is `refinesOneshotPrefix`: in EVERY reachable
 * state, under ANY chunking the simulator chose (empty chunks included),
 * the delivered lines and the carry equal the oneshot split of exactly
 * the consumed prefix. Terminal agreement with the oneshot pipeline,
 * flushed tail included, is the corollary `terminalAgreement`.
 *
 * Unit: ST-1 (splitter laws), ST-2 (flush and conservation), ST-4
 *   (chunking-invariant metadata join), ST-6 (streaming refines oneshot)
 *   in .context/formal-verification/mapping-data.json — re-derived here
 *   as designed-in properties, not as tests of the current code.
 * Authority policy: verification/quint/STYLE.md ("Authority
 *   annotations"), plus the quint-next design charter: firmware
 *   conformance by default (P1), properties designed in (P2); every
 *   deliberate divergence from firmware or from the current
 *   implementation cites its reason here or in the companion's ledger.
 * Companion: streaming.md.
 *
 * NO REPLAY BINDING, by design (charter P6): this module intentionally
 * disagrees with src/helpers/split-chunk.ts and GCodePreview.readStream
 * (see the companion's divergence ledger), so there is no vitest replay
 * and no trace corpus. The gate is internal consistency:
 *   npx quint parse verification/quint-next/streaming.qnt
 *   npx quint test  --main streaming_next verification/quint-next/streaming.qnt
 *   npx quint run   --main streaming_next --invariant allInvariants \
 *     --max-samples 200 --max-steps 30 --seed=0x67c0de2026 \
 *     verification/quint-next/streaming.qnt
 */
module streaming_next {
  // --- alphabet (keep in sync with the table above and the companion) ---
  pure val T_A = 0
  pure val T_B = 1
  pure val T_SP = 2
  pure val T_SEMI = 3
  pure val T_NL = 4
  pure val T_CR = 5

  // --- phases and event kinds as sum types; strings exist only inside
  // --- `ev`, derived in one place (`kindStr`) ---
  type Phase = Feeding | AtEof | Done
  type EvKind = EInit | EChunk | EFlush | EStutter

  pure def kindStr(k: EvKind): str = match k {
    | EInit => "init"
    | EChunk => "chunk"
    | EFlush => "flush"
    | EStutter => "stutter"
  }

  /// A consumer-layer line: the canonical text plus the sequence number
  /// assigned at emission. `seq` equals the line's 0-based index in the
  /// document — the designed join key for all downstream metadata.
  type Line = { seq: int, toks: List[int] }

  /// The semantic state. `prevCursor` is a ghost for the monotonicity
  /// invariant; `ghostRaw` holds the raw (pre-canonicalization) segments
  /// so conservation is exact even though delivered lines drop CRLF '\r's;
  /// `nextSeq` is the consumer's counter, pinned to delivered.length() by
  /// an invariant so a mis-transcribed transition is caught.
  type SpecState = {
    doc: List[int], // the whole document, fixed at init
    cursor: int, // tokens of doc consumed so far
    prevCursor: int, // ghost: the cursor before this step
    carry: List[int], // raw text after the last consumed '\n'
    ghostRaw: List[List[int]], // ghost: raw segments delivered so far
    delivered: List[Line], // consumer layer: canonical lines with seq
    commentSeqs: Set[int], // consumer join: seqs of comment-only lines
    nextSeq: int, // next sequence number to assign
    phase: Phase // Feeding -> AtEof -> Done
  }

  /// The event record: what this step did, in ITF-friendly values.
  type Event = {
    kind: str, // kindStr of the event's sum-type kind
    chunk: List[int], // the chunk fed this step (empty otherwise)
    emitted: List[List[int]], // canonical lines this step delivered
    seqFrom: int // sequence number of the first line delivered
  }

  var s: SpecState
  var ev: Event

  pure def minInt(a: int, b: int): int = if (a < b) a else b

  /// Split on T_NL; n separators yield n+1 raw segments (split([]) == [[]])
  pure def splitSegs(text: List[int]): List[List[int]] =
    text.foldl(List(List()), (acc, t) =>
      if (t == T_NL) acc.append(List())
      else acc.replaceAt(acc.length() - 1, acc[acc.length() - 1].append(t)))

  /**
   * Canonicalize one raw segment: strip exactly one trailing '\r', so a
   * CRLF-terminated line and an LF-terminated line canonicalize to the
   * same text. Interior and non-final '\r's are data and pass through.
   *
   * Authority: RepRap wiki, "G-code" (Introduction): "G-code line endings
   * are Unix Line Endings (\n), but will accept Windows Line Endings
   * (\r\n)" — the two accepted endings, made indistinguishable here.
   * Library stance: designed divergence from the current implementation,
   * which forwards '\r' inside the line and relies on trim() at parse
   * time (charter P1/P4; companion ledger row "CRLF policy").
   * Exclusions: a lone '\r' is NOT a terminator here, although Marlin's
   * serial reader treats it as one (Marlin 2.1.x src/core/macros.h:
   * ISEOL(C) == ((C)=='\n'||(C)=='\r')). Reason: under a CR-terminator
   * rule every CRLF would need pairing lookahead across chunk boundaries
   * to avoid a phantom empty line; the RepRap wiki names only \n and \r\n
   * as accepted file endings, and slicer output is a file, not a serial
   * byte stream.
   */
  pure def canonLine(seg: List[int]): List[int] =
    if (seg.length() > 0 and seg[seg.length() - 1] == T_CR)
      seg.slice(0, seg.length() - 1)
    else seg

  pure def canonAll(segs: List[List[int]]): List[List[int]] =
    segs.foldl(List(), (acc, sg) => acc.append(canonLine(sg)))

  /**
   * A comment-only line: optional leading blanks, then the comment opener.
   * Classification happens in the CONSUMER layer, on canonical lines —
   * the splitter below is content-agnostic by design.
   *
   * Authority: RepRap wiki, "G-code" (Comments): "G-code comments begin
   * at a semicolon, and end at the end of the line."
   * Library stance: conforms; the classification stands in for the
   * library's slicer-metadata join (which lines carry metadata), reseated
   * downstream of the splitter per charter P2.
   * Exclusions: the model's only blank is ' '; real inputs may pad with
   * tabs. A '\r' before the ';' classifies as non-comment here, where the
   * current implementation's trimStart() would skip it.
   */
  pure def isCommentOnly(line: List[int]): bool =
    line.foldl(0, (st, t) =>
      if (st != 0) st
      else if (t == T_SP) 0
      else if (t == T_SEMI) 1
      else 2) == 1

  type SplitResult = { emittedRaw: List[List[int]], newCarry: List[int] }

  /**
   * One splitter step on (carry, chunk). The design: the carry is exactly
   * the raw text after the last consumed '\n', every '\n' in carry+chunk
   * completes a line immediately, and nothing is held back on content.
   * Because the splitter's state is a pure function of the consumed
   * prefix, chunking-refines-oneshot holds by construction; invariants
   * below check it rather than assume it.
   *
   * Authority: none — no firmware governs how a viewer buffers streamed
   * text; the layering itself is this charter's design (P2).
   * Library stance: designed divergence from the current implementation,
   * which splits at the chunk's LAST '\n' only, emits one joined string,
   * and holds back a trailing run of comment-only lines (companion ledger
   * rows "Emission granularity" and "Comment-run holdback").
   * Exclusions: byte decoding (UTF-8 boundaries) is upstream of this
   * splitter; chunk reordering or loss is transport failure, out of model.
   */
  pure def feed(carryIn: List[int], chunk: List[int]): SplitResult = {
    val segs = splitSegs(carryIn.concat(chunk))
    { emittedRaw: segs.slice(0, segs.length() - 1), newCarry: segs[segs.length() - 1] }
  }

  /// Pure transition: feed the next chunk; deliver each completed line to
  /// the consumer with its sequence number assigned at emission.
  pure def applyChunk(st: SpecState, chunk: List[int]): SpecState = {
    val res = feed(st.carry, chunk)
    val newCursor = st.cursor + chunk.length()
    {
      doc: st.doc,
      cursor: newCursor,
      prevCursor: st.cursor,
      carry: res.newCarry,
      ghostRaw: st.ghostRaw.concat(res.emittedRaw),
      delivered: res.emittedRaw.foldl(st.delivered, (acc, sg) =>
        acc.append({ seq: acc.length(), toks: canonLine(sg) })),
      commentSeqs: res.emittedRaw.foldl((st.commentSeqs, st.nextSeq), (acc, sg) =>
        (if (isCommentOnly(canonLine(sg))) acc._1.union(Set(acc._2)) else acc._1, acc._2 + 1))._1,
      nextSeq: st.nextSeq + res.emittedRaw.length(),
      phase: if (newCursor == st.doc.length()) AtEof else Feeding
    }
  }

  /**
   * Pure transition: the explicit end-of-stream flush. A nonempty carry
   * is the document's final unterminated line: it is delivered through
   * the SAME consumer path as every other line — canonicalized, sequence
   * numbered, classified. An empty carry flushes nothing, so a document
   * ending in '\n' has no phantom final empty line, in the chunked run
   * and in the oneshot alike.
   *
   * Authority: Marlin 2.1.x src/gcode/queue.cpp (get_sdcard_commands)
   * treats end-of-file as a line terminator — "End of file with no
   * newline" — so a file's last unterminated line is still executed.
   * Library stance: designed divergence from the current implementation,
   * where the stream driver (readStream) parses the leftover tail in a
   * separate code path outside the splitter (companion ledger row
   * "End-of-stream tail").
   * Exclusions: firmware discards empty lines before queueing
   * (queue.cpp, process_line_done); this design delivers interior empty
   * lines so seq equals the file line index — stated divergence, reason:
   * a stable join key outranks queue hygiene in a viewer (charter P2).
   */
  pure def applyFlush(st: SpecState): SpecState =
    if (st.carry.length() == 0) {
      doc: st.doc,
      cursor: st.cursor,
      prevCursor: st.cursor,
      carry: List(),
      ghostRaw: st.ghostRaw,
      delivered: st.delivered,
      commentSeqs: st.commentSeqs,
      nextSeq: st.nextSeq,
      phase: Done
    } else {
      doc: st.doc,
      cursor: st.cursor,
      prevCursor: st.cursor,
      carry: List(),
      ghostRaw: st.ghostRaw.append(st.carry),
      delivered: st.delivered.append({ seq: st.delivered.length(), toks: canonLine(st.carry) }),
      commentSeqs: if (isCommentOnly(canonLine(st.carry)))
        st.commentSeqs.union(Set(st.nextSeq)) else st.commentSeqs,
      nextSeq: st.nextSeq + 1,
      phase: Done
    }

  /// Pure transition: the finished machine holds still
  pure def applyStutter(st: SpecState): SpecState = {
    doc: st.doc,
    cursor: st.cursor,
    prevCursor: st.cursor,
    carry: st.carry,
    ghostRaw: st.ghostRaw,
    delivered: st.delivered,
    commentSeqs: st.commentSeqs,
    nextSeq: st.nextSeq,
    phase: st.phase
  }

  pure def mkEvent(k: EvKind, chunk: List[int], emitted: List[List[int]], seqFrom: int): Event =
    { kind: kindStr(k), chunk: chunk, emitted: emitted, seqFrom: seqFrom }

  // --- the oneshot pipeline (ghost reference) ---

  /// The designed oneshot result for a whole document: every line closed
  /// by '\n', then the final unterminated line when one exists — exactly
  /// what feeding the document as one chunk and flushing produces.
  pure def oneshotOf(text: List[int]): List[List[int]] = {
    val segs = splitSegs(text)
    val body = canonAll(segs.slice(0, segs.length() - 1))
    val tl = segs[segs.length() - 1]
    if (tl.length() == 0) body else body.append(canonLine(tl))
  }

  /// The delivered canonical texts, in order (seq == position, checked)
  val deliveredToks: List[List[int]] =
    s.delivered.foldl(List(), (acc, ln) => acc.append(ln.toks))

  // --- init and step ---

  /**
   * Start the machine on document d with an empty carry.
   *
   * Authority: none — model scaffolding.
   * Library stance: design artifact; the empty document starts AtEof so
   * even it takes the explicit flush step before Done.
   * Exclusions: none.
   */
  action initWith(d: List[int]): bool = all {
    ev' = mkEvent(EInit, List(), List(), 0),
    s' = {
      doc: d,
      cursor: 0,
      prevCursor: 0,
      carry: List(),
      ghostRaw: List(),
      delivered: List(),
      commentSeqs: Set(),
      nextSeq: 0,
      phase: if (d.length() == 0) AtEof else Feeding
    }
  }

  /// Weighted token bag for random documents: '\n' at 2/8 keeps lines
  /// short (mean ~3 tokens), ';' at 2/8 makes comment-only lines common
  /// (the consumer-join invariant needs them), and '\r' at 1/8 puts CRLF
  /// pairs and interior CRs in most documents — including CRs that land
  /// last in a chunk, the canonicalization's only interesting boundary.
  pure val TokenBag: List[int] = List(T_A, T_B, T_SP, T_SEMI, T_SEMI, T_CR, T_NL, T_NL)

  /// Document lengths sized to the 30-step gate budget: chunks average 3
  /// tokens (uniform 0..6), so ~22 steps consume a ~66-token document,
  /// one step flushes, and a short stutter tail remains — most runs reach
  /// Done, so terminalAgreement and joinChunkingInvariant are exercised,
  /// not vacuous. Degenerate documents (empty, newline-free, CR-heavy)
  /// live in the *Test runs instead of this bag.
  pure val LenBag: List[int] = List(56, 60, 62, 64, 66, 68, 70, 72)

  pure val MaxDocLen = 72

  action init = {
    nondet len = LenBag.indices().oneOf()
    nondet pick = setOfMaps(0.to(MaxDocLen - 1), TokenBag.indices()).oneOf()
    initWith(range(0, LenBag[len]).foldl(List(), (acc, i) => acc.append(TokenBag[pick.get(i)])))
  }

  /**
   * Feed the next `nTokens` tokens of the document through the splitter.
   *
   * Authority: none — chunk sizes are an artifact of transport, not of
   * any G-code semantics.
   * Library stance: design artifact — the chunker is the adversary the
   * refinement theorem quantifies over; empty chunks stay possible on
   * purpose (TextDecoderStream legitimately emits them).
   * Exclusions: chunks are contiguous document slices; reordering or
   * loss is transport-layer failure, out of model.
   */
  action takeSized(nTokens: int): bool = {
    val chunk = s.doc.slice(s.cursor, s.cursor + nTokens)
    all {
      ev' = mkEvent(EChunk, chunk, canonAll(feed(s.carry, chunk).emittedRaw), s.nextSeq),
      s' = applyChunk(s, chunk)
    }
  }

  /// Chunks are capped at 6 tokens (uniform 0..6, mean 3) so a 30-step
  /// run crosses many line boundaries, CRLF pairs and seq assignments
  /// per document.
  pure val MaxChunkLen = 6

  action takeChunk = all {
    s.phase == Feeding,
    {
      nondet nTokens = 0.to(minInt(MaxChunkLen, s.doc.length() - s.cursor)).oneOf()
      takeSized(nTokens)
    }
  }

  /// The explicit end-of-stream flush (see applyFlush for the authority
  /// block): enabled exactly once, between AtEof and Done.
  action flush = all {
    s.phase == AtEof,
    ev' = mkEvent(
      EFlush,
      List(),
      if (s.carry.length() == 0) List() else List(canonLine(s.carry)),
      s.nextSeq
    ),
    s' = applyFlush(s)
  }

  /**
   * The stream is finished and flushed: hold still.
   *
   * Authority: none — model scaffolding so `step` is always enabled.
   * Library stance: design artifact; the real stream simply ends.
   * Exclusions: nothing — the event is a no-op by construction.
   */
  action stutter = all {
    s.phase == Done,
    ev' = mkEvent(EStutter, List(), List(), s.nextSeq),
    s' = applyStutter(s)
  }

  action step = any { takeChunk, flush, stutter }

  // --- invariants (over semantic state only; none mention `ev`) ---

  val cursorInBounds = s.cursor >= 0 and s.cursor <= s.doc.length()

  /// The phase agrees with progress: Feeding strictly inside the
  /// document, AtEof and Done only at its end
  val phaseConsistent = and {
    (s.phase == Feeding) == (s.cursor < s.doc.length()),
    (s.phase == AtEof or s.phase == Done) == (s.cursor == s.doc.length())
  }

  /// Monotonicity ghost: the cursor never rewinds, and never jumps by
  /// more than one chunk
  val cursorMonotone = s.cursor >= s.prevCursor and s.cursor - s.prevCursor <= MaxChunkLen

  /// Conservation, exact to the token: the raw segments (each one closed
  /// by the '\n' it consumed), then the carry, then the unread input,
  /// reconstruct the document. After the flush the final raw segment is
  /// the one the document's own last token proves unterminated.
  val conservation =
    if (s.phase == Done) {
      val endsNl = s.doc.length() == 0 or s.doc[s.doc.length() - 1] == T_NL
      val n = s.ghostRaw.length()
      if (endsNl)
        s.ghostRaw.foldl(List(), (acc, sg) => acc.concat(sg).append(T_NL)) == s.doc
      else
        range(0, n - 1)
          .foldl(List(), (acc, i) => acc.concat(s.ghostRaw[i]).append(T_NL))
          .concat(s.ghostRaw[n - 1]) == s.doc
    } else
      s.ghostRaw
        .foldl(List(), (acc, sg) => acc.concat(sg).append(T_NL))
        .concat(s.carry)
        .concat(s.doc.slice(s.cursor, s.doc.length())) == s.doc

  /// THE HEADLINE REFINEMENT THEOREM, as a per-state invariant quantified
  /// over every document and every chunking the simulator explores:
  /// before the flush, the delivered lines and the carry equal the
  /// oneshot split of exactly the consumed prefix. Any two chunkings of
  /// the same document therefore agree at every shared cursor position —
  /// chunk boundaries are unobservable downstream, by construction.
  val refinesOneshotPrefix =
    (s.phase != Done) implies {
      val segs = splitSegs(s.doc.slice(0, s.cursor))
      and {
        s.carry == segs[segs.length() - 1],
        deliveredToks == canonAll(segs.slice(0, segs.length() - 1))
      }
    }

  /// Whatever has been delivered is a prefix of the oneshot pipeline's
  /// final output (flush included) — the streaming consumer never sees a
  /// line the oneshot consumer would not see at the same index
  val prefixOfOneshot = {
    val target = oneshotOf(s.doc)
    val common = minInt(deliveredToks.length(), target.length())
    and {
      deliveredToks.length() <= target.length(),
      range(0, common).foldl(true, (acc, i) => acc and deliveredToks[i] == target[i])
    }
  }

  /// Terminal agreement, flushed tail included: once Done, the delivered
  /// lines equal the oneshot result exactly and the carry is spent
  val terminalAgreement =
    (s.phase == Done) implies and {
      s.carry == List(),
      deliveredToks == oneshotOf(s.doc)
    }

  /// The consumer's sequence numbers are the join key, by construction:
  /// seq equals position among delivered lines, which (by refinement)
  /// equals the line's index in the document
  val seqMatchesIndex = and {
    s.nextSeq == s.delivered.length(),
    range(0, s.delivered.length())
      .foldl(true, (acc, i) => acc and s.delivered[i].seq == i)
  }

  /// The consumer-layer join is internally consistent in every state:
  /// commentSeqs is exactly the set of delivered comment-only line seqs
  val consumerJoinConsistent =
    s.commentSeqs == s.delivered.indices().filter(i => isCommentOnly(s.delivered[i].toks))

  /// Chunking-invariant metadata join, the ST-4 property made structural:
  /// once Done, the comment-line seq set equals the one computed from the
  /// oneshot pipeline — the join never depends on where chunks fell
  val joinChunkingInvariant =
    (s.phase == Done) implies {
      val target = oneshotOf(s.doc)
      s.commentSeqs == target.indices().filter(i => isCommentOnly(target[i]))
    }

  /// Delivered lines never contain the separator that completed them.
  /// (A delivered line MAY end in '\r': canonicalization strips exactly
  /// one trailing '\r' — the CR of a CRLF — so a raw segment "a\r\r"
  /// yields the canonical line "a\r", whose final '\r' is data.)
  val deliveredHasNoSeparator =
    s.delivered.foldl(true, (acc, ln) =>
      acc and ln.toks.foldl(true, (a, t) => a and t != T_NL))

  /// The carry is at most one raw line: it never contains a separator
  val carryIsOneLine = s.carry.foldl(true, (acc, t) => acc and t != T_NL)

  val allInvariants = and {
    cursorInBounds,
    phaseConsistent,
    cursorMonotone,
    conservation,
    refinesOneshotPrefix,
    prefixOfOneshot,
    terminalAgreement,
    seqMatchesIndex,
    consumerJoinConsistent,
    joinChunkingInvariant,
    deliveredHasNoSeparator,
    carryIsOneLine
  }

  // --- semantic tests (run with:
  // ---   npx quint test --main streaming_next verification/quint-next/streaming.qnt) ---

  /// CRLF document "a\r\nb\r\n" with the pair cut between '\r' and '\n':
  /// the pending '\r' waits raw in the carry and canonicalization strips
  /// it when the '\n' lands in the next chunk. A CRLF-terminated final
  /// line leaves an empty carry, so the flush delivers nothing.
  run crlfAcrossChunkBoundaryTest =
    initWith(List(T_A, T_CR, T_NL, T_B, T_CR, T_NL))
      .then(takeSized(2))
      .expect(s.carry == List(T_A, T_CR) and s.delivered == List())
      .then(takeSized(4))
      .expect(and {
        deliveredToks == List(List(T_A), List(T_B)),
        s.carry == List(),
        s.phase == AtEof,
        allInvariants
      })
      .then(flush)
      .expect(and {
        ev.kind == "flush",
        ev.emitted == List(),
        deliveredToks == List(List(T_A), List(T_B)),
        deliveredToks == oneshotOf(s.doc),
        s.phase == Done,
        allInvariants
      })

  /// "ab\nb a" has no trailing newline: the explicit flush step delivers
  /// the final partial line through the same consumer path, with the next
  /// sequence number, and terminal agreement includes it
  run flushDeliversTailTest =
    initWith(List(T_A, T_B, T_NL, T_B, T_SP, T_A))
      .then(takeSized(6))
      .expect(and {
        deliveredToks == List(List(T_A, T_B)),
        s.carry == List(T_B, T_SP, T_A),
        s.phase == AtEof
      })
      .then(flush)
      .expect(and {
        ev.emitted == List(List(T_B, T_SP, T_A)),
        ev.seqFrom == 1,
        s.delivered == List(
          { seq: 0, toks: List(T_A, T_B) },
          { seq: 1, toks: List(T_B, T_SP, T_A) }
        ),
        deliveredToks == oneshotOf(s.doc),
        s.phase == Done,
        allInvariants
      })
      .then(stutter)
      .expect(ev.kind == "stutter" and deliveredToks == oneshotOf(s.doc))

  /// ";a\r\nb\nba" driven through two different chunkings — one chunk of
  /// eight versus eight chunks of one — delivers the identical final
  /// output, lines, seqs and comment-join alike. The comment line is
  /// delivered the moment its newline arrives (no holdback), and both
  /// runs end equal to the oneshot, tail included.
  run twoChunkingsAgreeTest =
    initWith(List(T_SEMI, T_A, T_CR, T_NL, T_B, T_NL, T_B, T_A))
      .then(takeSized(8))
      .expect(and {
        deliveredToks == List(List(T_SEMI, T_A), List(T_B)),
        s.commentSeqs == Set(0),
        s.carry == List(T_B, T_A)
      })
      .then(flush)
      .expect(and {
        deliveredToks == List(List(T_SEMI, T_A), List(T_B), List(T_B, T_A)),
        s.commentSeqs == Set(0),
        deliveredToks == oneshotOf(s.doc),
        allInvariants
      })
      .then(initWith(List(T_SEMI, T_A, T_CR, T_NL, T_B, T_NL, T_B, T_A)))
      .then(takeSized(1))
      .then(takeSized(1))
      .then(takeSized(1))
      .expect(s.carry == List(T_SEMI, T_A, T_CR) and deliveredToks == List())
      .then(takeSized(1))
      // the comment line is delivered immediately — no comment-run holdback
      .expect(and {
        ev.emitted == List(List(T_SEMI, T_A)),
        ev.seqFrom == 0,
        s.commentSeqs == Set(0),
        s.carry == List()
      })
      .then(takeSized(1))
      .then(takeSized(1))
      .expect(deliveredToks == List(List(T_SEMI, T_A), List(T_B)))
      .then(takeSized(1))
      .then(takeSized(1))
      .expect(s.phase == AtEof and s.carry == List(T_B, T_A))
      .then(flush)
      .expect(and {
        deliveredToks == List(List(T_SEMI, T_A), List(T_B), List(T_B, T_A)),
        s.delivered == List(
          { seq: 0, toks: List(T_SEMI, T_A) },
          { seq: 1, toks: List(T_B) },
          { seq: 2, toks: List(T_B, T_A) }
        ),
        s.commentSeqs == Set(0),
        deliveredToks == oneshotOf(s.doc),
        allInvariants
      })

  /// The empty document starts life AtEof, takes its (empty) flush, and
  /// only ever stutters; every invariant holds vacuously-but-checked
  run emptyDocTest =
    initWith(List())
      .expect(s.phase == AtEof and allInvariants)
      .then(flush)
      .expect(ev.emitted == List() and s.phase == Done and deliveredToks == List() and allInvariants)
      .then(stutter)
      .expect(ev.kind == "stutter" and allInvariants)

  /// "a\r\r\n\nb": only the '\r' adjacent to a '\n' is terminator
  /// material — canonicalization strips exactly one, so the first line
  /// keeps its interior '\r' as data; the empty line between the two
  /// separators is delivered (seq stability over queue hygiene); the
  /// unterminated 'b' arrives on flush
  run loneCrIsDataTest =
    initWith(List(T_A, T_CR, T_CR, T_NL, T_NL, T_B))
      .then(takeSized(4))
      .expect(ev.emitted == List(List(T_A, T_CR)) and s.carry == List())
      .then(takeSized(1))
      .expect(ev.emitted == List(List()) and deliveredToks == List(List(T_A, T_CR), List()))
      .then(takeSized(1))
      .then(flush)
      .expect(and {
        deliveredToks == List(List(T_A, T_CR), List(), List(T_B)),
        deliveredToks == oneshotOf(s.doc),
        s.commentSeqs == Set(),
        allInvariants
      })
}
