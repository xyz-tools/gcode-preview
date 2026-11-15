// -*- mode: Bluespec; -*-
/**
 * slicer_detector — the v2 model of the write-once slicer-classification
 * latch over a streamed G-code parse. Each step delivers one chunk to the
 * parser: a single line, an ordered pair of lines, or a window-sized flood
 * of neutral comments with one marker line at the window boundary. While
 * un-latched, the detector samples the chunk's first WINDOW comment-bearing
 * lines, resolves the matched parser families through a fixed priority
 * order, and latches the winner together with the reported slicer name —
 * resolved from the latching chunk alone. Once latched, later chunks are
 * never examined again.
 *
 * Unlike v1 (one line per chunk, outcome hard-coded per event), detection
 * is modeled as data here: every line kind carries the SET of parser
 * families its representative texts match, the priority fold computes the
 * winner, and multi-line chunks make within-chunk priority — a lower
 * priority marker on an earlier line losing to a higher-priority marker
 * later in the same chunk — reachable in traces. The event-to-line mapping
 * is part of the contract: per line kind the replay holds a set of
 * representative line strings (case and boundary variants included) and
 * iterates all of them.
 *
 * All numeric state is integers (line counts); nothing is scaled. step is
 * always enabled — a stream can always produce another chunk — so there is
 * no stutter.
 *
 * Unit: PA-3 (slicer detection: latch monotonicity, priority purity,
 *   sampling window) in .context/formal-verification/mapping-data.json.
 * Authority policy: verification/quint/STYLE.md ("Authority
 *   annotations"). Everything modeled here is host-library machinery: no
 *   firmware or G-code standard governs slicer fingerprints, so every
 *   transition below is library-invented and pins the implementation.
 * Companion: slicer-detector.md.
 */
module slicer_detector {
  // --- sum types ---------------------------------------------------------

  /// The four parser families, one constructor per registered parser.
  type Family = FPrusaFamily | FSimplify3d | FSlic3r | FCura

  /// Reported slicer names. The PrusaFamily parser upgrades its generic
  /// family name to the specific generator named by the latching chunk;
  /// every other family reports a single fixed name.
  type Name = NPrusaSlicer | NPrusaFamily | NSimplify3d | NSlic3r | NCura

  /// The classification latch: written at most once per parse.
  /// lineStart is the number of lines fed before the latching chunk.
  type Latch = Unlatched | Latched({ fam: Family, name: Name, lineStart: int })

  /// The line alphabet. Marker kinds match exactly one family; ambig kinds
  /// match the two families named (one per adjacent pair in the priority
  /// order); neutral kinds match none. The replay owns a set of
  /// representative line strings per kind (the contract table in
  /// src/__tests__/parser/slicer-detector.ts) and iterates all of them.
  type LineKind =
    | LPrusaHeader
    | LPrusaLayerChange
    | LS3dHeader
    | LS3dLayer
    | LSlic3rHeader
    | LSlic3rLayer
    | LCuraHeader
    | LCuraLayer
    | LNeutralComment
    | LNeutralMove
    | LAmbigPrusaS3d
    | LAmbigS3dSlic3r
    | LAmbigSlic3rCura

  type EvKind = KInit | KSingle | KPair | KWindowEdge | KWindowOverflow

  type StepKind = SSingle | SPair | SConflictPair | SWindowEdge | SWindowOverflow

  // --- detection as data ---------------------------------------------------

  /// Families in the fixed order detection consults them.
  ///
  /// Authority: none — the order is a registration-array fact of the
  /// library, not any slicer's or firmware's rule.
  /// Library stance: library-invented — pins AVAILABLE_PARSERS order
  /// [PrusaFamily, Simplify3D, Slic3r, Cura].
  /// Exclusions: nothing — the list is the whole registry.
  pure val FAMILY_PRIORITY: List[Family] = [FPrusaFamily, FSimplify3d, FSlic3r, FCura]

  /// Second, independent encoding of the same order, used only by the
  /// priority invariant so a mis-transcribed fold is caught.
  pure def priorityIndex(f: Family): int = match f {
    | FPrusaFamily => 0
    | FSimplify3d => 1
    | FSlic3r => 2
    | FCura => 3
  }

