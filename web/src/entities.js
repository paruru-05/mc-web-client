import * as THREE from 'three'

const KIND_COLORS = {
  player: 0x4aa3ff,
  hostile: 0xd64545,
  passive: 0x53c153,
  ambient: 0xd8d84a,
  other: 0x9aa0a6
}

function normKey (s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function makeNameTag (text) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  ctx.font = 'bold 28px sans-serif'
  const w = Math.max(4, ctx.measureText(text).width + 16)
  canvas.width = w
  canvas.height = 44
  const ctx2 = canvas.getContext('2d')
  ctx2.font = 'bold 28px sans-serif'
  ctx2.fillStyle = 'rgba(0,0,0,.55)'
  ctx2.fillRect(0, 0, w, 44)
  ctx2.fillStyle = '#fff'
  ctx2.textAlign = 'center'
  ctx2.textBaseline = 'middle'
  ctx2.fillText(text, w / 2, 24)

  const tex = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(w / 44 * 0.7, 0.7, 1)
  return sprite
}

// ---- Bedrock entity model helpers (from prismarine-viewer/lib/entity/Entity.js) ----
const elemFaces = {
  up: {
    dir: [0, 1, 0],
    u0: [0, 0, 1],
    v0: [0, 0, 0],
    u1: [1, 0, 1],
    v1: [0, 0, 1],
    corners: [
      [0, 1, 1, 0, 0],
      [1, 1, 1, 1, 0],
      [0, 1, 0, 0, 1],
      [1, 1, 0, 1, 1]
    ]
  },
  down: {
    dir: [0, -1, 0],
    u0: [1, 0, 1],
    v0: [0, 0, 0],
    u1: [2, 0, 1],
    v1: [0, 0, 1],
    corners: [
      [1, 0, 1, 0, 0],
      [0, 0, 1, 1, 0],
      [1, 0, 0, 0, 1],
      [0, 0, 0, 1, 1]
    ]
  },
  east: {
    dir: [1, 0, 0],
    u0: [0, 0, 0],
    v0: [0, 0, 1],
    u1: [0, 0, 1],
    v1: [0, 1, 1],
    corners: [
      [1, 1, 1, 0, 0],
      [1, 0, 1, 0, 1],
      [1, 1, 0, 1, 0],
      [1, 0, 0, 1, 1]
    ]
  },
  west: {
    dir: [-1, 0, 0],
    u0: [1, 0, 1],
    v0: [0, 0, 1],
    u1: [1, 0, 2],
    v1: [0, 1, 1],
    corners: [
      [0, 1, 0, 0, 0],
      [0, 0, 0, 0, 1],
      [0, 1, 1, 1, 0],
      [0, 0, 1, 1, 1]
    ]
  },
  north: {
    dir: [0, 0, -1],
    u0: [0, 0, 1],
    v0: [0, 0, 1],
    u1: [1, 0, 1],
    v1: [0, 1, 1],
    corners: [
      [1, 0, 0, 0, 1],
      [0, 0, 0, 1, 1],
      [1, 1, 0, 0, 0],
      [0, 1, 0, 1, 0]
    ]
  },
  south: {
    dir: [0, 0, 1],
    u0: [1, 0, 2],
    v0: [0, 0, 1],
    u1: [2, 0, 2],
    v1: [0, 1, 1],
    corners: [
      [0, 0, 1, 0, 1],
      [1, 0, 1, 1, 1],
      [0, 1, 1, 0, 0],
      [1, 1, 1, 1, 0]
    ]
  }
}

