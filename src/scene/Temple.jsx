import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { makeStoneTextures } from './textures.js'
import { makeFlame, fxUniforms } from './effects/flame.js'
import { latheGeometry } from './character/jewelry.js'
import { timeline, smooth, win } from '../lib/timeline.js'

export const DAIS_TOP = 0.16

// deterministic random so every replay / recording looks identical
function seeded(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

// ---------------------------------------------------------------- materials
function useStone() {
  return useMemo(() => {
    const floor = makeStoneTextures({ tiles: 4, seed: 5, base: [34, 30, 30], polished: true })
    floor.map.repeat.set(6, 6)
    floor.orm.repeat.set(6, 6)
    const pillar = makeStoneTextures({ tiles: 1, seed: 9, base: [92, 74, 58] })
    pillar.map.repeat.set(2, 3)
    pillar.orm.repeat.set(2, 3)
    const wall = makeStoneTextures({ tiles: 6, seed: 13, base: [70, 56, 46] })
    wall.map.repeat.set(2, 1.6)
    return {
      wall: new THREE.MeshStandardMaterial({ map: wall.map, roughness: 0.85, color: '#a08a76' }),
      floor: new THREE.MeshStandardMaterial({ map: floor.map, roughnessMap: floor.orm, roughness: 1, metalness: 0, envMapIntensity: 1.4 }),
      pillar: new THREE.MeshStandardMaterial({ map: pillar.map, roughnessMap: pillar.orm, roughness: 1, color: '#c9b39a' }),
      darkStone: new THREE.MeshStandardMaterial({ color: '#2a2220', roughness: 0.6 }),
      brass: new THREE.MeshStandardMaterial({ color: '#c08a3e', metalness: 1, roughness: 0.32 }),
      gold: new THREE.MeshStandardMaterial({ color: '#d9a44e', metalness: 1, roughness: 0.25 }),
    }
  }, [])
}

// carved column: plinth, fluted shaft with bands, bell capital and bracket
function pillarGeometry() {
  const H = 4.6
  const profile = [
    [0.0, 0], [0.34, 0], [0.34, 0.12], [0.3, 0.16], [0.3, 0.32], [0.26, 0.36], [0.26, 0.42], [0.22, 0.46],
    [0.2, 0.5], [0.2, 1.2], [0.23, 1.24], [0.23, 1.32], [0.2, 1.36], [0.19, 2.6], [0.22, 2.64], [0.22, 2.72],
    [0.19, 2.76], [0.18, 3.7], [0.21, 3.75], [0.27, 3.9], [0.3, 4.05], [0.24, 4.15], [0.3, 4.2], [0.36, 4.3],
    [0.36, 4.45], [0.0, 4.45],
  ]
  const g = latheGeometry(profile, 32)
  // flutes on the shaft
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const onShaft = (y > 0.52 && y < 1.18) || (y > 1.4 && y < 2.58) || (y > 2.8 && y < 3.68)
    if (!onShaft) continue
    const a = Math.atan2(z, x)
    const k = 1 - 0.06 * Math.pow(Math.abs(Math.sin(a * 8)), 0.6)
    p.setX(i, x * k)
    p.setZ(i, z * k)
  }
  g.computeVertexNormals()
  // square abacus on top
  const cap = new THREE.BoxGeometry(0.9, 0.18, 0.9).translate(0, H - 0.06, 0)
  const capIdx = cap.toNonIndexed()
  const gi = g.toNonIndexed()
  gi.deleteAttribute('uv')
  capIdx.deleteAttribute('uv')
  const merged = new THREE.BufferGeometry()
  const pos = new Float32Array(gi.attributes.position.count * 3 + capIdx.attributes.position.count * 3)
  pos.set(gi.attributes.position.array, 0)
  pos.set(capIdx.attributes.position.array, gi.attributes.position.count * 3)
  const nrm = new Float32Array(pos.length)
  nrm.set(gi.attributes.normal.array, 0)
  nrm.set(capIdx.attributes.normal.array, gi.attributes.normal.count * 3)
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  // cylindrical UVs for the stone texture
  const uv = new Float32Array((pos.length / 3) * 2)
  for (let i = 0; i < pos.length / 3; i++) {
    uv[i * 2] = Math.atan2(pos[i * 3 + 2], pos[i * 3]) / (Math.PI * 2) + 0.5
    uv[i * 2 + 1] = pos[i * 3 + 1] / H
  }
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return merged
}

