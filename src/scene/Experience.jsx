import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import Mahakali from './character/Mahakali.jsx'
import Temple, { DAIS_TOP } from './Temple.jsx'
import CameraRig from './CameraRig.jsx'
import { timeline } from '../lib/timeline.js'

// Image-based lighting for the PBR metals and skin (generated, no download).
function Environment() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const room = new RoomEnvironment()
    const env = pmrem.fromScene(room, 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.32
    scene.environmentRotation = new THREE.Euler(0, Math.PI * 0.2, 0)
    return () => {
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])
  return null
}

let frames = 0
// frames to render before signalling readiness to the screenshot script (?ready=N)
const DEBUG_FRAMES = new URLSearchParams(location.search).has('fps')
const READY_AT = Number(new URLSearchParams(location.search).get('ready')) || 90
function Clock() {
  useFrame((_, dt) => {
    timeline.advance(Math.min(dt, 1 / 20))
    // signal for automated screenshots
    if (++frames === READY_AT) document.documentElement.dataset.ready = '1'
    if (DEBUG_FRAMES && frames % 5 === 0) console.log('frame', frames, performance.now().toFixed(0))
  })
  return null
}

// `lit` collects the main lights so the custom hair shader can use them too.
function Lights({ lit }) {
  const { scene } = useThree()
  const faceTarget = useMemo(() => {
    const o = new THREE.Object3D()
    o.position.set(0, DAIS_TOP + 1.62, 0)
    return o
  }, [])
  const keep = (i) => (l) => {
    lit.current[i] = l
  }
  return (
    <>
      <primitive object={faceTarget} />
      <hemisphereLight args={['#4a3a5a', '#120806', 0.25]} />
      {/* warm key from the sanctum opening above-front */}
      <spotLight
        ref={keep(0)}
        position={[1.4, 4.6, 2.6]}
        target={scene}
        angle={0.42}
        penumbra={0.85}
        intensity={70}
        decay={2}
        color="#ffd2a0"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.02}
      />
      {/* cool moonlight rim from behind to carve the silhouette */}
      <spotLight ref={keep(1)} position={[-1.8, 3.2, -2.2]} target={scene} angle={0.6} penumbra={1} intensity={45} color="#7d95ff" decay={2} />
      <spotLight ref={keep(2)} position={[2.0, 2.4, -1.8]} target={scene} angle={0.6} penumbra={1} intensity={25} color="#a070ff" decay={2} />
      {/* soft portrait key on the face (under the crown's shadow) */}
      <spotLight ref={keep(3)} position={[-0.75, 2.05, 1.7]} target={faceTarget} angle={0.22} penumbra={1} intensity={7} color="#ffc896" decay={2} />
      {/* gentle frontal fill so the face reads on small screens */}
      <pointLight position={[0.3, 1.85, 1.6]} intensity={1.2} color="#ffc08a" distance={4} decay={2} />
    </>
  )
}

export default function Experience() {
  const lit = useRef([])
  return (
    <>
      <Clock />
      <color attach="background" args={['#050306']} />
      <fogExp2 attach="fog" args={['#0b0709', 0.075]} />
      <Environment />
      <Lights lit={lit} />
      <Temple />
      <Mahakali position={[0, DAIS_TOP, 0]} lights={lit} />
      <CameraRig />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.85} luminanceSmoothing={0.2} radius={0.6} />
        <Vignette offset={0.25} darkness={0.75} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </>
  )
}
