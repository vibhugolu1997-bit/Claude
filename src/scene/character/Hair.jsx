import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { makeHairTexture } from '../textures.js'
import { timeline } from '../../lib/timeline.js'

// Long, loose hair falling to the waist: verlet-simulated strands rooted on the
// measured scalp, colliding with the head and back, rendered as alpha-textured
// ribbon cards (two cards per strand for volume).

const STRANDS = 110
const POINTS = 14
const GRAVITY = -9.8

function rand(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

export function Hair({ character }) {
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

    const headInv = new THREE.Matrix4().copy(head.matrixWorld).invert()
    const strands = []
    for (let i = 0; i < STRANDS; i++) {
      // azimuth from one side round the back to the other; a few strands come forward over the shoulders
      // a few locks fall over the shoulders, the rest cascade down the back
      const front = i < 10
      const phi = front
        ? (i % 2 ? 1 : -1) * (Math.PI * (0.42 + r() * 0.07))
        : Math.PI * (0.4 + ((i - 10) / (STRANDS - 10)) * 1.2) + (r() - 0.5) * 0.08
      const elev = front ? 0.35 + r() * 0.2 : 0.15 + r() * 0.75
      const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(elev), Math.sin(elev), Math.cos(phi) * Math.cos(elev))
      const rootPos = ell.c.clone().add(dir.clone().multiply(ell.r).multiplyScalar(1.02))
      const len = front ? 0.5 + r() * 0.12 : 0.62 + r() * 0.2
      const seg = len / (POINTS - 1)
      const pts = []
      for (let k = 0; k < POINTS; k++) {
        const p = rootPos.clone()
        p.y -= k * seg
        pts.push({ p, prev: p.clone() })
      }
      strands.push({
        rootLocal: rootPos.clone().applyMatrix4(headInv),
        outLocal: rootPos.clone().add(dir.clone().multiplyScalar(0.02)).applyMatrix4(headInv),
        pts,
        seg,
        width: (front ? 0.022 : 0.036) * (0.8 + r() * 0.5),
        phase: r() * 10,
      })
    }

    // ribbon geometry: 2 cards × strands × points × 2 verts
    const CARDS = 2
    const vCount = STRANDS * CARDS * POINTS * 2
    const pos = new Float32Array(vCount * 3)
    const uv = new Float32Array(vCount * 2)
    const idx = []
    let v = 0
    for (let s = 0; s < STRANDS; s++) {
      for (let card = 0; card < CARDS; card++) {
        const u0 = r() * 0.6
        for (let k = 0; k < POINTS; k++) {
          const t = k / (POINTS - 1)
          uv.set([u0, 1 - t, u0 + 0.4, 1 - t], v * 2)
          if (k < POINTS - 1) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2)
          v += 2
        }
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geometry.setIndex(idx)
    const material = new THREE.MeshStandardMaterial({
      map: makeHairTexture(),
      color: '#7a8296',
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      roughness: 0.78,
      metalness: 0.0,
      envMapIntensity: 0.25,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.receiveShadow = true
    return { strands, ell, mesh, settled: false, lastT: -1 }
  }, [shape, rig, root, head])

  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), m: new THREE.Matrix4(), side: new THREE.Vector3(), out: new THREE.Vector3(), tan: new THREE.Vector3() }), [])

  useFrame((state, delta) => {
    const { strands, ell, mesh } = sim
    const t = timeline.t
    // head transform in model space this frame
    const rootInv = tmp.m.copy(root.matrixWorld).invert()
    const headM = new THREE.Matrix4().multiplyMatrices(rootInv, head.matrixWorld)
    // where the scalp ellipsoid is now (it follows the head's motion)
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
      for (const s of strands) {
        const rootP = tmp.a.copy(s.rootLocal).applyMatrix4(headM)
        const outP = tmp.b.copy(s.outLocal).applyMatrix4(headM)
        s.pts[0].p.copy(rootP)
        s.pts[0].prev.copy(rootP)
        // second point steers the strand away from the scalp
        s.pts[1].p.copy(outP).addScaledVector(new THREE.Vector3(0, -1, 0), s.seg * 0.6)
        s.pts[1].prev.copy(s.pts[1].p)
        // a temple breeze from the front-left, gently gusting
        const gust = 0.5 + 0.5 * Math.sin(time * 0.9 + s.phase)
        const wind = new THREE.Vector3(0.35 + 0.25 * gust, 0.05, -0.55 - 0.4 * gust).multiplyScalar(reset ? 0 : 1)
        for (let k = 2; k < POINTS; k++) {
          const pt = s.pts[k]
          const vel = pt.p.clone().sub(pt.prev).multiplyScalar(0.965)
          pt.prev.copy(pt.p)
          const flutter = Math.sin(time * 2.3 + s.phase + k * 0.6) * 0.25
          pt.p.add(vel).add(new THREE.Vector3(wind.x + flutter * 0.3, GRAVITY + wind.y, wind.z + flutter * 0.2).multiplyScalar(dt * dt * (k / POINTS)))
        }
        // constraints (a few iterations)
        for (let it = 0; it < 3; it++) {
          for (let k = 1; k < POINTS; k++) {
            const a = s.pts[k - 1].p, b = s.pts[k].p
            const d = b.clone().sub(a)
            const len = d.length() || 1e-6
            const diff = (len - s.seg) / len
            if (k <= 1) continue
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

    // ---- rebuild ribbons
    const pos = mesh.geometry.attributes.position.array
    let v = 0
    for (const s of strands) {
      for (let card = 0; card < 2; card++) {
        for (let k = 0; k < POINTS; k++) {
          const p = s.pts[k].p
          const q = s.pts[Math.min(k + 1, POINTS - 1)].p, o = s.pts[Math.max(k - 1, 0)].p
          tmp.tan.copy(q).sub(o).normalize()
          const c = shape.center(Math.min(Math.max(p.y, 0.8), 1.6))
          tmp.out.set(p.x - c.x, 0, p.z - c.z).normalize()
          tmp.side.crossVectors(tmp.tan, tmp.out).normalize()
          const taper = 1 - (k / (POINTS - 1)) * 0.45
          // soft waves along the length so strands don't read as straight sheets
          const wave = Math.sin(k * 0.9 + s.phase) * 0.012 * (k / POINTS)
          const w = s.width * taper * (card ? 0.75 : 1)
          const lift = card ? 0.006 : 0 // second card floats slightly off the first for volume
          const ox = tmp.out.x * lift + tmp.side.x * wave, oz = tmp.out.z * lift + tmp.side.z * wave
          const shift = card ? w * 0.35 : 0
          pos[v * 3] = p.x - tmp.side.x * (w / 2 - shift) + ox
          pos[v * 3 + 1] = p.y - tmp.side.y * (w / 2 - shift)
          pos[v * 3 + 2] = p.z - tmp.side.z * (w / 2 - shift) + oz
          pos[v * 3 + 3] = p.x + tmp.side.x * (w / 2 + shift) + ox
          pos[v * 3 + 4] = p.y + tmp.side.y * (w / 2 + shift)
          pos[v * 3 + 5] = p.z + tmp.side.z * (w / 2 + shift) + oz
          v += 2
        }
      }
    }
    mesh.geometry.attributes.position.needsUpdate = true
    mesh.geometry.computeVertexNormals()
  })

  return <primitive object={sim.mesh} />
}

const _l = new THREE.Vector3()
function collide(p, ellC, ellInv, ell, shape) {
  // scalp ellipsoid (in the head's current frame)
  _l.copy(p).applyMatrix4(ellInv).sub(ell.c).divide(ell.r)
  const d = _l.length()
  if (d < 1.06) {
    _l.multiplyScalar(1.06 / d).multiply(ell.r).add(ell.c)
    const m = new THREE.Matrix4().copy(ellInv).invert()
    p.copy(_l.applyMatrix4(m))
  }
  // neck, shoulders and back: keep outside the measured body surface
  if (p.y > 0.75 && p.y < ellC.y - 0.06) {
    const c = shape.center(p.y)
    const dx = p.x - c.x, dz = p.z - c.z
    const th = Math.atan2(dx, dz)
    const r = Math.hypot(dx, dz)
    const minR = shape.radius(p.y, th) + 0.012
    if (r < minR) {
      p.x = c.x + (dx / (r || 1)) * minR
      p.z = c.z + (dz / (r || 1)) * minR
    }
  }
}
