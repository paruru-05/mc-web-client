// Generates the texture atlas + blockStates json used by the prismarine-viewer mesher.
// Pure-JS implementation (pngjs) replacing viewer/prerender.js which needs native canvas.
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')
const mcAssetsFactory = require('minecraft-assets')

function nextPowerOfTwo (n) {
  if (n === 0) return 1
  n--
  n |= n >> 1
  n |= n >> 2
  n |= n >> 4
  n |= n >> 8
  n |= n >> 16
  return n + 1
}

// normalize a name to a comparable key (lowercase, alnum only)
function normKey (s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Curated aliases (targets are normalized texture keys that exist in the atlas).
const MOB_ALIASES = {
  mooshroom: 'redmooshroom',
  mushroomcow: 'redmooshroom',
  pigzombie: 'zombifiedpiglin',
  zombiepigman: 'zombifiedpiglin',
  wanderingtrader: 'wanderingtrader',
  zombievillager: 'zombievillager',
  enderdragon: 'ender'
}

function makeTextureAtlas (mcAssets) {
  const blocksTexturePath = path.join(mcAssets.directory, '/blocks')
  const itemsTexturePath = path.join(mcAssets.directory, '/items')
  const entityChestPath = path.join(mcAssets.directory, '/entity/chest')
  const blocksFiles = fs.readdirSync(blocksTexturePath).filter(file => file.endsWith('.png'))
  const itemsFiles = fs.existsSync(itemsTexturePath) ? fs.readdirSync(itemsTexturePath).filter(file => file.endsWith('.png')) : []
  const chestFiles = fs.existsSync(entityChestPath) ? fs.readdirSync(entityChestPath).filter(file => file.endsWith('.png')).map(f => path.join('entity/chest', f)) : []
  // For atlas, we store chest textures under a prefixed name to avoid collision with other 'normal.png'
  const chestAtlasFiles = chestFiles.map(f => 'chest_' + path.basename(f))
  // Combine: blocks first, then items, then chest entity textures (for chest block)
  const allFiles = [...blocksFiles, ...itemsFiles, ...chestAtlasFiles]
  const missingTexPath = path.join(__dirname, 'missing_texture.png')
  const missingPng = PNG.sync.read(fs.readFileSync(missingTexPath))

  // Use block textures for atlas base, but ensure chest and items are included
  const texSize = nextPowerOfTwo(Math.ceil(Math.sqrt(allFiles.length + 1)))
  const tileSize = 16
  const imgSize = texSize * tileSize

  const out = new PNG({ width: imgSize, height: imgSize })
  const texturesIndex = {}

  // slot 0 is the missing texture
  texturesIndex.missing_texture = { u: 0, v: 0, su: tileSize / imgSize, sv: tileSize / imgSize }
  out.data.set(missingPng.data.subarray(0, 16 * 16 * 4), 0)

  // Keep a map for chest entity textures: atlasName -> full path
  const chestAtlasMap = new Map()
  for (const f of chestFiles) {
    const base = path.basename(f, '.png')
    const atlasName = 'chest_' + base
    chestAtlasMap.set(atlasName, f)
  }
  const ordered = ['missing_texture.png', ...allFiles]
  ordered.forEach((file, i) => {
    const x = (i % texSize) * tileSize
    const y = Math.floor(i / texSize) * tileSize
    const name = file.split('.')[0]
    if (name !== 'missing_texture') {
      texturesIndex[name] = { u: x / imgSize, v: y / imgSize, su: tileSize / imgSize, sv: tileSize / imgSize }
      let png
      let fullPath
      if (chestAtlasMap.has(name)) {
        fullPath = path.join(mcAssets.directory, chestAtlasMap.get(name))
      } else if (itemsFiles.includes(file)) {
        fullPath = path.join(itemsTexturePath, file)
      } else {
        fullPath = path.join(blocksTexturePath, file)
      }
      try {
        png = PNG.sync.read(fs.readFileSync(fullPath))
      } catch (e) {
        console.warn('failed to read texture', file, e.message)
        return
      }
      for (let ty = 0; ty < 16; ty++) {
        const srcRow = (ty * 16) * 4
        const dstRow = ((y + ty) * imgSize + x) * 4
        out.data.set(png.data.subarray(srcRow, srcRow + 16 * 4), dstRow)
      }
    }
  })

  return { image: PNG.sync.write(out), json: { size: tileSize / imgSize, textures: texturesIndex } }
}

// ---- mob / entity texture atlas ----
function collectEntityPngs (dir) {
  const out = []
  const walk = d => {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch (e) { return }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.png')) out.push(full)
    }
  }
  walk(dir)
  return out
}

