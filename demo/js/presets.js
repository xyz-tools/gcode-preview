export const settingsPresets = {
  multicolor: {
    title: 'Multicolor',
    file: 'gcodes/3DBenchy-Multi-part.gcode',
    lineWidth: 1,
    singleLayerMode: false,
    renderExtrusion: true,
    renderTubes: true,
    extrusionColors: ['#CF439D', 'rgb(84,74,187)', 'white', 'rgb(83,209,104)'],
    travel: false,
    travelColor: '#00FF00',
    highlightTopLayer: false,
    topLayerColor: undefined,
    lastSegmentColor: undefined,
    drawBuildVolume: true,
    buildVolume: {
      x: 180,
      y: 180,
      z: 0
    }
  },
  mach3: {
    title: 'CNC tool path',
    file: 'gcodes/mach3.gcode',
    lineWidth: 1,
    singleLayerMode: false,
    renderExtrusion: false,
    renderTubes: false,
    extrusionColors: [],
    travel: true,
    travelColor: '#00FF00',
    highlightTopLayer: false,
    topLayerColor: undefined,
    lastSegmentColor: undefined,
    drawBuildVolume: true,
    buildVolume: {
      x: 20,
      y: 20,
      z: ''
    }
  },
  arcs: {
    title: 'Arcs with G2/G3',
    file: 'gcodes/screw.gcode',
    lineWidth: 2,
    singleLayerMode: true,
    renderExtrusion: true,
    renderTubes: true,
    extrusionColors: ['rgb(83,209,104)'],
    travel: false,
    travelColor: '#00FF00',
    highlightTopLayer: false,
    topLayerColor: undefined,
    lastSegmentColor: undefined,
    drawBuildVolume: true,
    buildVolume: {
      x: 150,
      y: 150,
      z: 150
    }
  },
  'vase-mode': {
    title: 'Vase mode',
    file: 'gcodes/vase.gcode',
    lineWidth: 1,
    singleLayerMode: true,
    renderExtrusion: true,
    renderTubes: true,
    extrusionColors: ['rgb(84,74,187)'],
    travel: false,
    travelColor: '#00FF00',
    highlightTopLayer: true,
    topLayerColor: '#40BFBF',
    lastSegmentColor: '#ffffff',
    drawBuildVolume: true,
    buildVolume: {
      x: 200,
      y: 200,
      z: 180
    }
  },
  'travel-moves': {
    title: 'Travel moves',
    file: 'gcodes/plant-sign.gcode',
    lineWidth: 2,
    singleLayerMode: false,
    renderExtrusion: true,
    renderTubes: true,
    extrusionColors: ['#777777'],
    travel: true,
    travelColor: '#00FF00',
    highlightTopLayer: true,
    topLayerColor: '#aaaaaa',
    lastSegmentColor: undefined,
    drawBuildVolume: true,
    buildVolume: {
      x: 200,
      y: 200,
      z: 180
    }
  }
};
