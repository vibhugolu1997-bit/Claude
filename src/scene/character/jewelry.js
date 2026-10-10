import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Hand-built ornaments, fitted to the measured body and parented to bones so
// they follow the animation. Geometry is generated at load time.

export function jewelryMaterials() {
  return {
    gold: new THREE.MeshPhysicalMaterial({ color: '#e2ad57', metalness: 1, roughness: 0.24, clearcoat: 0.3, clearcoatRoughness: 0.2 }),
    oldGold: new THREE.MeshPhysicalMaterial({ color: '#b98535', metalness: 1, roughness: 0.38 }),
    ruby: new THREE.MeshPhysicalMaterial({ color: '#8a0614', metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, emissive: '#2a0004', ior: 1.76, specularIntensity: 1, specularColor: '#ffffff' }),
    emerald: new THREE.MeshPhysicalMaterial({ color: '#0b5e36', metalness: 0, roughness: 0.05, clearcoat: 1, emissive: '#001a0c', ior: 1.58 }),
    pearl: new THREE.MeshPhysicalMaterial({ color: '#cfc5b6', metalness: 0, roughness: 0.28, sheen: 1, sheenColor: '#ffd9f0', sheenRoughness: 0.3, clearcoat: 0.6 }),
    steel: new THREE.MeshPhysicalMaterial({ color: '#c9ccd2', metalness: 1, roughness: 0.16, clearcoat: 0.4 }),
    silver: new THREE.MeshPhysicalMaterial({ color: '#e8ecf4', metalness: 1, roughness: 0.18, emissive: '#283048', emissiveIntensity: 0.4 }),
  }
}

const gemGeo = new THREE.IcosahedronGeometry(1, 1)
const beadGeo = new THREE.SphereGeometry(1, 12, 8)
const ballGeo = new THREE.SphereGeometry(1, 16, 12)

function placeInstances(geo, mat, transforms) {
  const im = new THREE.InstancedMesh(geo, mat, transforms.length)
  transforms.forEach((m, i) => im.setMatrixAt(i, m))
  im.instanceMatrix.needsUpdate = true
  im.castShadow = true
  im.computeBoundingSphere()
  return im
}

const M = (pos, scale = 1, quat = new THREE.Quaternion()) =>
  new THREE.Matrix4().compose(pos, quat, typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : scale)

// A band that follows a closed/open polyline (points + outward normals).
function bandGeometry(points, normals, height, thickness, closed) {
  const n = points.length
  const pos = [], idx = []
  const up = new THREE.Vector3(0, 1, 0)
  for (let i = 0; i < n; i++) {
    const p = points[i], nr = normals[i]
    const o = p.clone().addScaledVector(nr, thickness)
    for (const [base, dy] of [[p, 0], [o, 0], [o, height], [p, height]]) {
      const v = base.clone().addScaledVector(up, dy)
      pos.push(v.x, v.y, v.z)
    }
  }
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const a = i * 4, b = ((i + 1) % n) * 4
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4
      idx.push(a + k, b + k, b + k2, a + k, b + k2, a + k2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// 2-D petal / spire outline → bevelled extrusion (crown spires, armband crest)
function spireGeometry(w, h, depth = 0.004) {
  const s = new THREE.Shape()
  s.moveTo(-w / 2, 0)
  s.bezierCurveTo(-w * 0.62, h * 0.35, -w * 0.18, h * 0.6, 0, h)
  s.bezierCurveTo(w * 0.18, h * 0.6, w * 0.62, h * 0.35, w / 2, 0)
  s.closePath()
  // filigree window
  const hole = new THREE.Path()
  hole.moveTo(0, h * 0.25)
  hole.bezierCurveTo(w * 0.25, h * 0.32, w * 0.12, h * 0.55, 0, h * 0.68)
  hole.bezierCurveTo(-w * 0.12, h * 0.55, -w * 0.25, h * 0.32, 0, h * 0.25)
  s.holes.push(hole)
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.0012, bevelThickness: 0.0012, bevelSegments: 2, curveSegments: 10 })
  g.translate(0, 0, -depth / 2)
  return g
}

