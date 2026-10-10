import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { timeline, smoother, DURATION } from '../lib/timeline.js'

// Debug framings: ?cam=face|torso|full|side|back
const debugCam = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('cam') : null
const DEBUG = {
  face: [[0, 1.78, 0.9], [0, 1.74, 0]],
  full: [[0, 1.2, 4.6], [0, 1.1, 0]],
  torso: [[0, 1.55, 2.2], [0, 1.4, 0]],
  side: [[2.4, 1.5, 0.8], [0, 1.35, 0]],
  back: [[0.6, 1.6, -2.0], [0, 1.4, 0]],
  wide: [[0, 1.6, 8.5], [0, 1.4, 0]],
}

// One continuous move: low and far down the pillared aisle → crane up and
// push in → settle on a heroic, slightly low medium shot of the goddess.
const KEYS = [
  { t: 0.0, pos: [0.35, 0.45, 8.2], look: [0, 1.25, 0], fov: 30 },
  { t: 1.4, pos: [0.75, 0.85, 5.6], look: [0, 1.35, 0], fov: 30 },
  { t: 2.8, pos: [-0.55, 1.3, 3.6], look: [0, 1.5, 0], fov: 31 },
  { t: 4.0, pos: [-0.3, 1.45, 3.25], look: [0, 1.55, 0], fov: 32 },
  { t: DURATION, pos: [0.0, 1.5, 2.95], look: [0, 1.58, 0], fov: 32 },
]

export default function CameraRig() {
  const { size } = useThree()
  const path = useMemo(() => {
    const pos = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k.pos)), false, 'centripetal')
    const look = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k.look)), false, 'centripetal')
    return { pos, look }
  }, [])
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), l: new THREE.Vector3() }), [])

  useFrame(({ camera, clock }) => {
    // narrower vertical FOV when the phone is held in landscape
    const aspect = size.width / size.height
    const fovScale = aspect > 1 ? 0.78 : 1.12
    if (debugCam && DEBUG[debugCam]) {
      const [p, l] = DEBUG[debugCam]
      camera.position.set(...p)
      camera.lookAt(...l)
      camera.fov = 32 * fovScale
      camera.updateProjectionMatrix()
      return
    }
    const t = timeline.t
    // ease the whole move, then map onto the key times
    const u = smoother(t / DURATION) * 0.85 + (t / DURATION) * 0.15
    path.pos.getPoint(u, tmp.p)
    path.look.getPoint(u, tmp.l)
    // handheld-like micro drift (very subtle)
    const time = clock.elapsedTime
    tmp.p.x += Math.sin(time * 0.7) * 0.01
    tmp.p.y += Math.sin(time * 0.9 + 1) * 0.006
    camera.position.copy(tmp.p)
    camera.lookAt(tmp.l)
    let fov = KEYS[0].fov
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (t >= KEYS[i].t) fov = THREE.MathUtils.lerp(KEYS[i].fov, KEYS[i + 1].fov, Math.min(1, (t - KEYS[i].t) / (KEYS[i + 1].t - KEYS[i].t)))
    }
    camera.fov = fov * fovScale
    camera.updateProjectionMatrix()
  })
  return null
}
