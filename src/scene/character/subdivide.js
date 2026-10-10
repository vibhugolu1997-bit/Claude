import * as THREE from 'three'

/**
 * One level of Loop subdivision for a *skinned*, UV-mapped mesh.
 *
 * The Rocketbox base is a ~3.7k-vertex game mesh; its faceted silhouette is the
 * most visible "low-poly" tell on the face, neck and arms. This splits every
 * triangle in four and moves the vertices onto a smooth limit-like surface
 * while carrying UVs, skin indices and skin weights through.
 *
 * - Topology is computed on position-welded vertices, so UV seams don't crack.
 * - Boundary edges (garment hems, the head/body seam at the neck) stay linear,
 *   so neighbouring meshes still meet exactly.
 * - `isFixed(i)` pins vertices that must not shrink (e.g. the eyeballs).
 * - `vertexBlend` < 1 keeps original vertices partly in place, which preserves
 *   the likeness of small facial features (nose tip, lips) better than full Loop.
 */
export function loopSubdivideSkinned(geometry, { isFixed = () => false, vertexBlend = 0.75 } = {}) {
  const src = geometry
  if (!src.index) throw new Error('loopSubdivideSkinned expects indexed geometry')
  const pos = src.attributes.position
  const idx = src.index.array
  const n = pos.count

  // ---- weld by position
  const key = (i) => `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`
  const weldMap = new Map()
  const weld = new Int32Array(n)
  const wPos = []
  for (let i = 0; i < n; i++) {
    const k = key(i)
    let w = weldMap.get(k)
    if (w === undefined) {
      w = wPos.length / 3
      weldMap.set(k, w)
      wPos.push(pos.getX(i), pos.getY(i), pos.getZ(i))
    }
    weld[i] = w
  }
  const wn = wPos.length / 3
  const fixedW = new Uint8Array(wn)
  for (let i = 0; i < n; i++) if (isFixed(i)) fixedW[weld[i]] = 1

  // ---- welded edges → adjacent opposite vertices
  const edgeKey = (a, b) => (a < b ? a * wn + b : b * wn + a)
  const edges = new Map() // key -> { a, b, opp: [] }
  const neighbors = Array.from({ length: wn }, () => new Set())
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [weld[idx[t]], weld[idx[t + 1]], weld[idx[t + 2]]]
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3], c = tri[(e + 2) % 3]
      if (a === b) continue
      const k = edgeKey(a, b)
      let rec = edges.get(k)
      if (!rec) edges.set(k, (rec = { a, b, opp: [] }))
      rec.opp.push(c)
      neighbors[a].add(b)
      neighbors[b].add(a)
    }
  }
  const boundaryNbrs = Array.from({ length: wn }, () => [])
  for (const rec of edges.values()) {
    if (rec.opp.length === 1) {
      boundaryNbrs[rec.a].push(rec.b)
      boundaryNbrs[rec.b].push(rec.a)
    }
  }

  // ---- new positions for original (welded) vertices
  const P = (w, out) => out.set(wPos[w * 3], wPos[w * 3 + 1], wPos[w * 3 + 2])
  const a = new THREE.Vector3(), b = new THREE.Vector3(), sum = new THREE.Vector3()
  const newV = new Float32Array(wn * 3)
  for (let w = 0; w < wn; w++) {
    P(w, a)
    if (fixedW[w] || boundaryNbrs[w].length) {
      // boundaries stay where they are so adjoining meshes keep meeting
      newV.set([a.x, a.y, a.z], w * 3)
      continue
    }
    const nb = [...neighbors[w]]
    const k = nb.length
    if (k < 3) {
      newV.set([a.x, a.y, a.z], w * 3)
      continue
    }
    const beta = k === 3 ? 3 / 16 : 3 / (8 * k)
    sum.set(0, 0, 0)
    for (const m of nb) sum.add(P(m, b))
    const loop = a.clone().multiplyScalar(1 - k * beta).addScaledVector(sum, beta)
    a.lerp(loop, vertexBlend)
    newV.set([a.x, a.y, a.z], w * 3)
  }

  // ---- edge points (welded)
  const edgePoint = new Map()
  for (const [k, rec] of edges) {
    P(rec.a, a)
    P(rec.b, b)
    const linear = a.clone().add(b).multiplyScalar(0.5)
    if (rec.opp.length !== 2 || (fixedW[rec.a] && fixedW[rec.b])) {
      edgePoint.set(k, linear)
      continue
    }
    const c = P(rec.opp[0], new THREE.Vector3()), d = P(rec.opp[1], new THREE.Vector3())
    edgePoint.set(k, a.clone().multiplyScalar(3 / 8).addScaledVector(b, 3 / 8).addScaledVector(c, 1 / 8).addScaledVector(d, 1 / 8))
  }

  // ---- build output: original split vertices + one new vertex per (split) edge
  const attrs = Object.entries(src.attributes).filter(([name]) => name !== 'normal')
  const out = {}
  for (const [name, attr] of attrs) out[name] = []
  const pushVertex = (fn) => {
    for (const [name, attr] of attrs) fn(name, attr, out[name])
  }
  // copy originals with moved positions
  for (let i = 0; i < n; i++) {
    pushVertex((name, attr, arr) => {
      if (name === 'position') arr.push(newV[weld[i] * 3], newV[weld[i] * 3 + 1], newV[weld[i] * 3 + 2])
      else for (let c = 0; c < attr.itemSize; c++) arr.push(attr.array[i * attr.itemSize + c])
    })
  }
  let next = n
  const splitEdge = new Map() // "i,j" of split vertex indices -> new index
  const midpoint = (i, j) => {
    const k = i < j ? `${i},${j}` : `${j},${i}`
    let v = splitEdge.get(k)
    if (v !== undefined) return v
    v = next++
    splitEdge.set(k, v)
    const ep = edgePoint.get(edgeKey(weld[i], weld[j]))
    const skin = src.attributes.skinIndex ? mergeSkin(src, i, j) : null
    pushVertex((name, attr, arr) => {
      const s = attr.itemSize
      if (name === 'position') arr.push(ep.x, ep.y, ep.z)
      else if (name === 'skinIndex') arr.push(...skin.indices)
      else if (name === 'skinWeight') arr.push(...skin.weights)
      else for (let c = 0; c < s; c++) arr.push((attr.array[i * s + c] + attr.array[j * s + c]) / 2)
    })
    return v
  }
  const newIdx = []
  for (let t = 0; t < idx.length; t += 3) {
    const i = idx[t], j = idx[t + 1], k = idx[t + 2]
    const ij = midpoint(i, j), jk = midpoint(j, k), ki = midpoint(k, i)
    newIdx.push(i, ij, ki, ij, j, jk, ki, jk, k, ij, jk, ki)
  }

  const g = new THREE.BufferGeometry()
  for (const [name, attr] of attrs) {
    const Ctor = attr.array.constructor
    g.setAttribute(name, new THREE.BufferAttribute(new Ctor(out[name]), attr.itemSize, attr.normalized))
  }
  g.setIndex(newIdx)
  g.groups = src.groups.map((gr) => ({ ...gr, start: gr.start * 4, count: gr.count * 4 }))
  computeWeldedNormals(g)
  g.computeBoundingSphere()
  g.computeBoundingBox()
  return g
}

