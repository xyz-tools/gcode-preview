// -*- mode: Bluespec; -*-
/**
 * layer_indexer — the v2 layer-indexing state machine. Models how a print
 * job groups paths into layers while G-code arrives chunk by chunk, one
 * move line or one slicer layer-comment block per step: the
 * indexing-strategy lock (tolerance fallback until the first path sorted
 * after slicer layer metadata exists, metadata mode forever after, with
 * adoption rewriting the fallback-made layers), the monotone metadata
 * layer pointer, tolerance-based layer creation in fallback mode, the
 * non-planar collapse that empties the layer array and removes the layer
 * indexer for good, and — new in v2 — the full layer partition: a
 * per-layer resident-path count, maintained through the chunk-boundary
 * resume that removes the last path from the newest layer and the re-sort
 * that files it again.
 *
 * All lengths are integers in centi-millimeters (lib/scale.qnt). Event
 * words carry whole millimeters, so the real tolerances (0.05 mm fallback
 * break, 0.01 mm metadata z-match) stay exact under integer comparison.
 *
 * State shape (the v2 trace contract): exactly two variables. `s` is the
 * semantic machine state as one record, advanced only by pure transition
 * functions (`applyMove`, `applyComment`); `ev` is the event record in
 * plain strings/ints/bools, so an ITF trace doubles as an input program a
 * replay feeds chunk-by-chunk through the real parse-and-execute pipeline.
 * The replay compares, after every step: the whole partition
 * (`s.layers[i].z/h/n` against the job's layers and their path counts),
 * the parser-side accumulated layer metadata (`s.meta`), the job's path
 * count (`s.pathsCount`), and the layer index recorded on the job's last
 * path (`s.last.idx`), so negative outcomes assert something real.
 *
 * Unit: JL-2 (layer-indexing state machines: strategy lock, non-planar
 *   collapse, metadata-mode membership bounds), the layer-membership slice
 *   of JL-1 (every finished path's layerIndex back-pointer), and the
 *   layer-comment slices of PA-5 (PrusaSlicer block grammar, height
 *   derivation) and PA-6 (cross-chunk accumulation, positional layer
 *   numbering) in .context/formal-verification/mapping-data.json.
 * Authority policy: verification/quint/STYLE.md ("Authority
 *   annotations"). No firmware governs layer bookkeeping; every clause
 *   here is library machinery or a slicer comment dialect, so the blocks
 *   below are mostly library-invented with named exclusions.
 * Companion: layer-indexer.md.
 */
module layer_indexer {
  import scale.* from "./lib/scale"

  // --- sum types (strings exist only inside `ev`, derived below) ---------

  /// Type of a finished path, as the layer indexer sees it
  type PathKind = PNone | PTravel | PExtrusion

  /// The event kinds the generator can take
  type EvKind = EInit | ETravel | EExtrude | EExtrudeUp | ELayerComment

  /// What the step's final sort did to the step's path:
  /// - OFiled:    a layer received the path (ev.assigned says which)
  /// - ODropped:  a sort ran and no layer received the path
  /// - OCollapse: the sort collapsed the layer index (non-planar extrusion)
  /// - ONoSort:   no layer sort ran at all (no finished path to re-file,
  ///   or the indexer is gone after a collapse)
  type Outcome = OFiled | ODropped | OCollapse | ONoSort

  pure def kindStr(k: EvKind): str = match k {
    | EInit => "init"
    | ETravel => "travel"
    | EExtrude => "extrude"
    | EExtrudeUp => "extrudeup"
    | ELayerComment => "layercomment"
  }

  pure def outcomeStr(o: Outcome): str = match o {
    | OFiled => "filed"
    | ODropped => "dropped"
    | OCollapse => "collapse"
    | ONoSort => "nosort"
  }

  /// The path type a move event produces (extrude and extrudeup both lay
  /// down material; the comment and init kinds never reach this map)
  pure def moveKindOf(k: EvKind): PathKind = match k {
    | ETravel => PTravel
    | EExtrude => PExtrusion
    | EExtrudeUp => PExtrusion
    | EInit => PNone
    | ELayerComment => PNone
  }

  // --- state records ------------------------------------------------------

  /// One accumulated slicer layer entry (hz/hh say whether z/h were stored)
  type MetaEntry = { hz: bool, z: int, hh: bool, h: int }

  /// One job layer: its z and height (centi-mm) and `n`, the number of
  /// path entries resident in its paths array. `n` counts entries, not
  /// distinct paths: the chunk-boundary resume removes the last path only
  /// from the NEWEST layer, so a path re-filed into an older layer gains
  /// an additional residence entry there each chunk (pinned behavior the
  /// replay verifies against the real arrays).
  type LayerRec = { z: int, h: int, n: int }

  /// The job's last finished path: its type, seed z (the z its first
  /// point was laid at, which is what layer filing reads), the line height
  /// it was created with (-1 = undeclared), and `idx`, the layer index
  /// currently recorded on it (-1 = none was ever recorded; the value is
  /// sticky, surviving drops, no-sort steps and even the collapse).
  type LastPath = { kind: PathKind, z: int, h: int, idx: int }

  /// Previous-step values frozen for the monotonicity ghost invariants
  type GhostPrev = {
    pointer: int,
    locked: bool,
    collapsed: bool,
    metaLen: int,
    layerCount: int,
    pathsCount: int
  }

