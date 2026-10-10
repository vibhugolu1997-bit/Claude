import * as THREE from 'three'

// Eye realism helpers: fitted cornea shells and lash-only card filtering.

function boneSet(mesh, names) {
  return new Set(names.map((n) => mesh.skeleton.bones.findIndex((b) => b.name === n)).filter((i) => i >= 0))
}

export function boneWeight(geometry, i, set) {
  const si = geometry.attributes.skinIndex, sw = geometry.attributes.skinWeight
  let w = 0
  for (let k = 0; k < 4; k++) if (set.has(si.getComponent(i, k))) w += sw.getComponent(i, k)
  return w
}

export function eyeVertexTest(mesh) {
  const set = boneSet(mesh, ['Bip01_LEye', 'Bip01_REye'])
  return (i) => boneWeight(mesh.geometry, i, set) > 0.5
}

// Vertices that subdivision must not move: the eyeballs (so they don't shrink
// inside the lids) and the lips (so smoothing doesn't part them and show teeth).
export function faceFeatureTest(mesh) {
  const eyes = eyeVertexTest(mesh)
  const lips = boneSet(mesh, [
    'Bip01_MUpperLip', 'Bip01_MBottomLip', 'Bip01_LUpperlip', 'Bip01_RUpperlip',
    'Bip01_LMouthCorner', 'Bip01_RMouthCorner', 'Bip01_LMouthBottom', 'Bip01_RMouthBottom',
  ])
  return (i) => eyes(i) || boneWeight(mesh.geometry, i, lips) > 0.25
}

// Least-squares sphere through points: x²+y²+z² = 2ax + 2by + 2cz + d
function fitSphere(points) {
  const A = new Float64Array(16), B = new Float64Array(4)
  for (const p of points) {
    const row = [2 * p.x, 2 * p.y, 2 * p.z, 1]
    const rhs = p.lengthSq()
    for (let r = 0; r < 4; r++) {
      B[r] += row[r] * rhs
      for (let c = 0; c < 4; c++) A[r * 4 + c] += row[r] * row[c]
    }
  }
  const m = new THREE.Matrix4().set(...A).invert()
  const e = m.elements // column-major
  const sol = [0, 1, 2, 3].map((r) => e[r] * B[0] + e[4 + r] * B[1] + e[8 + r] * B[2] + e[12 + r] * B[3])
  const center = new THREE.Vector3(sol[0], sol[1], sol[2])
  const radius = Math.sqrt(sol[3] + center.lengthSq())
  return { center, radius }
}

/**
 * Builds a glossy cornea over each eyeball, fitted to the eyeball vertices and
 * parented to the eye bone, so the eyes get real, moving catch-lights.
 */
export function buildCorneas(root, headMesh, material) {
  root.updateMatrixWorld(true)
  const toModel = new THREE.Matrix4().multiplyMatrices(root.matrixWorld.clone().invert(), headMesh.matrixWorld)
  const out = []
  for (const name of ['Bip01_LEye', 'Bip01_REye']) {
    const set = boneSet(headMesh, [name])
    const pos = headMesh.geometry.attributes.position
    const pts = []
    for (let i = 0; i < pos.count; i++) {
      if (boneWeight(headMesh.geometry, i, set) > 0.5) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(toModel))
    }
    if (pts.length < 8) continue
    const { center, radius } = fitSphere(pts)
    if (!(radius > 0.004 && radius < 0.03)) continue // implausible fit – skip rather than float a shell
    const geo = new THREE.SphereGeometry(radius * 1.012, 40, 20, 0, Math.PI * 2, 0, 0.82)
    geo.rotateX(Math.PI / 2) // cap faces +Z (the eye's rest gaze)
    geo.scale(1, 1, 1.06) // slight corneal bulge in front of the iris
    const cornea = new THREE.Mesh(geo, material)
    cornea.position.copy(center)
    cornea.renderOrder = 2
    const bone = headMesh.skeleton.bones.find((b) => b.name === name)
    bone.attach(cornea)
    out.push({ cornea, center, radius })
  }
  return out
}

/**
 * The Rocketbox hair-card mesh carries both the short bob haircut and the
 * eyelashes. Keep only the lashes (triangles close to the eyes); the new
 * simulated strand hair replaces the bob.
 */
export function keepOnlyLashes(cardMesh, eyeCenters, maxDist = 0.032) {
  const g = cardMesh.geometry
  const pos = g.attributes.position
  const m = cardMesh.matrixWorld
  const v = new THREE.Vector3()
  const near = new Uint8Array(pos.count)
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m)
    near[i] = eyeCenters.some((c) => c.distanceTo(v) < maxDist) ? 1 : 0
  }
  const idx = g.index.array
  const keep = []
  for (let t = 0; t < idx.length; t += 3) if (near[idx[t]] && near[idx[t + 1]] && near[idx[t + 2]]) keep.push(idx[t], idx[t + 1], idx[t + 2])
  g.setIndex(keep)
  return keep.length / 3
}
