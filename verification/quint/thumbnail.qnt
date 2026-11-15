// -*- mode: Bluespec; -*-
/**
 * thumbnail — the v2 embedded-thumbnail comment machine. Slicers write a
 * thumbnail into G-code comments as a 'thumbnail begin <size> <count>'
 * marker, a run of base64 payload comments, and a 'thumbnail end' marker;
 * the library collects the payload between the markers and keeps the
 * finished thumbnail only when the collected characters pass the declared
 * length and the base64 shape check. The machine pins that collector,
 * including its header coercions: a begin header can omit the count or
 * carry a size token with no parsable dimensions, and each malformed form
 * has its own observable in-flight shape and storability.
 *
 * Payload is abstract: a data line is an alphabet-character run followed by
 * a trailing '=' pad run, carried as counts. Validity therefore does not
 * collapse to one filler convention (v1's single repeated character):
 * the model tracks a pad-structure mode (none / '=' / '==' / broken) and a
 * dirty flag for non-base64 characters, and the stored predicate — length
 * equals the declared count, length a multiple of 4, no dirty characters,
 * pad structure not broken — coincides with the implementation's base64
 * regex on every representable payload, padded and unpadded forms included.
 *
 * All counters are plain integers (character counts, pixel dimensions);
 * nothing is scaled. Two state variables only: `s` (semantic state plus
 * ghosts) and `ev` (the trace contract in plain values, so an ITF trace
 * doubles as a comment stream the replay rebuilds line by line).
 *
 * Unit: PA-2 (Thumbnail state machine + pure decode + chunk-straddle
 *   equivalence) in .context/formal-verification/mapping-data.json.
 * Authority policy: verification/quint/STYLE.md ("Authority
 *   annotations"); every transition below carries its block.
 * Companion: thumbnail.md.
 */
module thumbnail {
  // --- sum types ----------------------------------------------------------

  /// Pad structure of the collected payload: '=' may only form a trailing
  /// run of length one or two. Any alphabet character after a pad, or a
  /// third pad, breaks the structure for the rest of the block.
  type Pad = NoPad | OnePad | TwoPad | BrokenPad

  /// The declared character count: a well-formed header declares an integer;
  /// a header with no count token coerces to an unmatchable declaration
  /// (the implementation's +undefined), so the block can never store.
  type Decl = Declared(int) | NoDecl

  /// The stored-record key, i.e. the header's size token. SizeWH is the
  /// well-formed 'WxH' token; SizeBad is a fixed token with no parsable
  /// dimensions (the replay renders it as 'qq'); SizeEmpty is the empty
  /// token of a bare 'thumbnail begin'.
  type SizeKey = SizeWH({ w: int, h: int }) | SizeBad | SizeEmpty

  /// The begin-header forms the machine distinguishes observably.
  type HeaderKind =
    | HFull({ w: int, h: int, cnt: int }) // 'thumbnail begin WxH N'
    | HNoCount({ w: int, h: int }) // 'thumbnail begin WxH'
    | HBadDims(int) // 'thumbnail begin qq N'
    | HEmpty // 'thumbnail begin'

  /// The in-progress block between a begin and its end.
  type Collect = { key: SizeKey, decl: Decl, collected: int, pads: Pad, dirty: bool }

  type Progress = Idle | Collecting(Collect)

  type StoredEntry = { key: SizeKey, len: int }

  type EvKind = KInit | KBegin | KData | KEnd | KGarbage | KNeutral

  // --- state and event records ---------------------------------------------

  /// Semantic state plus ghosts. The ghosts exist for property expression:
  /// ghostAppends is the per-line append log since the current begin, so the
  /// collected count is checkable against an independent derivation;
  /// ghostPadChars counts '=' characters appended since the begin, pinning
  /// the pad mode; the counters (stores, padded stores, overwrites, drops,
  /// discards, garbage hits) partition the end/begin outcomes and double as
  /// the corpus coverage meters; ghostPrevStores freezes the previous step's
  /// store count for the monotonicity invariant.
  type SpecState = {
    progress: Progress,
    stored: List[StoredEntry],
    ghostAppends: List[int],
    ghostPadChars: int,
    ghostStores: int,
    ghostPaddedStores: int,
    ghostOverwrites: int,
    ghostDrops: int,
    ghostDiscards: int,
    ghostGarbageHits: int,
    ghostPrevStores: int
  }

