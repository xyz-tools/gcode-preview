// -*- mode: Bluespec; -*-
/**
 * Formal specification of the layer-indexing state machine.
 *
 * Models the layer bookkeeping a Job performs when the interpreter replays
 * one G-code line (or one slicer layer-comment block) per Interpreter.execute
 * call: the LayersMetadataIndexer strategy lock (tolerance fallback until the
 * first path sorted after slicer layer metadata exists, metadata mode forever
 * after, with adoption rewriting the fallback-made layers), the monotone
 * metadata layer pointer, tolerance-based layer creation in fallback mode,
 * and the non-planar collapse that empties the layer array and removes the
 * layer indexer for good (src/indexers.ts, driven through src/job.ts).
 *
 * All lengths are integers in centi-millimeters (mm * 100). Event words carry
 * whole millimeters, so the real tolerances (0.05 mm fallback break, 0.01 mm
 * metadata z-match) stay exact under integer comparison.
 *
 * The cmd/word variables record WHICH event was taken on each step, so an ITF
 * trace doubles as an input program: a replay harness rebuilds each step as a
 * G-code line (travel/extrude moves) or a PrusaSlicer-style layer-comment
 * block, feeds it chunk-by-chunk through the real Parser + Interpreter into
 * one Job, and compares the job's layers (count, z, height) and the layer the
 * step's path joined after every step. "stutter" steps feed no input.
 */
module layer_indexer {
  // --- trace-contract variables: the event taken on this step ---
  /// "init" | "travel" | "extrude" | "extrudeup" | "layercomment" | "stutter"
  var cmd: str
  var hasZWord: bool
  var zWord: int
  var hasHWord: bool
  var hWord: int
  /// Index of the layer this step's (re)sorted path joined; -1 when no path
  /// was filed into a layer (dropped travel, collapse, comment with no paths)
  var assignedLayer: int

  // --- trace-contract variables: expected observable job state ---
  /// z of each layer, in centi-mm (compare against job.layers[i].z)
  var layersZ: List[int]
  /// height of each layer, in centi-mm (compare against job.layers[i].height)
  var layersH: List[int]

  // --- internal model state (not compared directly by the replay) ---
  /// LayersMetadataIndexer.useMetadata === true (strategy locked to metadata)
  var locked: bool
  /// Layer indexer removed after NonPlanarExtrusionError; layers emptied
  var collapsed: bool
  /// Slicer layer metadata entries (hz/hh say whether z/h were declared)
  var metaLayers: List[{ hz: bool, z: int, hh: bool, h: int }]
  /// LayersMetadataIndexer.currentMetadataLayerIndex
  var pointer: int
  /// Current nozzle z (centi-mm); starts at 0 (unhomed axes resolve to 0)
  var curZ: int
  /// state.lineHeight * 100; -1 encodes undefined (State.initial default)
  var stateH: int
  /// Type of the last finished path: "none" | "travel" | "extrusion"
  var lastPathType: str
  /// Seed z of the last finished path (its vertices[2], what sortIn reads)
  var lastPathZ: int
  /// lineHeight the last finished path was created with; -1 = undefined
  var lastPathH: int

  type MetaEntry = { hz: bool, z: int, hh: bool, h: int }
  type SortResult = { lz: List[int], lh: List[int], ptr: int, asg: int, lk: bool }

  // Word domains (whole millimeters)
  pure val ZWords: Set[int] = 0.to(6)
  pure val HWords: Set[int] = 1.to(3)

  /// LayersIndexer.DEFAULT_TOLERANCE = 0.05 mm
  pure val FALLBACK_TOL: int = 5
  /// LayersMetadataIndexer.Z_MATCH_TOLERANCE = 0.01 mm
  pure val Z_MATCH_TOL: int = 1
  /// LayersMetadataIndexer.DEFAULT_LAYER_HEIGHT = 0.2 mm
  pure val DEFAULT_H: int = 20

  /// findLayerIndexForZ: forward scan from the pointer; an entry without a
  /// declared z reads the z its layer was pinned with, and claims the path
  /// outright when no such layer exists yet. -1 = above everything known.
  pure def findTarget(pz: int, start: int, meta: List[MetaEntry], lz: List[int]): int =
    range(start, meta.length()).foldl(-1, (acc, i) =>
      if (acc >= 0) acc
      else if (not(meta[i].hz) and i >= lz.length()) i
      else {
        val zi = if (meta[i].hz) meta[i].z else lz[i]
        if (pz <= zi + Z_MATCH_TOL) i else -1
      })