// ring of points around the body at height y between angles a0..a1
function bodyRing(shape, y, a0, a1, n, offset) {
  const pts = [], nrm = []
  const c = shape.center(y)
  for (let i = 0; i < n; i++) {
    const th = a0 + (a1 - a0) * (i / (n - 1 || 1))
    const p = shape.surface(y, th, offset)
    pts.push(p)
    nrm.push(new THREE.Vector3(p.x - c.x, 0, p.z - c.z).normalize())
  }
  return { pts, nrm }
}

// --------------------------------------------------------------------- crown
export function buildCrown(shape, eyeY, eyeZ, mats) {
  const g = new THREE.Group()
  g.name = 'mukut'
  const bandY = eyeY + 0.05
  const ring = bodyRing(shape, bandY, -Math.PI * 0.98, Math.PI * 0.98, 72, 0.006)
  // tilt the ring so it sits higher at the back of the skull
  ring.pts.forEach((p, i) => {
    const back = -ring.nrm[i].z
    p.y += Math.max(0, back) * 0.035
  })
  g.add(new THREE.Mesh(bandGeometry(ring.pts, ring.nrm, 0.032, 0.006, true), mats.gold))
  // bead rows along both edges, gems along the band
  const beads = [], gems = [], pearls = []
  ring.pts.forEach((p, i) => {
    const n = ring.nrm[i]
    const out = p.clone().addScaledVector(n, 0.007)
    beads.push(M(out.clone().setY(p.y + 0.002), 0.0032), M(out.clone().setY(p.y + 0.030), 0.0032))
    if (i % 4 === 0) gems.push(M(out.clone().addScaledVector(n, 0.002).setY(p.y + 0.016), 0.0058))
    if (i % 2 === 1) pearls.push(M(out.clone().addScaledVector(n, -0.001).setY(p.y - 0.006), 0.0028))
  })
  g.add(placeInstances(beadGeo, mats.gold, beads), placeInstances(gemGeo, mats.ruby, gems), placeInstances(ballGeo, mats.pearl, pearls))

  // tiers of spires rising from the band, leaning inward like a temple shikhara
  const tiers = [
    { count: 15, w: 0.032, h: 0.055, y: 0.028, lean: 0.22, spread: 0.92, r: 0 },
    { count: 11, w: 0.028, h: 0.05, y: 0.062, lean: 0.34, spread: 0.8, r: -0.016 },
    { count: 5, w: 0.024, h: 0.045, y: 0.095, lean: 0.45, spread: 0.6, r: -0.034 },
  ]
  const spire = (w, h) => spireGeometry(w, h)
  for (const tier of tiers) {
    const geo = spire(tier.w, tier.h)
    for (let k = 0; k < tier.count; k++) {
      const th = (k / (tier.count - 1) - 0.5) * 2 * Math.PI * tier.spread
      const base = shape.surface(bandY, th, 0.008 + tier.r)
      const c = shape.center(bandY)
      const outward = new THREE.Vector3(base.x - c.x, 0, base.z - c.z).normalize()
      base.addScaledVector(outward, tier.r)
      base.y += tier.y + Math.max(0, -outward.z) * 0.035
      const m = new THREE.Mesh(geo, mats.gold)
      m.position.copy(base)
      m.lookAt(base.clone().add(outward))
      m.rotateX(-tier.lean)
      g.add(m)
      // a jewel in each spire
      const jewel = new THREE.Mesh(gemGeo, (k + tiers.indexOf(tier)) % 3 === 0 ? mats.emerald : mats.ruby)
      jewel.scale.setScalar(tier.w * 0.17)
      jewel.position.set(0, tier.h * 0.32, 0.004)
      m.add(jewel)
    }
  }
  // central front spire and finial
  const front = shape.surface(bandY, 0, 0.014)
  const big = new THREE.Mesh(spireGeometry(0.055, 0.11, 0.005), mats.gold)
  big.position.copy(front).add(new THREE.Vector3(0, 0.03, 0))
  big.rotation.x = -0.18
  g.add(big)
  const centreGem = new THREE.Mesh(gemGeo, mats.ruby)
  centreGem.scale.set(0.011, 0.014, 0.008)
  centreGem.position.set(0, 0.038, 0.006)
  big.add(centreGem)
  // silver crescent moon above the central jewel
  const moon = new THREE.Mesh(crescentGeometry(0.016), mats.silver)
  moon.position.set(0, 0.072, 0.005)
  big.add(moon)

  const top = shape.center(bandY).add(new THREE.Vector3(0, 0.128, -0.012))
  const finial = new THREE.Mesh(latheGeometry([[0, 0], [0.022, 0.003], [0.026, 0.011], [0.016, 0.021], [0.009, 0.032], [0.012, 0.04], [0.004, 0.055], [0.0, 0.072]], 24), mats.gold)
  finial.position.copy(top)
  g.add(finial)
  const finialGem = new THREE.Mesh(gemGeo, mats.ruby)
  finialGem.scale.setScalar(0.009)
  finialGem.position.copy(top).add(new THREE.Vector3(0, 0.034, 0.011))
  g.add(finialGem)
  // fill the crown's core so the head never shows through the spires
  const core = new THREE.Mesh(latheGeometry([[0.0, 0.0], [0.08, 0.0], [0.078, 0.03], [0.064, 0.07], [0.04, 0.1], [0.018, 0.12], [0, 0.125]], 32), mats.oldGold)
  const cc = shape.center(bandY + 0.02)
  core.position.set(cc.x, bandY + 0.02, cc.z - 0.01)
  core.scale.set(1.0, 1, 1.1)
  g.add(core)
  g.traverse((o) => o.isMesh && (o.castShadow = true))
  return g
}

