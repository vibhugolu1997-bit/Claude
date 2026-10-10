import * as THREE from 'three'

// Procedural rig controller for the Rocketbox (3ds Max Biped) skeleton.
//
// Everything is expressed in *model space* (the character's root group), so
// poses are independent of where the character is placed in the scene.
// Arms are driven by an analytic two-bone IK solver plus an explicit hand
// frame (finger direction + palm normal), fingers by per-joint curl angles.

const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _m = new THREE.Matrix4()
const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()

export const boneName = (s) => s.replace(/\s/g, '_')

// orthonormal basis (x = dir, y = up', z = dir × up') → quaternion
function frameQuat(dir, up, out = new THREE.Quaternion()) {
  const x = _v.copy(dir).normalize()
  const y = _v2.copy(up).addScaledVector(x, -up.dot(x)).normalize()
  const z = new THREE.Vector3().crossVectors(x, y)
  _m.makeBasis(x, y, z)
  return out.setFromRotationMatrix(_m)
}

function orthogonalize(v, axis) {
  return v.clone().addScaledVector(axis, -v.dot(axis)).normalize()
}

export class Rig {
  constructor(root, skeleton) {
    this.root = root
    this.bones = new Map()
    for (const b of skeleton.bones) this.bones.set(b.name, b)
    root.updateMatrixWorld(true)
    this.rootInv = new THREE.Quaternion()
    root.getWorldQuaternion(this.rootInv).invert()
    this.rest = new Map()
    for (const b of skeleton.bones) this.captureRest(b)
    this.arms = {}
  }

  get(name) {
    return this.bones.get(boneName(name))
  }

  // model-space quaternion / position of a bone at the current pose
  modelQuat(bone, out = new THREE.Quaternion()) {
    bone.getWorldQuaternion(out)
    return out.premultiply(this.rootInv)
  }
  modelPos(bone, out = new THREE.Vector3()) {
    bone.getWorldPosition(out)
    return this.root.worldToLocal(out)
  }

  captureRest(bone) {
    this.bones.set(bone.name, bone)
    this.rest.set(bone, {
      local: bone.quaternion.clone(),
      position: bone.position.clone(),
      model: this.modelQuat(bone),
    })
  }

  resetPose() {
    for (const [bone, r] of this.rest) {
      bone.quaternion.copy(r.local)
      bone.position.copy(r.position)
    }
    this.root.updateMatrixWorld(true)
  }

  // Set a bone's model-space rotation (keeps parent untouched).
  setModelQuat(bone, qModel) {
    const parentQ = this.modelQuat(bone.parent, _q2)
    bone.quaternion.copy(parentQ.invert().multiply(qModel))
    bone.updateMatrixWorld(true)
  }

  // Rotate a bone about a model-space axis relative to its rest pose.
  rotateRest(bone, axisModel, angle) {
    const r = this.rest.get(bone)
    const axisLocal = _v.copy(axisModel).applyQuaternion(_q.copy(r.model).invert()).normalize()
    bone.quaternion.copy(r.local).multiply(_q.setFromAxisAngle(axisLocal, angle))
  }

  // Add a model-space rotation on top of the bone's current rotation.
  rotateModel(bone, axisModel, angle) {
    const cur = this.modelQuat(bone)
    const axisLocal = _v.copy(axisModel).applyQuaternion(cur.clone().invert()).normalize()
    bone.quaternion.multiply(_q.setFromAxisAngle(axisLocal, angle))
  }

  // ---------------------------------------------------------------- arms
  // Records an arm chain and the rest frames needed by the IK solver.
  defineArm(key, { upper, fore, hand, fingers, side }) {
    const U = this.get(upper), F = this.get(fore), H = this.get(hand)
    const pU = this.modelPos(U), pF = this.modelPos(F), pH = this.modelPos(H)
    const f = fingers.map((chain) => chain.map((n) => this.get(n)))
    const middle1 = this.modelPos(f[2][0]), index1 = this.modelPos(f[1][0]), pinky1 = this.modelPos(f[4][0])

    const back = new THREE.Vector3(0, 0, -1)
    const upDir = pF.clone().sub(pU).normalize()
    const foreDir = pH.clone().sub(pF).normalize()
    const handDir = middle1.clone().sub(pH).normalize()
    // palm normal: perpendicular to fingers and to the knuckle line
    const across = index1.clone().sub(pinky1)
    let palm = new THREE.Vector3().crossVectors(handDir, across).normalize()
    if (side === 'R') palm.negate()
    // relaxed A-pose: palms face the thighs / down – make sure we point that way
    if (palm.y > 0.3) palm.negate()

    const restFrame = (bone, dir, up) => {
      // R such that modelQuat = frameQuat(dir, up) * R
      const fq = frameQuat(dir, up)
      return fq.invert().multiply(this.rest.get(bone).model.clone())
    }
    this.arms[key] = {
      side,
      U, F, H, fingers: f,
      lenU: pF.distanceTo(pU),
      lenF: pH.distanceTo(pF),
      offU: restFrame(U, upDir, orthogonalize(back, upDir)),
      offF: restFrame(F, foreDir, orthogonalize(back, foreDir)),
      offH: restFrame(H, handDir, palm),
      restPalm: palm,
      restHandDir: handDir,
      fingerRest: f.map((chain) =>
        chain.map((b, i) => {
          const pos = this.modelPos(b)
          const next = chain[i + 1] ? this.modelPos(chain[i + 1]) : null
          const dir = next ? next.sub(pos).normalize() : null
          return { dir }
        }),
      ),
    }
    // curl axis per finger joint, in each bone's local rest frame
    const arm = this.arms[key]
    arm.curlAxis = f.map((chain, fi) =>
      chain.map((b, i) => {
        const pos = this.modelPos(b)
        const tip = this.modelPos(chain[Math.min(i + 1, chain.length - 1)])
        let dir = tip.sub(pos)
        if (dir.lengthSq() < 1e-8 || i === chain.length - 1) dir = arm.fingerRest[fi][Math.max(0, i - 1)].dir || handDir
        dir = dir.clone().normalize()
        // bend toward the palm: axis = dir × palm
        const ref = fi === 0 ? palm.clone().lerp(across.clone().normalize().multiplyScalar(side === 'R' ? 1 : -1), 0.55) : palm
        const axisModel = new THREE.Vector3().crossVectors(dir, ref).normalize()
        return axisModel.applyQuaternion(this.rest.get(b).model.clone().invert())
      }),
    )
    return arm
  }

