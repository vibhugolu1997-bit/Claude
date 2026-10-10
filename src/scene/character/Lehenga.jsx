import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { makeLehengaTextures } from '../textures.js'
import { timeline } from '../../lib/timeline.js'

// Floor-length pleated silk skirt fitted to the measured hips.
export const WAIST_Y = 1.0 // waist height (m) – sits over the tunic's lower half
const TOP = WAIST_Y
const HEM = 0.015
const SEG_A = 96
const SEG_Y = 36
const FOLDS = 18

export function Lehenga({ character }) {
  const { shape, rig } = character
  const mesh = useRef()

  const { geometry, material, base, pelvis } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1, SEG_A, SEG_Y)
    const pos = geometry.attributes.position
    const uv = geometry.attributes.uv
    const base = new Float32Array(pos.count * 4) // theta, y, radius, s
    const c = shape.center(TOP)
    // widest point of hips / tunic / sash below the waist, per azimuth (smoothed)
    const hipR = new Float32Array(SEG_A + 1)
    for (let i = 0; i <= SEG_A; i++) {
      const theta = (i / SEG_A) * Math.PI * 2 + Math.PI
      let m = 0
      for (let y = TOP; y > TOP - 0.3; y -= 0.01) m = Math.max(m, shape.radius(y, theta))
      hipR[i] = m + 0.03
    }
    const hipS = hipR.map((_, i) => {
      let sum = 0
      for (let k = -4; k <= 4; k++) sum += hipR[(i + k + SEG_A) % SEG_A]
      return sum / 9
    })
    for (let j = 0; j <= SEG_Y; j++) {
      const s = j / SEG_Y // 0 at waist → 1 at hem
      const y = THREE.MathUtils.lerp(TOP, HEM, s)
      for (let i = 0; i <= SEG_A; i++) {
        const idx = j * (SEG_A + 1) + i
        const theta = (i / SEG_A) * Math.PI * 2 + Math.PI // seam at the back
        const waistR = shape.radius(TOP, theta) + 0.018
        // bell flare – wider at the back & sides like a heavy lehenga
        const hemR = 0.36 + 0.05 * Math.abs(Math.sin(theta)) + 0.03 * (Math.cos(theta) < 0 ? 1 : 0)
        let r = THREE.MathUtils.lerp(waistR, hemR, Math.pow(s, 1.25))
        // never intersect the hips / tunic underneath (smooth, monotonic flare)
        const k = THREE.MathUtils.smoothstep(s, 0, 0.18)
        r = Math.max(r, THREE.MathUtils.lerp(waistR, Math.max(hipS[i], waistR), k))
        base[idx * 4] = theta
        base[idx * 4 + 1] = y
        base[idx * 4 + 2] = r
        base[idx * 4 + 3] = s
        uv.setXY(idx, i / SEG_A, 1 - s)
      }
    }
    const tex = makeLehengaTextures()
    const material = new THREE.MeshPhysicalMaterial({
      map: tex.map,
      roughnessMap: tex.orm,
      metalnessMap: tex.orm,
      roughness: 1,
      metalness: 1,
      sheen: 0.45,
      sheenRoughness: 0.4,
      sheenColor: new THREE.Color('#b8323e'),
      side: THREE.DoubleSide,
    })
    tex.map.repeat.set(3, 1)
    tex.orm.repeat.set(3, 1)
    // convert texture v so the hem border sits at the bottom
    tex.map.flipY = true
    pos.needsUpdate = true
    return { geometry, material, base, pelvis: rig.get('Bip01 Pelvis'), center: c }
  }, [shape, rig])

  const tmp = useMemo(() => ({ v: new THREE.Vector3(), c: new THREE.Vector3(), q: new THREE.Quaternion() }), [])

  useFrame((state) => {
    const t = timeline.t
    const time = state.clock.elapsedTime
    const pos = geometry.attributes.position
    // follow the pelvis sway (rotation only, around the waist)
    rig.modelQuat(pelvis, tmp.q).multiply(rig.rest.get(pelvis).model.clone().invert())
    const waist = shape.center(TOP, tmp.c)
    const swirl = Math.sin(t * 1.1) * 0.02
    for (let k = 0; k < pos.count; k++) {
      const theta = base[k * 4], y = base[k * 4 + 1], r0 = base[k * 4 + 2], s = base[k * 4 + 3]
      // pleats deepen toward the hem; a slow travelling ripple keeps the silk alive
      const pleat = Math.sin(theta * FOLDS + s * 1.5) * (0.004 + 0.022 * s * s)
      const ripple = Math.sin(theta * 3 - time * 1.6 + s * 4) * 0.006 * s * s
      const r = r0 + pleat + ripple
      const th = theta + swirl * s * s
      const c = shape.center(Math.max(y, TOP - 0.2), tmp.v)
      tmp.v.set(c.x + Math.sin(th) * r, y, c.z + Math.cos(th) * r)
      tmp.v.sub(waist).applyQuaternion(tmp.q).add(waist)
      pos.setXYZ(k, tmp.v.x, tmp.v.y, tmp.v.z)
    }
    pos.needsUpdate = true
    geometry.computeVertexNormals()
  })

  return <mesh ref={mesh} geometry={geometry} material={material} castShadow receiveShadow frustumCulled={false} />
}
