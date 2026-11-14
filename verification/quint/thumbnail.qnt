// -*- mode: Bluespec; -*-
/**
 * Formal specification of the embedded-thumbnail comment protocol.
 *
 * Models the online state machine in Parser.parseMetadata
 * (src/parser/gcode-parser.ts) together with Thumbnail.isValid
 * (src/thumbnail.ts), exactly as implemented:
 *
 *   - 'thumbnail begin WxH N' always starts a fresh in-progress thumbnail,
 *     even while one is already collecting (the old one is discarded).
 *   - While collecting, EVERY comment without a begin/end marker is appended
 *     verbatim to the in-progress chars; there is no cap, so the collected
 *     count may exceed the declared count.
 *   - 'thumbnail end' finalizes: the thumbnail is stored only when
 *     chars.length == charLength and the chars match the base64 regex;
 *     either way the in-progress thumbnail is cleared.
 *   - 'thumbnail end' without a begin, and any comment while idle, do nothing.
 *   - Completed thumbnails are keyed by their size string "WxH", so a later
 *     thumbnail with the same dimensions overwrites the earlier one. The spec
 *     keys the stored map by the (width, height) pair, which is the same key.
 *
 * Filler convention (shared with the replay harness): every data line is N
 * copies of one base64-alphabet character with no '=' padding, and every
 * garbage line is the fixed 9-char non-base64 comment '*garbage*'. Under that
 * convention the real base64 regex accepts the collected chars iff no garbage
 * was appended and the total length is a multiple of 4, so validity is modeled
 * as: collected == expected AND collected % 4 == 0 AND clean.
 *
 * All counters are plain integers (character counts and pixel dimensions);
 * no scaling is needed.
 *
 * The cmd/evWidth/evHeight/evCount/evN variables record WHICH event was taken
 * on each step, so an ITF trace of this spec doubles as a comment stream: a
 * replay harness can rebuild each line (e.g. '; thumbnail begin 16x16 8'),
 * feed it to the real Parser, and compare the machine's observable state.
 */
module thumbnail {
  // --- trace-contract variables: the event taken on this step ---
  var cmd: str // "init" | "begin" | "data" | "end" | "garbage" | "neutral" | "stutter"
  var evWidth: int // begin: width in pixels (0 otherwise)
  var evHeight: int // begin: height in pixels (0 otherwise)
  var evCount: int // begin: declared base64 char count (0 otherwise)
  var evN: int // data: number of filler chars on the line (0 otherwise)

  // --- trace-contract variables: machine state ---
  var phase: str // "idle" | "collecting" (Parser.thumb undefined / set)
  var width: int // in-progress thumbnail width (0 while idle)
  var height: int // in-progress thumbnail height (0 while idle)
  var expected: int // in-progress declared char count (0 while idle)
  var collected: int // chars accumulated so far (0 while idle)
  var clean: bool // all collected chars are from the base64 alphabet
  var stored: (int, int) -> int // completed thumbnails: (w, h) -> char length

  // Event domains: small sets keep the traces readable while still covering
  // match, mismatch, oversize and regex-failure (count not a multiple of 4).
  pure val Dims: Set[int] = Set(8, 16, 32, 48)
  pure val Counts: Set[int] = Set(0, 4, 6, 8, 12)
  pure val DataNs: Set[int] = Set(3, 4, 8)

  /// Length of the fixed garbage comment the replay feeds ('*garbage*')
  pure val GarbageLen: int = 9

  // --- bookkeeping helpers ---

  /// Record which event (and which parameters) this step takes
  action recordEvent(c: str, w: int, h: int, cnt: int, n: int): bool = all {
    cmd' = c,
    evWidth' = w,
    evHeight' = h,
    evCount' = cnt,
    evN' = n
  }

  action keepProgress = all {
    phase' = phase,
    width' = width,
    height' = height,
    expected' = expected,
    collected' = collected,
    clean' = clean
  }
  action keepStored = stored' = stored

