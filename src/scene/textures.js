import * as THREE from 'three'

// Procedurally painted textures (no external files needed).

function canvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')]
}

function rand(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

function finish(c, srgb, repeat = [1, 1]) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(...repeat)
  t.anisotropy = 8
  return t
}

// paisley / mango motif used in zari borders
function paisley(g, x, y, s, rot) {
  g.save()
  g.translate(x, y)
  g.rotate(rot)
  g.scale(s, s)
  g.beginPath()
  g.moveTo(0, -10)
  g.bezierCurveTo(9, -10, 10, 4, 0, 10)
  g.bezierCurveTo(-6, 13, -10, 4, -6, 0)
  g.bezierCurveTo(-3, -4, 4, -3, 2, -8)
  g.closePath()
  g.fill()
  g.restore()
}

/**
 * Lehenga silk: crimson body with gold buttis and a broad zari border.
 * Returns { map, orm } – orm: G = roughness, B = metalness.
 */
export function makeLehengaTextures() {
  const W = 1024, H = 1024
  const [c, g] = canvas(W, H)
  const [o, og] = canvas(W, H)
  const r = rand(7)

  // base silk with soft vertical pleat shading
  const grad = g.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#3e040b')
  grad.addColorStop(1, '#55060f')
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)
  for (let x = 0; x < W; x += 2) {
    const v = Math.sin(x * 0.05) * 0.5 + Math.sin(x * 0.013 + 1) * 0.5
    g.fillStyle = `rgba(${v > 0 ? '255,80,90' : '0,0,0'},${Math.abs(v) * 0.05})`
    g.fillRect(x, 0, 2, H)
  }
  og.fillStyle = 'rgb(255,140,0)' // roughness ~0.55, metal 0
  og.fillRect(0, 0, W, H)

  const gold = (alpha = 1) => `rgba(196,146,62,${alpha})`
  const metal = 'rgb(255,80,235)' // roughness ~0.3, metal ~0.92

  // scattered buttis
  for (let row = 0; row < 14; row++) {
    for (let col = 0; col < 16; col++) {
      const x = (col + (row % 2) * 0.5) * (W / 16)
      const y = 40 + row * 46
      if (y > H * 0.7) continue
      for (const [ctx, col_] of [[g, gold(0.9)], [og, metal]]) {
        ctx.fillStyle = col_
        ctx.beginPath()
        ctx.arc(x, y, 4.5, 0, Math.PI * 2)
        ctx.fill()
        for (let p = 0; p < 4; p++) {
          const a = (p / 4) * Math.PI * 2 + Math.PI / 4
          ctx.beginPath()
          ctx.ellipse(x + Math.cos(a) * 7, y + Math.sin(a) * 7, 3.2, 1.6, a, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
  }

  // zari border bands (hem at v = 1 → canvas bottom)
  const band = (y0, y1) => {
    for (const [ctx, col_] of [[g, gold()], [og, metal]]) {
      ctx.fillStyle = col_
      ctx.fillRect(0, y0, W, y1 - y0)
    }
    // woven texture inside the gold
    for (let y = y0; y < y1; y += 3) {
      g.fillStyle = `rgba(90,50,10,${0.15 + r() * 0.1})`
      g.fillRect(0, y, W, 1)
    }
  }
  band(H * 0.74, H * 0.755)
  band(H * 0.79, H * 0.965)
  band(H * 0.98, H * 0.995)
  // crimson paisley inlays within the main band
  g.fillStyle = '#6a0712'
  og.fillStyle = 'rgb(255,140,0)'
  for (let i = 0; i < 16; i++) {
    const x = (i + 0.5) * (W / 16)
    paisley(g, x, H * 0.877, 3.4, i % 2 ? 0.4 : -0.4)
    paisley(og, x, H * 0.877, 3.4, i % 2 ? 0.4 : -0.4)
  }
  g.fillStyle = gold()
  for (let i = 0; i < 16; i++) {
    const x = (i + 0.5) * (W / 16)
    g.beginPath()
    g.arc(x + 2, H * 0.874, 5, 0, Math.PI * 2)
    g.fill()
    // tiny dots row
    for (let k = 0; k < 6; k++) {
      g.beginPath()
      g.arc(i * (W / 16) + k * (W / 96), H * 0.805, 2, 0, Math.PI * 2)
      g.fill()
    }
  }
  return { map: finish(c, true, [3, 1]), orm: finish(o, false, [3, 1]) }
}

/**
 * Hair strand alpha card: many thin, slightly wavy strands that taper at the tip.
 */
export function makeHairTexture() {
  const W = 512, H = 1024
  const [c, g] = canvas(W, H)
  const r = rand(11)
  g.clearRect(0, 0, W, H)
  // strands gather into clumps with gaps between them, like real loose hair
  const clumps = Array.from({ length: 9 }, () => r() * W)
  for (let i = 0; i < 700; i++) {
    const x0 = (clumps[i % clumps.length] + (r() - 0.5) * 70 + W) % W
    const len = H * (0.7 + r() * 0.3)
    const width = 0.6 + r() * 1.6
    const shade = 8 + r() * 30
    const blue = shade + 6 + r() * 10
    g.strokeStyle = `rgba(${shade},${shade + 2},${blue},${0.55 + r() * 0.45})`
    g.lineWidth = width
    g.beginPath()
    const phase = r() * 6.28, amp = 2 + r() * 7
    for (let y = 0; y <= len; y += 8) {
      const x = x0 + Math.sin(y * 0.012 + phase) * amp + (y / H) * (r() - 0.5) * 2
      if (y === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
  }
  // a few bright strands for the specular sheen
  for (let i = 0; i < 120; i++) {
    const x0 = r() * W
    g.strokeStyle = `rgba(70,78,100,${0.25 + r() * 0.3})`
    g.lineWidth = 0.6
    g.beginPath()
    g.moveTo(x0, 0)
    g.lineTo(x0 + (r() - 0.5) * 12, H * (0.5 + r() * 0.5))
    g.stroke()
  }
  // taper the tips: fade alpha toward the bottom of the card
  g.globalCompositeOperation = 'destination-in'
  const fade = g.createLinearGradient(0, 0, 0, H)
  fade.addColorStop(0, 'rgba(0,0,0,1)')
  fade.addColorStop(0.75, 'rgba(0,0,0,0.95)')
  fade.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = fade
  g.fillRect(0, 0, W, H)
  const t = finish(c, true)
  t.wrapT = THREE.ClampToEdgeWrapping
  return t
}

/**
 * Carved granite for the temple: albedo + roughness, tiled.
 */
export function makeStoneTextures({ tiles = 4, seed = 3, base = [52, 46, 42], polished = false } = {}) {
  const W = 1024
  const [c, g] = canvas(W, W)
  const [o, og] = canvas(W, W)
  const r = rand(seed)
  g.fillStyle = `rgb(${base.join(',')})`
  g.fillRect(0, 0, W, W)
  // grain
  const img = g.getImageData(0, 0, W, W)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 22 + (r() < 0.02 ? 30 : 0)
    img.data[i] += n
    img.data[i + 1] += n * 0.95
    img.data[i + 2] += n * 0.9
  }
  g.putImageData(img, 0, 0)
  // mottling
  for (let i = 0; i < 260; i++) {
    const x = r() * W, y = r() * W, rad = 10 + r() * 80
    const grd = g.createRadialGradient(x, y, 0, x, y, rad)
    const d = r() < 0.5 ? '0,0,0' : '255,240,220'
    grd.addColorStop(0, `rgba(${d},${0.05 + r() * 0.06})`)
    grd.addColorStop(1, `rgba(${d},0)`)
    g.fillStyle = grd
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  og.fillStyle = polished ? 'rgb(255,70,0)' : 'rgb(255,190,0)'
  og.fillRect(0, 0, W, W)
  // slab joints
  const s = W / tiles
  g.strokeStyle = 'rgba(10,8,6,0.85)'
  og.strokeStyle = 'rgb(255,250,0)'
  g.lineWidth = og.lineWidth = 3
  for (let i = 0; i <= tiles; i++) {
    for (const ctx of [g, og]) {
      ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, W); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * s); ctx.lineTo(W, i * s); ctx.stroke()
    }
  }
  return { map: finish(c, true), orm: finish(o, false) }
}

// Soft round sprite used by particles / smoke.
export function makeSoftSprite() {
  const [c, g] = canvas(128, 128)
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  return finish(c, true)
}