  /**
   * The families whose identification patterns match a line kind's
   * representative texts. Every representative of a kind matches exactly
   * this set — the replay's contract test re-checks that per string.
   *
   * Authority: none — fingerprints are slicer output conventions; which of
   * them identify a family is the library's own pattern table.
   * Library stance: library-invented — pins identificationPatterns of the
   * four parser classes, including that ambig_prusa_s3d matches PrusaFamily
   * and Simplify3D, ambig_s3d_slic3r matches Simplify3D and Slic3r, and
   * ambig_slic3r_cura matches Slic3r and Cura.
   * Exclusions: SuperSlicer / OrcaSlicer / BambuStudio / Bambu Lab markers,
   * the Simplify3D "Layer count:" header and Slic3r "layer_z" forms beyond
   * the chosen representatives, and any comment text outside the
   * representative sets.
   */
  pure def matchedFamilies(l: LineKind): Set[Family] = match l {
    | LPrusaHeader => Set(FPrusaFamily)
    | LPrusaLayerChange => Set(FPrusaFamily)
    | LS3dHeader => Set(FSimplify3d)
    | LS3dLayer => Set(FSimplify3d)
    | LSlic3rHeader => Set(FSlic3r)
    | LSlic3rLayer => Set(FSlic3r)
    | LCuraHeader => Set(FCura)
    | LCuraLayer => Set(FCura)
    | LNeutralComment => Set()
    | LNeutralMove => Set()
    | LAmbigPrusaS3d => Set(FPrusaFamily, FSimplify3d)
    | LAmbigS3dSlic3r => Set(FSimplify3d, FSlic3r)
    | LAmbigSlic3rCura => Set(FSlic3r, FCura)
  }

  /// Whether the line carries a comment: detection and the sampling window
  /// only ever see comment-bearing lines. Only the bare move has none.
  pure def hasComment(l: LineKind): bool = match l {
    | LNeutralMove => false
    | _ => true
  }

  /// Whether the line's representatives contain the literal generator name
  /// "PrusaSlicer" — the input to name resolution, independent of which
  /// family pattern matched.
  pure def namesPrusaSlicer(l: LineKind): bool = match l {
    | LPrusaHeader => true
    | LAmbigPrusaS3d => true
    | _ => false
  }

  // --- the sampling window -------------------------------------------------

  /// How many comment-bearing lines of one chunk detection samples before
  /// giving up on that chunk.
  ///
  /// Authority: none — a performance bound of the library.
  /// Library stance: library-invented — pins canParse's maxLines = 200
  /// default; detectSlicerName slices the same first 200 comments, so one
  /// bound serves both detection and name resolution.
  /// Exclusions: callers passing a non-default maxLines (none in the
  /// library's own pipeline).
  pure val WINDOW = 200

  /// What detection sees of one chunk, after the window is applied.
  type ChunkInfo = {
    winFams: Set[Family], // families matched by in-window comment lines
    tailFams: Set[Family], // families matched only beyond the window
    prusaLiteralInWin: bool, // an in-window line names "PrusaSlicer"
    nLines: int // every line of the chunk, comment-bearing or not
  }

  /**
   * Scan a chunk: `fill` neutral comment lines, then the given lines in
   * order. A comment-bearing line is in the window iff its comment position
   * (fill counts first) is at most WINDOW; lines beyond it land in tailFams,
   * which detection never reads.
   *
   * Authority: none.
   * Library stance: library-invented — pins that the window counts
   * comment-bearing commands only (a bare move does not consume a slot) and
   * restarts for every chunk, because detection re-runs per chunk while
   * un-latched.
   * Exclusions: fillers are always neutral; a marker buried among the
   * fillers (rather than after them) is not generated.
   */
  pure def mkChunk(lns: List[LineKind], fill: int): ChunkInfo = {
    val zero: { cs: int, win: Set[Family], tail: Set[Family], lit: bool } =
      { cs: fill, win: Set(), tail: Set(), lit: false }
    val scanned = lns.foldl(zero, (acc, l) =>
      if (not(hasComment(l))) acc
      else if (acc.cs + 1 <= WINDOW) {
        cs: acc.cs + 1,
        win: acc.win.union(matchedFamilies(l)),
        tail: acc.tail,
        lit: acc.lit or namesPrusaSlicer(l)
      } else {
        cs: acc.cs + 1,
        win: acc.win,
        tail: acc.tail.union(matchedFamilies(l)),
        lit: acc.lit
      })
    { winFams: scanned.win, tailFams: scanned.tail, prusaLiteralInWin: scanned.lit, nLines: fill + lns.length() }
  }