  /// The semantic state. `occ` is the live path's residence count per
  /// layer (ghost-grade bookkeeping the resume/removal step needs; the
  /// replay never decodes it). `ghostEntries` is the partition
  /// conservation counter: filings minus newest-layer removals, counted
  /// from step outcomes independently of the per-layer `n` updates.
  type SpecState = {
    locked: bool,
    collapsed: bool,
    layers: List[LayerRec],
    occ: List[int],
    meta: List[MetaEntry],
    pointer: int,
    curZ: int,
    stateH: int,
    last: LastPath,
    pathsCount: int,
    ghostEntries: int,
    ghostPrev: GhostPrev
  }

  /// The trace contract: which event this step took (with its whole-mm
  /// words, so the replay can rebuild the exact chunk) and what the sort
  /// did (`outcome`, `assigned`). Strings are derived from the sum types
  /// in one place each (kindStr, outcomeStr).
  type Event = {
    kind: str,
    hasZ: bool, z: int,
    hasH: bool, h: int,
    outcome: str,
    assigned: int
  }

  var s: SpecState
  var ev: Event

  // --- constants ----------------------------------------------------------

  /// Word domains (whole millimeters)
  pure val Z_WORDS: Set[int] = 0.to(6)
  pure val H_WORDS: Set[int] = 1.to(3)

  /// Fallback-mode layer-break tolerance: 0.05 mm
  pure val FALLBACK_TOL: int = 5
  /// Metadata-mode z-match tolerance: 0.01 mm
  pure val Z_MATCH_TOL: int = 1
  /// Default layer height when metadata declares none: 0.2 mm
  pure val DEFAULT_H: int = 20

  // --- pure sort machinery ------------------------------------------------

  /// Metadata-mode target lookup: forward scan from the pointer; an entry
  /// without a stored z reads the z its layer was pinned with, and claims
  /// the path outright when no such layer exists yet. -1 = above
  /// everything known.
  pure def findTarget(pz: int, start: int, meta: List[MetaEntry], layers: List[LayerRec]): int =
    range(start, meta.length()).foldl(-1, (acc, i) =>
      if (acc >= 0) acc
      else if (not(meta[i].hz) and i >= layers.length()) i
      else {
        val zi = if (meta[i].hz) meta[i].z else layers[i].z
        if (pz <= zi + Z_MATCH_TOL) i else -1
      })

  /// Materialize metadata layers (with zero residents) up to and including
  /// the target, keeping `occ` aligned
  pure def ensureUpTo(target: int, pz: int, meta: List[MetaEntry],
      layers: List[LayerRec], occ: List[int]): (List[LayerRec], List[int]) =
    range(layers.length(), target + 1).foldl((layers, occ), (acc, k) =>
      (acc._1.append({
        z: if (meta[k].hz) meta[k].z else pz,
        h: if (meta[k].hh) meta[k].h else DEFAULT_H,
        n: 0
      }),
        acc._2.append(0)))

  /// Adoption: stored z/height replace the observed values on the layers
  /// the fallback made before the metadata arrived (prefix only; resident
  /// counts are untouched)
  pure def adoptLayers(meta: List[MetaEntry], layers: List[LayerRec]): List[LayerRec] = {
    val bound = if (meta.length() < layers.length()) meta.length() else layers.length()
    range(0, bound).foldl(layers, (acc, i) =>
      acc.replaceAt(i, {
        z: if (meta[i].hz) meta[i].z else acc[i].z,
        h: if (meta[i].hh) meta[i].h else acc[i].h,
        n: acc[i].n
      }))
  }

  /// File one path entry into layer t: the layer's resident count and the
  /// live path's residence count both grow
  pure def fileInto(t: int, layers: List[LayerRec], occ: List[int]): (List[LayerRec], List[int]) =
    (layers.replaceAt(t, { ...layers[t], n: layers[t].n + 1 }),
      occ.replaceAt(t, occ[t] + 1))

  /// A residence list of zeros aligned with `layers` (a fresh path has no
  /// residences yet)
  pure def zerosLike(layers: List[LayerRec]): List[int] =
    layers.foldl(List(), (acc, _) => acc.append(0))

  type SortResult = { layers: List[LayerRec], occ: List[int], ptr: int, lk: bool, asg: int }

