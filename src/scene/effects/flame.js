import * as THREE from 'three'

// Shared clock for all shader effects.
export const fxUniforms = {
  uTime: { value: 0 },
  uDivine: { value: 0 }, // 0..1 – rises as the goddess awakens
}

// Billboarded teardrop flame with flicker; additive.
export function makeFlameMaterial({ intensity = 1, hue = 0 } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: fxUniforms.uTime,
      uIntensity: { value: intensity },
      uHue: { value: hue },
      uSeed: { value: Math.random() * 100 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uSeed;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        // spherical billboard
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 scale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), 1.0);
        float sway = sin(uTime * 7.0 + uSeed) * 0.04 * uv.y * uv.y;
        mv.xy += (position.xy + vec2(sway, 0.0)) * scale.xy;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uIntensity; uniform float uSeed; uniform float uHue;
      varying vec2 vUv;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        float a = hash(i.x + i.y * 57.0), b = hash(i.x + 1.0 + i.y * 57.0);
        float c = hash(i.x + (i.y + 1.0) * 57.0), d = hash(i.x + 1.0 + (i.y + 1.0) * 57.0);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      void main() {
        vec2 p = vUv * 2.0 - 1.0;            // -1..1
        float y = vUv.y;
        float flick = noise(vec2(p.x * 3.0, y * 4.0 - uTime * 6.0 + uSeed)) * 0.35;
        // teardrop: wide near the base, pointed at the top
        float width = mix(0.55, 0.02, pow(y, 0.8)) * (0.85 + flick);
        float body = 1.0 - smoothstep(width * 0.6, width, abs(p.x + (flick - 0.17) * y * 0.6));
        body *= smoothstep(0.0, 0.12, y) * (1.0 - smoothstep(0.75, 1.0, y + flick * 0.3));
        float core = body * (1.0 - smoothstep(0.0, 0.45, y)) * (1.0 - smoothstep(0.0, 0.25, abs(p.x)));
        vec3 outer = mix(vec3(1.0, 0.32, 0.05), vec3(1.0, 0.12, 0.02), uHue);
        vec3 col = outer * body + vec3(1.0, 0.85, 0.5) * core * 1.6;
        float flicker = 0.85 + 0.15 * sin(uTime * 17.0 + uSeed * 3.0);
        gl_FragColor = vec4(col * uIntensity * flicker, body);
      }
    `,
  })
}

export function makeFlame(size = 0.08, opts) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), makeFlameMaterial(opts))
  m.scale.set(size * 0.55, size, 1)
  m.frustumCulled = false
  m.renderOrder = 10
  return m
}
