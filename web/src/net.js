// WebSocket bridge: JSON control messages + binary frames (chunk/geometry).
const MSG_CHUNK = 1
const MSG_GEOM = 2

export class Net {
  constructor () {
    this.handlers = new Map()
    this.ws = null
    this.chunkCount = 0
  }

  on (type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, [])
    this.handlers.get(type).push(fn)
  }

  _emit (type, payload) {
    const hs = this.handlers.get(type)
    if (hs) for (const h of hs) h(payload)
  }

  connect () {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${proto}://${location.host}/ws`)
      this.ws.binaryType = 'arraybuffer'
      this.ws.onopen = resolve
      this.ws.onerror = e => reject(new Error('バックエンドに接続できません'))
      this.ws.onmessage = ev => this._onmessage(ev)
      this.ws.onclose = () => this._emit('close', {})
    })
  }

  _onmessage (ev) {
    if (ev.data instanceof ArrayBuffer) {
      const view = new DataView(ev.data)
      const type = view.getUint8(0)
      if (type === MSG_CHUNK) {
        // payload ignored client-side (meshing happens on the backend)
        this.chunkCount++
        return
      }
      if (type === MSG_GEOM) {
        let o = 1
        o += 3 // alignment padding
        const sx = view.getInt32(o); o += 4
        const sy = view.getInt32(o); o += 4
        const sz = view.getInt32(o); o += 4
        const idxLen = view.getUint32(o); o += 4
        const indices = new Uint32Array(idxLen)
        {
          const bytes = idxLen * 4
          indices.set(new Uint32Array(ev.data, o, idxLen))
          o += bytes
        }
        const arrays = []
        for (let i = 0; i < 4; i++) {
          const len = view.getUint32(o); o += 4
          const arr = new Float32Array(ev.data, o, len)
          o += len * 4
          arrays.push(arr)
        }
        const [positions, normals, colors, uvs] = arrays
        this._emit('geometry', { key: `${sx},${sy},${sz}`, sx, sy, sz, indices, positions, normals, colors, uvs })
      }
      return
    }
    try {
      const msg = JSON.parse(ev.data.toString())
      this._emit(msg.t, msg)
    } catch (e) { /* ignore */ }
  }

  send (obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj))
  }

  close () {
    if (this.ws) this.ws.close()
  }
}
