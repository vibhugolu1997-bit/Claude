// Records the WebGL canvas with MediaRecorder. Safari on iOS (14.5+) records
// MP4/H.264; Chrome/Firefox record WebM. Returns null when unsupported.

const CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

export function recordingSupported() {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  )
}

export function pickMimeType() {
  if (!recordingSupported()) return null
  for (const type of CANDIDATES) {
    if (MediaRecorder.isTypeSupported?.(type)) return type
  }
  return ''
}

export function startRecording(canvas, fps = 30) {
  const mimeType = pickMimeType()
  if (mimeType === null) return null
  const stream = canvas.captureStream(fps)
  const options = { videoBitsPerSecond: 12_000_000 }
  if (mimeType) options.mimeType = mimeType
  const recorder = new MediaRecorder(stream, options)
  const chunks = []
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      const type = recorder.mimeType || mimeType || 'video/webm'
      const blob = new Blob(chunks, { type })
      resolve({ blob, ext: type.includes('mp4') ? 'mp4' : 'webm' })
    }
  })
  recorder.start(250)
  return { stop: () => recorder.state !== 'inactive' && recorder.stop(), done }
}
