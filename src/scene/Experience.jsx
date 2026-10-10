import { useEffect } from 'react'
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
function Clock() {
  useFrame((_, dt) => {
    timeline.advance(Math.min(dt, 1 / 20))
    // signal for automated screenshots
    if (++frames === 90) document.documentElement.dataset.ready = '1'
  })
  return null
}

function Lights() {
  const { scene } = useThree()
  return (
    <>
      <hemisphereLight args={['#4a3a5a', '#120806', 0.25]} />
      {/* warm key from the sanctum opening above-front */}
      <spotLight
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
      <spotLight position={[-1.8, 3.2, -2.2]} target={scene} angle={0.6} penumbra={1} intensity={45} color="#7d95ff" decay={2} />
      <spotLight position={[2.0, 2.4, -1.8]} target={scene} angle={0.6} penumbra={1} intensity={25} color="#a070ff" decay={2} />
      {/* soft frontal fill so the face reads on small screens */}
      <pointLight position={[0.2, 1.9, 1.6]} intensity={2.4} color="#ffc08a" distance={4} decay={2} />
    </>
  )
}

export default function Experience() {
  return (
    <>
      <Clock />
      <color attach="background" args={['#050306']} />
      <fogExp2 attach="fog" args={['#0b0709', 0.075]} />
      <Environment />
      <Lights />
      <Temple />
      <Mahakali position={[0, DAIS_TOP, 0]} />
      <CameraRig />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.85} luminanceSmoothing={0.2} radius={0.6} />
        <Vignette offset={0.25} darkness={0.75} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </>
  )
}
