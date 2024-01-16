# GCode Preview [![npm version](http://img.shields.io/npm/v/gcode-preview.svg?style=flat)](https://npmjs.org/package/gcode-preview "View this project on npm") [![MIT license](http://img.shields.io/badge/license-MIT-brightgreen.svg)](http://opensource.org/licenses/MIT) <a href="https://www.buymeacoffee.com/remcoder" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="25" width="106"></a>
A simple [G-code](https://en.wikipedia.org/wiki/G-code) parser & viewer with 3D printing in mind. Written in Typescript.

Try the [online demo](https://gcode-preview.web.app/)

<img width="519" alt="image" src="https://github.com/remcoder/gcode-preview/assets/461650/623b21e6-bbac-4124-8c92-83eb163782c6">



## Installation
[![npm version](http://img.shields.io/npm/v/gcode-preview.svg?style=flat)](https://npmjs.org/package/gcode-preview "View this project on npm") 

 `npm install gcode-preview`

or

`yarn add gcode-preview`


### Quick start

```  
  import * as GCodePreview from 'gcode-preview';

  const preview = GCodePreview.init({
      canvas: document.querySelector('canvas'),
      extrusionColor: 'hotpink'
  });
  
  // draw a diagonal line
  const gcode = 'G0 X0 Y0 Z0.2\nG1 X42 Y42 E10';
  preview.processGCode(gcode);
```

### Vue.js / React / Svelte integration
<img src="https://vuejs.org/logo.svg" height="40px" />

 There's a [Vue.js example](https://github.com/remcoder/gcode-preview/tree/develop/vue-demo) that has a [Vue component](https://github.com/remcoder/gcode-preview/blob/develop/vue-demo/src/components/GCodePreview.vue) to wrap the library.

 <img src="https://reactjs.org/favicon.ico" height="42px"/>
 
 @Zeng95 provided a [React & Typescript example](https://github.com/remcoder/gcode-preview/tree/develop/react-typescript-demo) that has a [React component](https://github.com/remcoder/gcode-preview/blob/develop/react-typescript-demo/src/components/GCodePreview.tsx) to wrap the library.
 
 <img src='https://svelte.dev/favicon.png' height='42px' />
 
 There is a [Svelte example](https://github.com/remcoder/gcode-preview/tree/develop/svelte-demo) with a [Svelte component](https://github.com/remcoder/gcode-preview/blob/develop/svelte-demo/src/lib/GCodePreview.svelte).

## Features

### Experimental: render extrusion as tubes
```
renderTubes : true
```

### G2/G3 arc support
Thanks to @Sindarius arc commands are now supported, which means gcode processed by ArcWelder should be rendered correctly.


### 3D WebGL + pan/zoom/rotate controls
![Demo Animation](../assets/benchy.gif?raw=true)

### Thumbnail preview
Thumbnail previews as generated by PrusaSlicer are detected and parsed. In the gcode these are found in comments, enclosed between 'thumbnail begin' and 'thumbnail end'. The images are encoded as base64 strings but split over multiple lines. These are now parsed and patched back together, but still kept a base64. This allows easy use in the browser for us as [data urls](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URIs).

![image](https://user-images.githubusercontent.com/461650/133330840-d11e4681-e265-45d0-b1d9-633ef285d972.png)

The thumbnails can be accessed like this: 
`gcodePreview.parser.metadata.thumbnails['220x124']`

Thumbnails have a `.src` property that will create a usable data url from the base64 string.

See an [example in the demo source](https://github.com/remcoder/gcode-preview/blob/v2.5.0/demo/demo.js#L190-L204).

### Build volume
The build volume will be rendered if the `buildVolume` parameter is passed. It has the following type: 
```
buildVolume: { 
  x: number; 
  y: number; 
  z: number
}
```

example:

<img src='https://user-images.githubusercontent.com/461650/103179898-c014a100-4890-11eb-8a25-13415c26f0f4.png' width=200>

## Demo
Go try the [interactive demo](https://gcode-preview.web.app/).


## Contributing
If you have found a bug or if have an idea for a feature, don't hesitate to [create an issue](https://github.com/remcoder/gcode-preview/issues/new).

It would be great if you want to help! Maybe you'd like to help out with:
 
 - testing GCode Preview with a variety of gcode files, from different slicers
 - making GCode Preview suitable for different printer types, like Deltas, Belt printers, IDEX, etc.
 - reporting any bugs you find and add as much detail as possible, or even better, a screenshot
 - even better yet: send in a pull request :-)
 - apart from the main code, lots of improvements can still be made in:
   - documentation
   - unit tests

## Contributors 
- ❤️ Thank you @sophiedeziel for rendering extrusion as tubes.
- ❤️ Thank you @Sindarius for implementing G2/G3 arc support.
- ❤️ Thank you @Zeng95 for providing a React & Typescript example.

## Changelog
Jump to the [CHANGELOG](CHANGELOG.md)
## Known issues
### Preview doesn't render in Brave
This is caused by the device recognition shield in Brave. By changing the setting for "Device Recognition" in Shield settings to "Allow all device recognition attemps" or "Only block cross-site device recognition attemps" you should not get this error.
https://github.com/mrdoob/three.js/issues/16904

## Sponsors

A big thanks to these sponsors for their contributions. 

[<img width=42 src="http://logo.q42.com/q42-logo.svg" />](http://q42.com)

[<img  src="https://duet3d-media.fra1.digitaloceanspaces.com/strapi/c1d3c11cd0e71c45981cedaa2a9170ee.png">](https://www.duet3d.com/)


### Donate
If you want to show gratitude you can always buy me beer/coffee/filament 
[via a Paypal donation](https://www.paypal.com/paypalme/my/profile ) ^_^

