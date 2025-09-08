export const defaultSettings = {
  renderTubes: true,
  buildVolume: {
    x: 180,
    y: 180,
    z: 180,
    smallGrid: false
  },
  initialCameraPosition: [-200, 232, 200], // resembles the angle of thumbnail
  lineHeight: 0.2,
  devMode: {
    camera: true,
    renderer: true,
    parser: true,
    buildVolume: true,
    devHelpers: true
  },
  startLayer: undefined, // number | undefined
  endLayer: 1,
  singleLayerMode: false,
  renderTravel: false,
  travelColor: 'red',
  renderExtrusion: true,
  lineWidth: 1,
  extrusionWidth: 0.4,
  colors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00'],
  highlightTopLayer: false,
  topLayerColor: '#40BFBF',
  highlightLastSegment: false,
  lastSegmentColor: null,
  drawBuildVolume: true,
  backgroundColor: '#141414',
  boundingBoxColor: '#A830F8',
  drawBoundingBox: false
};