  // --- one action per event ---

  /// 'thumbnail begin WxH N' — unconditionally replaces the in-progress
  /// thumbnail (gcode-parser.ts: the begin branch never checks this.thumb)
  action beginWith(w: int, h: int, cnt: int): bool = all {
    recordEvent("begin", w, h, cnt, 0),
    phase' = "collecting",
    width' = w,
    height' = h,
    expected' = cnt,
    collected' = 0,
    clean' = true,
    keepStored
  }

  /// A comment of n base64-alphabet filler chars. While collecting it is
  /// appended (no cap); while idle the machine ignores it.
  action dataWith(n: int): bool = all {
    recordEvent("data", 0, 0, 0, n),
    if (phase == "collecting") all {
      collected' = collected + n,
      phase' = phase,
      width' = width,
      height' = height,
      expected' = expected,
      clean' = clean
    } else keepProgress,
    keepStored
  }

  /// Any other comment line (no begin/end marker, not base64). While
  /// collecting the real machine appends it verbatim, poisoning the base64
  /// regex for this thumbnail; while idle it is ignored.
  action garbage = all {
    recordEvent("garbage", 0, 0, 0, 0),
    if (phase == "collecting") all {
      collected' = collected + GarbageLen,
      clean' = false,
      phase' = phase,
      width' = width,
      height' = height,
      expected' = expected
    } else keepProgress,
    keepStored
  }

  /// A non-comment G-code line: filtered out before parseMetadata ever runs
  action neutral = all {
    recordEvent("neutral", 0, 0, 0, 0),
    keepProgress,
    keepStored
  }

  /// 'thumbnail end' — finalize when collecting (store iff valid under the
  /// filler convention), no-op when idle (end without begin)
  action endThumb = all {
    recordEvent("end", 0, 0, 0, 0),
    if (phase == "collecting") all {
      stored' =
        if (collected == expected and collected % 4 == 0 and clean)
          stored.put((width, height), collected)
        else stored,
      phase' = "idle",
      width' = 0,
      height' = 0,
      expected' = 0,
      collected' = 0,
      clean' = true
    } else all {
      keepProgress,
      keepStored
    }
  }

  /// Explicit stutter so step is always enabled; the replay skips these
  /// steps without feeding any input line.
  action stutter = all {
    recordEvent("stutter", 0, 0, 0, 0),
    keepProgress,
    keepStored
  }

  // --- nondeterministic wrappers for simulation ---

  action anyBegin = {
    nondet w = Dims.oneOf()
    nondet h = Dims.oneOf()
    nondet cnt = Counts.oneOf()
    beginWith(w, h, cnt)
  }

  action anyData = {
    nondet n = DataNs.oneOf()
    dataWith(n)
  }

  // --- init and step ---

  action init = all {
    cmd' = "init",
    evWidth' = 0,
    evHeight' = 0,
    evCount' = 0,
    evN' = 0,
    phase' = "idle",
    width' = 0,
    height' = 0,
    expected' = 0,
    collected' = 0,
    clean' = true,
    stored' = Map()
  }

  /// Weighted event pick: data 50%, begin 20%, end 15%, the rest shares the
  /// remainder, so traces open blocks, fill them, and close them often.
  action step = {
    nondet choice = 1.to(20).oneOf()
    if (choice <= 4) anyBegin
    else if (choice <= 14) anyData
    else if (choice <= 17) endThumb
    else if (choice <= 18) garbage
    else if (choice <= 19) neutral
    else stutter
  }

  // --- invariants ---

  val phaseWellFormed = phase == "idle" or phase == "collecting"

  /// Idle keeps the normalized empty in-progress state
  val idleIsReset =
    (phase == "idle") implies
      and { width == 0, height == 0, expected == 0, collected == 0, clean }