  // --- priority resolution and name resolution -----------------------------

  type Detection = NoMatch | Matched(Family)

  /**
   * First-match priority over one chunk's in-window families.
   *
   * Authority: none.
   * Library stance: library-invented — pins that detectSlicer returns the
   * FIRST registered parser whose patterns match anywhere in the sampled
   * comments, so priority ranks families, never line positions: a chunk
   * pairing a Cura line before a Prusa line still latches PrusaFamily.
   * Exclusions: nothing within the modeled alphabet.
   */
  pure def firstByPriority(fams: Set[Family]): Detection =
    FAMILY_PRIORITY.foldl(NoMatch, (acc, f) =>
      match acc {
        | Matched(_) => acc
        | NoMatch => if (fams.contains(f)) Matched(f) else NoMatch
      })

  pure def canonicalName(f: Family): Name = match f {
    | FPrusaFamily => NPrusaFamily
    | FSimplify3d => NSimplify3d
    | FSlic3r => NSlic3r
    | FCura => NCura
  }

  /**
   * The reported name, resolved from the latching chunk only.
   *
   * Authority: none.
   * Library stance: library-invented — pins detectSlicerName: only the
   * PrusaFamily parser upgrades its generic name, by scanning the latching
   * chunk's in-window comments for a known generator literal — ANY line of
   * the chunk, not just the line whose pattern matched. Every other family
   * reports its fixed name.
   * Exclusions: of the four known generator literals only "PrusaSlicer" is
   * in the alphabet; SuperSlicer / OrcaSlicer / BambuStudio are not.
   */
  pure def resolveName(f: Family, c: ChunkInfo): Name =
    if (f == FPrusaFamily and c.prusaLiteralInWin) NPrusaSlicer else canonicalName(f)

  // --- state ---------------------------------------------------------------

  /// The semantic state. Ghosts exist for property expression only:
  /// ghostFirst freezes the first latch ever taken (monotonicity),
  /// ghostLatchFams records the latching chunk's in-window family set (the
  /// priority theorem), ghostEvidence is set — from in-window nonemptiness
  /// directly, not through the priority fold — the first time an un-latched
  /// step sees any in-window match (latch-iff-evidence), and prevLinesSeen
  /// carries the previous line count (monotone accounting).
  type SpecState = {
    latch: Latch,
    ghostFirst: Latch,
    ghostLatchFams: Set[Family],
    ghostEvidence: bool,
    linesSeen: int,
    prevLinesSeen: int
  }

  /// The trace contract, in plain values. kind/line1/line2/fill describe
  /// the chunk this step fed (line tags index the replay's representative
  /// table; fill counts prepended neutral filler comments); family,
  /// detected, latchStart and linesSeen project the latch after the step,
  /// derived from the sum types in latchFamStr/latchNameStr/latchStartOf
  /// only.
  type Event = {
    kind: str,
    line1: str,
    line2: str,
    fill: int,
    family: str,
    detected: str,
    latchStart: int,
    linesSeen: int
  }

  var s: SpecState
  var ev: Event

  // --- string derivation (one place; no free literals elsewhere) -----------

  pure def kindStr(k: EvKind): str = match k {
    | KInit => "init"
    | KSingle => "single"
    | KPair => "pair"
    | KWindowEdge => "window_edge"
    | KWindowOverflow => "window_overflow"
  }

  pure def lineTag(l: LineKind): str = match l {
    | LPrusaHeader => "prusa_header"
    | LPrusaLayerChange => "prusa_layer_change"
    | LS3dHeader => "simplify3d_header"
    | LS3dLayer => "simplify3d_layer"
    | LSlic3rHeader => "slic3r_header"
    | LSlic3rLayer => "slic3r_layer"
    | LCuraHeader => "cura_header"
    | LCuraLayer => "cura_layer"
    | LNeutralComment => "neutral_comment"
    | LNeutralMove => "neutral_move"
    | LAmbigPrusaS3d => "ambig_prusa_s3d"
    | LAmbigS3dSlic3r => "ambig_s3d_slic3r"
    | LAmbigSlic3rCura => "ambig_slic3r_cura"
  }