  /// The trace contract: which comment line this step fed, in plain values.
  /// header is one of "full" | "nocount" | "baddims" | "empty" on begin
  /// steps and "" otherwise; w/h/cnt are the header numbers a form carries
  /// (0 when the form omits them); alphas/pads describe a data payload;
  /// gLen is a garbage line's trimmed length.
  type Event = {
    kind: str,
    header: str,
    w: int,
    h: int,
    cnt: int,
    alphas: int,
    pads: int,
    gLen: int
  }

  var s: SpecState
  var ev: Event

  // --- event derivation (one place; no free string literals) ---------------

  pure def kindStr(k: EvKind): str =
    match k {
      | KInit => "init"
      | KBegin => "begin"
      | KData => "data"
      | KEnd => "end"
      | KGarbage => "garbage"
      | KNeutral => "neutral"
    }

  pure def headerStr(h: HeaderKind): str =
    match h {
      | HFull(_) => "full"
      | HNoCount(_) => "nocount"
      | HBadDims(_) => "baddims"
      | HEmpty => "empty"
    }

  pure val EV_INIT: Event =
    { kind: kindStr(KInit), header: "", w: 0, h: 0, cnt: 0, alphas: 0, pads: 0, gLen: 0 }

  pure def evBegin(hdr: HeaderKind): Event =
    match hdr {
      | HFull(r) => { ...EV_INIT, kind: kindStr(KBegin), header: headerStr(hdr), w: r.w, h: r.h, cnt: r.cnt }
      | HNoCount(r) => { ...EV_INIT, kind: kindStr(KBegin), header: headerStr(hdr), w: r.w, h: r.h }
      | HBadDims(c) => { ...EV_INIT, kind: kindStr(KBegin), header: headerStr(hdr), cnt: c }
      | HEmpty => { ...EV_INIT, kind: kindStr(KBegin), header: headerStr(hdr) }
    }

  pure def evData(alphas: int, pads: int): Event =
    { ...EV_INIT, kind: kindStr(KData), alphas: alphas, pads: pads }

  pure def evGarbage(n: int): Event = { ...EV_INIT, kind: kindStr(KGarbage), gLen: n }

  pure def evEnd: Event = { ...EV_INIT, kind: kindStr(KEnd) }

  pure def evNeutral: Event = { ...EV_INIT, kind: kindStr(KNeutral) }

  // --- pure helpers ---------------------------------------------------------

  pure def keyOf(hdr: HeaderKind): SizeKey =
    match hdr {
      | HFull(r) => SizeWH({ w: r.w, h: r.h })
      | HNoCount(r) => SizeWH({ w: r.w, h: r.h })
      | HBadDims(_) => SizeBad
      | HEmpty => SizeEmpty
    }

  pure def declOf(hdr: HeaderKind): Decl =
    match hdr {
      | HFull(r) => Declared(r.cnt)
      | HNoCount(_) => NoDecl
      | HBadDims(c) => Declared(c)
      | HEmpty => NoDecl
    }

  /// Pad structure after appending one data line of `alphas` alphabet
  /// characters followed by `pads` trailing '=' characters (pads <= 2 by
  /// the generation menus; a line is never empty, see the data annotation).
  pure def padAfter(cur: Pad, alphas: int, pads: int): Pad =
    if (alphas == 0 and pads == 0) cur
    else match cur {
      | NoPad => if (pads == 0) NoPad else if (pads == 1) OnePad else TwoPad
      | OnePad => if (alphas > 0) BrokenPad else if (pads == 1) TwoPad else BrokenPad
      | TwoPad => BrokenPad
      | BrokenPad => BrokenPad
    }

  pure def sumList(xs: List[int]): int = xs.foldl(0, (acc, n) => acc + n)

  /// Index of key k in the stored list, or -1 when absent.
  pure def findKey(stored: List[StoredEntry], k: SizeKey): int =
    stored.foldl((0, -1), (acc, e) => (acc._1 + 1, if (acc._2 == -1 and e.key == k) acc._1 else acc._2))._2