function dot (a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function addCubeAtlas (attr, boneId, bone, cube, texWidth, texHeight, tile) {
  const cubeRotation = new THREE.Euler(0, 0, 0)
  if (cube.rotation) {
    cubeRotation.x = -cube.rotation[0] * Math.PI / 180
    cubeRotation.y = -cube.rotation[1] * Math.PI / 180
    cubeRotation.z = -cube.rotation[2] * Math.PI / 180
  }
  const mirror = !!cube.mirror
  for (const { dir, corners, u0, v0, u1, v1 } of Object.values(elemFaces)) {
    const ndx = Math.floor(attr.positions.length / 3)
    for (const pos of corners) {
      // Mirror flips the U axis for the cube's texture
      let u0m = u0, u1m = u1
      if (mirror) {
        // Swap east/west U vectors when mirrored
        if (dir[0] !== 0) {
          const tmp = u0m; u0m = u1m; u1m = tmp
        }
      }
      const uNorm = (cube.uv[0] + dot(pos[3] ? u1m : u0m, cube.size)) / texWidth
      const vNorm = (cube.uv[1] + dot(pos[4] ? v1 : v0, cube.size)) / texHeight
      const u = tile.u + uNorm * tile.su
      const v = tile.v + vNorm * tile.sv
      const inflate = cube.inflate ? cube.inflate : 0
      let vecPos = new THREE.Vector3(
        cube.origin[0] + pos[0] * cube.size[0] + (pos[0] ? inflate : -inflate),
        cube.origin[1] + pos[1] * cube.size[1] + (pos[1] ? inflate : -inflate),
        cube.origin[2] + pos[2] * cube.size[2] + (pos[2] ? inflate : -inflate)
      )
      vecPos = vecPos.applyEuler(cubeRotation)
      vecPos = vecPos.sub(bone.position)
      vecPos = vecPos.applyEuler(bone.rotation)
      vecPos = vecPos.add(bone.position)
      attr.positions.push(vecPos.x, vecPos.y, vecPos.z)
      attr.normals.push(...dir)
      attr.uvs.push(u, v)
      attr.skinIndices.push(boneId, 0, 0, 0)
      attr.skinWeights.push(1, 0, 0, 0)
    }
    attr.indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3)
  }
}