  shoulderPos(key, out = new THREE.Vector3()) {
    return this.modelPos(this.arms[key].U, out)
  }

  /**
   * Solve an arm.
   * @param key     arm id
   * @param target  model-space wrist position
   * @param pole    model-space direction the elbow should point to
   * @param handDir model-space direction of the fingers
   * @param palm    model-space palm normal
   * @param fingerCurl [thumb, index, middle, ring, pinky] curl 0..1 (or numbers per joint)
   */
  solveArm(key, { target, pole, handDir, palm, fingerCurl = [0.2, 0.15, 0.2, 0.25, 0.3], spread = 0, twist = 0.55 }) {
    const a = this.arms[key]
    const S = this.modelPos(a.U)
    const toT = target.clone().sub(S)
    let d = toT.length()
    const maxReach = (a.lenU + a.lenF) * 0.999
    d = Math.min(Math.max(d, Math.abs(a.lenU - a.lenF) + 1e-3), maxReach)
    const dir = toT.normalize()
    // law of cosines: angle at shoulder
    const cosA = (a.lenU * a.lenU + d * d - a.lenF * a.lenF) / (2 * a.lenU * d)
    const angA = Math.acos(THREE.MathUtils.clamp(cosA, -1, 1))
    const bendAxis = orthogonalize(pole, dir)
    const upperDir = dir.clone().multiplyScalar(Math.cos(angA)).addScaledVector(bendAxis, Math.sin(angA)).normalize()
    const elbow = S.clone().addScaledVector(upperDir, a.lenU)
    const wrist = S.clone().addScaledVector(dir, d)
    const foreDir = wrist.clone().sub(elbow).normalize()

    // upper arm: elbow tip points along the pole
    const qU = frameQuat(upperDir, orthogonalize(pole, upperDir)).multiply(a.offU)
    this.setModelQuat(a.U, qU)

    // hand target frame
    const qH = frameQuat(handDir, palm).multiply(a.offH)

    // forearm: blend between pole-driven roll and the roll that the hand wants
    const qFpole = frameQuat(foreDir, orthogonalize(pole, foreDir)).multiply(a.offF)
    // roll that keeps the hand at its rest offset relative to the forearm
    const relRest = this.rest.get(a.F).model.clone().invert().multiply(this.rest.get(a.H).model)
    const qFideal = qH.clone().multiply(relRest.clone().invert())
    // swing qFideal so that its long axis matches foreDir (keep only twist)
    const idealDir = new THREE.Vector3(1, 0, 0).applyQuaternion(qFideal.clone().multiply(a.offF.clone().invert()))
    const swing = new THREE.Quaternion().setFromUnitVectors(idealDir.normalize(), foreDir)
    const qFtwist = swing.multiply(qFideal)
    const qF = qFpole.clone().slerp(qFtwist, twist)
    this.setModelQuat(a.F, qF)
    this.setModelQuat(a.H, qH)

    // fingers
    a.fingers.forEach((chain, fi) => {
      const c = fingerCurl[fi]
      chain.forEach((b, i) => {
        const r = this.rest.get(b)
        const amt = Array.isArray(c) ? c[i] : c * (fi === 0 ? [0.5, 0.6, 0.7][i] : [1.0, 1.25, 0.9][i])
        let angle = amt * (fi === 0 ? 1.0 : 1.35)
        b.quaternion.copy(r.local).multiply(_q.setFromAxisAngle(a.curlAxis[fi][i], angle))
        if (i === 0 && fi > 0 && spread) {
          // spread fingers apart around the palm normal
          const s = (fi - 2.5) * spread * (a.side === 'R' ? -1 : 1)
          const pn = a.restPalm.clone().applyQuaternion(r.model.clone().invert())
          b.quaternion.multiply(_q.setFromAxisAngle(pn, s))
        }
      })
    })
    a.H.updateMatrixWorld(true)
    return { elbow, wrist }
  }
}

// ------------------------------------------------------------------ helpers
export const FINGERS = (side) =>
  [0, 1, 2, 3, 4].map((f) => [`Bip01 ${side} Finger${f}`, `Bip01 ${side} Finger${f}1`, `Bip01 ${side} Finger${f}2`])
