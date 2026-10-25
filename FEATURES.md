# Features

For runnable snippets of the options shown here, see
[EXAMPLES-v3.md](EXAMPLES-v3.md) (or [EXAMPLES-v2.md](EXAMPLES-v2.md) if you are
still on 2.x). For the full option reference, see the
[API docs](https://gcode-preview.web.app/docs/).



---

## Multi-colour / multi-tool prints

Pass an array to `extrusionColor` and each tool gets its own colour. Tool
changes in the G-code (`T0`, `T1`, …) pick the colour by index, so a two-colour
print comes out as two colours without any extra bookkeeping.

```js
extrusionColor: ['#4a9c3f', '#e0a030']
```

<img src="media/multicolor-1.png" width="49%" alt="Two-colour tree frog, front three-quarter view"> <img src="media/multicolor-2.png" width="49%" alt="Two-colour tree frog seen from above">

---

## Extrusion geometry: tubes vs lines

**Changed in v3**

`renderTubes: false` draws each extrusion as a flat line — fast, and fine for a
quick look at the toolpath. `renderTubes: true` (the default) builds real
extrusion-shaped geometry from the nozzle width and layer height, so the print
looks like the object it will become.

```js
renderTubes: true   // extrusion-shaped geometry (default)
renderTubes: false  // flat lines
```

<img src="media/tubes-lines.png" width="49%" alt="3DBenchy drawn as flat lines"> <img src="media/tubes-tubes.png" width="49%" alt="3DBenchy drawn as extrusion tubes">

---

## Arc moves (G2 / G3)

Arcs are interpolated into segments rather than skipped or flattened into
chords you can see. `arcChordTolerance` controls how closely the interpolation
follows the true arc — smaller means smoother and more segments.

```js
arcChordTolerance: 0.05 // mm, the default
```

A single layer of a screw thread, seen straight down through the orthographic
camera — the curves are all `G2`/`G3` moves:

<img src="media/arcs-topdown.png" width="60%" alt="Top-down orthographic view of one layer of a screw thread, its concentric arc passes drawn as curves">

---

## Layer range

**Changed in v3**

`startLayer` and `endLayer` clip the render to a slice of the print. Both are
plain setters that re-render on assignment, so wiring them to a slider is a
two-line job.

```js
preview.sceneManager.startLayer = 1;
preview.sceneManager.endLayer = 120;
```

<img src="media/layers-full.png" width="49%" alt="A vase rendered in full"> <img src="media/layers-range.png" width="49%" alt="The same vase clipped to its lower layers">

---

## Top layer and last segment highlight

`topLayerColor` paints the last visible layer, and `lastSegmentColor` paints the
very last extrusion on it. Together they show exactly where the nozzle is in the
print — which is what makes the layer slider readable.

```js
topLayerColor: '#ffffff',
lastSegmentColor: '#ff3b30'
```

<img src="media/highlight.png" width="60%" alt="3DBenchy stopped mid-print, with the top layer in white and the last segment in red">

---

## Travel moves

Travel moves are off by default — they add a lot of lines for something most
people don't want to see. Turn them on when you're hunting for stringing or
wondering why a print takes so long.

```js
renderTravel: true,
travelColor: '#30d158'
```

<img src="media/travel-off.png" width="49%" alt="A cat model with travel moves hidden"> <img src="media/travel-on.png" width="49%" alt="The same model with travel moves drawn in green">

---

## Build volume

**Changed in v3**

Give the build volume an `x`, `y` and `z` and you get a wireframe box and a
grid at the right scale. `smallGrid: true` adds a 1 mm grid under the 10 mm
one, which helps when you're judging the size of small parts.

```js
buildVolume: { x: 180, y: 180, z: 100 }
buildVolume: { x: 180, y: 180, z: 100, smallGrid: true }
```

<img src="media/buildvolume-1.png" width="49%" alt="A build volume box with the default 10 mm grid"> <img src="media/buildvolume-2.png" width="49%" alt="The same build volume with the fine 1 mm grid added">

---

## Bounding box

**Added in v3**

`boundingBoxColor` draws a box around the printed object — the extents of the
job rather than the machine.

```js
boundingBoxColor: '#ff5fa2'
```

<img src="media/boundingbox.png" width="60%" alt="A cat model inside a pink bounding box">

---

## Orthographic and perspective cameras

**Added in v3**

`orthographic: true` swaps the perspective camera for an orthographic one.
Parallel lines stay parallel, which is what you want for comparing dimensions
or lining a part up against the plate.

```js
orthographic: true
```

<img src="media/camera-perspective.png" width="49%" alt="A vase seen through the perspective camera"> <img src="media/camera-orthographic.png" width="49%" alt="The same vase through the orthographic camera">

---

## CNC and laser toolpaths

**Added in v3**

G-code that never extrudes still renders. With `renderTravel: true` the whole
toolpath is visible, so CNC jobs, laser cuts and pen plots work the same way a
print does.

```js
renderTravel: true,
travelColor: '#30d158'
```

<img src="media/cnc-easel.png" width="49%" alt="A CNC engraving toolpath spelling CKC"> <img src="media/cnc-mach3.png" width="49%" alt="A Mach3 CNC toolpath">

---

## Layer-by-layer playback

**Changed in v3**

Stepping `endLayer` from the first layer to the last replays the print. The
animation below is nothing but that setter in a loop — the same thing a layer
slider does, and roughly what you see while a large file is still parsing,
since the preview draws as it goes (`liveRenderInterval`, 250 ms by default).

![A 3DBenchy built up layer by layer](media/grow.gif)

---

## Orbit, pan and zoom

The canvas comes with orbit controls wired up — drag to rotate, scroll to zoom,
right-drag to pan. `initialCameraPosition` sets where the camera starts.

![The tree frog rotating on the build plate](media/orbit.gif)