  /// ensureLayersUpTo: materialize metadata layers up to and including target
  pure def ensureUpTo(target: int, pz: int, meta: List[MetaEntry], lz: List[int], lh: List[int]): (List[int], List[int]) =
    range(lz.length(), target + 1).foldl((lz, lh), (acc, k) =>
      (acc._1.append(if (meta[k].hz) meta[k].z else pz),
        acc._2.append(if (meta[k].hh) meta[k].h else DEFAULT_H)))

  /// adoptMetadataLayers: declared z/height replace the observed values on
  /// the layers the fallback made before the metadata arrived (prefix only)
  pure def adoptLayers(meta: List[MetaEntry], lz: List[int], lh: List[int]): (List[int], List[int]) = {
    val n = if (meta.length() < lz.length()) meta.length() else lz.length()
    range(0, n).foldl((lz, lh), (acc, i) =>
      (if (meta[i].hz) acc._1.replaceAt(i, meta[i].z) else acc._1,
        if (meta[i].hh) acc._2.replaceAt(i, meta[i].h) else acc._2))
  }

  /// One LayersMetadataIndexer.sortIn of a planar path: lock-and-adopt when
  /// metadata exists and the strategy is still unset, then metadata-mode or
  /// fallback filing. The non-planar throw is handled by the calling action.
  pure def sortPath(ty: str, pz: int, lk0: bool, meta: List[MetaEntry], lz0: List[int], lh0: List[int], ptr0: int): SortResult = {
    val willLock = not(lk0) and meta.length() > 0
    val adopted = if (willLock) adoptLayers(meta, lz0, lh0) else (lz0, lh0)
    val lz = adopted._1
    val lh = adopted._2
    val lk = lk0 or willLock
    if (ty == "travel")
      // travels never open a layer: they join the last one or are dropped
      { lz: lz, lh: lh, ptr: ptr0, asg: if (lz.length() == 0) -1 else lz.length() - 1, lk: lk }
    else if (lk) {
      val target = findTarget(pz, ptr0, meta, lz)
      if (target < 0) {
        // above everything the metadata describes: keep it in the last known
        // layer, bootstrapping one when none exist; the pointer stays put
        if (lz.length() == 0)
          { lz: lz.append(pz), lh: lh.append(DEFAULT_H), ptr: ptr0, asg: 0, lk: lk }
        else
          { lz: lz, lh: lh, ptr: ptr0, asg: lz.length() - 1, lk: lk }
      } else {
        val grown = ensureUpTo(target, pz, meta, lz, lh)
        { lz: grown._1, lh: grown._2, ptr: target, asg: target, lk: lk }
      }
    } else {
      // fallback LayersIndexer: a new layer only for an extrusion more than
      // the tolerance ABOVE the last one; lower z silently joins the last
      if (lz.length() == 0)
        { lz: List(pz), lh: List(pz), ptr: ptr0, asg: 0, lk: lk }
      else {
        val lastZ = lz[lz.length() - 1]
        if (pz - lastZ > FALLBACK_TOL)
          { lz: lz.append(pz), lh: lh.append(pz - lastZ), ptr: ptr0, asg: lz.length(), lk: lk }
        else
          { lz: lz, lh: lh, ptr: ptr0, asg: lz.length() - 1, lk: lk }
      }
    }
  }

  /// Record which event (and which words) this step takes
  action recordEvent(c: str, hz: bool, zw: int, hh: bool, hw: int, asg: int): bool = all {
    cmd' = c,
    hasZWord' = hz, zWord' = zw,
    hasHWord' = hh, hWord' = hw,
    assignedLayer' = asg
  }