function makeMobAtlas (mcAssets) {
  const entityDir = path.join(mcAssets.directory, 'entity')
  const files = collectEntityPngs(entityDir)
  const TILE = 64
  const count = Math.max(1, files.length)
  const texSize = nextPowerOfTwo(Math.ceil(Math.sqrt(count)))
  const imgSize = texSize * TILE

  // build a normalized lookup: normKey -> png path (prefer exact basename matches)
  const byKey = new Map()
  for (const file of files) {
    const base = path.basename(file, '.png')
    const key = normKey(base)
    if (!byKey.has(key)) byKey.set(key, file)
  }
  // also index by "dirname/basename" for folders like cow/cow, sheep/sheep
  for (const file of files) {
    const rel = path.relative(entityDir, file).replace(/\\/g, '/').replace(/\.png$/, '')
    const key = normKey(rel)
    if (!byKey.has(key)) byKey.set(key, file)
  }

  const out = new PNG({ width: imgSize, height: imgSize })
  const textures = {}
  let i = 0
  for (const [key, file] of byKey) {
    let png
    try { png = PNG.sync.read(fs.readFileSync(file)) } catch (e) { continue }
    const x = (i % texSize) * TILE
    const y = Math.floor(i / texSize) * TILE
    // Preserve aspect: fit the source image inside TILE x TILE, keep
    // top-left aligned and store the effective used size. This prevents
    // stretching a 64x32 skin to 64x64 (which would double the vertical
    // texels) and keeps small skins pixel-perfect.
    const w0 = Math.max(1, png.width)
    const h0 = Math.max(1, png.height)
    const scale = Math.min(1, TILE / w0, TILE / h0)
    const wS = Math.max(1, Math.round(w0 * scale))
    const hS = Math.max(1, Math.round(h0 * scale))
    if (scale === 1) {
      // direct copy, no filtering — pixel perfect
      for (let ty = 0; ty < hS; ty++) {
        const sRow = ty * w0 * 4
        const dRow = ((y + ty) * imgSize + x) * 4
        out.data.set(png.data.subarray(sRow, sRow + wS * 4), dRow)
      }
    } else {
      // downscale with nearest neighbour
      for (let ty = 0; ty < hS; ty++) {
        const sy = Math.min(h0 - 1, Math.floor(ty * h0 / hS))
        for (let tx = 0; tx < wS; tx++) {
          const sx = Math.min(w0 - 1, Math.floor(tx * w0 / wS))
          const sIdx = (sy * w0 + sx) * 4
          const dIdx = ((y + ty) * imgSize + (x + tx)) * 4
          out.data[dIdx] = png.data[sIdx]
          out.data[dIdx + 1] = png.data[sIdx + 1]
          out.data[dIdx + 2] = png.data[sIdx + 2]
          out.data[dIdx + 3] = png.data[sIdx + 3]
        }
      }
    }
    // su/sv encode the *used* sub-rect inside the TILE, not the whole TILE.
    // This lets the client's UV remapping address the exact skin pixels and
    // avoids sampling the transparent padding area.
    textures[key] = {
      u: x / imgSize, v: y / imgSize,
      su: wS / imgSize, sv: hS / imgSize,
      w: wS, h: hS, tw: w0, th: h0
    }
    i++
  }
  // bake curated aliases that point at an existing normalized key
  for (const [alias, target] of Object.entries(MOB_ALIASES)) {
    const tk = normKey(target)
    if (textures[alias] == null && textures[tk] != null) textures[alias] = textures[tk]
  }
  return { image: PNG.sync.write(out), json: { size: TILE / imgSize, textures } }
}

async function main () {
  const version = process.argv[2] || '1.21.4'
  console.log('loading minecraft-assets for', version, '...')
  const mcAssets = mcAssetsFactory(version)
  console.log('assets dir:', mcAssets.directory)
  console.log('building atlas ...')
  const atlas = makeTextureAtlas(mcAssets)

  // Patch chest block models to use the entity chest texture instead of oak_planks
  try {
    for (const name of ['chest', 'trapped_chest', 'ender_chest']) {
      if (!mcAssets.blocksModels[name]) continue
      let tex = 'chest_normal'
      if (name === 'trapped_chest') tex = 'chest_trapped'
      else if (name === 'ender_chest') tex = 'chest_ender'
      // Fallback to normal chest if specific variant missing
      if (!atlas.json.textures[tex]) tex = 'chest_normal'
      if (!atlas.json.textures[tex]) continue
      mcAssets.blocksModels[name] = {
        parent: 'block/cube_all',
        textures: { all: `minecraft:block/${tex}` }
      }
    }
  } catch (e) {
    console.warn('chest patch failed', e.message)
  }

  const { prepareBlocksStates } = require('prismarine-viewer/viewer/lib/modelsBuilder')
  console.log('preparing blockStates ...')
  const blocksStates = prepareBlocksStates(mcAssets, atlas)

  const outDir = path.join(__dirname, '..', 'assets')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'atlas.png'), atlas.image)
  fs.writeFileSync(path.join(outDir, 'atlas.json'), JSON.stringify(atlas.json))
  fs.writeFileSync(path.join(outDir, 'blockStates.json'), JSON.stringify(blocksStates))
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({ version, generatedAt: Date.now() }))
  console.log('written assets/atlas.png (' + atlas.image.length + ' bytes), assets/blockStates.json, assets/atlas.json')

  console.log('building mob atlas ...')
  const mob = makeMobAtlas(mcAssets)
  fs.writeFileSync(path.join(outDir, 'mobAtlas.png'), mob.image)
  fs.writeFileSync(path.join(outDir, 'mobTextures.json'), JSON.stringify(mob.json))
  console.log('written assets/mobAtlas.png (' + mob.image.length + ' bytes), assets/mobTextures.json (' + Object.keys(mob.json.textures).length + ' textures)')

  // Bundle vanilla entity models (Bedrock-format bones/cubes) so the client
  // can build true multi-part mobs with correct UV per cube face. Reuse the
  // data from prismarine-viewer which already ships the 94 mob models.
  try {
    const ePath = require.resolve('prismarine-viewer/viewer/lib/entity/entities.json')
    const eData = fs.readFileSync(ePath, 'utf8')
    // validate it's JSON
    JSON.parse(eData)
    fs.writeFileSync(path.join(outDir, 'entityModels.json'), eData)
    console.log('written assets/entityModels.json (' + Buffer.byteLength(eData) + ' bytes)')
  } catch (e) {
    console.warn('entityModels.json not written:', e.message)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