function mergeSkin(geo, i, j) {
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight
  const acc = new Map()
  for (const v of [i, j]) {
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(v, k) * 0.5
      if (w <= 0) continue
      const bone = si.getComponent(v, k)
      acc.set(bone, (acc.get(bone) || 0) + w)
    }
  }
  const top = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4)
  const total = top.reduce((s, e) => s + e[1], 0) || 1
  const res = { indices: [0, 0, 0, 0], weights: [0, 0, 0, 0] }
  top.forEach(([bone, w], k) => {
    res.indices[k] = bone
    res.weights[k] = w / total
  })
  return res
}

// Smooth normals that ignore UV seams (positions welded).
function computeWeldedNormals(g) {
  const pos = g.attributes.position
  const idx = g.index.array
  const keyOf = (i) => `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`
  const ids = new Map()
  const weld = new Int32Array(pos.count)
  for (let i = 0; i < pos.count; i++) {
    const k = keyOf(i)
    let w = ids.get(k)
    if (w === undefined) ids.set(k, (w = ids.size))
    weld[i] = w
  }
  const acc = new Float32Array(ids.size * 3)
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  for (let t = 0; t < idx.length; t += 3) {
    a.fromBufferAttribute(pos, idx[t])
    b.fromBufferAttribute(pos, idx[t + 1])
    c.fromBufferAttribute(pos, idx[t + 2])
    const nrm = c.sub(b).cross(a.sub(b)) // area weighted
    for (let k = 0; k < 3; k++) {
      const w = weld[idx[t + k]]
      acc[w * 3] += nrm.x
      acc[w * 3 + 1] += nrm.y
      acc[w * 3 + 2] += nrm.z
    }
  }
  const normals = new Float32Array(pos.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    const w = weld[i]
    v.set(acc[w * 3], acc[w * 3 + 1], acc[w * 3 + 2])
    // vertices touched only by degenerate triangles would get a zero normal (NaN in the shader)
    if (v.lengthSq() < 1e-20) v.set(0, 1, 0)
    v.normalize()
    normals.set([v.x, v.y, v.z], i * 3)
  }
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
}