function Pillars({ mat }) {
  const geo = useMemo(pillarGeometry, [])
  const spots = useMemo(() => {
    const s = []
    for (const x of [-1.7, 1.7]) for (const z of [-1.4, 0.9, 3.2, 5.5]) s.push([x, 0, z])
    return s
  }, [])
  return (
    <group>
      {spots.map((p, i) => (
        <mesh key={i} geometry={geo} material={mat} position={p} rotation-y={i * 0.7} castShadow receiveShadow />
      ))}
      {/* stone lintels */}
      {[-1.7, 1.7].map((x) => (
        <mesh key={x} position={[x, 4.62, 2.05]} material={mat} receiveShadow>
          <boxGeometry args={[0.7, 0.36, 8.4]} />
        </mesh>
      ))}
    </group>
  )
}

// stepped lotus dais the goddess stands on
function Dais({ mats }) {
  const petals = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(-0.09, 0)
    s.bezierCurveTo(-0.11, 0.06, -0.05, 0.13, 0, 0.17)
    s.bezierCurveTo(0.05, 0.13, 0.11, 0.06, 0.09, 0)
    s.closePath()
    return new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2 })
  }, [])
  const ring = useMemo(() => {
    const items = []
    const n = 28
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      items.push({ pos: [Math.sin(a) * 0.74, DAIS_TOP - 0.06, Math.cos(a) * 0.74], rot: [-0.55, a, 0] })
    }
    return items
  }, [])
  return (
    <group>
      <mesh material={mats.darkStone} receiveShadow castShadow position={[0, 0.03, 0]}>
        <cylinderGeometry args={[1.05, 1.1, 0.06, 64]} />
      </mesh>
      <mesh material={mats.darkStone} receiveShadow castShadow position={[0, 0.06 + (DAIS_TOP - 0.06) / 2, 0]}>
        <cylinderGeometry args={[0.8, 0.86, DAIS_TOP - 0.06, 64]} />
      </mesh>
      {ring.map((p, i) => (
        <mesh key={i} geometry={petals} material={mats.gold} position={p.pos} rotation={p.rot} castShadow />
      ))}
    </group>
  )
}

// prabhavali: the gold aureole behind the goddess, ringed with sacred fire
function Aureole({ mats }) {
  const group = useRef()
  const flames = useMemo(() => {
    const g = new THREE.Group()
    const n = 30
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (-0.08 + (i / (n - 1)) * 1.16) // an arch over the head
      const f = makeFlame(0.16, { intensity: 0.9 })
      f.position.set(Math.cos(a) * 1.02, Math.sin(a) * 1.02, 0.02)
      f.userData.base = 0.12 + (i % 3) * 0.02
      g.add(f)
    }
    return g
  }, [])
  const spires = useMemo(() => {
    const items = []
    for (let i = 0; i < 21; i++) {
      const a = Math.PI * (-0.05 + (i / 20) * 1.1)
      items.push({ a })
    }
    return items
  }, [])
  const spireGeo = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(-0.05, 0)
    s.bezierCurveTo(-0.06, 0.05, -0.02, 0.09, 0, 0.14)
    s.bezierCurveTo(0.02, 0.09, 0.06, 0.05, 0.05, 0)
    s.closePath()
    return new THREE.ExtrudeGeometry(s, { depth: 0.01, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 1 })
  }, [])
  useFrame(() => {
    const d = fxUniforms.uDivine.value
    flames.children.forEach((f, i) => {
      const k = smooth((d * 1.4 - i / flames.children.length * 0.4))
      const s = f.userData.base * (0.2 + 0.8 * k)
      f.scale.set(s * 0.55, s, 1)
      f.material.uniforms.uIntensity.value = 0.15 + 1.1 * k
    })
  })
  return (
    <group ref={group} position={[0, DAIS_TOP + 1.42, -0.42]}>
      <mesh material={mats.gold} castShadow>
        <torusGeometry args={[0.92, 0.035, 16, 96, Math.PI * 1.1]} />
      </mesh>
      <mesh material={mats.gold} rotation-z={-Math.PI * 0.05} castShadow>
        <torusGeometry args={[0.86, 0.012, 8, 96, Math.PI * 1.1]} />
      </mesh>
      {spires.map((s, i) => (
        <mesh key={i} geometry={spireGeo} material={mats.gold} position={[Math.cos(s.a) * 0.95, Math.sin(s.a) * 0.95, -0.005]} rotation-z={s.a - Math.PI / 2} />
      ))}
      {/* the aureole's posts down to the dais */}
      {[-1, 1].map((x) => (
        <mesh key={x} material={mats.gold} position={[x * 0.92, -0.75, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.04, 1.5, 16]} />
        </mesh>
      ))}
      <primitive object={flames} />
    </group>
  )
}

