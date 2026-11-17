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

Lines are shaded slightly differently per layer, which gives a flat render some
depth. `disableGradient` turns that off (it applies to line rendering only —
tubes are never gradient-shaded):

```js
disableGradient: false  // per-layer shading (default)
disableGradient: true   // one flat colour
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

<img src="media/highlight.png" width="60%" alt="A cat model stopped mid-print, with the top layer in white and the last segment in red">

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

<img src="media/camera-perspective.png" width="49%" alt="A cat on the build plate through the perspective camera, the grid lines converging towards the back"> <img src="media/camera-orthographic.png" width="49%" alt="The same scene through the orthographic camera, every grid cell the same size">

---

## CNC and laser toolpaths

**Changed in v3**

G-code that never extrudes still renders. With `renderTravel: true` the whole
toolpath is visible, so CNC jobs, laser cuts and pen plots work the same way a
print does. v3 also interprets the commands these files lean on and 2.x ignored
— `G20`/`G21` for units, `G28` for homing, `G92` for setting position, and the
`G31`/`G38.x` probe family — so the toolpath lands where the machine would put
it.

```js
renderTravel: true,
travelColor: '#30d158'
```

<img src="media/cnc-easel.png" width="49%" alt="A CNC engraving toolpath spelling CKC"> <img src="media/cnc-mach3.png" width="49%" alt="A Mach3 CNC toolpath">