function crescentGeometry(r) {
  const s = new THREE.Shape()
  s.absarc(0, 0, r, Math.PI * 0.15, Math.PI * 0.85, true)
  s.absarc(0, r * 0.45, r * 0.78, Math.PI * 0.9, Math.PI * 0.1, false)
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.002, bevelEnabled: true, bevelSize: 0.0008, bevelThickness: 0.0008, bevelSegments: 2 })
  g.rotateZ(Math.PI)
  return g
}

export function latheGeometry(profile, segs = 24) {
  return new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), segs)
}

// ------------------------------------------------------------------- jhumka
export function buildJhumka(mats) {
  const g = new THREE.Group()
  const stud = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.002, 8, 20), mats.gold)
  g.add(stud)
  const studGem = new THREE.Mesh(gemGeo, mats.ruby)
  studGem.scale.setScalar(0.004)
  g.add(studGem)
  const link = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.012, 6), mats.gold)
  link.position.y = -0.012
  g.add(link)
  // the bell
  const bell = new THREE.Mesh(
    latheGeometry([[0.0, 0], [0.004, -0.001], [0.009, -0.006], [0.0125, -0.014], [0.0145, -0.022], [0.0148, -0.025], [0.0, -0.025]], 28),
    mats.gold,
  )
  bell.position.y = -0.016
  g.add(bell)
  const drops = []
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    drops.push(M(new THREE.Vector3(Math.cos(a) * 0.0142, -0.044, Math.sin(a) * 0.0142), 0.0022))
  }
  g.add(placeInstances(ballGeo, mats.pearl, drops))
  g.traverse((o) => o.isMesh && (o.castShadow = true))
  return g
}

// ------------------------------------------------------------- necklaces
export function buildNecklaces(shape, neckBaseY, mats) {
  const g = new THREE.Group()
  const strands = [
    { drop: 0.035, beads: 46, size: 0.0042, mat: mats.gold, span: 1.25 },
    { drop: 0.075, beads: 58, size: 0.0048, mat: mats.pearl, span: 1.3 },
    { drop: 0.13, beads: 64, size: 0.0055, mat: mats.gold, span: 1.35 },
    { drop: 0.19, beads: 70, size: 0.0046, mat: mats.pearl, span: 1.38 },
  ]
  const pendants = []
  for (const st of strands) {
    const mats_ = []
    let prev = null
    for (let i = 0; i < st.beads; i++) {
      const f = (i / (st.beads - 1)) * 2 - 1 // -1..1
      const th = f * st.span
      const y = neckBaseY - st.drop * Math.pow(Math.cos((f * Math.PI) / 2), 1.6)
      const p = shape.surface(y, th, st.size + 0.002)
      if (prev && p.distanceTo(prev) < st.size * 1.6) continue
      mats_.push(M(p, st.size))
      prev = p
    }
    g.add(placeInstances(beadGeo, st.mat, mats_))
    pendants.push(shape.surface(neckBaseY - st.drop, 0, st.size * 2 + 0.004))
  }
  // central medallion (padakkam) on the long gold strand
  const pc = pendants[2]
  const med = new THREE.Group()
  med.position.copy(pc).add(new THREE.Vector3(0, -0.022, 0.004))
  med.rotation.x = -0.2
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.0035, 10, 36), mats.gold)
  med.add(frame)
  const stone = new THREE.Mesh(gemGeo, mats.ruby)
  stone.scale.set(0.013, 0.016, 0.006)
  med.add(stone)
  const petals = []
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    petals.push(M(new THREE.Vector3(Math.cos(a) * 0.024, Math.sin(a) * 0.024, 0), 0.0045))
  }
  med.add(placeInstances(beadGeo, mats.gold, petals))
  const drop = new THREE.Mesh(gemGeo, mats.emerald)
  drop.scale.set(0.006, 0.009, 0.005)
  drop.position.y = -0.034
  med.add(drop)
  g.add(med)
  g.traverse((o) => o.isMesh && (o.castShadow = true))
  return g
}