  /// Keyed put: replace the existing entry for k, or append a new one.
  pure def storePut(stored: List[StoredEntry], k: SizeKey, n: int): List[StoredEntry] = {
    val i = findKey(stored, k)
    if (i == -1) stored.append({ key: k, len: n }) else stored.replaceAt(i, { key: k, len: n })
  }

  /// The storability predicate at 'thumbnail end': the collected length
  /// equals the declared count AND the collected characters match the base64
  /// shape — no non-base64 character, pad structure not broken, and total
  /// length a multiple of 4. On the model's payload language (alphabet runs
  /// with trailing pad runs) this coincides with the implementation's
  /// base64 regex: a contiguous trailing pad run of one or two makes the
  /// alphabet prefix 4k+3 or 4k+2 exactly when the total is a multiple
  /// of 4, which is the regex's padded final quartet.
  pure def isStorable(c: Collect): bool =
    match c.decl {
      | NoDecl => false
      | Declared(n) =>
        and {
          n == c.collected,
          c.collected % 4 == 0,
          not(c.dirty),
          not(c.pads == BrokenPad)
        }
    }

  // --- pure transitions ------------------------------------------------------

  /**
   * 'thumbnail begin …' — unconditionally replaces any in-progress block
   * with a fresh one shaped by the header form; a begin never checks
   * whether a block is already open.
   *
   * Authority: none — the thumbnail block is a slicer comment convention
   * (PrusaSlicer-style), not governed by firmware or a G-code standard.
   * Library stance: library-invented — pins the header coercions: a missing
   * count token or a size token without parsable dimensions still opens a
   * collecting block; the no-count forms carry an unmatchable declaration
   * and can never store, while a dimensionless size token with a count can.
   * Exclusions: markers at non-canonical positions inside longer comments
   * (the implementation matches the marker anywhere in the comment text);
   * extra tokens after the count (ignored); size tokens other than the one
   * fixed dimensionless representative.
   */
  pure def applyBegin(st: SpecState, hdr: HeaderKind): SpecState = {
    ...st,
    progress: Collecting({ key: keyOf(hdr), decl: declOf(hdr), collected: 0, pads: NoPad, dirty: false }),
    ghostAppends: [],
    ghostPadChars: 0,
    ghostDiscards: st.ghostDiscards + (match st.progress { | Collecting(_) => 1 | Idle => 0 }),
    ghostPrevStores: st.ghostStores
  }

  /**
   * A marker-free comment of `alphas` base64-alphabet characters followed by
   * `pads` trailing '=' characters. While collecting it is appended with no
   * cap (the collected count may exceed the declared count); while idle it
   * is ignored.
   *
   * Authority: none — comment payload handling is library machinery.
   * Library stance: library-invented — the implementation appends the
   * trimmed comment text verbatim; the model carries its character-class
   * composition instead of its characters.
   * Exclusions: whitespace-only comments (normalized away upstream, so they
   * never reach this machine — a data line is never empty); '=' anywhere
   * but a trailing run within one line (a pad-then-alphabet sequence ACROSS
   * lines is in model and breaks the pad structure); payload containing ';'
   * or a begin/end marker substring.
   */
  pure def applyData(st: SpecState, alphas: int, pads: int): SpecState =
    match st.progress {
      | Idle => { ...st, ghostPrevStores: st.ghostStores }
      | Collecting(c) => {
          ...st,
          progress: Collecting({
            ...c,
            collected: c.collected + alphas + pads,
            pads: padAfter(c.pads, alphas, pads)
          }),
          ghostAppends: st.ghostAppends.append(alphas + pads),
          ghostPadChars: st.ghostPadChars + pads,
          ghostPrevStores: st.ghostStores
        }
    }

