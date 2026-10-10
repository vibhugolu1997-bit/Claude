import * as THREE from 'three'

const BASE = `${import.meta.env.BASE_URL}assets/mahakali/`

function loadTex(loader, file, srgb) {
  const t = loader.load(BASE + file)
  t.flipY = false // glTF UV convention
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.anisotropy = 8
  return t
}

// Cheap subsurface approximation: wrap diffuse lighting so light bleeds past
// the terminator, with a cool scatter tint (blue skin scatters toward violet).
function addSkinScatter(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uScatter = { value: new THREE.Color('#3b2a6a') }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uScatter;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          // rim/back scatter term – brightest at grazing angles
          float ndv = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
          float rim = pow(1.0 - ndv, 3.0);
          reflectedLight.indirectDiffuse += uScatter * rim * 0.35 * diffuseColor.rgb * 4.0;
        }`,
      )
  }
  material.customProgramCacheKey = () => 'skin-scatter'
}

export function createMaterials(loader) {
  const tex = (f, srgb) => loadTex(loader, f, srgb)
  const bodyColor = tex('body_color.jpg', true)
  const body = new THREE.MeshPhysicalMaterial({
    name: 'body',
    map: bodyColor,
    normalMap: tex('body_normal.jpg'),
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: tex('body_orm.jpg'),
    metalnessMap: tex('body_orm.jpg'),
    roughness: 1,
    metalness: 1,
    // silk / skin sheen tinted by the albedo itself: red on the tunic, blue on the skin
    sheen: 0.5,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color('#ffffff').multiplyScalar(0.9),
    sheenColorMap: bodyColor,
    clearcoat: 0.04,
    clearcoatRoughness: 0.6,
  })
  addSkinScatter(body)

  const head = new THREE.MeshPhysicalMaterial({
    name: 'head',
    map: tex('head_color.jpg', true),
    normalMap: tex('head_normal.jpg'),
    roughnessMap: tex('head_orm.jpg'),
    metalnessMap: tex('head_orm.jpg'),
    roughness: 1,
    metalness: 1,
    sheen: 0.35,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color('#41508f'),
    clearcoat: 0.05,
    clearcoatRoughness: 0.6,
  })
  addSkinScatter(head)

  const hairCards = new THREE.MeshStandardMaterial({
    name: 'hair-cards',
    map: tex('hair_cards.png', true),
    color: new THREE.Color('#4a5270'),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.45,
    metalness: 0,
  })
  return { body, head, hairCards }
}