  /**
   * One filing of a planar path: lock-and-adopt when metadata exists and
   * the strategy is still unset, then metadata-mode or fallback filing.
   * The non-planar case is handled by the calling transition.
   *
   * Authority: none — layer grouping is a viewer feature with no firmware
   * or G-code-standard counterpart.
   * Library stance: library-invented — pins the decisions: travels never
   * open a layer (they join the newest one or are dropped); the strategy
   * locks to metadata on the first sort with any metadata present, even a
   * sort that then drops the path; the fallback opens a layer only for an
   * extrusion more than 0.05 mm ABOVE the newest one (lower z silently
   * joins it); metadata matching is a forward scan from the monotone
   * pointer with a 0.01 mm ceiling; a path above everything known joins
   * the newest layer, bootstrapping one (default 0.2 mm height) when none
   * exist; an entry with no stored z claims the path outright when its
   * layer does not exist yet and is pinned by that first path's z.
   * Exclusions: the tolerance is the default (a Job built with a custom
   * minLayerThreshold is out of model); explicit slicer layer indices
   * (Bambu/Orca ;LAYER:n) are not generated.
   */
  pure def sortPath(ty: PathKind, pz: int, meta: List[MetaEntry], lk0: bool,
      layers0: List[LayerRec], occ0: List[int], ptr0: int): SortResult = {
    val willLock = not(lk0) and meta.length() > 0
    val layersA = if (willLock) adoptLayers(meta, layers0) else layers0
    val lk = lk0 or willLock
    if (ty == PTravel) {
      if (layersA.length() == 0)
        { layers: layersA, occ: occ0, ptr: ptr0, lk: lk, asg: -1 }
      else {
        val filed = fileInto(layersA.length() - 1, layersA, occ0)
        { layers: filed._1, occ: filed._2, ptr: ptr0, lk: lk, asg: layersA.length() - 1 }
      }
    } else if (lk) {
      val target = findTarget(pz, ptr0, meta, layersA)
      if (target < 0) {
        // above everything the metadata describes: keep it in the newest
        // layer, bootstrapping one when none exist; the pointer stays put
        if (layersA.length() == 0) {
          val filed = fileInto(0, layersA.append({ z: pz, h: DEFAULT_H, n: 0 }), occ0.append(0))
          { layers: filed._1, occ: filed._2, ptr: ptr0, lk: lk, asg: 0 }
        } else {
          val filed = fileInto(layersA.length() - 1, layersA, occ0)
          { layers: filed._1, occ: filed._2, ptr: ptr0, lk: lk, asg: layersA.length() - 1 }
        }
      } else {
        val grown = ensureUpTo(target, pz, meta, layersA, occ0)
        val filed = fileInto(target, grown._1, grown._2)
        { layers: filed._1, occ: filed._2, ptr: target, lk: lk, asg: target }
      }
    } else {
      // fallback mode
      if (layersA.length() == 0) {
        val filed = fileInto(0, layersA.append({ z: pz, h: pz, n: 0 }), occ0.append(0))
        { layers: filed._1, occ: filed._2, ptr: ptr0, lk: lk, asg: 0 }
      } else {
        val lastZ = layersA[layersA.length() - 1].z
        if (pz - lastZ > FALLBACK_TOL) {
          val filed = fileInto(layersA.length(), layersA.append({ z: pz, h: pz - lastZ, n: 0 }), occ0.append(0))
          { layers: filed._1, occ: filed._2, ptr: ptr0, lk: lk, asg: layersA.length() }
        } else {
          val filed = fileInto(layersA.length() - 1, layersA, occ0)
          { layers: filed._1, occ: filed._2, ptr: ptr0, lk: lk, asg: layersA.length() - 1 }
        }
      }
    }
  }

  /**
   * The chunk-boundary resume's index removal: the popped last path is
   * removed from the NEWEST layer's paths array when (and only when) it
   * has a residence there. A residence in any older layer is not touched.
   *
   * Authority: none — chunk-resume bookkeeping is host-library machinery.
   * Library stance: library-invented — pins that the removal looks at the
   * newest layer only, which is what lets a path re-filed into an older
   * layer accumulate residence entries there across chunk boundaries.
   * Exclusions: the travel/extrusion and per-tool index removals that
   * happen alongside (those partitions are out of this machine).
   */
  pure def resumeRemove(layers: List[LayerRec], occ: List[int]): (List[LayerRec], List[int], bool) =
    if (layers.length() == 0) (layers, occ, false)
    else {
      val li = layers.length() - 1
      if (occ[li] > 0)
        (layers.replaceAt(li, { ...layers[li], n: layers[li].n - 1 }),
          occ.replaceAt(li, occ[li] - 1),
          true)
      else (layers, occ, false)
    }

  // --- pure step transitions ----------------------------------------------

  type StepOut = { st: SpecState, out: Outcome, asg: int }

  /// Previous-step values for the monotonicity ghosts, frozen by every step
  pure def freezeGhost(st: SpecState): GhostPrev = {
    pointer: st.pointer,
    locked: st.locked,
    collapsed: st.collapsed,
    metaLen: st.meta.length(),
    layerCount: st.layers.length(),
    pathsCount: st.pathsCount
  }