// Choker: a slim jewelled band fitted to the neck at the given height.
export function buildChoker(shape, y, mats) {
  const g = new THREE.Group()
  const ring = bodyRing(shape, y, -Math.PI, Math.PI, 64, 0.001)
  g.add(new THREE.Mesh(bandGeometry(ring.pts, ring.nrm, 0.011, 0.003, true), mats.gold))
  const gems = []
  ring.pts.forEach((p, i) => i % 3 === 0 && Math.abs((i / 63) * 2 - 1) < 0.45 && gems.push(M(p.clone().addScaledVector(ring.nrm[i], 0.0045).setY(p.y + 0.0055), 0.003)))
  g.add(placeInstances(gemGeo, mats.ruby, gems))
  g.traverse((o) => o.isMesh && (o.castShadow = true))
  return g
}

// ------------------------------------------------- arm rings (bajuband/bangles)
export function measureLimb(mesh, root, boneIdxSet, origin, axis) {
  // average radius of the limb around `axis` near `origin` (model space)
  const pos = mesh.geometry.attributes.position
  const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight
  const toModel = new THREE.Matrix4().multiplyMatrices(root.matrixWorld.clone().invert(), mesh.matrixWorld)
  const v = new THREE.Vector3()
  let sum = 0, n = 0, max = 0
  for (let i = 0; i < pos.count; i++) {
    let w = 0
    for (let k = 0; k < 4; k++) if (boneIdxSet.has(si.getComponent(i, k))) w += sw.getComponent(i, k)
    if (w < 0.5) continue
    v.fromBufferAttribute(pos, i).applyMatrix4(toModel).sub(origin)
    const along = v.dot(axis)
    if (Math.abs(along) > 0.012) continue
    const r = v.addScaledVector(axis, -along).length()
    sum += r; n++; max = Math.max(max, r)
  }
  return n ? { mean: sum / n, max } : { mean: 0.04, max: 0.045 }
}

export function buildArmband(radius, mats) {
  const g = new THREE.Group()
  const band = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.004, radius + 0.004, 0.018, 32, 1, true), mats.gold)
  band.material = mats.gold
  g.add(band)
  for (const y of [-0.009, 0.009]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.004, 0.0022, 8, 40), mats.gold)
    rim.rotation.x = Math.PI / 2
    rim.position.y = y
    g.add(rim)
  }
  // crest facing outward (+X in ring space, oriented by the caller)
  const crest = new THREE.Mesh(spireGeometry(0.03, 0.036, 0.003), mats.gold)
  crest.position.set(radius + 0.006, -0.012, 0)
  crest.rotation.set(0, Math.PI / 2, 0)
  g.add(crest)
  const gem = new THREE.Mesh(gemGeo, mats.ruby)
  gem.scale.setScalar(0.0055)
  gem.position.set(radius + 0.009, 0.0, 0)
  g.add(gem)
  g.traverse((o) => o.isMesh && (o.castShadow = true))
  return g
}

export function buildBangles(radius, mats) {
  const g = new THREE.Group()
  const kinds = [mats.gold, mats.ruby, mats.gold, mats.gold, mats.ruby, mats.gold]
  kinds.forEach((mat, i) => {
    const r = radius + 0.006 + i * 0.0012
    const t = new THREE.Mesh(new THREE.TorusGeometry(r, mat === mats.ruby ? 0.0018 : 0.0026, 8, 40), mat)
    t.rotation.x = Math.PI / 2
    t.position.y = -i * 0.0062
    g.add(t)
  })
  g.traverse((o) => o.isMesh && (o.castShadow = true))
  return g
}

