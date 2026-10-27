// Shared helper: render a Minecraft item/block icon into a DOM slot element
// using the combined block+item texture atlas (assets/atlas.png + atlas.json).
let atlas = null
let loading = null
const readyCbs = []

export function loadAtlas () {
  if (atlas) return Promise.resolve(atlas)
  if (loading) return loading
  loading = fetch('/assets/atlas.json')
    .then(r => r.json())
    .then(j => { atlas = j; readyCbs.splice(0).forEach(cb => { try { cb(j) } catch {} }); return j })
    .catch(() => { atlas = { textures: {} }; readyCbs.splice(0).forEach(cb => { try { cb(atlas) } catch {} }); return atlas })
  return loading
}

export function onAtlasReady (cb) {
  if (atlas) { try { cb(atlas) } catch {}; return }
  readyCbs.push(cb)
}

function norm (name) {
  return (name || '').replace(/^minecraft:/, '')
}

function findUV (name) {
  if (!atlas || !atlas.textures) return null
  const key = norm(name)
  if (atlas.textures[key]) return atlas.textures[key]
  const lower = key.toLowerCase()
  if (atlas.textures[lower]) return atlas.textures[lower]
  const noU = key.replace(/_/g, '').toLowerCase()
  for (const k of Object.keys(atlas.textures)) {
    if (k.replace(/_/g, '').toLowerCase() === noU) return atlas.textures[k]
  }
  const n = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const k of Object.keys(atlas.textures)) {
    if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === n) return atlas.textures[k]
  }
  return null
}

// Sets the slot element's background to the item's icon from the atlas.
// Returns true if an icon was applied, false if a text fallback should be used.
export function setItemIcon (el, name) {
  const uv = findUV(name)
  if (!uv) {
    el.style.backgroundImage = ''
    el.style.backgroundSize = ''
    el.style.backgroundPosition = ''
    return false
  }
  const kx = Math.round(uv.u * 64)
  const ky = Math.round(uv.v * 64)
  const posX = (kx / 63) * 100
  const posY = (ky / 63) * 100
  el.style.backgroundImage = "url('/assets/atlas.png')"
  el.style.backgroundSize = '6400% 6400%'
  el.style.backgroundPosition = `${posX}% ${posY}%`
  el.style.backgroundRepeat = 'no-repeat'
  return true
}
