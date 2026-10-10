import * as THREE from 'three'
import {
  jewelryMaterials, buildCrown, buildJhumka, buildNecklaces, measureLimb,
  buildArmband, buildBangles, buildWaistBelt, buildKhadga, buildBowl,
} from './jewelry.js'

/**
 * Fit and attach every ornament / prop at the rest pose. Objects are created in
 * model space and re-parented to bones with Object3D.attach(), which keeps
 * their placement while making them follow the skeleton.
 */
export function adorn(c, waistY) {
  const { root, rig, shape, body, arms } = c
  const mats = jewelryMaterials()
  root.updateMatrixWorld(true)
  const P = (name) => rig.modelPos(rig.get(name))

  const eyeL = P('Bip01 LEye'), eyeR = P('Bip01 REye')
  const eyeY = (eyeL.y + eyeR.y) / 2
  const eyeZ = (eyeL.z + eyeR.z) / 2
  const neck = P('Bip01 Neck')
  const head = rig.get('Bip01 Head')

  // crown
  const crown = buildCrown(shape, eyeY, eyeZ, mats)
  head.attach(crown)

  // earrings – hanging just below the ear lobes
  for (const side of [-1, 1]) {
    const j = buildJhumka(mats)
    j.position.set(side * 0.069, eyeY - 0.045, eyeZ - 0.088)
    head.attach(j)
  }

  // nose stud (left nostril) – a small gold & pearl nath
  const nose = P('Bip01 MNose')
  const nath = new THREE.Mesh(new THREE.TorusGeometry(0.0058, 0.0008, 6, 24), mats.gold)
  nath.position.set(nose.x + 0.012, nose.y - 0.008, nose.z + 0.006)
  nath.rotation.set(0, Math.PI / 2 - 0.3, 0)
  head.attach(nath)

  // necklaces on the chest, choker on the neck
  const necks = buildNecklaces(shape, neck.y + 0.0, mats)
  rig.get('Bip01 Spine2').attach(necks)

  // waist belt over the lehenga
  const belt = buildWaistBelt(shape, waistY - 0.012, mats)
  rig.get('Bip01 Pelvis').attach(belt)

  // ---- arm ornaments, measured on the original arms and copied to the clones
  const boneIndex = (name) => body.skeleton.bones.indexOf(rig.get(name))
  for (const side of ['R', 'L']) {
    const a = arms[side], a2 = arms[side + '2']
    const S = rig.modelPos(a.U), E = rig.modelPos(a.F), W = rig.modelPos(a.H)

    // bajuband at 32% of the upper arm (also hides the shoulder blend of the extra arm)
    const upAxis = E.clone().sub(S).normalize()
    const bandPos = S.clone().lerp(E, 0.32)
    const r1 = measureLimb(body, root, new Set([boneIndex(`Bip01 ${side} UpperArm`)]), bandPos, upAxis)
    const band = buildArmband(r1.max * 0.92, mats)
    orientRing(band, bandPos, upAxis, new THREE.Vector3(0, 0, 1))
    attachMirrored(band, a.U, a2.U)

    // bangle stack near the wrist
    const foreAxis = W.clone().sub(E).normalize()
    const banglePos = E.clone().lerp(W, 0.86)
    const r2 = measureLimb(body, root, new Set([boneIndex(`Bip01 ${side} Forearm`)]), banglePos, foreAxis)
    const bangles = buildBangles(r2.max * 0.95, mats)
    orientRing(bangles, banglePos, foreAxis.clone().negate(), new THREE.Vector3(0, 0, 1))
    attachMirrored(bangles, a.F, a2.F)
  }

  // ---- khadga in the upper-left hand
  {
    const a = arms.L2
    const H = rig.modelPos(a.H)
    const index1 = rig.modelPos(a.fingers[1][0]), pinky1 = rig.modelPos(a.fingers[4][0])
    const axis = index1.clone().sub(pinky1).normalize() // blade leaves the fist on the thumb side
    const grip = H.clone().addScaledVector(a.restHandDir, 0.062).addScaledVector(a.restPalm, 0.026)
    const sword = buildKhadga(mats)
    const x = a.restHandDir.clone().addScaledVector(axis, -a.restHandDir.dot(axis)).normalize()
    const z = new THREE.Vector3().crossVectors(x, axis)
    // show the flat of the blade to the viewer
    sword.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(z.clone().negate(), axis, x))
    sword.position.copy(grip)
    a.H.attach(sword)
  }

  // ---- kapala bowl resting on the lower-left palm (holds the sacred flame)
  let bowlAnchor
  {
    const a = arms.L
    const H = rig.modelPos(a.H)
    const bowl = buildBowl(mats)
    bowl.position.copy(H).addScaledVector(a.restHandDir, 0.055).addScaledVector(a.restPalm, 0.04)
    bowl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.restPalm)
    a.H.attach(bowl)
    bowlAnchor = new THREE.Object3D()
    bowlAnchor.position.set(0, 0.006, 0)
    bowl.add(bowlAnchor)
  }

  return { mats, bowlAnchor }
}

// place a ring-shaped ornament (built around +Y) on a limb
function orientRing(obj, pos, axis, facing) {
  const y = axis.clone().normalize()
  const x = facing.clone().addScaledVector(y, -facing.dot(y)).normalize()
  const z = new THREE.Vector3().crossVectors(x, y)
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
  obj.position.copy(pos)
}

// attach to the original bone and put an identical copy on the cloned bone
function attachMirrored(obj, bone, cloneBone) {
  bone.attach(obj)
  const copy = obj.clone()
  copy.position.copy(obj.position)
  copy.quaternion.copy(obj.quaternion)
  copy.scale.copy(obj.scale)
  cloneBone.add(copy)
}
