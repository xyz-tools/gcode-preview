# Code examples (2.x)

Runnable snippets for `gcode-preview` **2.x** — the current stable line. Every
option below is optional, and each snippet notes the default it overrides.

Looking at 3.0? The API changed shape: see
[EXAMPLES-v3.md](EXAMPLES-v3.md). For pictures of what these options look like,
see [FEATURES.md](FEATURES.md) — note that a few of the features shown there are
3.0 only, and are marked as such.

## Contents

- [Minimal setup](#minimal-setup)
- [Loading G-code](#loading-g-code)
- [Re-rendering after a change](#re-rendering-after-a-change)
- [Build volume](#build-volume)
- [Colors](#colors)
- [Multi-tool / multi-color](#multi-tool--multi-color)
- [Tubes or lines](#tubes-or-lines)
- [Extrusion dimensions](#extrusion-dimensions)
- [Layer range and a slider](#layer-range-and-a-slider)
- [Travel moves](#travel-moves)
- [Camera](#camera)
- [Arcs (G2/G3)](#arcs-g2g3)
- [Drag and drop](#drag-and-drop)
- [Thumbnails](#thumbnails)
- [Dev mode](#dev-mode)
- [Streaming](#streaming)
- [Clearing and disposing](#clearing-and-disposing)
- [Every option in one place](#every-option-in-one-place)

## Minimal setup

The class is called `WebGLPreview` in 2.x, and the only thing it really needs
is a canvas.

```js
import { WebGLPreview } from 'gcode-preview';

const preview = new WebGLPreview({
  canvas: document.querySelector('canvas')
});
```

That gets you: extrusions drawn as flat lines, travel moves hidden, a light
grey background, a perspective camera and no build plate.

## Loading G-code

`processGCode()` takes a string or an array of lines. It is synchronous, and it
renders as part of the call.

```js
const gcode = await fetch('benchy.gcode').then((r) => r.text());
preview.processGCode(gcode);

console.log(preview.layers.length, 'layers');
```

`preview.layers` includes the preamble (everything before the first move) as
index 0, so it is one longer than the number of printed layers. It is marked
`@internal` in 2.x — handy for a layer count, but don't build on it.

Calling `processGCode()` again **adds** to what is already there. To replace the
model, call `preview.clear()` first.

## Re-rendering after a change

This is the biggest difference from 3.0: in 2.x most options are plain
properties on the preview, and changing one does **not** redraw by itself. Call
`render()` when you are done changing things.

```js
preview.renderTravel = true;
preview.travelColor = '#30d158';
preview.render();
```

Colors assigned through the setters (`extrusionColor`, `travelColor`,
`topLayerColor`, `lastSegmentColor`) are no exception — they take effect on the
next `render()`. The one exception is `backgroundColor`, which is applied to the
scene straight away.

## Build volume

Pass `buildVolume` to draw a build plate; leave it out and nothing is drawn. In
2.x it is a plain `{ x, y, z }` — there is no fine grid option.

```js
new WebGLPreview({
  canvas,
  buildVolume: { x: 250, y: 210, z: 220 }
});
```

## Colors

Anything three.js accepts works: a CSS name, a hex number, or a `Color`.

```js
new WebGLPreview({
  canvas,
  backgroundColor: 0xe0e0e0,  // default: 0xe0e0e0 (light grey)
  extrusionColor: 'hotpink',  // default: 'hotpink'
  travelColor: '#30d158',     // default: 0x990000 (dark red)
  topLayerColor: '#ffffff',   // default: undefined — top layer uses extrusionColor
  lastSegmentColor: '#ff3b30' // default: undefined — last segment uses extrusionColor
});
```

`topLayerColor` and `lastSegmentColor` are what make "where is the print right
now" readable; they only stand out when the view stops short of the last layer.

Each layer is shaded slightly differently by default, which gives the model some
depth. It is a lines-only effect: the gradient is skipped when `renderTubes` is
true, and in `singleLayerMode`. Turn it off for flat, uniform color:

```js
new WebGLPreview({
  canvas,
  disableGradient: true   // default: false
});
```

## Multi-tool / multi-color

Pass an array and the index maps to the tool: `extrusionColor[0]` is `T0`,
`extrusionColor[1]` is `T1`, and so on up to `T7`. A tool with no entry falls
back to `hotpink`.

```js
new WebGLPreview({
  canvas,
  extrusionColor: ['#4a9c3f', '#e0a030']
});
```

There is also a `toolColors` option in the type definition, but in 2.18 it is
stored and never read — it has no effect. Use the array above.

## Tubes or lines

Extrusions are drawn as flat lines by default. Tube geometry is available but
marked experimental in 2.x (in 3.0 it is the default):

```js
new WebGLPreview({
  canvas,
  renderTubes: true   // default: false, @experimental
});
```

Line thickness only applies to the line renderer:

```js
new WebGLPreview({
  canvas,
  lineWidth: 2   // default: undefined (thin GL lines)
});
```

Extrusions can also be hidden entirely, which is mostly useful when you only
care about travel moves:

```js
new WebGLPreview({
  canvas,
  renderExtrusion: false,  // default: true
  renderTravel: true
});
```

## Extrusion dimensions

Tubes are sized from these two, in millimeters. 2.x applies them globally: the
`;WIDTH:` and `;HEIGHT:` comments that some slicers emit are not read at all
(3.0 added that). Left undefined, `lineHeight` falls back to the layer height
the parser worked out.

```js
new WebGLPreview({
  canvas,
  extrusionWidth: 0.45,  // default: 0.6
  lineHeight: 0.2        // default: undefined — uses the parsed layer height
});
```

## Layer range and a slider

`startLayer` and `endLayer` are 1-based indices into `preview.layers` (so layer
1 is the preamble). Omit both and the whole model is drawn. Unlike 3.0, nothing
is clamped and nothing re-renders on assignment.

```js
new WebGLPreview({
  canvas,
  startLayer: 1,
  endLayer: 50
});
```

```js
slider.addEventListener('input', () => {
  preview.endLayer = Number(slider.value);
  preview.render();
});
```

`singleLayerMode` renders only the top visible layer, which is what you want for
a "scrub through the print" view:

```js
preview.singleLayerMode = true;   // default: false
preview.render();
```

A rough layer height threshold decides where one layer ends and the next
begins; raise it for G-code whose Z wobbles. It is read once, when the parser is
created, so it has to go in the constructor.

```js
new WebGLPreview({
  canvas,
  minLayerThreshold: 0.1   // default: 0.05 (mm)
});
```

## Travel moves

Travels are hidden by default, since on a normal print they bury the model in a
hairball.

```js
new WebGLPreview({
  canvas,
  renderTravel: true,     // default: false
  travelColor: '#30d158'  // default: 0x990000
});
```

Some G-code uses moves that look like travels but aren't (a laser or a plotter
with the head down). List those codes and they are drawn as extrusions instead:

```js
new WebGLPreview({
  canvas,
  nonTravelMoves: ['G2', 'G3']   // default: []
});
```

## Camera

2.x has a perspective camera only; the orthographic camera arrived in 3.0.

```js
new WebGLPreview({
  canvas,
  initialCameraPosition: [-250, 350, 300]   // default: [-100, 400, 450]
});
```

Orbit, pan and zoom are wired up for you — the OrbitControls instance is on
`preview.controls`. Call `preview.resize()` after the canvas changes size.

## Arcs (G2/G3)

`G2` and `G3` are interpolated and rendered, with no options to tune. (3.0 adds
`arcChordTolerance` for the interpolation accuracy.)

## Drag and drop

```js
new WebGLPreview({
  canvas,
  allowDragNDrop: true   // default: false
});
```

This is deprecated in 2.x and logs a warning: dropping a file clears the
preview and loads the dropped `.gcode`, with no hook to run your own code in
between. The demo shows how to wire up a drop handler yourself, which is what
2.x wants you to do.

`targetId` — passing the id of a container element instead of a canvas — is
deprecated the same way. Pass `canvas`.

## Thumbnails

PrusaSlicer-family slicers embed preview images as base64 in comments. They are
parsed out and keyed by size:

```js
const thumb = preview.parser.metadata.thumbnails['220x124'];
img.src = thumb.src;   // a ready-to-use data URL
```

## Dev mode

2.x ships a debug overlay: an FPS counter, and a dat.GUI panel for most of the
options above.

```js
new WebGLPreview({
  canvas,
  devMode: true   // default: false, @experimental
});
```

It also takes an object, so the stats panel can go somewhere other than
`document.body`:

```js
devMode: { statsContainer: document.querySelector('#stats') }
```

## Streaming

There is no public streaming API in 2.x. `_readFromStream()` exists and is
marked experimental: it parses as the stream arrives but draws nothing until
you render afterwards, so you get a faster first paint, not a progressive one.

```js
const response = await fetch('big-print.gcode');
await preview._readFromStream(response.body);
preview.render();
```

Progressive rendering while the file downloads — `processGCodeStream()` and
`liveRenderInterval` — is a 3.0 feature.

## Clearing and disposing

`clear()` throws away the current job but keeps the preview usable. Note that it
also resets `startLayer`, `endLayer` and `singleLayerMode`.

```js
preview.clear();
preview.processGCode(otherGcode);
```

`dispose()` releases the WebGL resources. Call it when the component unmounts;
browsers cap the number of live WebGL contexts, so leaking previews will
eventually stop rendering altogether.

```js
// React
useEffect(() => {
  const preview = new WebGLPreview({ canvas: canvasRef.current });
  return () => preview.dispose();
}, []);
```

## Every option in one place

```js
const preview = new WebGLPreview({
  canvas: document.querySelector('canvas'),

  // build volume — omit to render no build plate
  buildVolume: { x: 250, y: 210, z: 220 },

  // colors (anything three.js accepts: 'hotpink', 0xff69b4, new Color(...))
  backgroundColor: 0xe0e0e0,
  extrusionColor: 'hotpink',   // or an array, one color per tool
  travelColor: 0x990000,
  topLayerColor: 0xffffff,
  lastSegmentColor: 0xffffff,
  toolColors: {},              // present in the types, but unused in 2.18

  // what gets drawn
  renderExtrusion: true,
  renderTravel: false,
  renderTubes: false,          // @experimental — 3D tubes instead of flat lines
  disableGradient: false,      // true = no color gradient between layers
  nonTravelMoves: [],          // codes to draw as extrusions, not travels

  // geometry, in mm
  lineWidth: undefined,        // lines only
  extrusionWidth: 0.6,         // global; ;WIDTH: comments are not read in 2.x
  lineHeight: undefined,       // global; falls back to the parsed layer height

  // layer range (1-based, layer 1 is the preamble)
  startLayer: 1,
  endLayer: 100,
  minLayerThreshold: 0.05,

  // camera
  initialCameraPosition: [-100, 400, 450],

  // debugging
  devMode: false,              // @experimental — stats + dat.GUI panel
  debug: false,                // @deprecated — use devMode

  // deprecated
  allowDragNDrop: false,       // implement your own drop handler instead
  targetId: undefined          // pass `canvas` instead
});
```
