# Code examples (3.0)

Runnable snippets for the things people most often want from `gcode-preview`
**3.0**. Every option below is optional — each snippet notes the default it
overrides, so this page doubles as a description of what plain
`new GCodePreview({ canvas })` already gives you.

Still on 2.x? The API has a different shape there: see
[EXAMPLES-v2.md](EXAMPLES-v2.md).

For pictures of what these options look like, see [FEATURES.md](FEATURES.md).
For the full reference, see the [API docs](https://gcode-preview.web.app/docs/).

## Contents

- [Minimal setup](#minimal-setup)
- [Loading G-code](#loading-g-code)
- [Streaming a large file](#streaming-a-large-file)
- [Build volume](#build-volume)
- [Colors](#colors)
- [Multi-tool / multi-color](#multi-tool--multi-color)
- [Tubes or lines](#tubes-or-lines)
- [Extrusion dimensions](#extrusion-dimensions)
- [Layer range and a slider](#layer-range-and-a-slider)
- [Travel moves](#travel-moves)
- [Bounding box](#bounding-box)
- [Camera](#camera)
- [Arcs (G2/G3)](#arcs-g2g3)
- [Drag and drop](#drag-and-drop)
- [Thumbnails and metadata](#thumbnails-and-metadata)
- [Clearing and disposing](#clearing-and-disposing)
- [Every option in one place](#every-option-in-one-place)

## Minimal setup

The only thing the library really needs is a canvas.

```js
import { GCodePreview } from 'gcode-preview';

const preview = new GCodePreview({
  canvas: document.querySelector('canvas')
});
```

That already gets you: extrusions drawn as 3D tubes, travel moves hidden, a
light grey background, a perspective camera, no build plate and no bounding
box.

## Loading G-code

`processGCode()` accepts a string or an array of lines, and resolves once the
model has been drawn.

```js
const gcode = await fetch('benchy.gcode').then((r) => r.text());
await preview.processGCode(gcode);

console.log(preview.countLayers, 'layers');
```

Calling it again **adds** to what is already there. To replace the model, call
`preview.clear()` first.

## Streaming a large file

`processGCodeStream()` takes a `ReadableStream` and draws the model while it is
still downloading. This is the nicest option for files of more than a few MB.

```js
const response = await fetch('big-print.gcode');
await preview.processGCodeStream(response.body);
```

While streaming, partial results are redrawn at most every 250 ms. Lower that
for a smoother grow-in, at the cost of one geometry batch (and so one draw call)
per redraw:

```js
new GCodePreview({
  canvas,
  liveRenderInterval: 60   // default: 250 (ms). 0 draws on every chunk.
});
```

There are two callbacks to hang progress UI off:

```js
preview.onJobUpdated = (job) => {
  slider.max = job.layers.length;
};
preview.onStreamEnd = () => {
  console.log('done');
};
```

## Build volume

Pass `buildVolume` to draw a build plate; leave it out and nothing is drawn.
Negative dimensions are clamped to 0, and a volume with `x` or `y` at 0 draws
nothing — handy for CNC or laser jobs, where a printer plate makes no sense.

```js
new GCodePreview({
  canvas,
  buildVolume: {
    x: 250,
    y: 210,
    z: 220,            // 0 draws the plate without the vertical box
    smallGrid: false   // default: false. true adds a 1 mm grid inside the 10 mm one.
  }
});
```

## Colors

Anything three.js accepts works: a CSS name, a hex number, or a `Color`.

```js
new GCodePreview({
  canvas,
  backgroundColor: 0xe0e0e0,  // default: 0xe0e0e0 (light grey)
  extrusionColor: 'hotpink',  // default: 'hotpink'
  topLayerColor: '#ffffff',   // default: undefined — top layer uses extrusionColor
  lastSegmentColor: '#ff3b30' // default: undefined — last segment uses extrusionColor
});
```

`topLayerColor` and `lastSegmentColor` are what make "where is the print right
now" readable; they only stand out when the view stops short of the last layer.

By default each layer is shaded slightly differently, which gives the model some
depth. Turn that off for flat, uniform color:

```js
new GCodePreview({
  canvas,
  disableGradient: true   // default: false
});
```

## Multi-tool / multi-color

Pass an array and the index maps to the tool: `extrusionColor[0]` is `T0`,
`extrusionColor[1]` is `T1`, and so on up to `T7`. A tool with no entry falls
back to the last color in the array (hotpink if the array is empty), and warns
once per tool index in the console.

```js
new GCodePreview({
  canvas,
  extrusionColor: ['#4a9c3f', '#e0a030']
});
```

Colors can be swapped at runtime; the setter re-renders by itself.

```js
preview.sceneManager.extrusionColor = ['indigo', 'lime'];
```

## Tubes or lines

Extrusions are drawn as volumetric tubes. Flat lines are much cheaper, which
matters on very large files or weak GPUs.

```js
new GCodePreview({
  canvas,
  renderTubes: false   // default: true
});
```

Line thickness is a separate option, and only applies to the line renderer:

```js
new GCodePreview({
  canvas,
  renderTubes: false,
  lineWidth: 2   // default: 1
});
```

Extrusions can also be hidden entirely, which is mostly useful when you only
care about travel moves:

```js
new GCodePreview({
  canvas,
  renderExtrusion: false,  // default: true
  renderTravel: true
});
```

## Extrusion dimensions

Tubes are sized from these two, in millimeters. Note that `;WIDTH:` and
`;HEIGHT:` comments in the G-code always win for the paths they apply to — so
with a slicer that emits them (PrusaSlicer's Arachne, for one) these are just
the fallback for everything else.

```js
new GCodePreview({
  canvas,
  extrusionWidth: 0.45,  // default: 0.6
  lineHeight: 0.2        // default: 0.2
});
```

## Layer range and a slider

`startLayer` and `endLayer` are **1-based**. `endLayer` is clamped to the layer
count; `startLayer` is not — a value outside `1..countLayers` is silently
dropped, leaving the bottom of the range open. Omit both and the whole model is
drawn.

```js
new GCodePreview({
  canvas,
  startLayer: 1,   // default: 1
  endLayer: 50     // default: the last layer
});
```

At runtime they live on the scene manager, and assigning either re-renders:

```js
slider.addEventListener('input', () => {
  preview.sceneManager.endLayer = Number(slider.value);
});
```

`singleLayerMode` pins the range to the top visible layer, which is what you
want for a "scrub through the print" view:

```js
preview.sceneManager.singleLayerMode = true;   // default: false
```

A rough layer height threshold decides where one layer ends and the next
begins; raise it for G-code whose Z wobbles.

```js
new GCodePreview({
  canvas,
  minLayerThreshold: 0.1   // default: 0.05 (mm)
});
```

## Travel moves

Travels are hidden by default, since on a normal print they bury the model in a
hairball.

```js
new GCodePreview({
  canvas,
  renderTravel: true,     // default: false
  travelColor: '#30d158'  // default: 0x990000 (dark red)
});
```

## Bounding box

Setting `boundingBoxColor` is what turns the box on — there is no separate flag,
and leaving it `undefined` means no box is drawn.

```js
new GCodePreview({
  canvas,
  boundingBoxColor: '#ff5fa2'   // default: undefined — no bounding box
});
```

## Camera

The camera is perspective by default. Orthographic drops the perspective
distortion, which makes dimensions comparable across the model.

```js
new GCodePreview({
  canvas,
  orthographic: true,                     // default: false
  initialCameraPosition: [-250, 350, 300] // default: [-100, 400, 450]
});
```

Orbit, pan and zoom are wired up for you — the preview owns an OrbitControls
instance on `preview.sceneManager.controls`.

## Arcs (G2/G3)

Arcs are tessellated into straight segments. The tolerance is the largest
allowed deviation, in mm, between what is drawn and the true arc: smaller is
rounder and heavier.

```js
new GCodePreview({
  canvas,
  arcChordTolerance: 0.01   // default: 0.05 (mm)
});
```

## Drag and drop

```js
new GCodePreview({
  canvas,
  droppable: true   // default: false
});
```

Dropping a `.gcode` file on the canvas clears the preview, streams the dropped
file in and renders it. When it is done, an `update` event is dispatched on the
canvas, so you can hang your own UI off the drop:

```js
canvas.addEventListener('update', (e) => {
  const { filename, size, layers, paths } = e.detail;
  console.log(`${filename}: ${layers} layers, ${paths} paths`);
});
```

## Thumbnails and metadata

PrusaSlicer-family slicers embed preview images as base64 in comments. They are
parsed out and keyed by size:

```js
const thumb = preview.parser.metadata.thumbnails['220x124'];
img.src = thumb.src;   // a ready-to-use data URL
```

The parsed source lines are **not** kept, because holding them costs several
megabytes on a big file and nothing in the library reads them back. Opt in if
you need them:

```js
new GCodePreview({
  canvas,
  keepLines: true   // default: false; then preview.parser.lines is populated
});
```

## Clearing and disposing

`clear()` throws away the current job but keeps the preview usable — this is
what you want before loading another file.

```js
preview.clear();
await preview.processGCode(otherGcode);
```

`dispose()` releases the WebGL resources. Call it when the component unmounts;
browsers cap the number of live WebGL contexts, so leaking previews will
eventually stop rendering altogether.

```js
// React
useEffect(() => {
  const preview = new GCodePreview({ canvas: canvasRef.current });
  return () => preview.dispose();
}, []);
```

## Every option in one place

```js
const preview = new GCodePreview({
  canvas: document.querySelector('canvas'),

  // build volume — omit to render no build plate
  buildVolume: { x: 250, y: 210, z: 220, smallGrid: false },

  // colors (anything three.js accepts: 'hotpink', 0xff69b4, new Color(...))
  backgroundColor: 0xe0e0e0,
  extrusionColor: 'hotpink',   // or an array, one color per tool
  travelColor: 0x990000,
  topLayerColor: 0xffffff,
  lastSegmentColor: 0xffffff,
  boundingBoxColor: 0xff0000,  // undefined = no bounding box

  // what gets drawn
  renderExtrusion: true,
  renderTravel: false,
  renderTubes: true,           // 3D tubes instead of flat lines
  disableGradient: false,      // true = no color gradient between layers

  // geometry, in mm
  lineWidth: 1,                // lines only
  extrusionWidth: 0.6,         // ;WIDTH: comments override this
  lineHeight: 0.2,             // ;HEIGHT: comments override this

  // layer range (1-based), omit to render everything
  startLayer: 1,
  endLayer: 100,
  minLayerThreshold: 0.05,

  // camera
  orthographic: false,         // true = flat, no perspective distortion
  initialCameraPosition: [-100, 400, 450],

  // streaming: how often (ms) partial results are drawn
  liveRenderInterval: 250,

  // G2/G3 arcs: max deviation in mm from the true arc
  arcChordTolerance: 0.05,

  // misc
  droppable: false,            // drag & drop g-code files onto the canvas
  keepLines: false             // keep parsed source on preview.parser.lines
});
```
