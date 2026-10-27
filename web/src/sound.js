// SoundManager: synthesized SFX + ambient BGM via Web Audio.
// If /assets/bgm.mp3 exists it is used as the BGM loop; otherwise a synth pad plays.
export class SoundManager {
  constructor () {
    this.ctx = null
    this.master = null
    this.muted = false
    this.volume = 0.6
    this.bgmNodes = null
    this.bgmAudio = null
    this._stepAt = 0
    this._lastPos = null
  }

  // Must be called from a user gesture (e.g. the Connect click).
  init () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume()
      return
    }
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = this.muted ? 0 : this.volume
    this.master.connect(this.ctx.destination)
    this.startBGM()
  }

  setMuted (m) {
    this.muted = m
    if (this.master) this.master.gain.value = m ? 0 : this.volume
  }

  toggleMute () { this.setMuted(!this.muted); return this.muted }

  // ---------------- BGM ----------------
  startBGM () {
    // Check custom BGM in order: /assets/sounds/bgm.mp3 -> /assets/bgm.mp3 -> synth
    const candidates = ['/assets/sounds/bgm.mp3', '/assets/sounds/bgm.ogg', '/assets/bgm.mp3', '/assets/bgm.ogg']
    this._tryPlayCandidates(candidates, () => this._startBgmSynth(), true)
  }

  _tryPlayCandidates (urls, onFail, isBgm = false) {
    if (!urls.length) { onFail(); return }
    const url = urls[0]
    fetch(url, { method: 'HEAD' }).then(r => {
      if (r.ok) {
        if (isBgm) this._startBgmFile(url)
        else this._playFile(url)
      } else {
        this._tryPlayCandidates(urls.slice(1), onFail, isBgm)
      }
    }).catch(() => this._tryPlayCandidates(urls.slice(1), onFail, isBgm))
  }

  _startBgmFile (url = '/assets/bgm.mp3') {
    const a = new Audio(url)
    a.loop = true
    a.volume = 0.5
    a.play().catch(() => {})
    this.bgmAudio = a
  }

  _startBgmSynth () {
    if (!this.ctx || this.bgmNodes) return
    const ctx = this.ctx
    const out = ctx.createGain()
    out.gain.value = 0.10
    out.connect(this.master)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 520
    filter.Q.value = 0.6
    filter.connect(out)
    const freqs = [110, 164.81, 220, 277.18] // A2 E3 A3 C#4
    const oscs = freqs.map((f, i) => {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = f
      o.detune.value = (i - 1.5) * 5
      o.connect(filter)
      o.start()
      return o
    })
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.05
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 260
    lfo.connect(lfoGain)
    lfoGain.connect(filter.frequency)
    lfo.start()
    this.bgmNodes = { out, filter, oscs, lfo }
  }

  // ---------------- SFX primitives ----------------
  _now () { return this.ctx.currentTime }

  _blip ({ freq = 440, type = 'sine', dur = 0.1, vol = 0.5, slideTo = null }) {
    if (!this.ctx) return
    const t = this._now()
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g); g.connect(this.master)
    o.start(t); o.stop(t + dur + 0.02)
  }

  _noise ({ dur = 0.1, vol = 0.5, filterType = 'lowpass', freq = 1000, q = 1 }) {
    if (!this.ctx) return
    const t = this._now()
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur))
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const f = this.ctx.createBiquadFilter()
    f.type = filterType
    f.frequency.value = freq
    f.Q.value = q
    const g = this.ctx.createGain()
    g.gain.value = vol
    src.connect(f); f.connect(g); g.connect(this.master)
    src.start(t)
  }

  // ---------------- custom SFX ----------------
  _customCache = new Map() // name -> { url, audio, isFile }
  _playFile (url, vol = 0.6) {
    try {
      const a = new Audio(url)
      a.volume = vol
      a.play().catch(() => {})
    } catch {}
  }

  _tryCustom (name, onMiss) {
    // Already known to be a file or not?
    const cached = this._customCache.get(name)
    if (cached) {
      if (cached.isFile) { this._playFile(cached.url, 0.6); return true }
      else { onMiss(); return false }
    }
    // Probe in order: /assets/sounds/<name>.mp3 -> .ogg -> .wav -> /assets/<name>.mp3
    const candidates = [
      `/assets/sounds/${name}.mp3`,
      `/assets/sounds/${name}.ogg`,
      `/assets/sounds/${name}.wav`,
      `/assets/${name}.mp3`,
      `/sounds/${name}.mp3`
    ]
    let idx = 0
    const tryNext = () => {
      if (idx >= candidates.length) {
        this._customCache.set(name, { isFile: false })
        onMiss()
        return
      }
      const url = candidates[idx++]
      fetch(url, { method: 'HEAD' }).then(r => {
        if (r.ok) {
          this._customCache.set(name, { url, isFile: true })
          this._playFile(url, 0.6)
        } else {
          tryNext()
        }
      }).catch(() => tryNext())
    }
    tryNext()
    return false // async, caller should not also play synth to avoid double
  }

  // ---------------- named sounds ----------------
  play (name) {
    if (!this.ctx || this.muted) return
    // Try custom file first; if it exists it will play and we skip synth.
    // We do async probe, but to avoid double-play we return early and let
    // the probe decide. If no custom file, the onMiss callback plays synth.
    const hasCache = this._customCache.has(name)
    if (hasCache) {
      const c = this._customCache.get(name)
      if (c.isFile) { this._playFile(c.url, 0.6); return }
      // else fall through to synth
    } else {
      // Start async probe; synth will be played in onMiss if no file.
      // To avoid gap, we optimistically do nothing and let probe handle it.
      // Use a flag to ensure we don't play synth twice.
      let didPlay = false
      this._tryCustom(name, () => {
        if (didPlay) return
        didPlay = true
        this._playSynth(name)
      })
      // If probe is async, we shouldn't play synth immediately.
      // Instead, play synth only if probe finds no file (via callback).
      // For first call, we need to allow the probe to run.
      // So return and let callback handle it.
      // However, if the file is not yet cached, we need to delay synth.
      // We set a short timeout to play synth if no file found quickly.
      setTimeout(() => {
        if (!this._customCache.has(name)) {
          // still probing, wait a bit more – the callback will handle
        }
      }, 30)
      return
    }
    this._playSynth(name)
  }

  _playSynth (name) {
    switch (name) {
      case 'dig':
        this._noise({ dur: 0.07, vol: 0.35, filterType: 'bandpass', freq: 900, q: 0.8 })
        break
      case 'break':
        this._noise({ dur: 0.12, vol: 0.55, filterType: 'lowpass', freq: 1200 })
        this._blip({ freq: 160, type: 'square', dur: 0.12, vol: 0.4, slideTo: 90 })
        break
      case 'place':
        this._blip({ freq: 200, type: 'square', dur: 0.1, vol: 0.45, slideTo: 140 })
        this._noise({ dur: 0.05, vol: 0.25, filterType: 'lowpass', freq: 800 })
        break
      case 'hit':
        this._noise({ dur: 0.06, vol: 0.6, filterType: 'bandpass', freq: 1500, q: 1 })
        this._blip({ freq: 220, type: 'square', dur: 0.07, vol: 0.4, slideTo: 130 })
        break
      case 'step':
        this._blip({ freq: 90, type: 'sine', dur: 0.05, vol: 0.18 })
        break
      case 'pop':
        this._blip({ freq: 880, type: 'sine', dur: 0.08, vol: 0.4, slideTo: 1300 })
        break
      case 'chestOpen':
        this._noise({ dur: 0.18, vol: 0.4, filterType: 'bandpass', freq: 500, q: 1.5 })
        this._blip({ freq: 300, type: 'triangle', dur: 0.12, vol: 0.25, slideTo: 420 })
        break
      case 'chestClose':
        this._noise({ dur: 0.12, vol: 0.3, filterType: 'bandpass', freq: 420, q: 1.5 })
        this._blip({ freq: 360, type: 'triangle', dur: 0.1, vol: 0.2, slideTo: 260 })
        break
      case 'craft':
        this._blip({ freq: 660, type: 'sine', dur: 0.15, vol: 0.4, slideTo: 990 })
        break
    }
  }

  // call every frame with the local player position to emit footstep ticks
  tickSteps (pos, moving) {
    if (!this.ctx || this.muted || !pos) return
    const now = performance.now()
    if (!moving) { this._lastPos = pos; return }
    if (now - this._stepAt < 380) return
    const d = this._lastPos
      ? Math.hypot(pos.x - this._lastPos.x, pos.z - this._lastPos.z)
      : 0
    if (d < 0.05) return
    this._stepAt = now
    this._lastPos = pos
    this.play('step')
  }
}
