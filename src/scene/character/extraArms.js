import * as THREE from 'three'

/**
 * Grow an additional, independently animated arm out of a skinned mesh.
 *
 * The arm is not a primitive: we duplicate the character's own arm triangles
 * (skin, hand, nails – with their UVs, normals and textures) and re-skin them
 * to a cloned bone chain parented to the same clavicle. Vertices around the
 * shoulder keep their partial weights on the clavicle/spine, so the new arm
 * blends into the torso like a real joint instead of a hard seam.
 *
 * Returns the cloned upper-arm bone.
 */
export function growArm(mesh, upperArmName, suffix) {
  const skel = mesh.skeleton
  const bones = skel.bones
  const upper = bones.find((b) => b.name === upperArmName)
  if (!upper) throw new Error(`bone ${upperArmName} not found`)

  // original chain (depth-first) and its clone in the same order
  const chain = []
  upper.traverse((o) => o.isBone && chain.push(o))
  const cloneRoot = cloneBones(upper)
  const cloneChain = []
  cloneRoot.traverse((o) => {
    if (o.isBone) {
      o.name = o.name + suffix
      cloneChain.push(o)
    }
  })
  upper.parent.add(cloneRoot)

  const remap = new Map()
  chain.forEach((b, i) => remap.set(bones.indexOf(b), bones.length + i))

  const newBones = [...bones, ...cloneChain]
  const newInverses = [
    ...skel.boneInverses.map((m) => m.clone()),
    ...chain.map((b) => skel.boneInverses[bones.indexOf(b)].clone()),
  ]
  const newSkeleton = new THREE.Skeleton(newBones, newInverses)

  // ---- geometry: copy the triangles that belong to the arm
  const g = mesh.geometry
  const si = g.attributes.skinIndex
  const sw = g.attributes.skinWeight
  const vCount = si.count
  const armW = new Float32Array(vCount)
  for (let v = 0; v < vCount; v++) {
    let w = 0
    for (let k = 0; k < 4; k++) if (remap.has(si.getComponent(v, k))) w += sw.getComponent(v, k)
    armW[v] = w
  }
  const index = g.index ? g.index.array : [...Array(vCount).keys()]
  const tris = []
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2]
    if (Math.max(armW[a], armW[b], armW[c]) > 0.5 && Math.min(armW[a], armW[b], armW[c]) > 0.04) tris.push(a, b, c)
  }

  const used = [...new Set(tris)]
  const oldToNew = new Map(used.map((v, i) => [v, i]))
  const ng = new THREE.BufferGeometry()
  for (const [name, attr] of Object.entries(g.attributes)) {
    const size = attr.itemSize
    const arr = new attr.array.constructor(used.length * size)
    used.forEach((v, i) => {
      for (let k = 0; k < size; k++) arr[i * size + k] = attr.array[v * size + k]
    })
    ng.setAttribute(name, new THREE.BufferAttribute(arr, size, attr.normalized))
  }
  // re-skin: arm bones → cloned bones, everything else unchanged
  const nsi = ng.attributes.skinIndex
  for (let i = 0; i < nsi.count; i++) {
    for (let k = 0; k < 4; k++) {
      const old = nsi.getComponent(i, k)
      if (remap.has(old)) nsi.setComponent(i, k, remap.get(old))
    }
  }
  ng.setIndex(tris.map((v) => oldToNew.get(v)))
  ng.computeBoundingSphere()

  const armMesh = new THREE.SkinnedMesh(ng, mesh.material)
  armMesh.name = `${mesh.name}${suffix}`
  armMesh.castShadow = mesh.castShadow
  armMesh.receiveShadow = mesh.receiveShadow
  armMesh.frustumCulled = false
  armMesh.bind(newSkeleton, mesh.bindMatrix)
  mesh.parent.add(armMesh)
  armMesh.position.copy(mesh.position)
  armMesh.quaternion.copy(mesh.quaternion)
  armMesh.scale.copy(mesh.scale)
  return { upper: cloneRoot, mesh: armMesh, skeleton: newSkeleton }
}

// Recursively clone only Bone children (skips any attached props).
function cloneBones(bone) {
  const c = new THREE.Bone()
  c.name = bone.name
  c.position.copy(bone.position)
  c.quaternion.copy(bone.quaternion)
  c.scale.copy(bone.scale)
  for (const child of bone.children) if (child.isBone) c.add(cloneBones(child))
  return c
}
