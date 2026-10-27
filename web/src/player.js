// First-person controls: pointer-lock mouse look + keyboard movement.
// Camera position follows the server-authoritative bot position smoothly;
// yaw/pitch are purely local for instant response.
export class Player {
  constructor (canvas, net) {
    this.canvas = canvas
    this.net = net

    this.yaw = 0
    this.pitch = 0
    this.serverPos = { x: 0, y: 64, z: 0 }
    this.eyeHeight = 1.62
    this.controls = { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false }
    this.enabled = false
    this.chatOpen = false
    this.dead = false

    this._sendTimer = setInterval(() => this.sendInput(), 50)

    document.addEventListener('keydown', e => this.onKey(e, true), true)
    document.addEventListener('keyup', e => this.onKey(e, false), true)
    document.addEventListener('mousemove', e => this.onMouse(e), true)
    window.addEventListener('blur', () => this.clearControls())
  }

  attach (camera) {
    this.camera = camera
    this.pos = { x: this.serverPos.x, y: this.serverPos.y, z: this.serverPos.z }
    camera.rotation.order = 'YXZ'
  }

  setServerPos (p) {
    const first = !this.pos
    this.serverPos = p
    if (first || !this.pos) {
      this.pos = { x: p.x, y: p.y, z: p.z }
    }
    // teleport detection
    const d = Math.hypot(p.x - this.pos.x, p.y - this.pos.y, p.z - this.pos.z)
    if (d > 8) {
      this.pos.x = p.x; this.pos.y = p.y; this.pos.z = p.z
    }
  }

  onMouse (e) {
    if (this.chatOpen) return
    if (!this.enabled || document.pointerLockElement !== this.canvas) return
    this.yaw -= e.movementX * 0.0024
    this.pitch -= e.movementY * 0.0024
    const lim = Math.PI / 2 - 0.001
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch))
    this.sendInput()
  }

  onKey (e, down) {
    if (this.chatOpen) return // typing in chat — never touch game keys
    if (!this.enabled) return
    let flag = null
    switch (e.code) {
      case 'KeyW': flag = 'forward'; break
      case 'KeyS': flag = 'back'; break
      case 'KeyA': flag = 'left'; break
      case 'KeyD': flag = 'right'; break
      case 'Space': flag = 'jump'; break
      case 'ShiftLeft': case 'ShiftRight': flag = 'sneak'; break
      case 'ControlLeft': case 'ControlRight': flag = 'sprint'; break
      default: return
    }
    e.preventDefault()
    if (this.chatOpen) return
    if (this.controls[flag] !== down) {
      this.controls[flag] = down
      this.sendInput()
    }
  }

  clearControls () {
    for (const k of Object.keys(this.controls)) this.controls[k] = false
    this.sendInput()
  }

  sendInput () {
    const wasEnabled = this._wasEnabled
    this._wasEnabled = this.enabled
    if (!this.enabled && !wasEnabled) return
    this.net.send({
      t: 'input',
      yaw: this.yaw,
      pitch: this.pitch,
      controls: { ...this.controls }
    })
  }

  updateCamera (dt) {
    if (!this.camera || !this.pos) return
    // smooth-follow the server position
    const k = 1 - Math.exp(-dt * 14)
    this.pos.x += (this.serverPos.x - this.pos.x) * k
    this.pos.y += (this.serverPos.y - this.pos.y) * k
    this.pos.z += (this.serverPos.z - this.pos.z) * k

    const eyeY = this.pos.y + (this.controls.sneak ? 1.42 : this.eyeHeight)
    this.camera.position.set(this.pos.x, eyeY, this.pos.z)
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ')
  }

  get eyePosition () {
    const eh = this.controls && this.controls.sneak ? 1.42 : this.eyeHeight
    return { x: this.pos?.x ?? 0, y: (this.pos?.y ?? 0) + eh, z: this.pos?.z ?? 0 }
  }

  lookDirection () {
    const cp = Math.cos(this.pitch)
    return {
      x: -Math.sin(this.yaw) * cp,
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * cp
    }
  }
}