// tall brass lamp stands (deepastambha) with five wicks each
function LampStand({ position, mats, lightRef }) {
  const geo = useMemo(
    () =>
      latheGeometry([
        [0, 0], [0.22, 0], [0.22, 0.03], [0.12, 0.08], [0.06, 0.14], [0.045, 0.3], [0.07, 0.34], [0.04, 0.38],
        [0.035, 0.95], [0.06, 1.0], [0.035, 1.05], [0.035, 1.18], [0.16, 1.22], [0.2, 1.26], [0.19, 1.28], [0.0, 1.27],
      ], 32),
    [],
  )
  const flames = useMemo(() => {
    const g = new THREE.Group()
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      const f = makeFlame(0.085)
      f.position.set(Math.cos(a) * 0.15, 1.29, Math.sin(a) * 0.15)
      g.add(f)
    }
    return g
  }, [])
  return (
    <group position={position}>
      <mesh geometry={geo} material={mats.brass} castShadow receiveShadow />
      <primitive object={flames} />
      <pointLight ref={lightRef} position={[0, 1.42, 0]} color="#ff9440" intensity={3} distance={7} decay={2} />
    </group>
  )
}

// a row of small clay diyas lining the aisle
function Diyas({ mats }) {
  const { lamps, flames } = useMemo(() => {
    const spots = []
    for (const x of [-1.25, 1.25]) for (let z = 1.3; z < 8; z += 0.55) spots.push([x, 0, z])
    const diya = latheGeometry([[0, 0], [0.04, 0.0], [0.055, 0.015], [0.06, 0.03], [0.055, 0.032], [0.045, 0.02], [0, 0.018]], 16)
    const mesh = new THREE.InstancedMesh(diya, mats.brass, spots.length)
    const g = new THREE.Group()
    spots.forEach((p, i) => {
      mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(...p))
      const f = makeFlame(0.055, { intensity: 0.9 })
      f.position.set(p[0] + 0.03, 0.03, p[2])
      g.add(f)
    })
    mesh.instanceMatrix.needsUpdate = true
    return { lamps: mesh, flames: g }
  }, [mats])
  return (
    <group>
      <primitive object={lamps} />
      <primitive object={flames} />
    </group>
  )
}

