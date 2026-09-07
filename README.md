# GCode Preview [![npm version](http://img.shields.io/npm/v/gcode-preview.svg?style=flat)](https://npmjs.org/package/gcode-preview "View this project on npm") [![MIT license](http://img.shields.io/badge/license-MIT-brightgreen.svg)](http://opensource.org/licenses/MIT)
A simple [G-code](https://en.wikipedia.org/wiki/G-code) parser & viewer lib with 3D printing in mind. Written in Typescript.

Join us on <a href="https://discord.gg/w2bsGRE6S4">discord</a>

## New org: XYZ Tools
11-11-2024 This repo was moved to a brand new org which is a collaboration between @remcoder and @sophiedeziel for everything 3D printing related.

## Feature summary
- multi-color
- tube geometry
- g2/g3 arcs
- streaming (progressive rendering from a `ReadableStream`)
- thumbnail preview
- build volume
- orthographic camera
- slicer detection (PrusaSlicer family, Cura, Simplify3D, Slic3r)
- drag & drop
- examples for various frameworks

## Demo 

### Minimal demo
<img width="433" alt="image" src="https://github.com/user-attachments/assets/3b52c7a9-d1c9-41c5-9c41-570e12825aaf" />

try it out: https://codepen.io/remcoder/pen/PwYVXBg

### Batteries included
Click to see the [full-fledged demo](https://gcode-preview.web.app/):

[<img title="click to see the demo" width="320" alt="image" src="https://github.com/user-attachments/assets/4e663193-0a01-4fe2-864b-a8ffb18cbcd8">](https://gcode-preview.web.app/)

## Installation

`npm install gcode-preview`

GCode Preview depends on [three.js](https://threejs.org/) and supports `three` `>=0.166.0 <0.186.0`.

### Quick start

```js
  import { GCodePreview } from 'gcode-preview';

  const preview = new GCodePreview({
      canvas: document.querySelector('canvas'),
      extrusionColor: 'hotpink'
  });
  
  // draw a diagonal line
  const gcode = 'G0 X0 Y0 Z0.2\nG1 X42 Y42 E10';
  preview.processGCode(gcode);
```

G-code can also be streamed in and rendered progressively:

```js
  const response = await fetch('benchy.gcode');
  await preview.processGCodeStream(response.body);
```

### Constructor options

The main options accepted by `new GCodePreview({ ... })` (see the
[API docs](https://gcode-preview.web.app/docs) for the full reference):

- `canvas` — the canvas element to render to
- `buildVolume` — renders the build volume (see below)
- colors: `backgroundColor`, `extrusionColor`, `travelColor`, `topLayerColor`, `lastSegmentColor`, `boundingBoxColor`
- render toggles: `renderExtrusion`, `renderTravel`, `renderTubes`, `disableGradient`
- geometry: `lineWidth`, `lineHeight`, `extrusionWidth`
- layer range: `startLayer`, `endLayer`
- camera: `orthographic`, `initialCameraPosition`
- streaming: `liveRenderInterval` (throttles progressive rendering)
- arcs: `arcChordTolerance` (tessellation precision for G2/G3)
- misc: `droppable` (drag & drop g-code files onto the canvas), `devMode` (debug GUI + stats), `keepLines`, `minLayerThreshold`

After construction, most rendering properties live on the scene manager and can
be changed at runtime, e.g. `preview.sceneManager.renderTubes = true`, followed
by a re-render.

### API Docs
Check the full API documentation at https://gcode-preview.web.app/docs

### Vue.js / React / Svelte integration
<img src="https://vuejs.org/logo.svg" height="40px" />

 There's a [Vue.js example](https://github.com/xyz-tools/gcode-preview-examples) that has a [Vue component](https://github.com/xyz-tools/gcode-preview-examples/blob/main/GCodePreview.vue) to wrap the library.

 <img src="https://reactjs.org/favicon.ico" height="42px"/>
 
 @Zeng95 provided a [React & Typescript example](https://github.com/xyz-tools/gcode-preview-react) that has a [React component](https://github.com/xyz-tools/gcode-preview-react/blob/main/src/components/GCodePreview.tsx) to wrap the library.
 
 <img src='https://svelte.dev/favicon.png' height='42px' />
 
 There is a [Svelte example](https://github.com/xyz-tools/gcode-preview-svelte) with a [Svelte component](https://github.com/xyz-tools/gcode-preview-svelte/blob/main/src/lib/GCodePreview.svelte).

## Feature description

### Supported G-code commands

The interpreter currently handles:

| Command | Meaning |
| --- | --- |
| `G0` / `G1` | linear move |
| `G2` / `G3` | clockwise / counter-clockwise arc |
| `G20` / `G21` | set units to inches / millimeters |
| `G28` | home |
| `G31` | straight probe |
| `G38.2`–`G38.5` | probe family |
| `G92` | set position |
| `G92.1` | reset coordinate system offsets |
| `T0`–`T7` | tool selection |

Commands without a handler are parsed but ignored by the interpreter.

`G92` stores offsets for X, Y, Z, and extrusion (E); `G92.1` clears them without moving.
`state.e` tracks cumulative physical extrusion, with logical position `state.e - state.positionShift.e`.
Extrusion moves still use relative E values; `M82`/`M83` mode switching is not yet implemented.

### Multi-color support

GCode files that were sliced for a multi-tool system can be previewed as such. Pass an array of colors as the `extrusionColor` constructor option (or assign `preview.sceneManager.extrusionColor` at runtime), where the index in the array corresponds to the index of the tool: T0..T7. 

example: 
```js
extrusionColor: ['hotpink', 'indigo', 'lime']
```
Here, T0 is hotpink, T1 is indigo and T2 is lime.

<img width="300" alt="image" src="https://github.com/remcoder/gcode-preview/assets/461650/d965d30f-101e-40d3-8ad7-c8257dd7866a">

Supported systems include:
 - Prusa MMU1/2/3 and XL
 - Bambulab AMS & AMS lite
 - Enraged Rabbit Carrot Feeder (ERCF)
 - IDEX machines
 - toolchangers
 - 3D Chameleon
 - Virtual tools (color mixing)
 - and possibly more

### Render extrusion as tubes
Extrusions are rendered as flat lines by default; pass the `renderTubes`
constructor option to get true tube geometry (it can also be toggled at runtime
via `preview.sceneManager.renderTubes`):
```js
new GCodePreview({ canvas, renderTubes: true });
```

### G2/G3 arc support
Thanks to @Sindarius arc commands are now supported, which means gcode processed by ArcWelder should be rendered correctly.

### Thumbnail preview
Thumbnail previews as generated by PrusaSlicer are detected and parsed. In the gcode these are found in comments, enclosed between 'thumbnail begin' and 'thumbnail end'. The images are encoded as base64 strings but split over multiple lines. These are now parsed and patched back together, but still kept a base64. This allows easy use in the browser for us as [data urls](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URIs).

![image](https://github.com/user-attachments/assets/6931167b-d48e-44a8-9233-ec8dbc064a0b) *Thumbnail Preview as generated by PrusaSlicer*

The thumbnails can be accessed like this: 
`gcodePreview.parser.metadata.thumbnails['220x124']`

Thumbnails have a `.src` property that will create a usable data url from the base64 string.

See an [example in the demo source](https://github.com/xyz-tools/gcode-preview/blob/develop/demo/js/app.js#L43-L50).

### Build volume
The build volume will be rendered if the `buildVolume` parameter is passed. It has the following type: 
```ts
buildVolume: { 
  x: number; 
  y: number; 
  z: number;
  smallGrid?: boolean;
}
```
Negative dimensions are clamped to 0.

example:

<img src='https://user-images.githubusercontent.com/461650/103179898-c014a100-4890-11eb-8a25-13415c26f0f4.png' width=200>

## Development
To develop on gcode-preview run:

`npm i && npm run dev`

This runs the demo app which is fairly complete in using the libs features.

If you don't need the demo app, just run `npm run dev:watch`.

Both build a dev bundle in the `dist` directory.
Note the dev bundle:
 - is not minified
 - has no type defs (.d.ts)

### Submitting a PR
See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guidelines. In short, before submitting a PR run:
- `npm run check` (test + typeCheck + lint)
- `npm run build` for a production build
- `npm run test:coverage` — CI requires 100% coverage for every file under `src/`

To auto-fix simple issues:
- `npm run lint:fix` or `npm run prettier:fix`

### Production builds
For working on production builds you can use:
- `npm run demo` which does a prod build and launches the demo app using local server
- or just `npm run build` or `npm run build:watch`

## Feedback
If you have found a bug or if have an idea for a feature, don't hesitate to [create an issue on GitHub](https://github.com/xyz-tools/gcode-preview/issues/new) or [talk to us on Discord](https://discord.gg/w2bsGRE6S4).

## Contributing
Want to help out? We are open to your ideas and always willing to get you started! [talk to us on Discord](https://discord.gg/w2bsGRE6S4).

 - maybe there is an [open issue](https://github.com/xyz-tools/gcode-preview/issues?q=is%3Aissue%20state%3Aopen%20-label%3Ademo%20-label%3A3.1%2B%20-label%3Ablocked%20-label%3Arefactor) that appeals to you?
 - other things that are always helpful:
   - testing different gcode files, from different slicers
   - reporting bugs! Screenshot == ❤️
   - making GCode Preview suitable for different printer types, like Deltas, Belt printers, IDEX, etc. Even CNC machines
   - documentation & examples
   - unit tests

## Contributors 
- ❤️ Thank you @0xTHAC0 for adding the orthographic camera.
- ❤️ Thank you @sophiedeziel for rendering extrusion as tubes and creating a new interpreter.
- ❤️ Thank you @RickRyan26 and @Sindarius for implementing G2/G3 arc support.
- ❤️ Thank you @Zeng95 for providing a React & Typescript example.
- ❤️ Thank you @raulodev for parser and preview fixes.
- ❤️ Thank you @TimTheBig for dependency and tooling updates.

## Known issues
### Preview doesn't render in Brave
This is caused by the device recognition shield in Brave. By changing the setting for "Device Recognition" in Shield settings to "Allow all device recognition attemps" or "Only block cross-site device recognition attemps" you should not get this error.
https://github.com/mrdoob/three.js/issues/16904

## Sponsors

A big thanks to these sponsors for their contributions. 

[<img width=42 src="http://logo.q42.com/q42-logo.svg" />](http://q42.com)

[<img  src="https://duet3d-media.fra1.digitaloceanspaces.com/strapi/c1d3c11cd0e71c45981cedaa2a9170ee.png">](https://www.duet3d.com/)


### Donate
If you want to show gratitude you can always buy me beer/coffee/filament via [ko-fi](https://ko-fi.com/remcoder) or 
[PayPal](https://www.paypal.me/remcoder64)
 ^_^

## License

This project is licensed under the [MIT License](LICENSE).
