import { ShaderMaterial } from 'three/src/materials/ShaderMaterial.js';
import { Color } from 'three/src/math/Color.js';

/* 
  This file contains a custom ShaderMaterial that calculates the lighting of a mesh based on the normal of the mesh and a fixed light direction. 
  The material also allows for setting the color, ambient light intensity, directional light intensity, and brightness. 
*/

// Vertex Shader
const vertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fragment Shader
const fragmentShader = `
  uniform vec3 uColor;
  uniform float ambient;
  uniform float directional;
  uniform float brightness;
  varying vec3 vNormal;
  varying vec3 vPosition;
  
  void main() {
    // Fixed light direction (pointing from front-left)
    vec3 lightDir = normalize(vec3(-0.8, -0.2, -0.8));
    
    // Calculate diffuse lighting with increased intensity
    float diff = max(dot(vNormal, -lightDir), 0.0) * directional;
    
    // // Increased ambient light
    // float ambient = 0.5;
    
    // Combine lighting with color
    vec3 finalColor = uColor * (diff + ambient);
    
    // Add a bit of extra brightness
    finalColor = min(finalColor * brightness, 1.0);
    
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

// ShaderMaterial
export function createColorMaterial(
  color: number,
  ambient: number,
  directional: number,
  brightness: number
): ShaderMaterial {
  console.log(color, ambient, directional);
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uColor: { value: new Color(color) },
      ambient: { value: ambient },
      directional: { value: directional },
      brightness: { value: brightness }
    }
  });

  return material;
}