  /// One replayed move line (G0/G1). The in-progress path continues only
  /// while its type and lineHeight still match the state (Job.continuePath);
  /// a continued path keeps its seed z, which is what sortIn reads. An
  /// extrusion whose destination z differs from the current z is non-planar:
  /// in fallback mode that collapses the layer index for good, in metadata
  /// mode it is filed by seed z without complaint.
  action moveWith(c: str, ty: str, hasZw: bool, zwMm: int): bool = {
    val zTarget = if (hasZw) zwMm * 100 else curZ
    val merged = lastPathType == ty and lastPathH == stateH
    val pz = if (merged) lastPathZ else curZ
    val wouldCollapse = and {
      ty == "extrusion",
      zTarget != curZ,
      not(locked),
      metaLayers.length() == 0,
      not(collapsed)
    }
    val r =
      if (collapsed)
        { lz: layersZ, lh: layersH, ptr: pointer, asg: -1, lk: locked }
      else if (wouldCollapse)
        { lz: List(), lh: List(), ptr: pointer, asg: -1, lk: locked }
      else
        sortPath(ty, pz, locked, metaLayers, layersZ, layersH, pointer)
    all {
      recordEvent(c, hasZw, zwMm, false, 0, r.asg),
      locked' = r.lk,
      collapsed' = (collapsed or wouldCollapse),
      layersZ' = r.lz,
      layersH' = r.lh,
      pointer' = r.ptr,
      metaLayers' = metaLayers,
      curZ' = zTarget,
      stateH' = stateH,
      lastPathType' = ty,
      lastPathZ' = pz,
      lastPathH' = stateH
    }
  }

  /// One PrusaSlicer-style layer-comment block (;LAYER_CHANGE [;Z:n]
  /// [;HEIGHT:n]) parsed and executed as its own chunk. The block appends a
  /// metadata entry; a HEIGHT line doubles as an extrusion-dimension event
  /// that updates state.lineHeight. The streaming parser derives a missing
  /// height for the first layer of a chunk — which here is every layer —
  /// from the previous accumulated entry's z, when both z values exist
  /// (Parser.parseGCode layer accumulation). Executing the chunk resumes and
  /// re-files the last path, and THAT re-sort is what locks the strategy to
  /// metadata (adopting the fallback-made layers) when it is still unset.
  action layerCommentWith(hz: bool, zwMm: int, hh: bool, hwMm: int): bool = {
    val derived =
      if (metaLayers.length() == 0) false
      else hz and not(hh) and metaLayers[metaLayers.length() - 1].hz
    val meta1 = metaLayers.append({
      hz: hz,
      z: zwMm * 100,
      hh: hh or derived,
      h: if (derived) zwMm * 100 - metaLayers[metaLayers.length() - 1].z else hwMm * 100
    })
    val stateH1 = if (hh) hwMm * 100 else stateH
    val noSort = collapsed or lastPathType == "none"
    val r =
      if (noSort)
        { lz: layersZ, lh: layersH, ptr: pointer, asg: -1, lk: locked }
      else
        sortPath(lastPathType, lastPathZ, locked, meta1, layersZ, layersH, pointer)
    all {
      recordEvent("layercomment", hz, zwMm, hh, hwMm, r.asg),
      locked' = r.lk,
      collapsed' = collapsed,
      layersZ' = r.lz,
      layersH' = r.lh,
      pointer' = r.ptr,
      metaLayers' = meta1,
      curZ' = curZ,
      stateH' = stateH1,
      lastPathType' = lastPathType,
      lastPathZ' = lastPathZ,
      lastPathH' = lastPathH
    }
  }

  /// Explicit stutter: the replay skips these steps without feeding input
  action stutterStep = all {
    recordEvent("stutter", false, 0, false, 0, -1),
    locked' = locked,
    collapsed' = collapsed,
    layersZ' = layersZ,
    layersH' = layersH,
    pointer' = pointer,
    metaLayers' = metaLayers,
    curZ' = curZ,
    stateH' = stateH,
    lastPathType' = lastPathType,
    lastPathZ' = lastPathZ,
    lastPathH' = lastPathH
  }

  // --- nondeterministic wrappers for simulation ---

  /// G0 X<n> Z<z>: travel to a (possibly unchanged) height
  action anyTravel = {
    nondet zw = ZWords.oneOf()
    moveWith("travel", "travel", true, zw)
  }

  /// G1 X<n> E<n>: extrude at the current height (planar)
  action anyExtrude = moveWith("extrude", "extrusion", false, 0)

  /// G1 X<n> Z<z'> E<n> with z' != current z: a non-planar extrusion
  action anyExtrudeUp = {
    nondet zw = ZWords.filter(w => w * 100 != curZ).oneOf()
    moveWith("extrudeup", "extrusion", true, zw)
  }

  /// ;LAYER_CHANGE block with optional ;Z: and ;HEIGHT: lines
  action anyLayerComment = {
    nondet hz = Bool.oneOf()
    nondet zw = ZWords.oneOf()
    nondet hh = Bool.oneOf()
    nondet hw = HWords.oneOf()
    layerCommentWith(hz, if (hz) zw else 0, hh, if (hh) hw else 0)
  }

  // --- init and step ---

