import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const SKY_COLOR = 0x88bbf7

export class WorldRenderer {
  constructor (canvas, atlasUrl) {
    this.canvas = canvas
    this.sectionData = new Map()   // sectionKey -> geometry payload
    this.chunkSections = new Map() // chunkKey -> Set<sectionKey>
    this.chunkMeshes = new Map()   // chunkKey -> THREE.Mesh
    this.unloadPending = new Set()

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(SKY_COLOR)
    this.scene.fog = new THREE.Fog(SKY_COLOR, 70, 150)

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 400)

    const ambient = new THREE.AmbientLight(0xffffff, 2.1)
    this.scene.add(ambient)
    const dir = new THREE.DirectionalLight(0xffffff, 1.1)
    dir.position.set(60, 140, 40)
    this.scene.add(dir)

    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: null,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.FrontSide
    })

    const texLoader = new THREE.TextureLoader()
    texLoader.load(atlasUrl, tex => {
      tex.magFilter = THREE.NearestFilter
      tex.minFilter = THREE.NearestFilter
      tex.flipY = false
      tex.colorSpace = THREE.SRGBColorSpace
      this.material.map = tex
      this.material.needsUpdate = true
    })

    window.addEventListener('resize', () => this.resize())
    this.lastTime = performance.now()
    this.fps = 0
    this._fpsFrames = 0
    this._fpsAt = performance.now()
  }

  resize () {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  _chunkKey (sx, sz) {
    return `${sx >> 4},${sz >> 4}`
  }

  _sectionKey (g) {
    return g.key
  }

  _buildSectionGeometry (g) {
    const pos = new Float32Array(g.positions.length)
    for (let i = 0; i < g.positions.length; i += 3) {
      pos[i] = g.positions[i] + g.sx
      pos[i + 1] = g.positions[i + 1] + g.sy
      pos[i + 2] = g.positions[i + 2] + g.sz
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(g.colors, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2))
    geo.setIndex(new THREE.BufferAttribute(g.indices, 1))
    return geo
  }

  addGeometry (g) {
    const sk = g.key
    const ck = this._chunkKey(g.sx, g.sz)
    // remove previous section data if present (re-mesh)
    const prevChunk = this._sectionChunk ? this._sectionChunk.get(sk) : undefined
    if (prevChunk != null) {
      this.sectionData.delete(sk)
      const set = this.chunkSections.get(prevChunk)
      if (set) set.delete(sk)
      if (prevChunk !== ck) this._rebuildChunk(prevChunk)
    }
    this.sectionData.set(sk, g)
    if (!this.chunkSections.has(ck)) this.chunkSections.set(ck, new Set())
    this.chunkSections.get(ck).add(sk)
    if (!this._sectionChunk) this._sectionChunk = new Map()
    this._sectionChunk.set(sk, ck)
    this._rebuildChunk(ck)
  }

  _rebuildChunk (ck) {
    const set = this.chunkSections.get(ck)
    const old = this.chunkMeshes.get(ck)
    if (!set || set.size === 0) {
      if (old) { this.scene.remove(old); if (old.geometry) old.geometry.dispose(); this.chunkMeshes.delete(ck) }
      return
    }
    const geos = []
    for (const sk of set) {
      const g = this.sectionData.get(sk)
      if (g) geos.push(this._buildSectionGeometry(g))
    }
    if (geos.length === 0) return
    let merged
    try {
      merged = (geos.length === 1) ? geos[0] : BufferGeometryUtils.mergeGeometries(geos, false)
    } catch (e) {
      merged = geos[0]
    }
    if (!merged) return
    if (merged !== geos[0]) geos.forEach(gg => gg.dispose())
    const mesh = new THREE.Mesh(merged, this.material)
    mesh.frustumCulled = true
    if (old) { this.scene.remove(old); if (old.geometry && old.geometry !== merged) old.geometry.dispose() }
    this.chunkMeshes.set(ck, mesh)
    this.scene.add(mesh)
  }



  unloadColumn (bx, bz) {
    const prefixX = bx >> 4
    const prefixZ = bz >> 4
    for (const [ck, mesh] of [...this.chunkMeshes]) {
      const [cx, cz] = ck.split(',').map(Number)
      if (cx === prefixX && cz === prefixZ) {
        this.scene.remove(mesh)
        if (mesh.geometry) mesh.geometry.dispose()
        this.chunkMeshes.delete(ck)
        this.chunkSections.delete(ck)
      }
    }
    // remove section data for this column
    for (const [sk] of [...this.sectionData]) {
      const [sx, , sz] = sk.split(',').map(Number)
      if ((sx >> 4) === prefixX && (sz >> 4) === prefixZ) {
        this.sectionData.delete(sk)
        if (this._sectionChunk) this._sectionChunk.delete(sk)
      }
    }
  }

  renderLoop (updateFn) {
    requestAnimationFrame(() => this.renderLoop(updateFn))
    const now = performance.now()
    const dt = Math.min((now - this.lastTime) / 1000, 0.1)
    this.lastTime = now
    this._fpsFrames++
    if (now - this._fpsAt > 500) {
      this.fps = Math.round(this._fpsFrames * 1000 / (now - this._fpsAt))
      this._fpsFrames = 0
      this._fpsAt = now
    }
    updateFn(dt)
    this.renderer.render(this.scene, this.camera)
  }

  get stats () {
    return { sections: this.sectionData.size, chunks: this.chunkMeshes.size, fps: this.fps }
  }
}