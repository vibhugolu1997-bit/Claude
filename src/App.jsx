import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Canvas } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import * as THREE from 'three'
import Experience from './scene/Experience.jsx'
import { timeline, DURATION } from './lib/timeline.js'
import { recordingSupported, startRecording } from './lib/recorder.js'
import './index.css'

function useTimelineState() {
  return useSyncExternalStore(
    (fn) => timeline.subscribe(fn),
    () => (timeline.ended ? 'ended' : timeline.playing ? 'playing' : 'paused'),
  )
}

function Loader() {
  const { progress, active } = useProgress()
  if (!active && progress >= 100) return null
  return (
    <div className="loader">
      <div className="loader-ring" />
      <p>Invoking the temple… {Math.round(progress)}%</p>
    </div>
  )
}

function ProgressBar() {
  const bar = useRef()
  useEffect(() => {
    let raf
    const tick = () => {
      if (bar.current) bar.current.style.transform = `scaleX(${timeline.t / DURATION})`
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className="progress">
      <div ref={bar} className="progress-fill" />
    </div>
  )
}

export default function App() {
  const state = useTimelineState()
  const canvasRef = useRef()
  const [recording, setRecording] = useState(false)
  const [video, setVideo] = useState(null)
  const canRecord = recordingSupported()

  const onRecord = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || recording) return
    const rec = startRecording(canvas, 30)
    if (!rec) return
    setVideo(null)
    setRecording(true)
    timeline.replay()
    const unsub = timeline.subscribe(() => {
      if (timeline.ended) {
        unsub()
        // let the final frame land in the stream
        setTimeout(rec.stop, 200)
      }
    })
    const result = await rec.done
    setRecording(false)
    setVideo({ url: URL.createObjectURL(result.blob), ...result })
  }, [recording])

  const onSave = useCallback(async () => {
    if (!video) return
    const file = new File([video.blob], `mahakali.${video.ext}`, { type: video.blob.type })
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Mahakali' })
        return
      } catch {
        /* user cancelled or share failed – fall back to download */
      }
    }
    const a = document.createElement('a')
    a.href = video.url
    a.download = file.name
    a.click()
  }, [video])

  return (
    <div className="app">
      <Canvas
        className="stage"
        dpr={[1, 2]}
        shadows
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
        }}
        camera={{ fov: 32, near: 0.05, far: 80, position: [0, 1.6, 6] }}
        onCreated={({ gl }) => (canvasRef.current = gl.domElement)}
      >
        <Suspense fallback={null}>
          <Experience />
        </Suspense>
      </Canvas>
      <Loader />

      <header className="title">
        <h1>महाकाली</h1>
        <p>Mahakali · cinematic study</p>
      </header>

      <footer className="controls">
        <ProgressBar />
        <div className="buttons">
          {state === 'playing' ? (
            <button onClick={() => timeline.pause()} aria-label="Pause">❚❚ Pause</button>
          ) : (
            <button onClick={() => timeline.play()} aria-label="Play">▶ Play</button>
          )}
          <button onClick={() => timeline.replay()} aria-label="Replay">↺ Replay</button>
          {canRecord && (
            <button className={recording ? 'rec active' : 'rec'} onClick={onRecord} disabled={recording}>
              ● {recording ? 'Recording…' : 'Record'}
            </button>
          )}
        </div>
        {!canRecord && <p className="note">Video recording isn't supported in this browser.</p>}
        {video && (
          <div className="video-ready">
            <video src={video.url} controls playsInline muted loop className="clip" />
            <div className="video-actions">
              <span>{video.ext.toUpperCase()} · 5 s</span>
              <button onClick={onSave}>Save / Share</button>
              <button onClick={() => setVideo(null)} aria-label="Close clip">✕</button>
            </div>
          </div>
        )}
      </footer>
    </div>
  )
}
