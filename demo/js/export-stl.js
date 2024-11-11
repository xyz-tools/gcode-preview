import { STLExporter } from './STLExporter.js';

let link;

export function setup() {
  link = document.createElement( 'a' );
  link.style.display = 'none';
  document.body.appendChild( link );
}

export function exportSTL(mesh, file, binary) {
  console.log('exporting...');

  // Instantiate an exporter
  const exporter = new STLExporter();

  // Configure export options
  const options = { binary: !!binary }

  // Parse the input and generate the STL encoded output
  const result = exporter.parse(mesh, options );

  if (options.binary) {
    saveArrayBuffer(result, file )
  }
  else {
    saveString(result, file)
  }
}

function save( blob, filename ) {
  link.href = URL.createObjectURL( blob );
  link.download = filename;
  link.click();
}

function saveString( text, filename ) {
  save( new Blob( [ text ], { type: 'text/plain' } ), filename );
}

function saveArrayBuffer( buffer, filename ) {
  save( new Blob( [ buffer ], { type: 'application/octet-stream' } ), filename );
}
