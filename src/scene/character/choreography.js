import * as THREE from 'three'
import { smoother, win } from '../../lib/timeline.js'

// Arm key poses in model space (metres, character faces +Z, her right = -X).
// target: wrist · pole: elbow direction · dir: finger direction · palm: palm normal
const V = (x, y, z) => new THREE.Vector3(x, y, z)

export const POSES = {
  // eyes closed, all four hands gathered low – the "still" opening
  dormant: {
    R: { target: V(-0.24, 0.93, 0.07), pole: V(-0.3, 0.1, -1), dir: V(0.05, -1, 0.12), palm: V(1, 0, 0.1), curl: [0.25, 0.25, 0.3, 0.35, 0.4] },
    L: { target: V(0.24, 0.93, 0.07), pole: V(0.3, 0.1, -1), dir: V(-0.05, -1, 0.12), palm: V(-1, 0, 0.1), curl: [0.25, 0.25, 0.3, 0.35, 0.4] },
    R2: { target: V(-0.25, 0.97, -0.06), pole: V(-0.3, 0.1, -1), dir: V(0.0, -1, 0), palm: V(1, 0, 0), curl: [0.3, 0.3, 0.35, 0.4, 0.45] },
    L2: { target: V(0.25, 0.97, -0.06), pole: V(0.3, 0.1, -1), dir: V(0.0, -1, 0), palm: V(-1, 0, 0), curl: [0.3, 0.3, 0.35, 0.4, 0.45] },
  },
  // the awakened form: abhaya, khadga, varada, kapala
  divine: {
    // lower right · varada mudra (boon-giving): palm out, fingers down
    R: { target: V(-0.31, 1.0, 0.2), pole: V(-0.5, -0.1, -1), dir: V(-0.05, -1, 0.35), palm: V(0, 0.3, 1), curl: [0.05, 0.02, 0.05, 0.08, 0.12], spread: 0.06 },
    // lower left · holds the kapala bowl, palm up
    L: { target: V(0.27, 1.06, 0.24), pole: V(0.6, -0.3, -1), dir: V(-0.25, 0.05, 1), palm: V(0, 1, 0.05), curl: [0.35, 0.35, 0.4, 0.45, 0.5] },
    // upper right · abhaya mudra (fearlessness): raised, palm forward
    R2: { target: V(-0.38, 1.44, 0.14), pole: V(-0.4, -1, -0.35), dir: V(-0.08, 1, 0.08), palm: V(0, 0.05, 1), curl: [0.08, 0.0, 0.03, 0.06, 0.1], spread: 0.05 },
    // upper left · raises the khadga (sword)
    L2: { target: V(0.4, 1.52, 0.02), pole: V(0.4, -1, -0.4), dir: V(0.15, 1, 0.1), palm: V(-1, 0.1, 0.1), curl: [0.75, 1.0, 1.05, 1.1, 1.15] },
  },
}

const lerpV = (a, b, t) => a.clone().lerp(b, t)
const lerpDir = (a, b, t) => a.clone().normalize().lerp(b.clone().normalize(), t).normalize()
const lerpCurl = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t)

// When does each arm unfold? (seconds, staggered for a natural cascade)
const ARM_TIMING = {
  R2: [1.0, 2.6],
  L2: [1.25, 2.95],
  R: [1.6, 3.2],
  L: [1.8, 3.4],
}

export function armPose(key, t) {
  const [a, b] = ARM_TIMING[key]
  const k = smoother(win(t, a, b))
  const A = POSES.dormant[key], B = POSES.divine[key]
  // a slight overshoot arc: hands travel outward before settling
  const arc = Math.sin(k * Math.PI) * 0.06
  const out = key.startsWith('R') ? -1 : 1
  const target = lerpV(A.target, B.target, k).add(new THREE.Vector3(out * arc, arc * 0.5, arc * 0.6))
  // gentle life after settling
  const idle = Math.sin(t * 1.7 + key.length * 1.3) * 0.006 * k
  target.y += idle
  return {
    target,
    pole: lerpDir(A.pole, B.pole, k),
    handDir: lerpDir(A.dir, B.dir, k),
    palm: lerpDir(A.palm, B.palm, k),
    fingerCurl: lerpCurl(A.curl, B.curl, smoother(win(t, a + 0.3, b))),
    spread: (B.spread || 0) * k,
    weight: k,
  }
}

// head / gaze / eyelid timing
export function facePose(t) {
  const lift = smoother(win(t, 1.2, 3.0)) // head rises from a bowed meditation
  const open = smoother(win(t, 2.2, 2.7)) // eyes open
  const blink = t > 4.1 && t < 4.32 ? Math.sin(((t - 4.1) / 0.22) * Math.PI) : 0
  return { lift, open: open * (1 - blink), blink }
}