  /**
   * One replayed move line (G0/G1), parsed and executed as its own chunk.
   * The chunk boundary first resumes the last finished path (removing its
   * newest-layer residence). The path continues only while its type and
   * creation line height still match the state; a continued path keeps its
   * seed z, which is what filing reads. A broken path is re-sorted at the
   * break, and the fresh path (seeded at the pre-move z) is sorted at the
   * chunk's end. An extrusion whose destination z differs from the current
   * z makes the path non-planar: with no metadata and no lock that
   * collapses the layer index for good (the layer array empties and the
   * indexer is removed); in metadata mode it is filed by seed z without
   * complaint.
   *
   * Authority: none — moves' printer-state semantics live in the
   * interpreter machine; this machine consumes only their z effect.
   * Library stance: library-invented — pins: resume-then-re-sort at every
   * chunk boundary; path continuation decided by type + line height (the
   * replay holds width and tool constant); the layer index recorded on a
   * path is sticky (drops, no-sorts and the collapse leave it in place);
   * the collapse never fires once metadata exists, because the lock is
   * taken before the planarity check would run.
   * Exclusions: extrusion-width and tool-change path breaks (words not
   * generated); multiple moves per chunk; relative extrusion (the replay
   * drives absolute, strictly growing E words so every E move extrudes).
   */
  pure def applyMove(st: SpecState, ty: PathKind, hasZw: bool, zwMm: int): StepOut = {
    val zTarget = if (hasZw) mmToCenti(zwMm) else st.curZ
    val hasP = st.pathsCount > 0
    val merged = hasP and st.last.kind == ty and st.last.h == st.stateH
    val wouldCollapse = and {
      ty == PExtrusion,
      zTarget != st.curZ,
      not(st.locked),
      st.meta.length() == 0,
      not(st.collapsed)
    }
    val rem = if (hasP) resumeRemove(st.layers, st.occ) else (st.layers, st.occ, false)
    val removed = if (rem._3) 1 else 0
    if (st.collapsed) {
      // the layer indexer is gone: paths still break and continue, but no
      // sort ever reaches the layer partition again
      val st1 = {
        ...st,
        curZ: zTarget,
        last: if (merged) st.last else { kind: ty, z: st.curZ, h: st.stateH, idx: -1 },
        pathsCount: if (merged) st.pathsCount else st.pathsCount + 1,
        ghostPrev: freezeGhost(st)
      }
      { st: st1, out: ONoSort, asg: -1 }
    } else if (merged) {
      if (wouldCollapse) {
        val st1 = {
          ...st,
          collapsed: true,
          layers: List(),
          occ: List(),
          curZ: zTarget,
          ghostEntries: 0,
          ghostPrev: freezeGhost(st)
        }
        { st: st1, out: OCollapse, asg: -1 }
      } else {
        val r = sortPath(ty, st.last.z, st.meta, st.locked, rem._1, rem._2, st.pointer)
        val st1 = {
          ...st,
          locked: r.lk,
          layers: r.layers,
          occ: r.occ,
          pointer: r.ptr,
          curZ: zTarget,
          last: { ...st.last, idx: if (r.asg >= 0) r.asg else st.last.idx },
          ghostEntries: st.ghostEntries - removed + (if (r.asg >= 0) 1 else 0),
          ghostPrev: freezeGhost(st)
        }
        { st: st1, out: if (r.asg >= 0) OFiled else ODropped, asg: r.asg }
      }
    } else {
      // the path breaks: the old path is re-sorted at the break, then the
      // fresh path (seeded at the pre-move position) is sorted at the end
      val r1 =
        if (hasP)
          sortPath(st.last.kind, st.last.z, st.meta, st.locked, rem._1, rem._2, st.pointer)
        else
          { layers: rem._1, occ: rem._2, ptr: st.pointer, lk: st.locked, asg: -1 }
      val filed1 = if (r1.asg >= 0) 1 else 0
      if (wouldCollapse) {
        val st1 = {
          ...st,
          collapsed: true,
          layers: List(),
          occ: List(),
          curZ: zTarget,
          last: { kind: ty, z: st.curZ, h: st.stateH, idx: -1 },
          pathsCount: st.pathsCount + 1,
          ghostEntries: 0,
          ghostPrev: freezeGhost(st)
        }
        { st: st1, out: OCollapse, asg: -1 }
      } else {
        val r2 = sortPath(ty, st.curZ, st.meta, r1.lk, r1.layers, zerosLike(r1.layers), r1.ptr)
        val st1 = {
          ...st,
          locked: r2.lk,
          layers: r2.layers,
          occ: r2.occ,
          pointer: r2.ptr,
          curZ: zTarget,
          last: { kind: ty, z: st.curZ, h: st.stateH, idx: if (r2.asg >= 0) r2.asg else -1 },
          pathsCount: st.pathsCount + 1,
          ghostEntries: st.ghostEntries - removed + filed1 + (if (r2.asg >= 0) 1 else 0),
          ghostPrev: freezeGhost(st)
        }
        { st: st1, out: if (r2.asg >= 0) OFiled else ODropped, asg: r2.asg }
      }
    }
  }

  /**
   * One PrusaSlicer-style layer-comment block (;LAYER_CHANGE [;Z:n]
   * [;HEIGHT:n]) parsed and executed as its own chunk. The parser appends
   * one accumulated metadata entry; because every block is its own chunk,
   * the accumulator's first-layer-of-chunk height derivation applies to
   * every entry: a stored z with no HEIGHT line gets the z difference to
   * the previous entry's stored z, when both exist. A HEIGHT line doubles
   * as an extrusion-dimension event that updates the declared line height
   * before the chunk's end. Executing the chunk resumes and re-files the
   * last finished path, and THAT re-sort is what locks the strategy to
   * metadata (adopting the fallback-made layers) when it is still unset.
   *
   * Authority: none — the LAYER_CHANGE dialect is PrusaSlicer-family
   * convention, not a firmware or G-code standard.
   * Library stance: library-invented — pins: entries accumulate across
   * chunks in one growing array (its identity never changes, so the
   * metadata pointer is never rewound); positional layer numbering
   * continues from the entries gathered so far; the derived height may be
   * zero or negative when z regresses; entries keep accumulating after a
   * collapse but never sort anything again.
   * Exclusions: blocks split across chunk boundaries; ;LAYER:n explicit
   * indices; ;WIDTH: dimension comments; non-numeric Z/HEIGHT payloads
   * (the parser rejects them; the generator emits only well-formed words).
   */
  pure def applyComment(st: SpecState, hz: bool, zwMm: int, hh: bool, hwMm: int): StepOut = {
    val mlen = st.meta.length()
    val derived = mlen > 0 and hz and not(hh) and st.meta[mlen - 1].hz
    val entry = {
      hz: hz,
      z: mmToCenti(zwMm),
      hh: hh or derived,
      h: if (derived) mmToCenti(zwMm) - st.meta[mlen - 1].z else mmToCenti(hwMm)
    }
    val meta1 = st.meta.append(entry)
    val stateH1 = if (hh) mmToCenti(hwMm) else st.stateH
    val hasP = st.pathsCount > 0
    if (st.collapsed or not(hasP)) {
      val st1 = { ...st, meta: meta1, stateH: stateH1, ghostPrev: freezeGhost(st) }
      { st: st1, out: ONoSort, asg: -1 }
    } else {
      val rem = resumeRemove(st.layers, st.occ)
      val removed = if (rem._3) 1 else 0
      val r = sortPath(st.last.kind, st.last.z, meta1, st.locked, rem._1, rem._2, st.pointer)
      val st1 = {
        ...st,
        locked: r.lk,
        layers: r.layers,
        occ: r.occ,
        meta: meta1,
        pointer: r.ptr,
        stateH: stateH1,
        last: { ...st.last, idx: if (r.asg >= 0) r.asg else st.last.idx },
        ghostEntries: st.ghostEntries - removed + (if (r.asg >= 0) 1 else 0),
        ghostPrev: freezeGhost(st)
      }
      { st: st1, out: if (r.asg >= 0) OFiled else ODropped, asg: r.asg }
    }
  }