  pure def famStr(f: Family): str = match f {
    | FPrusaFamily => "PrusaFamily"
    | FSimplify3d => "Simplify3D"
    | FSlic3r => "Slic3r"
    | FCura => "Cura"
  }

  pure def nameStr(n: Name): str = match n {
    | NPrusaSlicer => "PrusaSlicer"
    | NPrusaFamily => "PrusaFamily"
    | NSimplify3d => "Simplify3D"
    | NSlic3r => "Slic3r"
    | NCura => "Cura"
  }

  pure def latchFamStr(l: Latch): str = match l {
    | Unlatched => "none"
    | Latched(r) => famStr(r.fam)
  }

  pure def latchNameStr(l: Latch): str = match l {
    | Unlatched => "none"
    | Latched(r) => nameStr(r.name)
  }

  pure def latchStartOf(l: Latch): int = match l {
    | Unlatched => -1
    | Latched(r) => r.lineStart
  }

  pure def isLatched(l: Latch): bool = match l {
    | Unlatched => false
    | Latched(_) => true
  }

  // --- pure transition -------------------------------------------------------

  /**
   * One chunk through the detector.
   *
   * Authority: none.
   * Library stance: library-invented — pins the write-once latch: while
   * un-latched every chunk is examined (window applied, priority resolved,
   * name fixed from that same chunk); once latched a chunk only advances
   * the line count, and neither the classification nor the reported name is
   * ever written again.
   * Exclusions: layer/thumbnail metadata extraction that shares the real
   * parse loop; the latch is the whole subject here.
   */
  pure def applyChunk(st: SpecState, c: ChunkInfo): SpecState = {
    val advanced = { ...st, prevLinesSeen: st.linesSeen, linesSeen: st.linesSeen + c.nLines }
    match st.latch {
      | Latched(_) => advanced
      | Unlatched => {
          val withEvidence = { ...advanced, ghostEvidence: advanced.ghostEvidence or c.winFams != Set() }
          match firstByPriority(c.winFams) {
            | NoMatch => withEvidence
            | Matched(f) => {
                val taken = Latched({ fam: f, name: resolveName(f, c), lineStart: st.linesSeen })
                { ...withEvidence, latch: taken, ghostFirst: taken, ghostLatchFams: c.winFams }
              }
          }
        }
    }
  }

  pure def mkEv(k: EvKind, lns: List[LineKind], fill: int, sn: SpecState): Event = {
    kind: kindStr(k),
    line1: if (lns.length() >= 1) lineTag(lns[0]) else "",
    line2: if (lns.length() >= 2) lineTag(lns[1]) else "",
    fill: fill,
    family: latchFamStr(sn.latch),
    detected: latchNameStr(sn.latch),
    latchStart: latchStartOf(sn.latch),
    linesSeen: sn.linesSeen
  }

  // --- init and step ---------------------------------------------------------

