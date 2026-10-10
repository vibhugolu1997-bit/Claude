import * as THREE from 'three'

const BASE = `${import.meta.env.BASE_URL}assets/mahakali/`

function loadTex(loader, file, srgb) {
  const t = loader.load(BASE + file)
  t.flipY = false // glTF UV convention
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.anisotropy = 8
  return t
}

// Fine skin micro-structure (pores + creases) as a tiling normal map, painted
// procedurally and converted from a height field.
let poreNormal = null
function makePoreNormal() {
  if (poreNormal) return poreNormal
  const N = 512
  const h = new Float32Array(N * N)
  let s = 1234567
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  // soft micro-noise
  for (let i = 0; i < h.length; i++) h[i] = rnd() * 0.15
  // pores: small pits
  for (let p = 0; p < 5200; p++) {
    const cx = rnd() * N, cy = rnd() * N, r = 0.8 + rnd() * 1.6, d = 0.6 + rnd() * 0.6
    for (let y = Math.floor(cy - 3); y <= cy + 3; y++)
      for (let x = Math.floor(cx - 3); x <= cx + 3; x++) {
        const dist = Math.hypot(x - cx, y - cy)
        if (dist > r * 1.8) continue
        const k = Math.exp(-(dist * dist) / (r * r))
        h[((y + N) % N) * N + ((x + N) % N)] -= d * k
      }
  }
  // faint criss-cross creases
  for (let c = 0; c < 140; c++) {
    let x = rnd() * N, y = rnd() * N
    const a = rnd() * Math.PI, len = 20 + rnd() * 60
    for (let t = 0; t < len; t++) {
      x += Math.cos(a) * 0.8
      y += Math.sin(a) * 0.8
      h[((Math.floor(y) % N) + N) % N * N + (((Math.floor(x) % N) + N) % N)] -= 0.25
    }
  }
  // blur once
  const b = new Float32Array(h.length)
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let sum = 0
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) sum += h[((y + j + N) % N) * N + ((x + i + N) % N)]
      b[y * N + x] = sum / 9
    }
  const data = new Uint8Array(N * N * 4)
  const strength = 2.2
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = b[y * N + ((x + 1) % N)] - b[y * N + ((x - 1 + N) % N)]
      const dy = b[((y + 1) % N) * N + x] - b[((y - 1 + N) % N) * N + x]
      const v = new THREE.Vector3(-dx * strength, -dy * strength, 1).normalize()
      const o = (y * N + x) * 4
      data[o] = (v.x * 0.5 + 0.5) * 255
      data[o + 1] = (v.y * 0.5 + 0.5) * 255
      data[o + 2] = (v.z * 0.5 + 0.5) * 255
      data[o + 3] = 255
    }
  poreNormal = new THREE.DataTexture(data, N, N)
  poreNormal.wrapS = poreNormal.wrapT = THREE.RepeatWrapping
  poreNormal.magFilter = THREE.LinearFilter
  poreNormal.minFilter = THREE.LinearMipmapLinearFilter
  poreNormal.generateMipmaps = true
  poreNormal.needsUpdate = true
  return poreNormal
}

// Physical lighting tweaks for skin, applied only where the ORM red channel
// marks skin:
//  * per-channel wrapped diffuse: light bleeds softly past the terminator with
//    a violet tint, the way light scatters under real skin
//  * pore-level detail normal mixed into the baked normal map
//  * a faint grazing-angle scatter rim
const physicalPars = THREE.ShaderChunk.lights_physical_pars_fragment
const DIFFUSE_LINE = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );'
if (!physicalPars.includes(DIFFUSE_LINE)) console.warn('skin shader: three.js lighting chunk changed; wrap lighting disabled')
const skinPhysicalPars = physicalPars.replace(
  DIFFUSE_LINE,
  `{
    float nlRaw = dot( geometryNormal, directLight.direction );
    vec3 w = uWrap * gSkin;
    vec3 wrapped = saturate( ( vec3( nlRaw ) + w ) / ( ( 1.0 + w ) * ( 1.0 + w ) ) );
    vec3 skinIrr = directLight.color * wrapped;
    #ifdef USE_SHEEN
      skinIrr *= sheenEnergyComp;
    #endif
    reflectedLight.directDiffuse += skinIrr * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
  }`,
)

