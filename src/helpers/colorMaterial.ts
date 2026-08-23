import { ShaderMaterial } from 'three/src/materials/ShaderMaterial.js';
import { Color } from 'three/src/math/Color.js';

/* 
  This file contains a custom ShaderMaterial that calculates the lighting of a mesh based on the normal of the mesh and a fixed light direction. 
  The material also allows for setting the color, ambient light intensity, directional light intensity, and brightness. 
*/

// Vertex Shader
const vertexShader = `
uniform float clipMinY;
uniform float clipMaxY;
varying vec3 vNormal;
varying vec3 vPosition;
varying float vWorldY;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vPosition = position;
  vWorldY = (modelMatrix * vec4(position, 1.0)).y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Fragment Shader
const fragmentShader = `
uniform vec3 uColor;
uniform float ambient;
uniform float directional;
uniform float brightness;
uniform float clipMinY;
uniform float clipMaxY;
varying vec3 vNormal;
varying vec3 vPosition;
varying float vWorldY;

void main() {
  // Apply clipping
  if (vWorldY < clipMinY || vWorldY > clipMaxY) {
    discard;
  }
  
  // Fixed light direction (pointing from front-left)
  vec3 lightDir = normalize(vec3(-0.8, -0.2, -0.8));
  
  // Calculate diffuse lighting with increased intensity
  float diff = max(dot(vNormal, -lightDir), 0.0) * directional;
  
  // Combine lighting with color
  vec3 finalColor = uColor * (diff + ambient);
  
  // Add a bit of extra brightness
  finalColor = min(finalColor * brightness, 1.0);
  
  gl_FragColor = vec4(finalColor, 1.0);
}
`;

// Each call returns a fresh material: callers mutate the uniforms in place
// (recoloring, clipping), so sharing instances across tools or previews would
// let one write bleed into every mesh with the same starting color.
export function createColorMaterial(
  color: number,
  ambient: number,
  directional: number,
  brightness: number
): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uColor: { value: new Color(color) },
      ambient: { value: ambient },
      directional: { value: directional },
      brightness: { value: brightness },
      clipMinY: { value: -Infinity },
      clipMaxY: { value: Infinity }
    }
  });
}
