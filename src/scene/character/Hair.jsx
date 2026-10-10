import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { makeHairTexture } from '../textures.js'
import { timeline } from '../../lib/timeline.js'

/**
 * Long, loose, waist-length hair.
 *
 * 1. 120 guide curves are verlet-simulated on the CPU: rooted on the measured
 *    scalp under the crown, following the head, colliding with head and back,
 *    stirred by a temple breeze.
 * 2. ~4,300 individual strands are generated on the GPU from those guides
 *    (each blends two neighbouring guides, fans out toward the tip, and gets
 *    its own wave), drawn as camera-facing fibres about a millimetre wide with
 *    alpha-to-coverage anti-aliasing.
 * 3. Strands are shaded with a two-lobe Kajiya–Kay model: a sharp white
 *    highlight and a broader, pigment-tinted secondary highlight shifted along
 *    the strand, plus depth-based self-occlusion and back-lit glow.
 * A sparse layer of dark cards underneath gives the hair its body.
 */

const GUIDES = 120
const POINTS = 16
const CHILDREN = 36
const SEGMENTS = 20
const GRAVITY = -9.8

function rand(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

const strandVertex = /* glsl */ `
  uniform sampler2D uGuides;
  uniform vec2 uGuideSize;      // (points per guide, guide count)
  uniform vec3 uCamLocal;       // camera position in this mesh's space
  uniform vec3 uHeadCenter;
  uniform vec2 uAxis;           // body axis (x, z)
  uniform float uWidth;
  uniform float uPixelAngle;    // world size of one pixel at 1 m distance
  attribute vec4 aStrand;       // guide A, guide B, blend, seed
  attribute vec2 aOffset;       // root offset (side, out) in metres
  attribute float aS;           // 0 root → 1 tip
  attribute float aSide;        // -1 / +1 edge of the fibre
  varying vec3 vT;
  varying vec3 vN;
  varying vec3 vWorld;
  varying float vS;
  varying float vSeed;
  varying float vAcross;
  varying float vAO;
  varying float vCoverage;
  #include <fog_pars_vertex>

  vec3 gp(float g, float k) {
    k = clamp(k, 0.0, uGuideSize.x - 1.0);
    return texture2D(uGuides, vec2((k + 0.5) / uGuideSize.x, (g + 0.5) / uGuideSize.y)).xyz;
  }
  // Catmull-Rom along a guide
  vec3 guideAt(float g, float s, out vec3 tangent) {
    float f = s * (uGuideSize.x - 1.0);
    float k = min(floor(f), uGuideSize.x - 2.0);
    float t = f - k;
    vec3 p0 = gp(g, k - 1.0), p1 = gp(g, k), p2 = gp(g, k + 1.0), p3 = gp(g, k + 2.0);
    if (k < 0.5) p0 = 2.0 * p1 - p2;
    if (k > uGuideSize.x - 2.5) p3 = 2.0 * p2 - p1;
    vec3 b = p2 - p0, c = 2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3, d = -p0 + 3.0 * p1 - 3.0 * p2 + p3;
    tangent = 0.5 * (b + 2.0 * c * t + 3.0 * d * t * t);
    return p1 + 0.5 * (b * t + c * t * t + d * t * t * t);
  }

  void main() {
    vec3 tA, tB;
    vec3 pA = guideAt(aStrand.x, aS, tA);
    vec3 pB = guideAt(aStrand.y, aS, tB);
    vec3 p = mix(pA, pB, aStrand.z);
    vec3 T = normalize(mix(tA, tB, aStrand.z) + vec3(1e-5));

    // strand frame: "out" points away from the head near the scalp and away
    // from the body's axis further down
    vec3 radialBody = vec3(p.x - uAxis.x, 0.0, p.z - uAxis.y);
    vec3 radialHead = p - uHeadCenter;
    vec3 radial = mix(radialHead, radialBody, smoothstep(uHeadCenter.y - 0.02, uHeadCenter.y - 0.16, p.y));
    vec3 outD = normalize(radial - T * dot(radial, T) + vec3(1e-5));
    vec3 sideD = normalize(cross(T, outD));

    float seed = aStrand.w;
    float spread = 1.0 + aS * 1.4;                          // fans out toward the tips
    float clump = mix(1.0, 0.7, smoothstep(0.55, 1.0, aS) * fract(seed * 7.0)); // some tips gather
    vec3 off = sideD * aOffset.x * spread * clump + outD * aOffset.y * (0.7 + aS * 0.9);
    // individual waves: long gentle S-curves + finer frizz
    float ph = seed * 6.2831;
    float waveAmp = (0.006 + 0.008 * fract(seed * 3.7)) * smoothstep(0.0, 0.35, aS);
    off += sideD * (sin(aS * 9.0 + ph) * waveAmp + sin(aS * 31.0 + ph * 3.0) * 0.0012 * smoothstep(0.0, 0.3, aS));
    off += outD * (cos(aS * 7.0 + ph * 2.0) * waveAmp * 0.7);
    vec3 center = p + off;

    // camera-facing fibre
    vec3 viewDir = normalize(uCamLocal - center);
    vec3 bin = normalize(cross(T, viewDir) + vec3(1e-6));
    float width = uWidth * mix(1.0, 0.3, aS * aS) * (0.75 + 0.5 * fract(seed * 13.0));
    // never thinner than ~1 pixel: widen distant fibres and fade them by the same
    // factor, so the hair keeps its true density instead of breaking up or aliasing
    float pixel = length(uCamLocal - center) * uPixelAngle;
    float drawn = max(width, pixel * 1.1);
    vCoverage = width / drawn;
    vec3 pos = center + bin * aSide * drawn * 0.5;

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorld = world.xyz;
    vT = normalize(mat3(modelMatrix) * T);
    vN = normalize(mat3(modelMatrix) * outD);
    vS = aS;
    vSeed = seed;
    vAcross = aSide;
    // self-occlusion: strands deeper in the mass and near the scalp get less light
    float depth = smoothstep(-0.008, 0.02, aOffset.y);
    vAO = mix(0.3, 1.0, depth) * mix(0.5, 1.0, smoothstep(0.0, 0.2, aS));
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const strandFragment = /* glsl */ `
  uniform vec3 uBase;           // hair pigment (linear)
  uniform vec3 uTint2;          // secondary-highlight tint
  uniform vec3 uAmbient;
  uniform vec3 uLightPos[4];
  uniform vec3 uLightCol[4];    // colour × intensity (cd)
  varying vec3 vT;
  varying vec3 vN;
  varying vec3 vWorld;
  varying float vS;
  varying float vSeed;
  varying float vAcross;
  varying float vAO;
  varying float vCoverage;
  #include <fog_pars_fragment>

  float strandSpec(vec3 T, vec3 H, float e) {
    float th = dot(T, H);
    return pow(max(0.0, sqrt(max(0.0, 1.0 - th * th))), e);
  }

  void main() {
    vec3 T = normalize(vT);
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vWorld);
    // per-strand and along-the-strand shift so highlights break into bands
    // instead of lighting the whole curtain at once
    float jitter = fract(sin(vSeed * 91.7) * 437.5) - 0.5;
    float along = sin(vS * 23.0 + vSeed * 40.0) * 0.18 + sin(vS * 61.0 + vSeed * 17.0) * 0.08;
    vec3 T1 = normalize(T + N * (-0.08 + jitter * 0.3 + along));  // primary (R) lobe, shifted to the root
    vec3 T2 = normalize(T + N * (0.12 + jitter * 0.35 + along));  // secondary (TRT) lobe, toward the tip
    vec3 col = uBase * uAmbient * vAO;
    for (int i = 0; i < 4; i++) {
      vec3 Ld = uLightPos[i] - vWorld;
      float d2 = max(dot(Ld, Ld), 0.04);
      vec3 L = Ld * inversesqrt(d2);
      vec3 E = uLightCol[i] / d2;
      vec3 H = normalize(L + V);
      float TL = dot(T, L);
      float diff = mix(0.25, 1.0, sqrt(max(0.0, 1.0 - TL * TL)));
      // light passing through from behind gives hair its glowing rim
      float back = pow(max(0.0, dot(-V, L)), 4.0) * 0.5;
      float s1 = strandSpec(T1, H, 260.0) * 0.12;
      float s2 = strandSpec(T2, H, 60.0) * 0.05;
      col += E * vAO * (uBase * (diff + back) / 3.14159 + vec3(s1) + uTint2 * s2);
    }
    // soft fibre edges and tapered tips (alpha-to-coverage turns this into AA)
    float edge = 1.0 - smoothstep(0.35, 1.0, abs(vAcross));
    float tip = 1.0 - smoothstep(0.82, 1.0, vS);
    gl_FragColor = vec4(col, edge * tip * vCoverage);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

export function Hair({ character, lights }) {
  const { shape, rig, root } = character
  const head = rig.get('Bip01 Head')

  const sim = useMemo(() => {
    const r = rand(42)
    root.updateMatrixWorld(true)
    const eyeY = (rig.modelPos(rig.get('Bip01 LEye')).y + rig.modelPos(rig.get('Bip01 REye')).y) / 2
    // scalp ellipsoid from the measured head
    const cy = eyeY + 0.03
    const c = shape.center(cy)
    const rx = Math.max(shape.radius(cy, Math.PI / 2), shape.radius(cy, -Math.PI / 2)) * 0.97
    const rz = (shape.radius(cy, 0) + shape.radius(cy, Math.PI)) * 0.5 * 0.97
    let top = cy
    while (shape.radius(top + 0.01, Math.PI) > 0.02 && top < cy + 0.3) top += 0.01
    const ry = (top - cy) * 0.95
    const ell = { c: new THREE.Vector3(c.x, cy, c.z), r: new THREE.Vector3(rx, ry, rz) }
    // crown band height: roots hide just beneath it
    const bandFront = Math.asin(THREE.MathUtils.clamp((eyeY + 0.05 - cy) / ry, -1, 1))
    const bandBack = Math.asin(THREE.MathUtils.clamp((eyeY + 0.085 - cy) / ry, -1, 1))

    const headInv = new THREE.Matrix4().copy(head.matrixWorld).invert()
    const guides = []
    for (let i = 0; i < GUIDES; i++) {
      // locks over the shoulders from the temples; the rest round the sides and back
      const front = i < 14
      const phi = front
        ? (i % 2 ? 1 : -1) * Math.PI * (0.36 + r() * 0.08)
        : Math.PI * (0.42 + ((i - 14) / (GUIDES - 14)) * 1.16) + (r() - 0.5) * 0.05
      const back = Math.max(0, -Math.cos(phi))
      const bandElev = THREE.MathUtils.lerp(bandFront, bandBack, back)
      const elev = front ? bandElev - 0.05 - r() * 0.1 : THREE.MathUtils.lerp(-0.45, bandElev - 0.03, Math.sqrt(r()))
      const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(elev), Math.sin(elev), Math.cos(phi) * Math.cos(elev))
      const rootPos = ell.c.clone().add(dir.clone().multiply(ell.r))
      const len = front ? 0.52 + r() * 0.12 : 0.66 + r() * 0.16 - Math.max(0, -elev) * 0.1
      const seg = len / (POINTS - 1)
      const pts = []
      for (let k = 0; k < POINTS; k++) {
        const p = rootPos.clone()
        p.y -= k * seg
        pts.push({ p, prev: p.clone() })
      }
      guides.push({
        rootLocal: rootPos.clone().applyMatrix4(headInv),
        outLocal: rootPos.clone().add(dir.clone().multiplyScalar(0.02)).applyMatrix4(headInv),
        rootModel: rootPos,
        pts,
        seg,
        phase: r() * 10,
        front,
      })
    }
    // nearest neighbour of each guide (strands blend between the two)
    guides.forEach((g, i) => {
      let best = -1, bd = Infinity
      guides.forEach((h, j) => {
        if (i === j || h.front !== g.front) return
        const d = g.rootModel.distanceTo(h.rootModel)
        if (d < bd) {
          bd = d
          best = j
        }
      })
      g.neighbor = best < 0 ? i : best
      g.spacing = bd
    })

    // ---- guide texture
    const guideData = new Float32Array(POINTS * GUIDES * 4)
    const guideTex = new THREE.DataTexture(guideData, POINTS, GUIDES, THREE.RGBAFormat, THREE.FloatType)
    guideTex.magFilter = guideTex.minFilter = THREE.NearestFilter
    guideTex.needsUpdate = true

    // ---- strand geometry (static attributes; positions come from the guides)
    const strands = GUIDES * CHILDREN
    const vPerStrand = (SEGMENTS + 1) * 2
    const count = strands * vPerStrand
    const aStrand = new Float32Array(count * 4)
    const aOffset = new Float32Array(count * 2)
    const aS = new Float32Array(count)
    const aSide = new Float32Array(count)
    const index = new Uint32Array(strands * SEGMENTS * 6)
    let v = 0, ii = 0
    guides.forEach((g, gi) => {
      const spacing = Math.min(Math.max(g.spacing, 0.012), 0.035)
      for (let c = 0; c < CHILDREN; c++) {
        const blend = r() * 0.5
        const seed = r()
        const ox = (r() - 0.5) * spacing * 1.1
        const oy = (r() * 1.1 - 0.35) * 0.018
        const base = v
        for (let k = 0; k <= SEGMENTS; k++) {
          const s = k / SEGMENTS
          for (const side of [-1, 1]) {
            aStrand.set([gi, g.neighbor, blend, seed], v * 4)
            aOffset.set([ox, oy], v * 2)
            aS[v] = s
            aSide[v] = side
            v++
          }
          if (k < SEGMENTS) {
            const a = base + k * 2
            index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], ii)
            ii += 6
          }
        }
      }
    })
    const geometry = new THREE.BufferGeometry()
    // position is required by three.js but unused (computed in the shader)
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    geometry.setAttribute('aStrand', new THREE.BufferAttribute(aStrand, 4))
    geometry.setAttribute('aOffset', new THREE.BufferAttribute(aOffset, 2))
    geometry.setAttribute('aS', new THREE.BufferAttribute(aS, 1))
    geometry.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1))
    geometry.setIndex(new THREE.BufferAttribute(index, 1))

    const lightCount = 4
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog])
    Object.assign(uniforms, {
      uGuides: { value: guideTex },
      uGuideSize: { value: new THREE.Vector2(POINTS, GUIDES) },
      uCamLocal: { value: new THREE.Vector3() },
      uHeadCenter: { value: ell.c.clone() },
      uAxis: { value: new THREE.Vector2(shape.center(1.3).x, shape.center(1.3).z) },
      uWidth: { value: 0.0011 },
      uPixelAngle: { value: 0.001 },
      uBase: { value: new THREE.Color('#0b0d16').convertSRGBToLinear() },
      uTint2: { value: new THREE.Color('#58627e') },
      uAmbient: { value: new THREE.Color(0.55, 0.5, 0.65) },
      uLightPos: { value: Array.from({ length: lightCount }, () => new THREE.Vector3(0, -100, 0)) },
      uLightCol: { value: Array.from({ length: lightCount }, () => new THREE.Color(0, 0, 0)) },
    })
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: strandVertex,
      fragmentShader: strandFragment,
      side: THREE.DoubleSide,
      alphaToCoverage: true,
      fog: true,
    })
    const strandMesh = new THREE.Mesh(geometry, material)
    strandMesh.frustumCulled = false

    // ---- body layer: one dark, soft card per guide fills the mass behind the strands
    const cardV = GUIDES * POINTS * 2
    const cardPos = new Float32Array(cardV * 3)
    const cardUv = new Float32Array(cardV * 2)
    const cardIdx = []
    let cv = 0
    for (let g = 0; g < GUIDES; g++) {
      const u0 = r() * 0.6
      for (let k = 0; k < POINTS; k++) {
        const t = k / (POINTS - 1)
        cardUv.set([u0, 1 - t, u0 + 0.4, 1 - t], cv * 2)
        if (k < POINTS - 1) cardIdx.push(cv, cv + 1, cv + 2, cv + 1, cv + 3, cv + 2)
        cv += 2
      }
    }
    const cardGeo = new THREE.BufferGeometry()
    cardGeo.setAttribute('position', new THREE.BufferAttribute(cardPos, 3))
    cardGeo.setAttribute('uv', new THREE.BufferAttribute(cardUv, 2))
    cardGeo.setIndex(cardIdx)
    const cardMat = new THREE.MeshStandardMaterial({
      map: makeHairTexture(),
      color: '#20242f',
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0,
      envMapIntensity: 0.15,
    })
    const cardMesh = new THREE.Mesh(cardGeo, cardMat)
    cardMesh.frustumCulled = false

    const group = new THREE.Group()
    group.add(cardMesh, strandMesh)
    return { guides, ell, group, guideTex, guideData, cardMesh, material, settled: false, lastT: -1 }
  }, [shape, rig, root, head])

  const tmp = useMemo(
    () => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), m: new THREE.Matrix4(), inv: new THREE.Matrix4(), side: new THREE.Vector3(), out: new THREE.Vector3(), tan: new THREE.Vector3(), c: new THREE.Vector3() }),
    [],
  )

  useFrame((state, delta) => {
    const { guides, ell, material } = sim
    const t = timeline.t
    const rootInv = tmp.m.copy(root.matrixWorld).invert()
    const headM = new THREE.Matrix4().multiplyMatrices(rootInv, head.matrixWorld)
    if (!sim.restHeadInv) sim.restHeadInv = new THREE.Matrix4().copy(head.matrixWorld).invert().premultiply(rootInv).invert()
    const ellM = new THREE.Matrix4().multiplyMatrices(headM, sim.restHeadInv)
    const ellC = ell.c.clone().applyMatrix4(ellM)
    const ellInv = new THREE.Matrix4().copy(ellM).invert()

    const reset = t < sim.lastT - 0.01 || !sim.settled
    sim.lastT = t
    const running = timeline.playing || reset
    const steps = reset ? 90 : running ? 2 : 0
    const dt = reset ? 1 / 60 : Math.min(delta, 1 / 30) / 2
    const time = state.clock.elapsedTime

    for (let step = 0; step < steps; step++) {
      for (const s of guides) {
        const rootP = tmp.a.copy(s.rootLocal).applyMatrix4(headM)
        const outP = tmp.b.copy(s.outLocal).applyMatrix4(headM)
        s.pts[0].p.copy(rootP)
        s.pts[0].prev.copy(rootP)
        s.pts[1].p.copy(outP).addScaledVector(new THREE.Vector3(0, -1, 0), s.seg * 0.6)
        s.pts[1].prev.copy(s.pts[1].p)
        const gust = 0.5 + 0.5 * Math.sin(time * 0.9 + s.phase)
        const wind = new THREE.Vector3(0.3 + 0.25 * gust, 0.05, -0.5 - 0.4 * gust).multiplyScalar(reset ? 0 : 1)
        for (let k = 2; k < POINTS; k++) {
          const pt = s.pts[k]
          const vel = pt.p.clone().sub(pt.prev).multiplyScalar(0.965)
          pt.prev.copy(pt.p)
          const flutter = Math.sin(time * 2.3 + s.phase + k * 0.6) * 0.25
          pt.p.add(vel).add(new THREE.Vector3(wind.x + flutter * 0.3, GRAVITY + wind.y, wind.z + flutter * 0.2).multiplyScalar(dt * dt * (k / POINTS)))
        }
        for (let it = 0; it < 3; it++) {
          for (let k = 2; k < POINTS; k++) {
            const a = s.pts[k - 1].p, b = s.pts[k].p
            const d = b.clone().sub(a)
            const len = d.length() || 1e-6
            const diff = (len - s.seg) / len
            if (k === 2) b.addScaledVector(d, -diff)
            else {
              a.addScaledVector(d, diff * 0.5)
              b.addScaledVector(d, -diff * 0.5)
            }
          }
          for (let k = 2; k < POINTS; k++) collide(s.pts[k].p, ellC, ellInv, ell, shape)
        }
      }
    }
    if (reset) sim.settled = true

    // ---- upload guides
    const data = sim.guideData
    guides.forEach((g, gi) => {
      g.pts.forEach((pt, k) => data.set([pt.p.x, pt.p.y, pt.p.z, 1], (gi * POINTS + k) * 4))
    })
    sim.guideTex.needsUpdate = true

    // ---- strand uniforms: camera in mesh space, scene lights
    const u = material.uniforms
    const meshInv = tmp.inv.copy(sim.group.matrixWorld).invert()
    u.uCamLocal.value.copy(state.camera.position).applyMatrix4(meshInv)
    const fovRad = THREE.MathUtils.degToRad(state.camera.fov || 32)
    u.uPixelAngle.value = (2 * Math.tan(fovRad / 2)) / Math.max(1, state.size.height * state.viewport.dpr)
    u.uHeadCenter.value.copy(ellC)
    const ls = lights?.current || []
    for (let i = 0; i < 4; i++) {
      const l = ls[i]
      if (!l) continue
      l.getWorldPosition(u.uLightPos.value[i])
      u.uLightCol.value[i].copy(l.color).multiplyScalar(l.intensity)
    }

    // ---- body-layer cards (slightly inside the strand mass)
    const pos = sim.cardMesh.geometry.attributes.position.array
    let v = 0
    for (const s of guides) {
      for (let k = 0; k < POINTS; k++) {
        const p = s.pts[k].p
        const q = s.pts[Math.min(k + 1, POINTS - 1)].p, o = s.pts[Math.max(k - 1, 0)].p
        tmp.tan.copy(q).sub(o).normalize()
        const c = shape.center(Math.min(Math.max(p.y, 0.8), 1.6), tmp.c)
        tmp.out.set(p.x - c.x, 0, p.z - c.z).normalize()
        tmp.side.crossVectors(tmp.tan, tmp.out).normalize()
        const w = 0.045 * (1 - (k / (POINTS - 1)) * 0.5)
        const inset = -0.004
        for (const sgn of [-1, 1]) {
          pos[v * 3] = p.x + tmp.side.x * (w / 2) * sgn + tmp.out.x * inset
          pos[v * 3 + 1] = p.y + tmp.side.y * (w / 2) * sgn
          pos[v * 3 + 2] = p.z + tmp.side.z * (w / 2) * sgn + tmp.out.z * inset
          v++
        }
      }
    }
    sim.cardMesh.geometry.attributes.position.needsUpdate = true
    sim.cardMesh.geometry.computeVertexNormals()
  })

  return <primitive object={sim.group} />
}

const _l = new THREE.Vector3()
const _m = new THREE.Matrix4()
function collide(p, ellC, ellInv, ell, shape) {
  // scalp ellipsoid (in the head's current frame)
  _l.copy(p).applyMatrix4(ellInv).sub(ell.c).divide(ell.r)
  const d = _l.length()
  if (d < 1.07) {
    _l.multiplyScalar(1.07 / d).multiply(ell.r).add(ell.c)
    p.copy(_l.applyMatrix4(_m.copy(ellInv).invert()))
  }
  // neck, shoulders and back: keep outside the measured body surface
  if (p.y > 0.75 && p.y < ellC.y - 0.06) {
    const c = shape.center(p.y)
    const dx = p.x - c.x, dz = p.z - c.z
    const th = Math.atan2(dx, dz)
    const r = Math.hypot(dx, dz)
    const minR = shape.radius(p.y, th) + 0.02
    if (r < minR) {
      p.x = c.x + (dx / (r || 1)) * minR
      p.z = c.z + (dz / (r || 1)) * minR
    }
  }
}