  /**
   * A fresh parse: nothing latched, nothing fed.
   *
   * Authority: none — model scaffolding.
   * Library stance: library-invented — mirrors a new Parser with a null
   * metadataParser and a zero line count.
   * Exclusions: nothing.
   */
  action init = all {
    s' = {
      latch: Unlatched,
      ghostFirst: Unlatched,
      ghostLatchFams: Set(),
      ghostEvidence: false,
      linesSeen: 0,
      prevLinesSeen: 0
    },
    ev' = {
      kind: kindStr(KInit),
      line1: "",
      line2: "",
      fill: 0,
      family: latchFamStr(Unlatched),
      detected: latchNameStr(Unlatched),
      latchStart: latchStartOf(Unlatched),
      linesSeen: 0
    }
  }

  /// Deliver one chunk: `fill` neutral filler comments, then `lns`.
  /// All event kinds funnel through here so the event record and the
  /// semantic state can never disagree.
  action deliver(k: EvKind, lns: List[LineKind], fill: int): bool = {
    val c = mkChunk(lns, fill)
    val sn = applyChunk(s, c)
    all {
      ev' = mkEv(k, lns, fill, sn),
      s' = sn
    }
  }

  /// A chunk of exactly one line (generation scaffolding; library-invented:
  /// mirrors a streaming read handing the parser one line).
  action singleFrom(menu: List[LineKind]): bool = {
    nondet i = menu.indices().oneOf()
    deliver(KSingle, [menu[i]], 0)
  }

  /// A chunk of two ordered lines (generation scaffolding; library-invented:
  /// one chunk carrying two lines is where within-chunk priority lives).
  action pairFrom(menu: List[LineKind]): bool = {
    nondet i = menu.indices().oneOf()
    nondet j = menu.indices().oneOf()
    deliver(KPair, [menu[i], menu[j]], 0)
  }

  /// An ordered marker pair whose priority winner sits on the SECOND line —
  /// the headline within-chunk case — drawn from the curated conflict menu
  /// (generation scaffolding; a random pair rarely lands this shape).
  action conflictPairFrom(menu: List[(LineKind, LineKind)]): bool = {
    nondet i = menu.indices().oneOf()
    deliver(KPair, [menu[i]._1, menu[i]._2], 0)
  }

  /// WINDOW - 1 fillers, then a marker: the marker holds the LAST in-window
  /// comment slot, so this chunk pins the inclusive edge of the window.
  action windowEdgeFrom(menu: List[LineKind]): bool = {
    nondet i = menu.indices().oneOf()
    deliver(KWindowEdge, [menu[i]], WINDOW - 1)
  }

  /// WINDOW fillers, then a marker: the marker is one comment past the
  /// window, so an un-latched detector must not see it.
  action windowOverflowFrom(menu: List[LineKind]): bool = {
    nondet i = menu.indices().oneOf()
    deliver(KWindowOverflow, [menu[i]], WINDOW)
  }

  // --- generation weights (weights live in data, one entry per weight unit) --

  /// Every line kind that can latch, uniformly.
  pure val MARKER_MENU: List[LineKind] = [
    LPrusaHeader, LPrusaLayerChange,
    LS3dHeader, LS3dLayer,
    LSlic3rHeader, LSlic3rLayer,
    LCuraHeader, LCuraLayer,
    LAmbigPrusaS3d, LAmbigS3dSlic3r, LAmbigSlic3rCura
  ]

  /// Line bag while un-latched: 12 neutral entries against the 11 markers
  /// (~52% neutral), so the un-latched mode survives a few steps per trace
  /// and window/pair events still find the latch open.
  pure val QUIET_LINE_MENU: List[LineKind] = [
    LNeutralComment, LNeutralComment, LNeutralComment,
    LNeutralComment, LNeutralComment, LNeutralComment,
    LNeutralMove, LNeutralMove, LNeutralMove,
    LNeutralMove, LNeutralMove, LNeutralMove
  ].concat(MARKER_MENU)

  /// Line bag once latched: marker-heavy (11 of 13), so every latched trace
  /// showers the latch with conflicting evidence.
  pure val RAIN_LINE_MENU: List[LineKind] = [LNeutralComment, LNeutralMove].concat(MARKER_MENU)

  /// Ordered pairs in which every family the FIRST line matches is outranked
  /// by the second line's best family, so the priority-resolved winner always
  /// comes from the later line. Covers every ordered adjacent-family hop plus
  /// ambiguous lines on both sides.
  pure val CONFLICT_PAIR_MENU: List[(LineKind, LineKind)] = [
    (LCuraLayer, LPrusaLayerChange),
    (LCuraHeader, LPrusaHeader),
    (LCuraLayer, LSlic3rHeader),
    (LCuraHeader, LSlic3rLayer),
    (LSlic3rHeader, LS3dLayer),
    (LSlic3rLayer, LS3dHeader),
    (LS3dHeader, LPrusaLayerChange),
    (LS3dLayer, LPrusaHeader),
    (LAmbigSlic3rCura, LS3dHeader),
    (LAmbigS3dSlic3r, LPrusaHeader),
    (LCuraLayer, LAmbigPrusaS3d),
    (LAmbigSlic3rCura, LAmbigPrusaS3d)
  ]

  /// Step-kind bag while un-latched: conflict pairs and window events are
  /// deliberately heavy because they are only semantically interesting
  /// before the latch closes.
  pure val UNLATCHED_STEP_MENU: List[StepKind] = [
    SSingle, SSingle, SSingle,
    SPair, SPair,
    SConflictPair, SConflictPair,
    SWindowEdge, SWindowEdge,
    SWindowOverflow, SWindowOverflow, SWindowOverflow
  ]

  /// Step-kind bag once latched: mostly marker rain, with window floods kept
  /// in the mix so the line accounting is exercised across big chunks too.
  pure val LATCHED_STEP_MENU: List[StepKind] = [
    SSingle, SSingle, SSingle, SSingle, SSingle,
    SPair, SPair,
    SWindowEdge,
    SWindowOverflow, SWindowOverflow
  ]

  action dispatch(sk: StepKind, lineMenu: List[LineKind]): bool = match sk {
    | SSingle => singleFrom(lineMenu)
    | SPair => pairFrom(lineMenu)
    | SConflictPair => conflictPairFrom(CONFLICT_PAIR_MENU)
    | SWindowEdge => windowEdgeFrom(MARKER_MENU)
    | SWindowOverflow => windowOverflowFrom(MARKER_MENU)
  }

  action stepUnlatched = all {
    not(isLatched(s.latch)),
    {
      nondet k = UNLATCHED_STEP_MENU.indices().oneOf()
      dispatch(UNLATCHED_STEP_MENU[k], QUIET_LINE_MENU)
    }
  }

  action stepLatched = all {
    isLatched(s.latch),
    {
      nondet k = LATCHED_STEP_MENU.indices().oneOf()
      dispatch(LATCHED_STEP_MENU[k], RAIN_LINE_MENU)
    }
  }

  /// Exactly one branch is enabled in every state, so step always is.
  action step = any { stepUnlatched, stepLatched }

  // --- invariants (over semantic state only; none mention `ev`) --------------

  /// The latch is monotone: the classification, name and position always
  /// equal the first ones ever taken. ghostFirst is written only on the
  /// Unlatched -> Latched edge, so any transition that re-latches fails here.
  val latchMonotone = s.latch == s.ghostFirst

  /// The latch exists exactly when some un-latched step saw an in-window
  /// match. ghostEvidence is derived from in-window nonemptiness directly —
  /// not through the priority fold — so a detector that latched from
  /// beyond-window lines (or failed to latch on an in-window match) fails
  /// here.
  val latchIffEvidence = isLatched(s.latch) == s.ghostEvidence

  /// The priority theorem: the latched family belongs to the latching
  /// chunk's in-window set and no higher-priority family does, measured
  /// against the independent priorityIndex encoding.
  val priorityRespected = match s.latch {
    | Unlatched => s.ghostLatchFams == Set()
    | Latched(r) => and {
        s.ghostLatchFams.contains(r.fam),
        s.ghostLatchFams.forall(g => priorityIndex(g) >= priorityIndex(r.fam))
      }
  }

  /// The reported name always belongs to the latched family; only
  /// PrusaFamily ever resolves to a more specific generator name.
  val nameBelongsToFamily = match s.latch {
    | Unlatched => true
    | Latched(r) => match r.fam {
        | FPrusaFamily => r.name == NPrusaSlicer or r.name == NPrusaFamily
        | FSimplify3d => r.name == NSimplify3d
        | FSlic3r => r.name == NSlic3r
        | FCura => r.name == NCura
      }
  }

  /// A latched position names lines that were actually fed: the latching
  /// chunk started at a line index already behind us.
  val latchStartConsistent = and {
    s.linesSeen >= 0,
    match s.latch {
      | Unlatched => true
      | Latched(r) => r.lineStart >= 0 and r.lineStart < s.linesSeen
    }
  }

  /// Line accounting is monotone and advances only by the sizes chunks can
  /// have: 1 (single), 2 (pair), WINDOW (edge flood), WINDOW + 1 (overflow
  /// flood) — or 0 at init.
  val linesMonotone = and {
    s.linesSeen >= s.prevLinesSeen,
    Set(0, 1, 2, WINDOW, WINDOW + 1).contains(s.linesSeen - s.prevLinesSeen)
  }

  val allInvariants = and {
    latchMonotone,
    latchIffEvidence,
    priorityRespected,
    nameBelongsToFamily,
    latchStartConsistent,
    linesMonotone
  }

  // --- semantic tests (run with:
  // ---   npx quint test verification/quint/slicer-detector.qnt) ------------

  /// Within-chunk priority, the case v1's one-line chunks could not reach:
  /// a chunk carrying a Cura marker on its FIRST line and a Prusa family
  /// marker on its second latches PrusaFamily — priority ranks families,
  /// not line positions. A later Cura header cannot re-latch.
  run pairPriorityWithinChunkTest =
    init
      .then(deliver(KPair, [LCuraLayer, LPrusaLayerChange], 0))
      .expect(and {
        ev.family == "PrusaFamily",
        ev.detected == "PrusaFamily",
        ev.latchStart == 0,
        s.linesSeen == 2
      })
      .then(deliver(KSingle, [LCuraHeader], 0))
      .expect(and { ev.family == "PrusaFamily", ev.detected == "PrusaFamily", s.linesSeen == 3 })

  /// The reported name is resolved from the WHOLE latching chunk: the
  /// generic LAYER_CHANGE line matches first, but the header later in the
  /// same chunk names PrusaSlicer, so the latch reports the specific name.
  /// A later header can never upgrade a name latched generic.
  run nameResolvedFromWholeChunkTest =
    init
      .then(deliver(KPair, [LPrusaLayerChange, LPrusaHeader], 0))
      .expect(and { ev.family == "PrusaFamily", ev.detected == "PrusaSlicer", ev.latchStart == 0 })
      .then(init)
      .then(deliver(KSingle, [LPrusaLayerChange], 0))
      .expect(ev.detected == "PrusaFamily")
      .then(deliver(KSingle, [LPrusaHeader], 0))
      .expect(and { ev.family == "PrusaFamily", ev.detected == "PrusaFamily", ev.latchStart == 0 })

  /// The window bound, pinned on both sides of the edge: a marker one
  /// comment past the window never latches (the chunk still counts its
  /// lines), while a marker on the last in-window slot latches — and the
  /// latch records the flood chunk's starting line.
  run windowBoundaryTest =
    init
      .then(deliver(KWindowOverflow, [LCuraHeader], WINDOW))
      .expect(and {
        ev.family == "none",
        ev.detected == "none",
        ev.latchStart == -1,
        s.linesSeen == WINDOW + 1,
        not(s.ghostEvidence)
      })
      .then(deliver(KWindowEdge, [LCuraHeader], WINDOW - 1))
      .expect(and {
        ev.family == "Cura",
        ev.detected == "Cura",
        ev.latchStart == WINDOW + 1,
        s.linesSeen == 2 * WINDOW + 1
      })

  /// Each ambiguous line latches the higher-priority family of its pair,
  /// and the Prusa-side ambiguity also carries the PrusaSlicer literal.
  run ambiguousLinesResolveByPriorityTest =
    init
      .then(deliver(KSingle, [LAmbigPrusaS3d], 0))
      .expect(and { ev.family == "PrusaFamily", ev.detected == "PrusaSlicer" })
      .then(init)
      .then(deliver(KSingle, [LAmbigS3dSlic3r], 0))
      .expect(and { ev.family == "Simplify3D", ev.detected == "Simplify3D" })
      .then(init)
      .then(deliver(KSingle, [LAmbigSlic3rCura], 0))
      .expect(and { ev.family == "Slic3r", ev.detected == "Slic3r" })

  /// The stream latch is strictly first-come: once Slic3r latches from its
  /// layer marker, higher-priority families arriving later — alone or in
  /// pairs — never displace it.
  run latchImmutableAcrossChunksTest =
    init
      .then(deliver(KSingle, [LNeutralMove], 0))
      .expect(and { ev.family == "none", s.linesSeen == 1 })
      .then(deliver(KSingle, [LSlic3rLayer], 0))
      .expect(and { ev.family == "Slic3r", ev.detected == "Slic3r", ev.latchStart == 1 })
      .then(deliver(KSingle, [LPrusaHeader], 0))
      .expect(and { ev.family == "Slic3r", ev.detected == "Slic3r" })
      .then(deliver(KPair, [LPrusaHeader, LCuraHeader], 0))
      .expect(and { ev.family == "Slic3r", ev.detected == "Slic3r", ev.latchStart == 1, s.linesSeen == 5 })

  /// Neutral lines never latch, singly or paired, however many arrive.
  run neutralNeverLatchesTest =
    init
      .then(deliver(KSingle, [LNeutralComment], 0))
      .then(deliver(KSingle, [LNeutralMove], 0))
      .then(deliver(KPair, [LNeutralComment, LNeutralMove], 0))
      .expect(and {
        ev.family == "none",
        ev.detected == "none",
        ev.latchStart == -1,
        s.linesSeen == 4,
        not(s.ghostEvidence)
      })
}