  // --- actions ------------------------------------------------------------

  action recordAndApply(k: EvKind, hz: bool, zw: int, hh: bool, hw: int, r: StepOut): bool = all {
    ev' = { kind: kindStr(k), hasZ: hz, z: zw, hasH: hh, h: hw, outcome: outcomeStr(r.out), assigned: r.asg },
    s' = r.st
  }

  action moveWith(k: EvKind, hasZw: bool, zwMm: int): bool =
    recordAndApply(k, hasZw, zwMm, false, 0, applyMove(s, moveKindOf(k), hasZw, zwMm))

  action commentWith(hz: bool, zwMm: int, hh: bool, hwMm: int): bool =
    recordAndApply(ELayerComment, hz, zwMm, hh, hwMm, applyComment(s, hz, zwMm, hh, hwMm))

  /**
   * Start before any input: a fresh Job/Parser pair.
   *
   * Authority: none — model scaffolding.
   * Library stance: library-invented — mirrors a fresh Job (no paths, no
   * layers, strategy unset) and a fresh Parser (no accumulated metadata);
   * the un-homed z resolves to 0 by the library's rendering convention.
   * Exclusions: nothing carries over from a previous job.
   */
  action init = all {
    ev' = { kind: kindStr(EInit), hasZ: false, z: 0, hasH: false, h: 0, outcome: outcomeStr(ONoSort), assigned: -1 },
    s' = {
      locked: false,
      collapsed: false,
      layers: List(),
      occ: List(),
      meta: List(),
      pointer: 0,
      curZ: 0,
      stateH: -1,
      last: { kind: PNone, z: 0, h: -1, idx: -1 },
      pathsCount: 0,
      ghostEntries: 0,
      ghostPrev: {
        pointer: 0, locked: false, collapsed: false,
        metaLen: 0, layerCount: 0, pathsCount: 0
      }
    }
  }

  // --- nondeterministic wrappers for simulation ---------------------------

  /// G0 X<n> Z<z>: travel to a (possibly unchanged) height
  action anyTravel = {
    nondet zw = Z_WORDS.oneOf()
    moveWith(ETravel, true, zw)
  }

  /// G1 X<n> E<n>: extrude at the current height (planar)
  action anyExtrude = moveWith(EExtrude, false, 0)

  /// G1 X<n> Z<z'> E<n> with z' != current z: a non-planar extrusion
  action anyExtrudeUp = {
    nondet zw = Z_WORDS.filter(w => mmToCenti(w) != s.curZ).oneOf()
    moveWith(EExtrudeUp, true, zw)
  }

  /// Comment ;Z: words, upper-biased: adoption boundaries that sit above
  /// the fallback-made layers are what route re-files below the newest
  /// layer, the partition mode the per-layer counts exist to pin
  pure val CZ_BAG: List[int] = [1, 2, 3, 4, 4, 5, 5, 6, 6, 6]

  /// ;Z: presence, 3:1 — real LAYER_CHANGE blocks nearly always carry a
  /// ;Z: line; the 1-in-4 bare form keeps the undeclared-z pinning rule
  /// exercised
  pure val HZ_BAG: List[bool] = [true, true, true, false]

  /// ;LAYER_CHANGE block with optional ;Z: and ;HEIGHT: lines
  action anyLayerComment = {
    nondet hzi = HZ_BAG.indices().oneOf()
    nondet zi = CZ_BAG.indices().oneOf()
    nondet hh = Bool.oneOf()
    nondet hw = H_WORDS.oneOf()
    val hz = HZ_BAG[hzi]
    commentWith(hz, if (hz) CZ_BAG[zi] else 0, hh, if (hh) hw else 0)
  }

  // --- step (weights live in data; see STYLE.md) --------------------------

  type StepKind = KTravel | KExtrude | KExtrudeUp | KComment

  /**
   * Two step menus of 20 entries, chosen by machine phase (weights still
   * live in data; the phase only picks which bag is drawn from). Before
   * any metadata exists, moves dominate and comments are rare, so the
   * fallback has room to stack several layers before the first comment —
   * the prefix that makes adoption re-file paths below the newest layer.
   * Once metadata exists, comments arrive often (deep entry lists, the
   * pointer scan) and the non-planar extrusion is doubled to exercise the
   * metadata-mode quiet filing. The collapse stays rare in both bags
   * because it is absorbing. The machine has no stutter: a G-code stream
   * never runs out of lines, so step is always enabled.
   *
   * Authority: none — generation scheduling, not semantics.
   * Library stance: library-invented — a coverage schedule, not a workload
   * model of real sliced files.
   * Exclusions: command frequencies of real slicer output.
   */
  pure val FALLBACK_MENU: List[StepKind] = [
    KTravel, KTravel, KTravel, KTravel, KTravel, KTravel,
    KExtrude, KExtrude, KExtrude, KExtrude, KExtrude, KExtrude, KExtrude, KExtrude, KExtrude, KExtrude,
    KExtrudeUp,
    KComment, KComment, KComment
  ]

  pure val META_MENU: List[StepKind] = [
    KTravel, KTravel, KTravel, KTravel, KTravel,
    KExtrude, KExtrude, KExtrude, KExtrude, KExtrude, KExtrude, KExtrude,
    KExtrudeUp, KExtrudeUp,
    KComment, KComment, KComment, KComment, KComment, KComment
  ]

  action dispatch(k: StepKind): bool = match k {
    | KTravel => anyTravel
    | KExtrude => anyExtrude
    | KExtrudeUp => anyExtrudeUp
    | KComment => anyLayerComment
  }

  action step = {
    val menu = if (s.meta.length() == 0) FALLBACK_MENU else META_MENU
    nondet k = menu.indices().oneOf()
    dispatch(menu[k])
  }

  // --- invariants (over semantic state only; none mention ev) -------------

  /// The partition is rectangular: every layer has a z, a height and a
  /// resident count, and the live path's residence list stays aligned
  val layersAligned = s.layers.length() == s.occ.length()

  /// Resident counts never go negative, and the live path never has more
  /// residences in a layer than the layer has residents
  val residentsSane = range(0, s.layers.length()).foldl(true, (ok, i) =>
    ok and s.occ[i] >= 0 and s.occ[i] <= s.layers[i].n)

  /// Partition conservation: the per-layer resident counts sum to the
  /// filings-minus-removals counter maintained from step outcomes along an
  /// independent path — a mis-transcribed n update in any sort clause
  /// breaks the equation
  val partitionConservation =
    s.layers.foldl(0, (acc, l) => acc + l.n) == s.ghostEntries

  /// The live path's residences all sit in one layer: the newest-layer
  /// removal plus stable re-file targets keep a path from spreading
  val liveResidencySingleLayer =
    s.occ.foldl(0, (acc, c) => if (c > 0) acc + 1 else acc) <= 1

  /// the collapse empties the layer array and nothing refills it
  val collapsedNoLayers = s.collapsed implies s.layers.length() == 0

  /// the collapse removes the indexer before it could ever lock, and a
  /// removed indexer never sorts again, so the lock stays unset forever
  val collapsedNeverLocks = s.collapsed implies not(s.locked)

  /// the strategy locks to metadata mode only on the evidence of at least
  /// one slicer layer entry
  val lockNeedsEvidence = s.locked implies s.meta.length() > 0

  /// the metadata layer pointer only moves inside the metadata it scans
  val pointerBounded = s.pointer >= 0 and (s.pointer == 0 or s.pointer < s.meta.length())

  /// the pointer belongs to metadata mode; the fallback never advances it
  val unlockedPointerZero = not(s.locked) implies s.pointer == 0

  /// Pointer monotonicity, as a checked ghost invariant: the forward scan
  /// starts at the pointer, so the pointer never rewinds
  val pointerMonotone = s.pointer >= s.ghostPrev.pointer

  /// Lock monotonicity: nothing ever clears the lock
  val lockMonotone = s.ghostPrev.locked implies s.locked

  /// Collapse monotonicity: the collapse is absorbing
  val collapseMonotone = s.ghostPrev.collapsed implies s.collapsed

  /// The metadata accumulator only appends, at most one entry per step
  val metaMonotone = and {
    s.meta.length() >= s.ghostPrev.metaLen,
    s.meta.length() <= s.ghostPrev.metaLen + 1
  }

  /// Outside the collapse, layers are never removed
  val layersMonotoneUnlessCollapsed =
    not(s.collapsed) implies s.layers.length() >= s.ghostPrev.layerCount

  /// Paths only accumulate, at most one new finished path per step
  val pathsMonotone = and {
    s.pathsCount >= s.ghostPrev.pathsCount,
    s.pathsCount <= s.ghostPrev.pathsCount + 1
  }

  /// The layer index recorded on the last path points at a real layer
  /// while the partition exists (after the collapse it may dangle: the
  /// recorded value is sticky and the layer array is empty)
  val lastIdxSane = not(s.collapsed) implies or {
    s.last.idx == -1,
    s.last.idx >= 0 and s.last.idx < s.layers.length()
  }

  /// No finished path, nothing recorded on one
  val lastNeedsPath = s.pathsCount == 0 implies (s.last.kind == PNone and s.last.idx == -1)

  /// while the fallback owns the array: z strictly increasing (beyond the
  /// tolerance) and heights telescoping from z=0 (each height is its
  /// layer's z minus the previous layer's z); metadata adoption is allowed
  /// to break both
  val fallbackLayersTelescope = (not(s.locked) and not(s.collapsed)) implies
    range(0, s.layers.length()).foldl(true, (ok, i) =>
      ok and (
        if (i == 0) s.layers[0].h == s.layers[0].z
        else and {
          s.layers[i].z - s.layers[i - 1].z > FALLBACK_TOL,
          s.layers[i].h == s.layers[i].z - s.layers[i - 1].z
        }))

  val allInvariants = and {
    layersAligned,
    residentsSane,
    partitionConservation,
    liveResidencySingleLayer,
    collapsedNoLayers,
    collapsedNeverLocks,
    lockNeedsEvidence,
    pointerBounded,
    unlockedPointerZero,
    pointerMonotone,
    lockMonotone,
    collapseMonotone,
    metaMonotone,
    layersMonotoneUnlessCollapsed,
    pathsMonotone,
    lastIdxSane,
    lastNeedsPath,
    fallbackLayersTelescope
  }

  // --- readable event constructors for the semantic runs ------------------

  action travelTo(zw: int): bool = moveWith(ETravel, true, zw)
  action extrude = moveWith(EExtrude, false, 0)
  action extrudeUpTo(zw: int): bool = moveWith(EExtrudeUp, true, zw)

  pure def layer(z: int, h: int, n: int): LayerRec = { z: z, h: h, n: n }

  // --- semantic tests (run with:
  // ---   npx quint test verification/quint/layer-indexer.qnt) ---

  /// Fallback mode, with the partition tracked entry by entry: the first
  /// extrusion opens a layer at its z with z as height; every chunk
  /// boundary re-files the last path (remove from the newest layer, sort
  /// again), so a type break leaves both the old and the new path
  /// resident; a higher extrusion opens the next layer with the z
  /// difference as height; an extrusion BELOW the newest layer joins it
  /// rather than rediscovering a lower one.
  run fallbackLayerLifecycleTest =
    init
      .then(extrude)
      .expect(and {
        s.layers == List(layer(0, 0, 1)),
        ev.outcome == "filed", ev.assigned == 0,
        s.last.idx == 0, s.pathsCount == 1
      })
      .then(travelTo(1))
      // the extrusion is re-filed at the break, then the travel joins in
      .expect(and {
        s.layers == List(layer(0, 0, 2)),
        ev.assigned == 0, s.curZ == 100, s.pathsCount == 2
      })
      .then(extrude)
      .expect(and {
        s.layers == List(layer(0, 0, 2), layer(100, 100, 1)),
        ev.assigned == 1, s.last.idx == 1, s.pathsCount == 3
      })
      .then(extrude)
      // merged: removed from the newest layer at the boundary, re-filed
      .expect(s.layers == List(layer(0, 0, 2), layer(100, 100, 1)) and ev.assigned == 1)
      .then(travelTo(0))
      .expect(s.layers == List(layer(0, 0, 2), layer(100, 100, 2)) and ev.assigned == 1)
      .then(extrude)
      // from below the newest layer: joins it, no lower layer rediscovered
      .expect(and {
        s.layers == List(layer(0, 0, 2), layer(100, 100, 3)),
        ev.assigned == 1, not(s.locked), s.pathsCount == 5
      })

  /// A travel before any extrusion is dropped: no layer exists to take it,
  /// and no layer index is ever recorded on it — the "dropped" outcome
  /// asserts exactly that, where v1's -1 asserted nothing
  run travelBeforeFirstExtrusionDroppedTest =
    init
      .then(travelTo(2))
      .expect(and {
        ev.outcome == "dropped", ev.assigned == -1,
        s.layers == List(), s.last.idx == -1,
        s.last.kind == PTravel, s.pathsCount == 1
      })
      .then(extrude)
      // the travel is re-filed at the break and dropped again; the new
      // extrusion opens the first layer
      .expect(and {
        s.layers == List(layer(200, 200, 1)),
        ev.outcome == "filed", ev.assigned == 0, s.last.idx == 0
      })

  /// A non-planar extrusion in fallback mode empties the layers and
  /// removes the indexer for good: later extrusions and metadata change
  /// nothing — but the layer index already recorded on the path survives
  /// the collapse (sticky), which the replay pins on the real path
  run nonPlanarCollapseStaleIndexTest =
    init
      .then(extrude)
      .expect(s.layers == List(layer(0, 0, 1)) and s.last.idx == 0)
      .then(extrudeUpTo(2))
      .expect(and {
        ev.outcome == "collapse",
        s.collapsed, s.layers == List(), s.curZ == 200,
        s.last.idx == 0, // sticky: recorded before the collapse
        s.pathsCount == 1
      })
      .then(extrude)
      .expect(and {
        ev.outcome == "nosort", s.collapsed,
        s.layers == List(), s.last.idx == 0
      })
      .then(commentWith(true, 1, false, 0))
      .expect(and {
        ev.outcome == "nosort", s.collapsed, not(s.locked),
        s.layers == List(), s.meta.length() == 1
      })
      .then(extrudeUpTo(4))
      .expect(s.collapsed and s.layers == List() and not(s.locked))

  /// Metadata arriving after fallback layers: the comment chunk's re-filed
  /// path locks the strategy, adoption restates layer 0 with the declared
  /// z/height, and the re-scan files the path by the adopted boundaries.
  /// From then on the path's residence sits below the newest layer, so the
  /// newest-layer removal at each chunk boundary never matches and every
  /// re-file adds another residence entry to layer 0 — the partition
  /// counts pin this growth exactly.
  run metadataLockAdoptionResidenceTest =
    init
      .then(extrude)
      .then(travelTo(1))
      .then(extrude)
      .expect(and {
        s.layers == List(layer(0, 0, 2), layer(100, 100, 1)),
        not(s.locked)
      })
      .then(commentWith(true, 3, true, 1))
      .expect(and {
        s.locked,
        s.layers == List(layer(300, 100, 3), layer(100, 100, 0)),
        ev.outcome == "filed", ev.assigned == 0,
        s.pointer == 0, s.stateH == 100, s.last.idx == 0
      })
      .then(extrude)
      // line height changed, so the path breaks: the old path is re-filed
      // into layer 0 (another residence entry) and the new one joins it
      .expect(and {
        s.layers == List(layer(300, 100, 5), layer(100, 100, 0)),
        ev.assigned == 0, s.pathsCount == 4
      })
      .then(extrude)
      // merged: the newest-layer removal misses (the residence is in layer
      // 0), the re-file adds one more entry
      .expect(and {
        s.layers == List(layer(300, 100, 6), layer(100, 100, 0)),
        ev.assigned == 0, s.pathsCount == 4
      })

  /// Metadata mode: layers materialize from stored entries as paths reach
  /// them, the accumulator derives a missing height from the z difference
  /// between entries, and the pointer follows the filed layer without ever
  /// rewinding — so a later LOWER extrusion is filed at the pointer
  /// instead of rediscovering layer 0 (pointerMonotone holds throughout)
  run metadataPointerMonotoneTest =
    init
      .then(commentWith(true, 1, false, 0))
      .expect(and {
        ev.outcome == "nosort", not(s.locked),
        s.meta.length() == 1, ev.assigned == -1
      })
      .then(travelTo(1))
      // the first sort with metadata present locks, then drops the travel
      .expect(and {
        s.locked, ev.outcome == "dropped", s.layers == List(), s.last.idx == -1
      })
      .then(extrude)
      .expect(and {
        s.layers == List(layer(100, 20, 1)),
        ev.assigned == 0, s.pointer == 0
      })
      .then(commentWith(true, 2, false, 0))
      // derived height: 200 - 100, stored on the accumulated entry
      .expect(and {
        ev.assigned == 0, s.meta.length() == 2,
        s.meta[1].hh and s.meta[1].h == 100
      })
      .then(travelTo(2))
      .expect(s.layers == List(layer(100, 20, 2)) and ev.assigned == 0)
      .then(extrude)
      .expect(and {
        s.layers == List(layer(100, 20, 2), layer(200, 100, 1)),
        ev.assigned == 1, s.pointer == 1
      })
      .then(travelTo(1))
      .expect(s.layers == List(layer(100, 20, 2), layer(200, 100, 2)) and ev.assigned == 1)
      .then(extrude)
      // z regressed below layer 0, but the scan starts at the pointer
      .expect(and {
        s.layers == List(layer(100, 20, 2), layer(200, 100, 3)),
        ev.assigned == 1, s.pointer == 1
      })

  /// Metadata mode: an extrusion above everything stored bootstraps a
  /// layer at its own z (default height); the layer position answers for
  /// metadata entry 0, so later paths keep joining it
  run metadataBootstrapAboveAllTest =
    init
      .then(commentWith(true, 1, false, 0))
      .then(travelTo(5))
      .expect(s.locked and s.layers == List() and ev.outcome == "dropped")
      .then(extrude)
      .expect(and {
        s.layers == List(layer(500, 20, 1)),
        ev.assigned == 0, s.pointer == 0
      })
      .then(extrude)
      .expect(s.layers == List(layer(500, 20, 1)) and ev.assigned == 0)
      .then(travelTo(1))
      .expect(s.layers == List(layer(500, 20, 2)) and ev.assigned == 0)
      .then(extrude)
      .expect(and {
        s.layers == List(layer(500, 20, 3)),
        ev.assigned == 0, s.pointer == 0
      })

  /// An entry with no stored z claims the next path outright when its
  /// layer does not exist yet, and is pinned by that path's z; entries
  /// with nothing stored adopt nothing
  run undeclaredZClaimTest =
    init
      .then(extrude)
      .expect(s.layers == List(layer(0, 0, 1)))
      .then(commentWith(false, 0, false, 0))
      // lock on an entry with nothing stored: adoption changes nothing,
      // the scan reads layer 0's own z and re-files the path there
      .expect(and {
        s.locked, s.layers == List(layer(0, 0, 1)),
        ev.assigned == 0, s.pointer == 0
      })
      .then(commentWith(false, 0, false, 0))
      .expect(s.meta.length() == 2 and ev.assigned == 0 and s.layers == List(layer(0, 0, 1)))
      .then(travelTo(3))
      .expect(s.layers == List(layer(0, 0, 2)) and ev.assigned == 0)
      .then(extrude)
      // entry 1 has no stored z and no layer yet: it claims the path and
      // is pinned at the path's z with the default height
      .expect(and {
        s.layers == List(layer(0, 0, 2), layer(300, 20, 1)),
        ev.assigned == 1, s.pointer == 1
      })
}
