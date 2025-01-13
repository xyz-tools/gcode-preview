import { ShaderMaterial } from "three/src/materials/ShaderMaterial.js";
import { Color } from "three/src/math/Color.js";

// Vertex Shader
const vertexShader = `
  varying vec3 vPosition;
  void main() {
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fragment Shader
const fragmentShader = `
  uniform vec3 uColor;
  varying vec3 vPosition;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
  }
`;

// ShaderMaterial
export function createColorMaterial(color: number) {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uColor: { value: new Color(color) }
    }
  });
}

