// Pool of worker_threads running prismarine-viewer's mesher.
// Sections are dispatched deterministically by position so each section
// always goes to the same worker (mirrors viewer WorldRenderer behaviour).
const { Worker } = require('worker_threads')
const path = require('path')
const { EventEmitter } = require('events')

function mod (x, n) {
  return ((x % n) + n) % n
}

class MesherPool extends EventEmitter {
  constructor (numWorkers = 4) {
    super()
    this.workers = []
    this.numWorkers = numWorkers
    for (let i = 0; i < numWorkers; i++) {
      const w = new Worker(path.join(__dirname, 'mesher-worker.cjs'))
      w.on('message', msg => this.emit(msg.type === 'geometry' ? 'geometry' : msg.type, msg))
      w.on('error', err => this.emit('workerError', err))
      this.workers.push(w)
    }
  }

  setVersion (version, blockStatesJson) {
    for (const w of this.workers) {
      w.postMessage({ type: 'version', version })
      w.postMessage({ type: 'blockStates', json: blockStatesJson })
    }
  }

  hashSection (x, y, z) {
    return mod(Math.floor(x / 16) + Math.floor(y / 16) + Math.floor(z / 16), this.workers.length)
  }

  addColumn (x, z, chunkJson) {
    const msg = { type: 'chunk', x, z, chunk: chunkJson }
    for (const w of this.workers) w.postMessage(cloneForWorker(msg))
  }

  unloadChunk (x, z) {
    for (const w of this.workers) w.postMessage({ type: 'unloadChunk', x, z })
  }

  blockUpdate (pos, stateId) {
    for (const w of this.workers) w.postMessage({ type: 'blockUpdate', pos, stateId })
  }

  // mark a section (world coords of its origin, multiples of 16) dirty
  dirty (x, y, z, value = true) {
    this.workers[this.hashSection(x, y, z)].postMessage({ type: 'dirty', x, y, z, value })
  }

  dispose () {
    for (const w of this.workers) w.terminate()
    this.workers = []
  }
}

// structuredClone keeps typed/plain data intact when posting to workers
function cloneForWorker (obj) {
  return obj
}

module.exports = { MesherPool }