function buildVanillaSkinnedMesh (jsonModel, tile, atlasTex) {
  const bones = {}
  const geoData = { positions: [], normals: [], uvs: [], indices: [], skinIndices: [], skinWeights: [] }
  let i = 0
  for (const jsonBone of jsonModel.bones) {
    const bone = new THREE.Bone()
    if (jsonBone.pivot) {
      bone.position.set(jsonBone.pivot[0], jsonBone.pivot[1], jsonBone.pivot[2])
    }
    const rot = jsonBone.bind_pose_rotation || jsonBone.rotation
    if (rot) {
      bone.rotation.set(-rot[0] * Math.PI / 180, -rot[1] * Math.PI / 180, -rot[2] * Math.PI / 180)
    }
    bones[jsonBone.name] = bone
    if (jsonBone.cubes) {
      for (const cube of jsonBone.cubes) {
        addCubeAtlas(geoData, i, bone, cube, jsonModel.texturewidth, jsonModel.textureheight, tile)
      }
    }
    i++
  }
  const rootBones = []
  for (const jsonBone of jsonModel.bones) {
    if (jsonBone.parent) {
      const parent = bones[jsonBone.parent]
      if (parent) parent.add(bones[jsonBone.name])
      else rootBones.push(bones[jsonBone.name])
    } else {
      rootBones.push(bones[jsonBone.name])
    }
  }
  const skeleton = new THREE.Skeleton(Object.values(bones))
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(geoData.positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(geoData.normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(geoData.uvs, 2))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(geoData.skinIndices, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(geoData.skinWeights, 4))
  geometry.setIndex(geoData.indices)
  const material = new THREE.MeshLambertMaterial({ map: atlasTex, transparent: true, alphaTest: 0.5 })
  const mesh = new THREE.SkinnedMesh(geometry, material)
  mesh.normalizeSkinWeights()
  mesh.add(...rootBones)
  mesh.bind(skeleton)
  mesh.scale.set(1 / 16, 1 / 16, 1 / 16)
  return mesh
}

const MODEL_ALIASES = {
  mooshroom: 'mooshroom',
  mushroomcow: 'mooshroom',
  pigzombie: 'zombie_pigman',
  zombiepigman: 'zombie_pigman',
  zombifiedpiglin: 'zombie_pigman'
}

export class EntityManager {
  constructor (scene, mobAtlasTex = null, mobTextures = null, entityModels = null) {
    this.scene = scene
    this.mobAtlasTex = mobAtlasTex
    this.mobTextures = mobTextures
    this.entityModels = entityModels
    this.entities = new Map()
    this._geoCache = new Map()
    this._vanillaCache = new Map() // modelKey -> template SkinnedMesh
  }

  setAtlas (tex, textures) {
    this.mobAtlasTex = tex
    this.mobTextures = textures
  }

  setModels (models) {
    this.entityModels = models
  }

  _texturedGeo (typeKey, w, h) {
    const cacheKey = `${typeKey}|${w}|${h}`
    if (this._geoCache.has(cacheKey)) return this._geoCache.get(cacheKey)
    const geo = new THREE.BoxGeometry(Math.max(w, 0.25), Math.max(h, 0.25), Math.max(w, 0.25))
    const rect = this.mobTextures[typeKey]
    if (rect) {
      const uv = geo.attributes.uv
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i)
        const v = uv.getY(i)
        uv.setXY(i, rect.u + u * rect.su, rect.v + v * rect.sv)
      }
      uv.needsUpdate = true
    }
    this._geoCache.set(cacheKey, geo)
    return geo
  }

  _resolveTypeKey (type) {
    if (!this.mobTextures || !type) return null
    const k = normKey(type)
    if (this.mobTextures[k]) return k
    for (const key of Object.keys(this.mobTextures)) {
      if (key.startsWith(k) || k.startsWith(key)) return key
    }
    return null
  }

  _resolveModelKey (type) {
    if (!this.entityModels || !type) return null
    const raw = String(type).toLowerCase().replace(/^minecraft:/, '')
    const k = normKey(raw)
    // aliases
    const alias = MODEL_ALIASES[k]
    const tryKeys = alias ? [alias, k] : [k]
    for (const tk of tryKeys) {
      if (this.entityModels[tk]) return tk
    }
    // fuzzy match like textures
    for (const key of Object.keys(this.entityModels)) {
      const nk = normKey(key)
      for (const tk of tryKeys) {
        if (nk === tk || nk.startsWith(tk) || tk.startsWith(nk)) return key
      }
    }
    return null
  }

  _createVanillaMesh (modelKey, fallbackTypeKey) {
    if (!this.entityModels || !this.mobAtlasTex || !this.mobTextures) return null
    // Reuse a cached template mesh to avoid rebuilding geometry from JSON.
    const cached = this._vanillaCache.get(modelKey)
    if (cached) {
      try { return cached.clone(true) } catch (e) { /* fall through to rebuild */ }
    }
    const entry = this.entityModels[modelKey]
    if (!entry || !entry.geometry) return null
    const geoMap = entry.geometry
    let jsonModel = geoMap.default || geoMap[Object.keys(geoMap)[0]]
    if (!jsonModel || !jsonModel.bones) return null
    // Resolve the tile from the model's own texture reference so the UV
    // exactly matches the skin file the model was authored for (e.g.
    // ender_dragon -> textures/entity/enderdragon/dragon -> 'dragon' tile).
    let tile = null
    const texPath = entry.textures && (entry.textures.default || entry.textures[Object.keys(entry.textures)[0]])
    if (texPath) {
      const base = String(texPath).split('/').pop()
      const k = normKey(base)
      tile = this.mobTextures[k] || null
      // texture names like 'creeper_armor' have no atlas entry -> fall back to base entity texture
      if (!tile) tile = this.mobTextures[fallbackTypeKey] || null
    }
    if (!tile) tile = this.mobTextures[fallbackTypeKey] || null
    if (!tile) return null
    try {
      const mesh = buildVanillaSkinnedMesh(jsonModel, tile, this.mobAtlasTex)
      if (mesh) this._vanillaCache.set(modelKey, mesh.clone(true))
      return mesh
    } catch (e) {
      return null
    }
  }

  _createFallbackMesh (typeKey, kindKey, w, h) {
    if (typeKey && this.mobAtlasTex) {
      const geo = this._texturedGeo(typeKey, w, h)
      const mat = new THREE.MeshLambertMaterial({ map: this.mobAtlasTex, transparent: true, alphaTest: 0.5 })
      return new THREE.Mesh(geo, mat)
    } else {
      const color = KIND_COLORS[kindKey]
      const geo = new THREE.BoxGeometry(w, h, w)
      const mat = new THREE.MeshLambertMaterial({ color })
      return new THREE.Mesh(geo, mat)
    }
  }

  applySnapshot (list) {
    const seen = new Set()
    for (const e of list) {
      seen.add(e.id)
      let rec = this.entities.get(e.id)
      if (!rec) {
        const kindKey = ['player', 'hostile', 'passive', 'ambient'].includes(e.kind) ? e.kind : 'other'
        const typeKey = this._resolveTypeKey(e.type)
        const modelKey = this._resolveModelKey(e.type)
        let mesh = null
        let isVanilla = false
        const w = Math.max(e.width, 0.25)
        const h = Math.max(e.height, 0.25)
        if (modelKey && typeKey && this.mobAtlasTex && this.entityModels) {
          mesh = this._createVanillaMesh(modelKey, typeKey)
          if (mesh) isVanilla = true
        }
        if (!mesh) {
          mesh = this._createFallbackMesh(typeKey, kindKey, w, h)
        }
        const group = new THREE.Group()
        group.frustumCulled = false
        mesh.frustumCulled = false
        group.add(mesh)
        if (kindKey === 'player' && e.name) {
          const tag = makeNameTag(e.name)
          tag.position.y = e.height / 2 + 0.5
          group.add(tag)
        }
        group.position.set(e.x, e.y, e.z)
        this.scene.add(group)
        rec = { group, target: { x: e.x, y: e.y, z: e.z }, height: e.height, mesh, type: e.type, width: w, typeKey, modelKey, textured: !!(typeKey && this.mobAtlasTex), isVanilla }
        this.entities.set(e.id, rec)
      } else {
        rec.target = { x: e.x, y: e.y, z: e.z }
        // upgrade a colour-only or cube mesh to vanilla/textured once assets arrive
        const typeKey = this._resolveTypeKey(rec.type)
        const modelKey = this._resolveModelKey(rec.type)
        const canVanilla = !!(modelKey && typeKey && this.mobAtlasTex && this.entityModels)
        const shouldUpgradeToVanilla = canVanilla && !rec.isVanilla
        const shouldUpgradeTexture = !rec.textured && typeKey && this.mobAtlasTex && this.mobTextures && !rec.isVanilla
        if (shouldUpgradeToVanilla) {
          const newMesh = this._createVanillaMesh(modelKey, typeKey)
          if (newMesh) {
            rec.group.remove(rec.mesh)
            rec.mesh.traverse?.(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose() })
            if (rec.mesh.geometry) rec.mesh.geometry.dispose()
            if (rec.mesh.material) rec.mesh.material.dispose()
            rec.group.add(newMesh)
            rec.mesh = newMesh
            rec.isVanilla = true
            rec.textured = true
            rec.typeKey = typeKey
            rec.modelKey = modelKey
          }
        } else if (shouldUpgradeTexture) {
          // only for fallback cube meshes
          const w = rec.width
          const h = rec.height
          try {
            rec.mesh.geometry = this._texturedGeo(typeKey, w, h)
            rec.mesh.material.map = this.mobAtlasTex
            rec.mesh.material.color?.set(0xffffff)
            rec.mesh.material.needsUpdate = true
            rec.mesh.material.transparent = true
            rec.mesh.material.alphaTest = 0.5
            rec.textured = true
            rec.typeKey = typeKey
          } catch (e) { /* ignore */ }
        }
      }
      rec.group.rotation.y = e.yaw || 0
    }
    for (const [id, rec] of [...this.entities]) {
      if (!seen.has(id)) {
        this.scene.remove(rec.group)
        rec.group.traverse(o => {
          if (o.geometry && o.geometry.dispose && !this._geoCache.has(o.geometry)) {
            // vanilla skinned meshes have unique geometry, safe to dispose
            // cube cache geometries are shared, skip
            const isCached = [...this._geoCache.values()].includes(o.geometry)
            if (!isCached) o.geometry.dispose()
          }
          if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach(m => m.dispose())
            else o.material.dispose()
          }
        })
        this.entities.delete(id)
      }
    }
  }

  update (dt) {
    const k = 1 - Math.exp(-dt * 10)
    for (const rec of this.entities.values()) {
      rec.group.position.x += (rec.target.x - rec.group.position.x) * k
      rec.group.position.y += (rec.target.y - rec.group.position.y) * k
      rec.group.position.z += (rec.target.z - rec.group.position.z) * k
    }
  }

  get count () { return this.entities.size }
}