function skinShader(material, { detailScale, detailStrength, wrap = [0.55, 0.22, 0.42], scatter = '#30245e', key }) {
  const uniforms = {
    uWrap: { value: new THREE.Vector3(...wrap) },
    uScatter: { value: new THREE.Color(scatter) },
    uPores: { value: makePoreNormal() },
    uPoreScale: { value: detailScale },
    uPoreStrength: { value: detailStrength },
  }
  material.userData.skinUniforms = uniforms
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uWrap; uniform vec3 uScatter;
        uniform sampler2D uPores; uniform float uPoreScale; uniform float uPoreStrength;
        float gSkin = 0.0;`,
      )
      .replace('#include <lights_physical_pars_fragment>', skinPhysicalPars)
      .replace(
        '#include <normal_fragment_maps>',
        `gSkin = texture2D( roughnessMap, vRoughnessMapUv ).r;
        vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
        mapN.xy *= normalScale;
        vec3 poreN = texture2D( uPores, vNormalMapUv * uPoreScale ).xyz * 2.0 - 1.0;
        mapN = normalize( vec3( mapN.xy + poreN.xy * uPoreStrength * gSkin, mapN.z ) );
        normal = normalize( tbn * mapN );`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          float ndv = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
          float rim = pow( 1.0 - ndv, 3.0 );
          reflectedLight.indirectDiffuse += uScatter * rim * 0.9 * gSkin;
        }`,
      )
  }
  material.customProgramCacheKey = () => `skin-${key}`
}

export function createMaterials(loader) {
  const tex = (f, srgb) => loadTex(loader, f, srgb)
  const bodyColor = tex('body_color.jpg', true)
  const bodyOrm = tex('body_orm.jpg')
  const body = new THREE.MeshPhysicalMaterial({
    name: 'body',
    map: bodyColor,
    normalMap: tex('body_normal.jpg'),
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: bodyOrm,
    metalnessMap: bodyOrm,
    roughness: 1,
    metalness: 1,
    // silk / skin sheen tinted by the albedo itself: red on the tunic, blue on the skin
    sheen: 0.45,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color('#ffffff').multiplyScalar(0.9),
    sheenColorMap: bodyColor,
    // a thin oily layer only on skin (ORM red channel) – the second specular lobe of real skin
    clearcoat: 0.2,
    clearcoatMap: bodyOrm,
    clearcoatRoughness: 0.42,
  })
  skinShader(body, { detailScale: 28, detailStrength: 0.35, key: 'body' })

  const headOrm = tex('head_orm.jpg')
  const head = new THREE.MeshPhysicalMaterial({
    name: 'head',
    map: tex('head_color.jpg', true),
    normalMap: tex('head_normal.jpg'),
    roughnessMap: headOrm,
    metalnessMap: headOrm,
    roughness: 1,
    metalness: 1,
    sheen: 0.25,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color('#41508f'),
    clearcoat: 0.24,
    clearcoatMap: headOrm,
    clearcoatRoughness: 0.38,
  })
  skinShader(head, { detailScale: 14, detailStrength: 0.42, key: 'head' })

  const hairCards = new THREE.MeshStandardMaterial({
    name: 'lashes',
    map: tex('hair_cards.png', true),
    color: new THREE.Color('#3a3f52'),
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    roughness: 0.6,
    metalness: 0,
  })

  // Cornea: a glossy, colourless shell over each eye. Rendered additively with a
  // black base, so only its reflections (the "wet" catch-lights) show.
  const cornea = new THREE.MeshPhysicalMaterial({
    name: 'cornea',
    color: '#000000',
    roughness: 0.03,
    metalness: 0,
    ior: 1.376,
    specularIntensity: 1,
    envMapIntensity: 2.2,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  return { body, head, hairCards, cornea }
}