  /**
   * A marker-free comment of n trimmed characters at least one of which is
   * outside the base64 alphabet and not '='. While collecting it is
   * appended like any other comment and dirties the block; while idle it is
   * ignored.
   *
   * Authority: none.
   * Library stance: library-invented — the implementation appends every
   * marker-free comment unconditionally; the base64 regex then rejects the
   * block at 'thumbnail end'.
   * Exclusions: garbage containing ';' (the comment text is cut at the next
   * semicolon upstream); garbage whose trimmed length differs from its fed
   * length.
   */
  pure def applyGarbage(st: SpecState, n: int): SpecState =
    match st.progress {
      | Idle => { ...st, ghostPrevStores: st.ghostStores }
      | Collecting(c) => {
          ...st,
          progress: Collecting({ ...c, collected: c.collected + n, dirty: true }),
          ghostAppends: st.ghostAppends.append(n),
          ghostGarbageHits: st.ghostGarbageHits + 1,
          ghostPrevStores: st.ghostStores
        }
    }

  /**
   * 'thumbnail end' — finalize when collecting: store under the header's
   * size key iff isStorable (a later block with the same key replaces the
   * earlier entry), clear the in-progress block either way. A no-op when
   * idle (end without begin).
   *
   * Authority: none.
   * Library stance: library-invented — pins the validity check (declared
   * length + base64 regex) and the size-keyed stored record, replacement
   * on key collision included.
   * Exclusions: a comment carrying both markers (the begin match wins
   * upstream and is a begin, never an end).
   */
  pure def applyEnd(st: SpecState): SpecState =
    match st.progress {
      | Idle => { ...st, ghostPrevStores: st.ghostStores }
      | Collecting(c) => {
          val ok = isStorable(c)
          {
            ...st,
            progress: Idle,
            stored: if (ok) storePut(st.stored, c.key, c.collected) else st.stored,
            ghostAppends: [],
            ghostPadChars: 0,
            ghostStores: st.ghostStores + (if (ok) 1 else 0),
            ghostPaddedStores: st.ghostPaddedStores + (if (ok and not(c.pads == NoPad)) 1 else 0),
            ghostOverwrites: st.ghostOverwrites + (if (ok and findKey(st.stored, c.key) >= 0) 1 else 0),
            ghostDrops: st.ghostDrops + (if (ok) 0 else 1),
            ghostPrevStores: st.ghostStores
          }
        }
    }

  /**
   * A non-comment G-code line: the collector only ever sees comments, so
   * the machine ignores it entirely, idle or collecting.
   *
   * Authority: none — model scaffolding for interleaving realism.
   * Library stance: library-invented — comment extraction upstream never
   * hands a command line to the collector.
   * Exclusions: the command's own semantics (owned by the interpreter
   * machine).
   */
  pure def applyNeutral(st: SpecState): SpecState = { ...st, ghostPrevStores: st.ghostStores }

  // --- actions ----------------------------------------------------------------

  action beginWith(hdr: HeaderKind): bool = all {
    ev' = evBegin(hdr),
    s' = applyBegin(s, hdr)
  }

  action dataWith(alphas: int, pads: int): bool = all {
    ev' = evData(alphas, pads),
    s' = applyData(s, alphas, pads)
  }

  action garbageWith(n: int): bool = all {
    ev' = evGarbage(n),
    s' = applyGarbage(s, n)
  }

  action endThumb = all {
    ev' = evEnd,
    s' = applyEnd(s)
  }

  action neutral = all {
    ev' = evNeutral,
    s' = applyNeutral(s)
  }