  // Deliberately NOT an invariant: collected <= expected. The source appends
  // without a cap and only checks the length at 'thumbnail end', so the
  // collected count can legitimately exceed the declared count.
  val countersNonNegative = expected >= 0 and collected >= 0

  /// Everything stored passed the validity check, so its length is a
  /// non-negative multiple of 4
  val storedAreValid =
    stored.keys().forall(k => stored.get(k) >= 0 and stored.get(k) % 4 == 0)

  val allInvariants = and { phaseWellFormed, idleIsReset, countersNonNegative, storedAreValid }

  // --- semantic tests (run with: npx quint test verification/quint/thumbnail.qnt) ---

  /// begin, matching data, end: the thumbnail is stored under its dimensions
  run happyPathTest =
    init
      .then(beginWith(16, 16, 8))
      .expect(phase == "collecting" and expected == 8 and collected == 0)
      .then(dataWith(4))
      .then(dataWith(4))
      .expect(collected == 8 and clean)
      .then(endThumb)
      .expect(and {
        phase == "idle",
        stored.keys() == Set((16, 16)),
        stored.get((16, 16)) == 8
      })

  /// collected != declared count at end: the thumbnail is dropped
  run countMismatchTest =
    init
      .then(beginWith(16, 16, 8))
      .then(dataWith(4))
      .then(endThumb)
      .expect(phase == "idle" and stored.keys().size() == 0)

  /// 'thumbnail end' and data without a begin are ignored
  run endWithoutBeginTest =
    init
      .then(endThumb)
      .expect(phase == "idle" and stored.keys().size() == 0)
      .then(dataWith(4))
      .expect(phase == "idle" and collected == 0 and stored.keys().size() == 0)

  /// begin while collecting discards the first block and restarts
  run beginWhileCollectingTest =
    init
      .then(beginWith(16, 16, 8))
      .then(dataWith(4))
      .expect(collected == 4)
      .then(beginWith(32, 32, 4))
      .expect(phase == "collecting" and collected == 0 and expected == 4 and width == 32)
      .then(dataWith(4))
      .then(endThumb)
      .expect(stored.keys() == Set((32, 32)) and stored.get((32, 32)) == 4)

  /// a non-base64 comment inside the block is appended and poisons the
  /// base64 check, even when the final length matches the declared count
  run garbageCorruptsTest =
    init
      .then(beginWith(8, 8, 12))
      .then(dataWith(3))
      .then(garbage)
      .expect(collected == 12 and not(clean))
      .then(endThumb)
      .expect(phase == "idle" and stored.keys().size() == 0)

  /// data may overshoot the declared count (no cap); the block is dropped at end
  run oversizeAccumulatesTest =
    init
      .then(beginWith(8, 8, 4))
      .then(dataWith(8))
      .expect(phase == "collecting" and collected == 8 and expected == 4)
      .then(endThumb)
      .expect(stored.keys().size() == 0)

  /// thumbnails are keyed by size, so a later one with the same dimensions
  /// overwrites the earlier one
  run sameSizeOverwritesTest =
    init
      .then(beginWith(16, 16, 4))
      .then(dataWith(4))
      .then(endThumb)
      .expect(stored.get((16, 16)) == 4)
      .then(beginWith(16, 16, 8))
      .then(dataWith(8))
      .then(endThumb)
      .expect(stored.keys().size() == 1 and stored.get((16, 16)) == 8)

  /// a declared count of 0 with no data lines is valid and stored
  run emptyThumbnailStoredTest =
    init
      .then(beginWith(16, 16, 0))
      .then(endThumb)
      .expect(stored.keys() == Set((16, 16)) and stored.get((16, 16)) == 0)

  /// a matching count that is not a multiple of 4 fails the base64 regex
  run nonMultipleOf4DroppedTest =
    init
      .then(beginWith(16, 16, 6))
      .then(dataWith(3))
      .then(dataWith(3))
      .expect(collected == 6 and clean)
      .then(endThumb)
      .expect(stored.keys().size() == 0)
}