// volumetric light shaft from the sanctum's opening above
function LightShaft() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uTime: fxUniforms.uTime, uDivine: fxUniforms.uDivine },
        vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform float uTime; uniform float uDivine; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
          void main(){
            float edge = pow(abs(dot(vN, vV)), 1.5);
            float fall = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
            float streak = 0.75 + 0.25 * sin(vUv.x * 40.0 + uTime * 0.4) * sin(vUv.x * 17.0 - uTime * 0.25);
            float a = edge * fall * streak * (0.05 + 0.07 * uDivine);
            gl_FragColor = vec4(vec3(1.0, 0.82, 0.6) * a, a);
          }`,
      }),
    [],
  )
  return (
    <mesh position={[0, 3.0, 0.05]} material={mat} renderOrder={5}>
      <cylinderGeometry args={[0.35, 1.25, 6, 48, 1, true]} />
    </mesh>
  )
}

// slow motes of dust / incense floating through the light
function Motes({ count = 380 }) {
  const ref = useRef()
  const { geo, mat } = useMemo(() => {
    const rnd = seeded(21)
    const g = new THREE.BufferGeometry()
    const p = new Float32Array(count * 3)
    const s = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(rnd()) * 1.6
      const a = rnd() * Math.PI * 2
      p.set([Math.cos(a) * r, rnd() * 4.2, Math.sin(a) * r + 0.6], i * 3)
      s[i] = rnd()
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(s, 1))
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: fxUniforms.uTime, uDivine: fxUniforms.uDivine, uPx: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: `uniform float uTime; uniform float uPx; attribute float aSeed; varying float vA;
        void main(){ vec3 p = position;
          p.y = mod(p.y + uTime * (0.03 + aSeed * 0.05), 4.2);
          p.x += sin(uTime * 0.3 + aSeed * 30.0) * 0.12; p.z += cos(uTime * 0.25 + aSeed * 20.0) * 0.12;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uPx * (1.5 + aSeed * 2.5) * (3.0 / -mv.z);
          vA = 0.25 + 0.75 * fract(aSeed * 7.0);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uDivine; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA * (0.35 + 0.5 * uDivine);
          gl_FragColor = vec4(vec3(1.0, 0.8, 0.55) * a, a); }`,
    })
    return { geo: g, mat: m }
  }, [count])
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} />
}

// glowing embers rising around the goddess once she awakens
function Embers({ count = 140 }) {
  const { geo, mat } = useMemo(() => {
    const rnd = seeded(77)
    const g = new THREE.BufferGeometry()
    const p = new Float32Array(count * 3)
    const s = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2
      const r = 0.4 + rnd() * 0.9
      p.set([Math.cos(a) * r, rnd() * 2.6, Math.sin(a) * r * 0.6 - 0.1], i * 3)
      s[i] = rnd()
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(s, 1))
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: fxUniforms.uTime, uDivine: fxUniforms.uDivine, uPx: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: `uniform float uTime; uniform float uPx; attribute float aSeed; varying float vA;
        void main(){ vec3 p = position;
          float life = fract(uTime * (0.12 + aSeed * 0.1) + aSeed);
          p.y += life * 1.6; p.x += sin(life * 6.0 + aSeed * 40.0) * 0.08;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uPx * (2.0 + aSeed * 3.0) * (3.0 / -mv.z);
          vA = sin(life * 3.14159);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uDivine; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA * uDivine;
          gl_FragColor = vec4(vec3(1.0, 0.45, 0.12) * a * 1.6, a); }`,
    })
    return { geo: g, mat: m }
  }, [count])
  return <points geometry={geo} material={mat} frustumCulled={false} position={[0, DAIS_TOP, 0]} />
}

export default function Temple() {
  const mats = useStone()
  const lampL = useRef(), lampR = useRef()
  useFrame((state) => {
    const time = state.clock.elapsedTime
    fxUniforms.uTime.value = time
    fxUniforms.uDivine.value = smooth(win(timeline.t, 1.8, 4.2))
    const flick = (s) => 2.6 + Math.sin(time * 11 + s) * 0.25 + Math.sin(time * 23 + s * 2) * 0.15
    if (lampL.current) lampL.current.intensity = flick(0)
    if (lampR.current) lampR.current.intensity = flick(3)
  })
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} material={mats.floor} receiveShadow>
        <planeGeometry args={[14, 22]} />
      </mesh>
      {/* sanctum back wall */}
      <mesh position={[0, 2.5, -2.6]} material={mats.wall} receiveShadow>
        <boxGeometry args={[6, 5, 0.3]} />
      </mesh>
      <Pillars mat={mats.pillar} />
      <Dais mats={mats} />
      <Aureole mats={mats} />
      <LampStand position={[-1.15, 0, 0.55]} mats={mats} lightRef={lampL} />
      <LampStand position={[1.15, 0, 0.55]} mats={mats} lightRef={lampR} />
      <Diyas mats={mats} />
      <LightShaft />
      <Motes />
      <Embers />
    </group>
  )
}
