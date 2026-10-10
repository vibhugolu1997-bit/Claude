import * as THREE from 'three'

/**
 * Measures the character's rest-pose surface so procedural garments, jewellery
 * and hair can be fitted to the real body (not to guessed primitives).
 *
 * radius(y, θ) returns the distance from the body's vertical axis to its
 * surface at height y (model space) and azimuth θ (0 = facing +Z).
 */
export class BodyShape {
  constructor(root, meshes, excludeBone = () => false) {
    this.step = 0.01
    this.bins = 48
    this.rows = 200 // 0 .. 2 m
    this.maxR = new Float32Array(this.rows * this.bins)
    this.cx = new Float32Array(this.rows)
    this.cz = new Float32Array(this.rows)
    const minX = new Float32Array(this.rows).fill(Infinity)
    const maxX = new Float32Array(this.rows).fill(-Infinity)
    const minZ = new Float32Array(this.rows).fill(Infinity)
    const maxZ = new Float32Array(this.rows).fill(-Infinity)

    root.updateMatrixWorld(true)
    const toModel = new THREE.Matrix4()
    const rootInv = root.matrixWorld.clone().invert()
    const pts = []
    const v = new THREE.Vector3()
    for (const mesh of meshes) {
      toModel.multiplyMatrices(rootInv, mesh.matrixWorld)
      const pos = mesh.geometry.attributes.position
      const si = mesh.geometry.attributes.skinIndex
      const sw = mesh.geometry.attributes.skinWeight
      for (let i = 0; i < pos.count; i++) {
        let skip = 0
        for (let k = 0; k < 4; k++) if (excludeBone(mesh.skeleton.bones[si.getComponent(i, k)])) skip += sw.getComponent(i, k)
        if (skip > 0.3) continue
        v.fromBufferAttribute(pos, i).applyMatrix4(toModel)
        const row = Math.floor(v.y / this.step)
        if (row < 0 || row >= this.rows) continue
        pts.push(v.x, v.y, v.z)
        minX[row] = Math.min(minX[row], v.x); maxX[row] = Math.max(maxX[row], v.x)
        minZ[row] = Math.min(minZ[row], v.z); maxZ[row] = Math.max(maxZ[row], v.z)
      }
    }
    for (let r = 0; r < this.rows; r++) {
      this.cx[r] = isFinite(minX[r]) ? (minX[r] + maxX[r]) / 2 : NaN
      this.cz[r] = isFinite(minZ[r]) ? (minZ[r] + maxZ[r]) / 2 : NaN
    }
    fillNaN(this.cx)
    fillNaN(this.cz)
    // the axis drifts with posture; smooth it
    smooth1D(this.cx, 4)
    smooth1D(this.cz, 4)
    for (let i = 0; i < pts.length; i += 3) {
      const row = Math.floor(pts[i + 1] / this.step)
      const dx = pts[i] - this.cx[row], dz = pts[i + 2] - this.cz[row]
      const b = this.bin(Math.atan2(dx, dz))
      const r = Math.hypot(dx, dz)
      const idx = row * this.bins + b
      if (r > this.maxR[idx]) this.maxR[idx] = r
    }
    // fill gaps around each ring and smooth
    for (let r = 0; r < this.rows; r++) {
      const ring = this.maxR.subarray(r * this.bins, (r + 1) * this.bins)
      fillRing(ring)
      smoothRing(ring, 1)
    }
  }

  bin(theta) {
    const t = ((theta / (Math.PI * 2)) % 1 + 1) % 1
    return Math.floor(t * this.bins) % this.bins
  }

  row(y) {
    return THREE.MathUtils.clamp(Math.floor(y / this.step), 0, this.rows - 1)
  }

  center(y, out = new THREE.Vector3()) {
    const r = this.row(y)
    return out.set(this.cx[r], y, this.cz[r])
  }

  radius(y, theta) {
    const fr = THREE.MathUtils.clamp(y / this.step, 0, this.rows - 1.001)
    const r0 = Math.floor(fr), tr = fr - r0
    const ft = (((theta / (Math.PI * 2)) % 1 + 1) % 1) * this.bins
    const b0 = Math.floor(ft) % this.bins, b1 = (b0 + 1) % this.bins, tb = ft - Math.floor(ft)
    const R = (row, b) => this.maxR[row * this.bins + b]
    const a = R(r0, b0) * (1 - tb) + R(r0, b1) * tb
    const c = R(r0 + 1, b0) * (1 - tb) + R(r0 + 1, b1) * tb
    return a * (1 - tr) + c * tr
  }

  // point on the surface (plus an offset) at height y / azimuth theta
  surface(y, theta, offset = 0, out = new THREE.Vector3()) {
    const c = this.center(y, out)
    const r = this.radius(y, theta) + offset
    return out.set(c.x + Math.sin(theta) * r, y, c.z + Math.cos(theta) * r)
  }
}

function fillNaN(a) {
  let last = NaN
  for (let i = 0; i < a.length; i++) if (isNaN(a[i])) a[i] = last; else last = a[i]
  last = NaN
  for (let i = a.length - 1; i >= 0; i--) if (isNaN(a[i])) a[i] = last; else last = a[i]
  for (let i = 0; i < a.length; i++) if (isNaN(a[i])) a[i] = 0
}

function smooth1D(a, k) {
  const c = a.slice()
  for (let i = 0; i < a.length; i++) {
    let s = 0, n = 0
    for (let j = -k; j <= k; j++) if (i + j >= 0 && i + j < a.length) { s += c[i + j]; n++ }
    a[i] = s / n
  }
}

function fillRing(ring) {
  const n = ring.length
  if (!ring.some((x) => x > 0)) return
  for (let i = 0; i < n; i++) {
    if (ring[i] > 0) continue
    let l = 1, r = 1
    while (ring[(i - l + n) % n] <= 0) l++
    while (ring[(i + r) % n] <= 0) r++
    const a = ring[(i - l + n) % n], b = ring[(i + r) % n]
    ring[i] = a + (b - a) * (l / (l + r))
  }
}

function smoothRing(ring, k) {
  const n = ring.length, c = ring.slice()
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = -k; j <= k; j++) s += Math.max(c[(i + j + n) % n], 0)
    ring[i] = Math.max(c[i], s / (2 * k + 1)) // never shrink inside the body
  }
}
