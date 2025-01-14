export const presets = {
  mach3: {
    title: 'CNC tool path',
    file: 'gcodes/mach3.gcode',
    lineWidth: 2,
    renderExtrusion: false,
    renderTravel: true,
    travelColor: '#00FF00',
    buildVolume: {
      x: 10,
      y: 10,
      z: 0
    },
    initialCameraPosition: [-20, 20, 1.8]
  },
  arcs: {
    title: 'Arcs with G2/G3',
    file: 'gcodes/screw.gcode',
    model: {
      name: 'Screw and Nut',
      designer: 'YSoft_be3D',
      license: 'CC BY-NC-SA 3.0',
      original: 'https://www.thingiverse.com/thing:387266'
    },
    extrusionWidth: 0.5,
    extrusionColor: ['rgb(83,209,104)'],
    travelColor: 'red',
    topLayerColor: undefined,
    lastSegmentColor: undefined,
    buildVolume: {
      x: 130,
      y: 150,
      z: 0
    }
  },
  'vase-mode': {
    title: 'vase mode',
    model: {
      name: 'Twisted 6-sided Vase Basic',
      designer: 'MaakMijnIdee',
      license: 'CC BY-NC-SA 3.0',
      original: 'https://www.thingiverse.com/thing:18672'
    },
    file: 'gcodes/vase.gcode',
    lineWidth: 0,
    lineHeight: 0.4,
    minLayerThreshold: 0.6,
    renderExtrusion: true,
    renderTubes: true,
    extrusionColor: ['rgb(84,74,187)'],
    renderTravel: true,
    travelColor: '#00FF00',
    topLayerColor: undefined,
    lastSegmentColor: undefined,
    buildVolume: {
      x: 200,
      y: 200,
      z: 0
    },
    initialCameraPosition: [-404, 320, 184]
  },
  'travel-moves': {
    title: 'Travel moves',
    file: 'gcodes/plant-sign.gcode',
    model: {
      name: 'Plant Sign',
      designer: 'SpoonUnit',
      license: 'CC BY-NC-SA 3.0',
      original: 'https://www.thingiverse.com/thing:1013494'
    },
    lineWidth: 1,
    renderExtrusion: true,
    renderTubes: true,
    extrusionColor: ['#777777'],
    renderTravel: true,
    travelColor: '#00FF00',
    topLayerColor: '#aaaaaa',
    lastSegmentColor: undefined,
    buildVolume: {
      x: 200,
      y: 200,
      z: 0
    }
  }
};
