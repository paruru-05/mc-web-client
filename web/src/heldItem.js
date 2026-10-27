import * as THREE from 'three'

export class HeldItemRenderer {
  constructor (scene, camera, getHeldItem, getAtlasTex = null) {
    this.scene = scene
    this.camera = camera
    this.getHeldItem = getHeldItem
    this.getAtlasTex = getAtlasTex
    // Reuse the world's atlas texture when available to avoid a second load.
    this.atlasTex = getAtlasTex ? getAtlasTex() : null
    this.atlasJson = null
    this.group = new THREE.Group()
    this.group.position.set(0.55, -0.35, -0.85)
    this.group.scale.set(0.7, 0.7, 0.7)
    this.camera.add(this.group)
    this.mesh = null
    this.lastHeldName = null
    if (!this.atlasTex) {
      const loader = new THREE.TextureLoader()
      loader.load('/assets/atlas.png', tex => {
        tex.magFilter = THREE.NearestFilter
        tex.minFilter = THREE.NearestFilter
        tex.flipY = false
        tex.colorSpace = THREE.SRGBColorSpace
        this.atlasTex = tex
        this.lastHeldName = null
        this.updateHeldItem()
      })
    }
    fetch('/assets/atlas.json').then(r => r.json()).then(j => {
      this.atlasJson = j
      this.lastHeldName = null
      this.updateHeldItem()
    }).catch(() => {})
  }

  _getItemUV (name) {
    if (!this.atlasJson || !this.atlasJson.textures) return null
    const key = name.replace(/^minecraft:/, '')
    // Direct hit and lower
    if (this.atlasJson.textures[key]) return this.atlasJson.textures[key]
    const lower = key.toLowerCase()
    if (this.atlasJson.textures[lower]) return this.atlasJson.textures[lower]
    // Try without underscores and lower
    const noUnderscore = key.replace(/_/g, '').toLowerCase()
    for (const k of Object.keys(this.atlasJson.textures)) {
      if (k.replace(/_/g, '').toLowerCase() === noUnderscore) return this.atlasJson.textures[k]
    }
    // Fallback: normalized alphanumeric
    const norm = key.toLowerCase().replace(/[^a-z0-9]/g, '')
    for (const k of Object.keys(this.atlasJson.textures)) {
      if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === norm) return this.atlasJson.textures[k]
    }
    return null
  }

  updateHeldItem () {
    const held = this.getHeldItem ? this.getHeldItem() : null
    const name = held ? held.name.replace(/^minecraft:/, '') : null
    if (name === this.lastHeldName) return
    this.lastHeldName = name
    if (this.mesh) {
      this.group.remove(this.mesh)
      if (this.mesh.geometry) this.mesh.geometry.dispose()
      if (this.mesh.material) {
        if (this.mesh.material.map && this.mesh.material.map !== this.atlasTex) this.mesh.material.map.dispose()
        this.mesh.material.dispose()
      }
      this.mesh = null
    }
    if (!name) return
    let geo, mat
    const uv = this._getItemUV(name)
    if (uv && this.atlasTex) {
      geo = new THREE.PlaneGeometry(0.6, 0.6)
      const uvs = geo.attributes.uv
      for (let i = 0; i < uvs.count; i++) {
        const u = uvs.getX(i)
        const v = uvs.getY(i)
        uvs.setXY(i, uv.u + u * uv.su, uv.v + (1 - v) * uv.sv)
      }
      uvs.needsUpdate = true
      mat = new THREE.MeshBasicMaterial({ map: this.atlasTex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.1, depthTest: false, depthWrite: false })
    } else {
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = 'rgba(0,0,0,0)'
      ctx.fillRect(0, 0, 64, 64)
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 9px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(name.slice(0, 14), 32, 30)
      ctx.fillStyle = '#aaa'
      ctx.font = '8px sans-serif'
      ctx.fillText(held && held.count > 1 ? `x${held.count}` : '', 32, 44)
      const canvasTex = new THREE.CanvasTexture(canvas)
      canvasTex.magFilter = THREE.NearestFilter
      canvasTex.minFilter = THREE.NearestFilter
      mat = new THREE.MeshBasicMaterial({ map: canvasTex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.1, depthTest: false, depthWrite: false })
      geo = new THREE.PlaneGeometry(0.55, 0.55)
    }
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.set(0, -0.1, 0.1)
    mesh.frustumCulled = false
    mesh.renderOrder = 10
    this.group.add(mesh)
    this.mesh = mesh
  }

  update (dt) {
    // Pick up the shared atlas texture once the world has loaded it.
    if (!this.atlasTex && this.getAtlasTex) {
      const t = this.getAtlasTex()
      if (t) { this.atlasTex = t; this.lastHeldName = null }
    }
    if (this.mesh) {
      const t = Date.now() * 0.004
      this.mesh.position.y = -0.02 + Math.sin(t) * 0.015
      const held = this.getHeldItem ? this.getHeldItem() : null
      const name = held ? held.name.replace(/^minecraft:/, '') : null
      if (name !== this.lastHeldName) this.updateHeldItem()
    } else {
      const held = this.getHeldItem ? this.getHeldItem() : null
      if (held) this.updateHeldItem()
    }
  }
}