  /**
   * Start idle with nothing stored and every ghost at zero.
   *
   * Authority: none — model scaffolding.
   * Library stance: library-invented — mirrors a fresh Parser (no
   * in-progress thumbnail, an empty thumbnails record).
   * Exclusions: nothing carries over from a previous parse.
   */
  action init = all {
    ev' = EV_INIT,
    s' = {
      progress: Idle,
      stored: [],
      ghostAppends: [],
      ghostPadChars: 0,
      ghostStores: 0,
      ghostPaddedStores: 0,
      ghostOverwrites: 0,
      ghostDrops: 0,
      ghostDiscards: 0,
      ghostGarbageHits: 0,
      ghostPrevStores: 0
    }
  }

  // --- generation menus (weights live in data; see STYLE.md) -------------------

  /// Pixel dimensions, 16 weighted triple so same-key stores (and therefore
  /// stored-record replacement) happen at a measurable rate.
  pure val DIMS: List[int] = [16, 16, 16, 32, 48]

  /// Declared counts: multiples of 4 dominate (storable when matched), 6 and
  /// 11 pin the matched-but-not-multiple-of-4 ending, 0 pins the stored
  /// empty thumbnail.
  pure val COUNTS: List[int] = [0, 4, 4, 6, 8, 8, 8, 11, 12, 16]

  /// Free data-line shapes: alphabet run length and trailing pad run.
  type DataShape = { a: int, p: int }
  pure val DATA_MENU: List[DataShape] = [
    { a: 1, p: 0 }, { a: 2, p: 0 }, { a: 3, p: 0 }, { a: 4, p: 0 },
    { a: 4, p: 0 }, { a: 8, p: 0 }, { a: 3, p: 1 }, { a: 2, p: 2 },
    { a: 0, p: 1 }, { a: 0, p: 2 }
  ]

  /// Trimmed lengths of the replay's non-base64 garbage comments.
  pure val GARBAGE_LENS: List[int] = [3, 5, 9]

  /// Begin-header forms: well-formed headers dominate; each malformed form
  /// stays a steady presence.
  type HeaderTag = TFull | TNoCount | TBadDims | TEmpty
  pure val HEADER_MENU: List[HeaderTag] = [
    TFull, TFull, TFull, TFull, TFull, TFull, TFull,
    TNoCount, TBadDims, TEmpty
  ]

  /// Pad run used by the deficit-filling generator.
  pure val PAD_FILL_MENU: List[int] = [1, 2]

  /// Step kinds. SFill/SFillPad aim a data line exactly at the declared
  /// count's remaining deficit (SFillPad ends it with a pad run), so
  /// successful stores — padded ones included — occur at corpus-measurable
  /// rates instead of by seed luck; both fall back to a free data line when
  /// there is no deficit to aim at.
  type StepKind = SBegin | SData | SFill | SFillPad | SEnd | SGarbage | SNeutral
  pure val STEP_MENU: List[StepKind] = [
    SBegin, SBegin, SBegin,
    SData, SData, SData,
    SFill, SFill, SFill, SFill, SFill,
    SFillPad, SFillPad, SFillPad,
    SEnd, SEnd, SEnd, SEnd,
    SGarbage,
    SNeutral
  ]

  // --- nondeterministic generators ---------------------------------------------

  action anyBegin = {
    nondet t = HEADER_MENU.indices().oneOf()
    match HEADER_MENU[t] {
      | TFull => {
          nondet wi = DIMS.indices().oneOf()
          nondet hi = DIMS.indices().oneOf()
          nondet ci = COUNTS.indices().oneOf()
          beginWith(HFull({ w: DIMS[wi], h: DIMS[hi], cnt: COUNTS[ci] }))
        }
      | TNoCount => {
          nondet wi = DIMS.indices().oneOf()
          nondet hi = DIMS.indices().oneOf()
          beginWith(HNoCount({ w: DIMS[wi], h: DIMS[hi] }))
        }
      | TBadDims => {
          nondet ci = COUNTS.indices().oneOf()
          beginWith(HBadDims(COUNTS[ci]))
        }
      | TEmpty => beginWith(HEmpty)
    }
  }

  action anyData = {
    nondet di = DATA_MENU.indices().oneOf()
    dataWith(DATA_MENU[di].a, DATA_MENU[di].p)
  }

  action anyGarbage = {
    nondet gi = GARBAGE_LENS.indices().oneOf()
    garbageWith(GARBAGE_LENS[gi])
  }

  /// One data line sized to the remaining declared deficit (alphabet only).
  /// A block already sitting exactly on its declared count is closed instead
  /// of overfilled; without a positive deficit to aim at, a free data line.
  action fillExact =
    match s.progress {
      | Collecting(c) =>
        match c.decl {
          | Declared(n) =>
            if (n - c.collected >= 1) dataWith(n - c.collected, 0)
            else if (n == c.collected) endThumb
            else anyData
          | NoDecl => anyData
        }
      | Idle => anyData
    }

  /// One data line sized to the remaining declared deficit and ending with a
  /// pad run, so the padded base64 forms reach the stored record; the same
  /// close-on-match and free-data fallbacks as fillExact.
  action fillPadded =
    match s.progress {
      | Collecting(c) =>
        match c.decl {
          | Declared(n) => {
              val deficit = n - c.collected
              if (deficit >= 2) {
                nondet pi = PAD_FILL_MENU.indices().oneOf()
                dataWith(deficit - PAD_FILL_MENU[pi], PAD_FILL_MENU[pi])
              } else if (deficit == 1) dataWith(0, 1)
              else if (deficit == 0) endThumb
              else anyData
            }
          | NoDecl => anyData
        }
      | Idle => anyData
    }

  /// Always enabled (every event is total), so this machine has no stutter.
  action step = {
    nondet k = STEP_MENU.indices().oneOf()
    match STEP_MENU[k] {
      | SBegin => anyBegin
      | SData => anyData
      | SFill => fillExact
      | SFillPad => fillPadded
      | SEnd => endThumb
      | SGarbage => anyGarbage
      | SNeutral => neutral
    }
  }

  // --- invariants (over semantic state only; none mention `ev`) ----------------

  /// The collected count equals the sum of the per-line append log — an
  /// independent derivation, so a mis-transcribed append fails here; idle
  /// keeps the log empty.
  val appendLogExact =
    match s.progress {
      | Idle => s.ghostAppends == []
      | Collecting(c) => c.collected == sumList(s.ghostAppends)
    }

  /// The pad mode agrees with the independent '=' character count: each
  /// unbroken mode pins the exact count, and three or more pads force the
  /// broken mode; idle keeps the count at zero.
  val padGhostCoherent =
    match s.progress {
      | Idle => s.ghostPadChars == 0
      | Collecting(c) =>
        and {
          match c.pads {
            | NoPad => s.ghostPadChars == 0
            | OnePad => s.ghostPadChars == 1
            | TwoPad => s.ghostPadChars == 2
            | BrokenPad => true
          },
          s.ghostPadChars >= 3 implies c.pads == BrokenPad
        }
    }

  /// Conservation of the stored record: its size is exactly the stores that
  /// did not replace an existing key.
  val storedCountConservation = s.stored.length() == s.ghostStores - s.ghostOverwrites

  /// The stored record is a map: keys never repeat.
  val storedKeysUnique =
    s.stored.indices().forall(i =>
      s.stored.indices().forall(j => i == j or not(s.stored[i].key == s.stored[j].key)))

  /// Everything stored passed the validity check, so its length is a
  /// non-negative multiple of 4.
  val storedAreValid = s.stored.foldl(true, (acc, e) => acc and e.len >= 0 and e.len % 4 == 0)

  /// Only headers that declare a count can store, so the bare-begin key
  /// never reaches the stored record.
  val storedKeysDeclared =
    s.stored.foldl(true, (acc, e) => acc and (match e.key { | SizeEmpty => false | _ => true }))

  /// Temporal claim, checked: the store count never decreases, and grows by
  /// at most one per step.
  val storesMonotone =
    s.ghostStores >= s.ghostPrevStores and s.ghostStores - s.ghostPrevStores <= 1

  val paddedStoresBounded = s.ghostPaddedStores <= s.ghostStores

  // Deliberately NOT an invariant: collected <= declared. The collector
  // appends without a cap and only checks the length at 'thumbnail end', so
  // the collected count can legitimately exceed the declared count.
  val countersNonNegative = and {
    s.ghostPadChars >= 0,
    s.ghostStores >= 0,
    s.ghostPaddedStores >= 0,
    s.ghostOverwrites >= 0,
    s.ghostDrops >= 0,
    s.ghostDiscards >= 0,
    s.ghostGarbageHits >= 0,
    match s.progress { | Idle => true | Collecting(c) => c.collected >= 0 }
  }

  val allInvariants = and {
    appendLogExact,
    padGhostCoherent,
    storedCountConservation,
    storedKeysUnique,
    storedAreValid,
    storedKeysDeclared,
    storesMonotone,
    paddedStoresBounded,
    countersNonNegative
  }

  // --- semantic tests (run with:
  // ---   npx quint test verification/quint/thumbnail.qnt) ---

  /// begin, matching data, end: stored under its size key
  run happyPathTest =
    init
      .then(beginWith(HFull({ w: 16, h: 16, cnt: 8 })))
      .expect(s.progress == Collecting({
        key: SizeWH({ w: 16, h: 16 }), decl: Declared(8), collected: 0, pads: NoPad, dirty: false
      }))
      .then(dataWith(4, 0))
      .then(dataWith(4, 0))
      .expect(match s.progress { | Collecting(c) => c.collected == 8 and not(c.dirty) | Idle => false })
      .then(endThumb)
      .expect(and {
        s.progress == Idle,
        s.stored == [{ key: SizeWH({ w: 16, h: 16 }), len: 8 }],
        s.ghostStores == 1,
        s.ghostPaddedStores == 0
      })

  /// padded final quartets store: a '=' line completing 4k+3 alphabet chars,
  /// then a '==' tail completing 4k+2 — both reach the stored record
  run paddedFormsStoreTest =
    init
      .then(beginWith(HFull({ w: 16, h: 16, cnt: 8 })))
      .then(dataWith(7, 1))
      .expect(match s.progress { | Collecting(c) => c.pads == OnePad and c.collected == 8 | Idle => false })
      .then(endThumb)
      .expect(s.stored == [{ key: SizeWH({ w: 16, h: 16 }), len: 8 }] and s.ghostPaddedStores == 1)
      .then(beginWith(HFull({ w: 32, h: 32, cnt: 8 })))
      .then(dataWith(4, 0))
      .then(dataWith(2, 2))
      .expect(match s.progress { | Collecting(c) => c.pads == TwoPad and c.collected == 8 | Idle => false })
      .then(endThumb)
      .expect(and {
        s.stored == [
          { key: SizeWH({ w: 16, h: 16 }), len: 8 },
          { key: SizeWH({ w: 32, h: 32 }), len: 8 }
        ],
        s.ghostStores == 2,
        s.ghostPaddedStores == 2
      })

  /// alphabet characters after a pad break the base64 shape: the length
  /// matches and is a multiple of 4, yet the block is dropped
  run brokenPaddingDroppedTest =
    init
      .then(beginWith(HFull({ w: 16, h: 16, cnt: 8 })))
      .then(dataWith(3, 1))
      .then(dataWith(4, 0))
      .expect(match s.progress { | Collecting(c) => c.pads == BrokenPad and c.collected == 8 | Idle => false })
      .then(endThumb)
      .expect(s.stored == [] and s.ghostDrops == 1)

  /// three pads break the shape too ('=' line after a '==' tail)
  run threePadsDroppedTest =
    init
      .then(beginWith(HFull({ w: 16, h: 16, cnt: 8 })))
      .then(dataWith(5, 2))
      .then(dataWith(0, 1))
      .expect(match s.progress { | Collecting(c) => c.pads == BrokenPad and c.collected == 8 | Idle => false })
      .then(endThumb)
      .expect(s.stored == [] and s.ghostDrops == 1)

  /// collected != declared at end: dropped
  run countMismatchDropsTest =
    init
      .then(beginWith(HFull({ w: 16, h: 16, cnt: 8 })))
      .then(dataWith(4, 0))
      .then(endThumb)
      .expect(s.progress == Idle and s.stored == [] and s.ghostDrops == 1)

  /// a matching count that is not a multiple of 4 fails the base64 shape
  run nonMultipleOf4DroppedTest =
    init
      .then(beginWith(HFull({ w: 16, h: 16, cnt: 6 })))
      .then(dataWith(3, 0))
      .then(dataWith(3, 0))
      .expect(match s.progress { | Collecting(c) => c.collected == 6 and not(c.dirty) | Idle => false })
      .then(endThumb)
      .expect(s.stored == [] and s.ghostDrops == 1)

  /// a non-base64 comment inside the block is appended and dirties it, even
  /// when the final length matches the declared count
  run garbageCorruptsTest =
    init
      .then(beginWith(HFull({ w: 8, h: 8, cnt: 12 })))
      .then(dataWith(3, 0))
      .then(garbageWith(9))
      .expect(match s.progress { | Collecting(c) => c.collected == 12 and c.dirty | Idle => false })
      .then(endThumb)
      .expect(s.stored == [] and s.ghostGarbageHits == 1 and s.ghostDrops == 1)

  /// 'thumbnail end', data and garbage without a begin are ignored
  run idleIgnoresEverythingTest =
    init
      .then(endThumb)
      .expect(s.progress == Idle and s.stored == [] and s.ghostDrops == 0)
      .then(dataWith(4, 0))
      .then(garbageWith(5))
      .then(neutral)
      .expect(and {
        s.progress == Idle,
        s.ghostAppends == [],
        s.ghostGarbageHits == 0,
        s.stored == []
      })

  /// begin while collecting discards the first block and restarts
  run beginWhileCollectingTest =
    init
      .then(beginWith(HFull({ w: 16, h: 16, cnt: 8 })))
      .then(dataWith(4, 0))
      .then(beginWith(HFull({ w: 32, h: 32, cnt: 4 })))
      .expect(and {
        s.progress == Collecting({
          key: SizeWH({ w: 32, h: 32 }), decl: Declared(4), collected: 0, pads: NoPad, dirty: false
        }),
        s.ghostDiscards == 1
      })
      .then(dataWith(4, 0))
      .then(endThumb)
      .expect(s.stored == [{ key: SizeWH({ w: 32, h: 32 }), len: 4 }])

  /// stored thumbnails are keyed by size: a later one with the same key
  /// replaces the earlier entry
  run sameKeyReplacesTest =
    init
      .then(beginWith(HFull({ w: 16, h: 16, cnt: 4 })))
      .then(dataWith(4, 0))
      .then(endThumb)
      .expect(s.stored == [{ key: SizeWH({ w: 16, h: 16 }), len: 4 }])
      .then(beginWith(HFull({ w: 16, h: 16, cnt: 8 })))
      .then(dataWith(8, 0))
      .then(endThumb)
      .expect(and {
        s.stored == [{ key: SizeWH({ w: 16, h: 16 }), len: 8 }],
        s.ghostStores == 2,
        s.ghostOverwrites == 1
      })

  /// a header without a count carries an unmatchable declaration: the block
  /// collects but can never store
  run noCountNeverStoresTest =
    init
      .then(beginWith(HNoCount({ w: 16, h: 16 })))
      .expect(match s.progress { | Collecting(c) => c.decl == NoDecl | Idle => false })
      .then(dataWith(4, 0))
      .then(endThumb)
      .expect(s.stored == [] and s.ghostDrops == 1)

  /// a dimensionless size token with a count still stores, under that token
  run badDimsStoresTest =
    init
      .then(beginWith(HBadDims(4)))
      .expect(match s.progress { | Collecting(c) => c.key == SizeBad | Idle => false })
      .then(dataWith(4, 0))
      .then(endThumb)
      .expect(s.stored == [{ key: SizeBad, len: 4 }] and s.ghostStores == 1)

  /// a bare 'thumbnail begin' collects under the empty size token and never
  /// stores
  run emptyHeaderNeverStoresTest =
    init
      .then(beginWith(HEmpty))
      .expect(s.progress == Collecting({
        key: SizeEmpty, decl: NoDecl, collected: 0, pads: NoPad, dirty: false
      }))
      .then(dataWith(8, 0))
      .then(endThumb)
      .expect(s.stored == [] and s.ghostDrops == 1)

  /// a declared count of 0 with no data lines is valid and stored
  run emptyThumbnailStoredTest =
    init
      .then(beginWith(HFull({ w: 16, h: 16, cnt: 0 })))
      .then(endThumb)
      .expect(s.stored == [{ key: SizeWH({ w: 16, h: 16 }), len: 0 }])

  /// data may overshoot the declared count (no cap); the block drops at end
  run oversizeAccumulatesTest =
    init
      .then(beginWith(HFull({ w: 8, h: 8, cnt: 4 })))
      .then(dataWith(8, 0))
      .expect(match s.progress { | Collecting(c) => c.collected == 8 | Idle => false })
      .then(endThumb)
      .expect(s.stored == [] and s.ghostDrops == 1)
}