// ------------------------------------------------------------ kamarbandh
export function buildWaistBelt(shape, y, mats) {
  const g = new THREE.Group()
  const ring = bodyRing(shape, y, -Math.PI, Math.PI, 80, 0.03)
  g.add(new THREE.Mesh(bandGeometry(ring.pts, ring.nrm, 0.03, 0.004, true), mats.gold))
  const gems = [], hang = []
  ring.pts.forEach((p, i) => {
    const out = p.clone().addScaledVector(ring.nrm[i], 0.005)
    if (i % 5 === 0) gems.push(M(out.clone().setY(y + 0.015), 0.0065))
    if (i % 2 === 0 && Math.abs(Math.atan2(ring.nrm[i].x, ring.nrm[i].z)) < 1.6) {
      for (let k = 0; k < 4; k++) hang.push(M(out.clone().setY(y - 0.006 - k * 0.0085), 0.0032))
    }
  })
  g.add(placeInstances(gemGeo, mats.ruby, gems), placeInstances(beadGeo, mats.gold, hang))
  g.traverse((o) => o.isMesh && (o.castShadow = true))
  return g
}

// ------------------------------------------------------------- the khadga
export function buildKhadga(mats) {
  // a broad, forward-curving blade that widens toward the tip (Kali's khadga)
  const L = 0.74
  const s = new THREE.Shape()
  s.moveTo(-0.012, 0)
  s.bezierCurveTo(-0.016, L * 0.4, -0.01, L * 0.75, 0.01, L * 0.93)
  s.bezierCurveTo(0.03, L * 1.0, 0.06, L * 0.99, 0.07, L * 0.92)
  s.bezierCurveTo(0.05, L * 0.8, 0.03, L * 0.45, 0.016, 0)
  s.closePath()
  const blade = new THREE.Mesh(
    new THREE.ExtrudeGeometry(s, { depth: 0.0025, bevelEnabled: true, bevelSize: 0.0028, bevelThickness: 0.0016, bevelSegments: 3, curveSegments: 24 }),
    mats.steel,
  )
  blade.geometry.translate(0, 0, -0.00125)
  blade.position.y = 0.06
  const g = new THREE.Group()
  g.add(blade)
  // fuller line in gold inlay
  const inlay = new THREE.Mesh(new THREE.BoxGeometry(0.003, L * 0.6, 0.0052), mats.gold)
  inlay.position.set(0.003, 0.06 + L * 0.35, 0)
  g.add(inlay)
  // guard and hilt
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 10, 24, Math.PI), mats.gold)
  guard.position.y = 0.06
  guard.rotation.z = Math.PI
  g.add(guard)
  const hilt = new THREE.Mesh(
    latheGeometry([[0.0, -0.1], [0.016, -0.098], [0.02, -0.09], [0.011, -0.08], [0.012, -0.02], [0.016, 0.0], [0.024, 0.05], [0.014, 0.06], [0, 0.062]], 20),
    mats.gold,
  )
  g.add(hilt)
  const pommelGem = new THREE.Mesh(gemGeo, mats.ruby)
  pommelGem.scale.setScalar(0.008)
  pommelGem.position.y = -0.104
  g.add(pommelGem)
  g.traverse((o) => o.isMesh && (o.castShadow = true))
  return g
}

// -------------------------------------------------------------- the kapala
export function buildBowl(mats) {
  const g = new THREE.Group()
  const bowl = new THREE.Mesh(
    latheGeometry([[0, -0.03], [0.022, -0.028], [0.038, -0.018], [0.046, -0.002], [0.048, 0.006], [0.044, 0.006], [0.042, -0.002], [0.034, -0.014], [0.018, -0.022], [0, -0.024]], 36),
    mats.oldGold,
  )
  bowl.material.side = THREE.DoubleSide
  g.add(bowl)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.0024, 8, 40), mats.gold)
  rim.rotation.x = Math.PI / 2
  rim.position.y = 0.006
  g.add(rim)
  g.traverse((o) => o.isMesh && (o.castShadow = true))
  return g
}

export { mergeGeometries }