  action init = all {
    cmd' = "init",
    hasZWord' = false, zWord' = 0,
    hasHWord' = false, hWord' = 0,
    assignedLayer' = -1,
    locked' = false,
    collapsed' = false,
    layersZ' = List(),
    layersH' = List(),
    metaLayers' = List(),
    pointer' = 0,
    curZ' = 0,
    stateH' = -1,
    lastPathType' = "none",
    lastPathZ' = 0,
    lastPathH' = -1
  }

  /// Weighted event pick: moves dominate so layers actually accumulate,
  /// layer comments arrive often enough to exercise the lock and the
  /// pointer, and the non-planar collapse stays rare (it is absorbing).
  action step = {
    nondet choice = 1.to(20).oneOf()
    if (choice <= 5) anyTravel
    else if (choice <= 13) anyExtrude
    else if (choice == 14) anyExtrudeUp
    else if (choice <= 19) anyLayerComment
    else stutterStep
  }

  // --- invariants ---

  /// z and height stay in lockstep: every layer has both
  val layersWellFormed = layersZ.length() == layersH.length()

  /// the collapse empties the layer array and nothing refills it
  val collapsedNoLayers = collapsed implies layersZ.length() == 0

  /// the collapse removes the indexer before it could ever lock, and a
  /// removed indexer never sorts again, so the lock stays unset forever
  val collapsedNeverLocks = collapsed implies not(locked)

  /// the strategy locks to metadata mode only on the evidence of at least
  /// one slicer layer entry (lock monotonicity: nothing ever clears it)
  val lockNeedsEvidence = locked implies metaLayers.length() > 0

  /// the metadata layer pointer only moves inside the metadata it scans
  val pointerBounded = pointer >= 0 and (pointer == 0 or pointer < metaLayers.length())

  /// the pointer belongs to metadata mode; the fallback never advances it
  val unlockedPointerZero = not(locked) implies pointer == 0

  /// partition well-formedness: a filed path lands in exactly one existing
  /// layer; -1 records the paths that no layer received
  val assignedInRange = assignedLayer == -1 or (assignedLayer >= 0 and assignedLayer < layersZ.length())

  /// after the collapse no path is ever filed into a layer again
  val collapsedNoAssignment = collapsed implies assignedLayer == -1

  /// while the fallback owns the array: z strictly increasing (beyond the
  /// tolerance) and heights telescoping from z=0, exactly as createLayerAt
  /// computes them; metadata adoption is allowed to break both
  val fallbackLayersTelescope = (not(locked) and not(collapsed)) implies
    range(0, layersZ.length()).foldl(true, (ok, i) =>
      ok and (
        if (i == 0) layersH[0] == layersZ[0]
        else layersZ[i] - layersZ[i - 1] > FALLBACK_TOL and layersH[i] == layersZ[i] - layersZ[i - 1]))

  val allInvariants = and {
    layersWellFormed,
    collapsedNoLayers,
    collapsedNeverLocks,
    lockNeedsEvidence,
    pointerBounded,
    unlockedPointerZero,
    assignedInRange,
    collapsedNoAssignment,
    fallbackLayersTelescope
  }

  // --- semantic tests (run with: npx quint test verification/quint/layer-indexer.qnt) ---

  /// Fallback mode: first extrusion opens a layer at its z with z as height,
  /// same-z extrusions and travels join it, a higher extrusion opens the next
  /// layer with the z difference as height, and an extrusion BELOW the last
  /// layer joins that last layer rather than rediscovering a lower one.
  run fallbackLayerLifecycleTest =
    init
      .then(moveWith("extrude", "extrusion", false, 0))
      .expect(layersZ == List(0) and layersH == List(0) and assignedLayer == 0)
      .then(moveWith("travel", "travel", true, 1))
      .expect(assignedLayer == 0 and layersZ == List(0) and curZ == 100)
      .then(moveWith("extrude", "extrusion", false, 0))
      .expect(layersZ == List(0, 100) and layersH == List(0, 100) and assignedLayer == 1)
      .then(moveWith("extrude", "extrusion", false, 0))
      .expect(layersZ == List(0, 100) and assignedLayer == 1)
      .then(moveWith("travel", "travel", true, 0))
      .then(moveWith("extrude", "extrusion", false, 0))
      .expect(layersZ == List(0, 100) and assignedLayer == 1 and not(locked))

