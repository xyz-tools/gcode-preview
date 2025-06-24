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
attribute float extrusionDistance;
varying vec3 vNormal;
varying vec3 vPosition;
varying float vWorldY;
varying float vExtrusion;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vPosition = position;
  vWorldY = (modelMatrix * vec4(position, 1.0)).y;
  vExtrusion = extrusionDistance;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

`;

// Fragment Shader
const fragmentShader = `
uniform float ambient;
uniform float directional;
uniform float brightness;
uniform float clipMinY;
uniform float clipMaxY;

varying vec3 vNormal;
varying vec3 vPosition;
varying float vWorldY;
varying float vExtrusion;

// Rainbow mapping function
vec3 hsv2rgb(float h, float s, float v) {
  float c = v * s;
  float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
  float m = v - c;

  vec3 rgb;
  if (h < 1.0 / 6.0)      rgb = vec3(c, x, 0.0);
  else if (h < 2.0 / 6.0) rgb = vec3(x, c, 0.0);
  else if (h < 3.0 / 6.0) rgb = vec3(0.0, c, x);
  else if (h < 4.0 / 6.0) rgb = vec3(0.0, x, c);
  else if (h < 5.0 / 6.0) rgb = vec3(x, 0.0, c);
  else                   rgb = vec3(c, 0.0, x);

  return rgb + vec3(m);
}

vec3 rainbow(float t) {
  // return hsv2rgb(t, 1.0, 1.0); // Full saturation and brightness
  if (t > 0.0 && t < 1.0) {
    return vec3(1.0, 0.0, 0.0);
  }
  return vec3(1.0, 1.0, 1.0); 
}


void main() {
  // Clipping
  if (vWorldY < clipMinY || vWorldY > clipMaxY) discard;

  vec3 lightDir = normalize(vec3(-0.8, -0.2, -0.8));
  float diff = max(dot(vNormal, -lightDir), 0.0) * directional;

  // Map extrusion to [0,1] with optional wrapping every 300 mm
  float t = mod(vExtrusion, 100.0) / 100.0;
  vec3 baseColor = rainbow(t);

  vec3 finalColor = baseColor * (diff + ambient);
  finalColor = min(finalColor * brightness, 1.0);

  gl_FragColor = vec4(finalColor, 1.0);
}

`;

// cachedMaterial is used to store the material so that it is only created once for every color
export const cachedMaterials: { [color: number]: ShaderMaterial } = {};

// TODO: remove the cache or add a way to clear it

export function createColorMaterial(
  color: number,
  ambient: number,
  directional: number,
  brightness: number
): ShaderMaterial {
  // Check if the material for the given color is already cached
  if (cachedMaterials[color]) {
    return cachedMaterials[color];
  }
  // console.debug('createColorMaterial. not cached', color);

  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uColor: { value: new Color(color) },
      ambient: { value: ambient },
      directional: { value: directional },
      brightness: { value: brightness },
      clipMinY: { value: -Infinity },
      clipMaxY: { value: Infinity }
    },
    wireframe: false,
    side: 2, // Double-sided for debugging
  });

  // Cache the material
  cachedMaterials[color] = material;

  return material;
}
