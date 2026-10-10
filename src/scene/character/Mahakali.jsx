import { useMemo, useRef } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { Rig, FINGERS } from './rig.js'
import { growArm } from './extraArms.js'
import { createMaterials } from './materials.js'
import { armPose, facePose } from './choreography.js'
import { timeline } from '../../lib/timeline.js'
import { Hair } from './Hair.jsx'
import { Lehenga, WAIST_Y } from './Lehenga.jsx'
import { adorn } from './adorn.js'
import { BodyShape } from './bodyShape.js'

// VITE_BODY_MODEL lets hosts that can't serve .glb use an embedded .gltf JSON instead
const URL_ = `${import.meta.env.BASE_URL}assets/mahakali/${import.meta.env.VITE_BODY_MODEL || 'body.glb'}`
const X = new THREE.Vector3(1, 0, 0)
const Y = new THREE.Vector3(0, 1, 0)
const Z = new THREE.Vector3(0, 0, 1)

function buildCharacter(gltf) {
  const root = gltf.scene
  if (root.userData.built) return root.userData.built

  const mats = createMaterials(new THREE.TextureLoader())
  let body = null, headMesh = null
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return
    o.castShadow = true
    o.receiveShadow = true
    o.frustumCulled = false
    const n = o.material.name
    if (n.includes('body')) {
      o.material = mats.body
      body = o
    } else if (n.includes('head')) {
      o.material = mats.head
      headMesh = o
    }
    else o.material = mats.hairCards
  })

  // measure the rest-pose torso (arms excluded) for fitting garments & hair
  const isArm = (b) => /UpperArm|Forearm|Hand|Finger/.test(b?.name || '')
  const shape = new BodyShape(root, [body, headMesh], isArm)

  // Two extra arms, grown from the character's own arm geometry.
  const R2 = growArm(body, 'Bip01_R_UpperArm', '_2')
  const L2 = growArm(body, 'Bip01_L_UpperArm', '_2')
  // root them slightly further back so the four arms fan out (model-space offset)
  root.updateMatrixWorld(true)
  const rootInv = root.getWorldQuaternion(new THREE.Quaternion()).invert()
  for (const extra of [R2, L2]) {
    const parentQ = extra.upper.parent.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInv)
    const offset = new THREE.Vector3(0, 0.012, -0.04).applyQuaternion(parentQ.invert())
    extra.upper.position.add(offset)
  }
  root.updateMatrixWorld(true)
  const rig = new Rig(root, R2.skeleton) // R2's skeleton = original bones + its clones
  for (const b of L2.skeleton.bones) if (!rig.rest.has(b)) rig.captureRest(b)

  const arms = {
    R: rig.defineArm('R', { upper: 'Bip01 R UpperArm', fore: 'Bip01 R Forearm', hand: 'Bip01 R Hand', fingers: FINGERS('R'), side: 'R' }),
    L: rig.defineArm('L', { upper: 'Bip01 L UpperArm', fore: 'Bip01 L Forearm', hand: 'Bip01 L Hand', fingers: FINGERS('L'), side: 'L' }),
    R2: rig.defineArm('R2', {
      upper: 'Bip01 R UpperArm_2', fore: 'Bip01 R Forearm_2', hand: 'Bip01 R Hand_2',
      fingers: FINGERS('R').map((c) => c.map((n) => n + '_2')), side: 'R',
    }),
    L2: rig.defineArm('L2', {
      upper: 'Bip01 L UpperArm_2', fore: 'Bip01 L Forearm_2', hand: 'Bip01 L Hand_2',
      fingers: FINGERS('L').map((c) => c.map((n) => n + '_2')), side: 'L',
    }),
  }

  const built = { root, rig, arms, mats, body, headMesh, shape }
  Object.assign(built, adorn(built, WAIST_Y))
  root.userData.built = built
  return built
}

export default function Mahakali(props) {
  const gltf = useLoader(GLTFLoader, URL_)
  const c = useMemo(() => buildCharacter(gltf), [gltf])
  const group = useRef()

  useFrame((state) => {
    const t = timeline.t
    const { rig } = c
    rig.resetPose()

    // ---- body: breathing, a slow divine sway, rising from meditation
    const face = facePose(t)
    const breathe = Math.sin(state.clock.elapsedTime * 1.3) * 0.5 + 0.5
    const sp = rig.get('Bip01 Spine1'), sp2 = rig.get('Bip01 Spine2')
    rig.rotateRest(rig.get('Bip01 Spine'), X, 0.06 * (1 - face.lift) - 0.015)
    rig.rotateRest(sp, X, -0.012 * breathe)
    rig.rotateRest(sp2, X, -0.018 * breathe - 0.03 * face.lift)
    rig.rotateModel(rig.get('Bip01 Pelvis'), Z, Math.sin(t * 0.9) * 0.012)

    // ---- head and neck
    const neck = rig.get('Bip01 Neck'), head = rig.get('Bip01 Head')
    rig.rotateRest(neck, X, 0.28 * (1 - face.lift) - 0.04)
    rig.rotateRest(head, X, 0.22 * (1 - face.lift) - 0.06)
    rig.rotateModel(head, Y, Math.sin(t * 0.7) * 0.05 * face.lift)
    c.root.updateMatrixWorld(true)

    // ---- the four arms
    for (const key of ['R', 'L', 'R2', 'L2']) rig.solveArm(key, armPose(key, t))

    // ---- eyes (Biped facial bones)
    const lidTopL = rig.get('Bip01 LEyeBlinkTop'), lidTopR = rig.get('Bip01 REyeBlinkTop')
    for (const lid of [lidTopL, lidTopR]) {
      if (!lid) continue
      rig.rotateRest(lid, X, (1 - face.open) * 0.55)
    }
  })

  return (
    <group ref={group} {...props}>
      <primitive object={c.root} />
      <Hair character={c} />
      <Lehenga character={c} />
    </group>
  )
}