  /// A travel before any extrusion is dropped: no layer exists to take it
  run travelBeforeFirstExtrusionDroppedTest =
    init
      .then(moveWith("travel", "travel", true, 2))
      .expect(assignedLayer == -1 and layersZ == List() and lastPathType == "travel")
      .then(moveWith("extrude", "extrusion", false, 0))
      .expect(layersZ == List(200) and layersH == List(200) and assignedLayer == 0)

  /// A non-planar extrusion in fallback mode empties the layers and removes
  /// the indexer for good: later extrusions and metadata change nothing
  run nonPlanarCollapseTest =
    init
      .then(moveWith("extrude", "extrusion", false, 0))
      .expect(layersZ == List(0))
      .then(moveWith("extrudeup", "extrusion", true, 2))
      .expect(collapsed and layersZ == List() and assignedLayer == -1 and curZ == 200)
      .then(moveWith("extrude", "extrusion", false, 0))
      .expect(collapsed and layersZ == List() and assignedLayer == -1)
      .then(layerCommentWith(true, 1, false, 0))
      .expect(collapsed and not(locked) and layersZ == List() and metaLayers.length() == 1)

  /// Metadata arriving after fallback layers: the comment chunk's re-filed
  /// path locks the strategy, adoption restates layer 0 with the declared
  /// z/height, and the re-scan files the path by the adopted boundaries
  run metadataLockAndAdoptionTest =
    init
      .then(moveWith("extrude", "extrusion", false, 0))
      .then(moveWith("travel", "travel", true, 1))
      .then(moveWith("extrude", "extrusion", false, 0))
      .expect(layersZ == List(0, 100) and layersH == List(0, 100) and not(locked))
      .then(layerCommentWith(true, 3, true, 1))
      .expect(and {
        locked,
        layersZ == List(300, 100),
        layersH == List(100, 100),
        assignedLayer == 0,
        pointer == 0,
        stateH == 100
      })
      .then(moveWith("extrude", "extrusion", false, 0))
      .expect(assignedLayer == 0 and layersZ == List(300, 100))

  /// Metadata mode: layers materialize from declared entries as paths reach
  /// them, the pointer follows the filed layer and never rewinds, so a later
  /// LOWER extrusion is filed at the pointer instead of rediscovering layer 0
  run metadataPointerMonotoneTest =
    init
      .then(layerCommentWith(true, 1, false, 0))
      .expect(not(locked) and metaLayers.length() == 1 and assignedLayer == -1)
      .then(moveWith("travel", "travel", true, 1))
      .expect(locked and assignedLayer == -1 and layersZ == List())
      .then(moveWith("extrude", "extrusion", false, 0))
      .expect(layersZ == List(100) and layersH == List(20) and assignedLayer == 0 and pointer == 0)
      .then(layerCommentWith(true, 2, false, 0))
      .expect(assignedLayer == 0 and metaLayers.length() == 2)
      .then(moveWith("travel", "travel", true, 2))
      .then(moveWith("extrude", "extrusion", false, 0))
      // the second entry's height is the parser-derived z difference (1 mm)
      .expect(layersZ == List(100, 200) and layersH == List(20, 100) and assignedLayer == 1 and pointer == 1)
      .then(moveWith("travel", "travel", true, 1))
      .then(moveWith("extrude", "extrusion", false, 0))
      .expect(assignedLayer == 1 and pointer == 1 and layersZ == List(100, 200))

  /// Metadata mode: an extrusion above everything declared bootstraps a layer
  /// at its own z; the layer position still answers for metadata entry 0, so
  /// a later low extrusion joins the bootstrap layer
  run metadataBootstrapAboveAllTest =
    init
      .then(layerCommentWith(true, 1, false, 0))
      .then(moveWith("travel", "travel", true, 5))
      .expect(locked and layersZ == List())
      .then(moveWith("extrude", "extrusion", false, 0))
      .expect(layersZ == List(500) and layersH == List(20) and assignedLayer == 0 and pointer == 0)
      .then(moveWith("extrude", "extrusion", false, 0))
      .expect(assignedLayer == 0)
      .then(moveWith("travel", "travel", true, 1))
      .then(moveWith("extrude", "extrusion", false, 0))
      .expect(layersZ == List(500) and assignedLayer == 0 and pointer == 0)

  /// Stutter changes nothing and is always available
  run stutterKeepsStateTest =
    init
      .then(moveWith("extrude", "extrusion", false, 0))
      .then(stutterStep)
      .expect(and {
        cmd == "stutter",
        layersZ == List(0),
        layersH == List(0),
        assignedLayer == -1,
        lastPathType == "extrusion"
      })
}
