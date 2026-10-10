// A tiny mutable timeline shared by the 3D scene and the React UI.
// The scene reads `timeline.t` every frame; the UI subscribes for status changes.

export const DURATION = 5 // seconds

const listeners = new Set()

// ?t=2.5 freezes the timeline at a given second (handy for stills / debugging)
const frozen = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('t') : null

export const timeline = {
  t: frozen ? Number(frozen) : 0,
  playing: !frozen,
  ended: false,

  advance(dt) {
    if (!this.playing) return
    this.t = Math.min(DURATION, this.t + dt)
    if (this.t >= DURATION) {
      this.playing = false
      this.ended = true
      emit()
    }
  },
  play() {
    if (this.ended) this.t = 0
    this.ended = false
    this.playing = true
    emit()
  },
  pause() {
    this.playing = false
    emit()
  },
  replay() {
    this.t = 0
    this.ended = false
    this.playing = true
    emit()
  },
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

function emit() {
  for (const fn of listeners) fn()
}

// Easing helpers used by the choreography.
export const clamp01 = (x) => Math.min(1, Math.max(0, x))
export const smooth = (x) => {
  x = clamp01(x)
  return x * x * (3 - 2 * x)
}
export const smoother = (x) => {
  x = clamp01(x)
  return x * x * x * (x * (x * 6 - 15) + 10)
}
// Normalised progress of `t` through the window [a, b].
export const win = (t, a, b) => clamp01((t - a) / (b - a))
