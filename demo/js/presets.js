export const presets = {
  benchy: {
    title: '3DBenchy',
    file: 'gcodes/3DBenchy.gcode',
    model: {
      name: '3DBenchy',
      designer: 'CreativeTools',
      license: 'CC0 - public domain',
      original: 'https://www.thingiverse.com/thing:763622'
    },
    extrusionWidth: 0.45,
    lineHeight: 0.2,
    colors: ['#95dfa1'],
    travelColor: 'red',
    buildVolume: {
      x: 180,
      y: 180,
      z: 0
    }
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
    lineHeight: 0.3,
    colors: ['#95dfa1'],
    travelColor: 'red',
    topLayerColor: undefined,
    lastSegmentColor: undefined,
    buildVolume: {
      x: 130,
      y: 150,
      z: 0,
      smallGrid: true
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
    lineWidth: 0.5,
    lineHeight: 0.4,
    minLayerThreshold: 0.6,
    renderExtrusion: true,
    renderTubes: true,
    colors: ['#8782bf'],
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
    lineHeight: 0.3,
    renderExtrusion: true,
    renderTubes: true,
    colors: ['#919191'],
    renderTravel: true,
    travelColor: '#00FF00',
    topLayerColor: '#aaaaaa',
    lastSegmentColor: undefined,
    buildVolume: {
      x: 200,
      y: 200,
      z: 0
    }
  },
  marlin: {
    title: 'multicolor Nemo (6MB)',
    file: 'https://storage.googleapis.com/gcode-preview.firebasestorage.app/Marlin.gcode',
    model: {
      name: 'Marlin (multi-material remix)',
      designer: 'cipis',
      license: 'CC BY-NC-SA',
      original: 'https://www.thingiverse.com/thing:387266'
    },
    extrusionWidth: 0.5,
    colors: ['orange', 'black', 'white'],
    travelColor: 'red',
    topLayerColor: undefined,
    lastSegmentColor: undefined,
    buildVolume: {
      x: 250,
      y: 250,
      z: 0
    }
  },
  treefrog: {
    title: '2-color tree frog',
    file: 'https://storage.googleapis.com/gcode-preview.firebasestorage.app/2color_treefrog.gcode',
    model: {
      name: '2-color tree frog',
      designer: 'nervoussystem',
      license: 'CC BY-NC',
      original: 'https://www.thingiverse.com/thing:329436'
    },
    extrusionWidth: 0.45,
    lineHeight: 0.2,
    colors: ['#4a9c3f', '#e0a030'],
    travelColor: 'red',
    topLayerColor: undefined,
    lastSegmentColor: undefined,
    buildVolume: {
      x: 250,
      y: 250,
      z: 0
    }
  },
  calicat: {
    title: 'Bounding box',
    file: 'gcodes/calicat.gcode',
    model: {
      name: 'Calicat - the calibration cat',
      designer: 'Dezign',
      license: 'CC BY-NC-SA 3.0',
      original: 'https://www.thingiverse.com/thing:1545913'
    },
    extrusionWidth: 0.45,
    lineHeight: 0.2,
    colors: ['pink'],
    travelColor: 'red',
    topLayerColor: undefined,
    lastSegmentColor: undefined,
    buildVolume: {
      x: 180,
      y: 180,
      z: 0
    },
    boundingBoxColor: 'pink',
    drawBoundingBox: true
  },
  easel: {
    title: 'Easel tool path (cnc)',
    file: 'gcodes/easel.gcode',
    lineWidth: 1,
    renderExtrusion: false,
    renderTravel: true,
    travelColor: '#00FFFF',
    buildVolume: {
      x: 300,
      y: 180,
      z: 0
    },
    initialCameraPosition: [-20, 20, 1.8],
    model: {
      name: 'Easel tool path',
      designer: 'Remco',
      license: 'CC0 - public domain',
      original: 'https://easel.com/projects/jfs2zG8VQ0vNTOqbscKNPA'
    }
  },
  mach3: {
    title: 'Mach3 tool path (cnc)',
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
  }
};
