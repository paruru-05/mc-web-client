import { Net } from './net.js'
import { WorldRenderer } from './worldRenderer.js'
import { Player } from './player.js'
import { EntityManager } from './entities.js'
import { ChatUI } from './chat.js'
import { HUD } from './hud.js'
import { InventoryUI } from './inventory.js'
import { ContainerUI } from './container.js'
import { SoundManager } from './sound.js'
import { HeldItemRenderer } from './heldItem.js'
import { loadAtlas } from './itemIcon.js'
import * as THREE from 'three'

const sound = new SoundManager()

// blocks that open a GUI on right-click instead of placing
const CONTAINER_BLOCKS = new Set([
  'chest', 'trapped_chest', 'barrel', 'ender_chest', 'crafting_table',
  'furnace', 'dispenser', 'dropper', 'hopper'
])
function isContainerBlock (name) {
  if (!name) return false
  if (CONTAINER_BLOCKS.has(name)) return true
  return name.endsWith('_shulker_box')
}

// blocks that should be activated (doors, trapdoors, gates, buttons, levers, etc.)
// Right-clicking these should toggle them instead of placing a block.
const ACTIVATABLE_SUFFIXES = ['_door', '_trapdoor', '_fence_gate', '_button']
const ACTIVATABLE_EXACT = new Set([
  'lever', 'note_block', 'jukebox', 'repeater', 'comparator',
  'daylight_detector', 'tripwire_hook', 'bell', 'campfire', 'soul_campfire'
])
function isActivatableBlock (name) {
  if (!name) return false
  if (ACTIVATABLE_EXACT.has(name)) return true
  for (const suf of ACTIVATABLE_SUFFIXES) if (name.endsWith(suf)) return true
  return false
}

const $ = id => document.getElementById(id)

// Loads the mob texture atlas as a THREE texture (returns null on failure/timeout).
function loadMobAtlas () {
  return new Promise(resolve => {
    let done = false
    const finish = v => { if (!done) { done = true; resolve(v) } }
    const timer = setTimeout(() => finish(null), 4000)
    const loader = new THREE.TextureLoader()
    loader.load('/assets/mobAtlas.png', tex => {
      tex.magFilter = THREE.NearestFilter
      tex.minFilter = THREE.NearestFilter
      tex.flipY = false
      tex.colorSpace = THREE.SRGBColorSpace
      clearTimeout(timer)
      finish(tex)
    }, undefined, () => { clearTimeout(timer); finish(null) })
  })
}

// ---------- connect screen ----------
loadAtlas() // preload item/block icon atlas for inventory + hotbar icons

const authSel = $('in-auth')
authSel.addEventListener('change', () => {
  const ms = authSel.value === 'microsoft'
  $('row-username').querySelector('label') // noop guard
  $('row-username').firstChild.textContent = ms ? 'メールアドレス' : 'ユーザー名'
  $('row-password').style.display = ms ? 'flex' : 'none'
})

// restore last used server
try {
  const saved = JSON.parse(localStorage.getItem('mcwc-last') || '{}')
  if (saved.host) $('in-host').value = saved.host
  if (saved.port) $('in-port').value = saved.port
  if (saved.username) $('in-username').value = saved.username
} catch (e) { /* ignore */ }

let net, world, player, entities, chat, hud, inventory, container, heldItemRenderer
let prevInv = null
let gameStarted = false
let lastRayAt = 0
let currentHit = null
let digButtonHeld = false // left mouse / N key held for digging
let digTarget = null      // block pos we last sent digStart for
let digActive = false     // digStart sent, awaiting completion

// Start (or re-start) digging the block currently under the crosshair,
// but only if the button is held and we're not already digging it.
function tryStartDig () {
  if (!digButtonHeld || !currentHit) return
  if (currentHit.block === 'air' || currentHit.block === 'cave_air') return
  const t = currentHit
  const same = digTarget && digTarget.x === t.x && digTarget.y === t.y && digTarget.z === t.z
  if (digActive && same) return
  digActive = true
  digTarget = { x: t.x, y: t.y, z: t.z }
  window.__digSent = (window.__digSent || 0) + 1
  net.send({ t: 'digStart', x: t.x, y: t.y, z: t.z })
  sound.play('dig')
}

function stopDig () {
  digButtonHeld = false
  if (digActive) net.send({ t: 'digEnd' })
  digActive = false
  digTarget = null
  hud?.showDigProgress(0)
}

// ---- attack (left click on an entity) ----
let attackHeld = false
let attackInterval = null

function startAttack () {
  if (!currentHit || currentHit.entity == null) return
  attackHeld = true
  window.__attackSent = (window.__attackSent || 0) + 1
  net.send({ t: 'attack', id: currentHit.entity })
  sound.play('hit')
  if (attackInterval) clearInterval(attackInterval)
  attackInterval = setInterval(() => {
    if (!attackHeld || !currentHit || currentHit.entity == null) { stopAttack(); return }
    net.send({ t: 'attack', id: currentHit.entity })
  }, 600)
}

function stopAttack () {
  attackHeld = false
  if (attackInterval) { clearInterval(attackInterval); attackInterval = null }
}

$('btn-connect').addEventListener('click', () => startConnect())
$('in-password').addEventListener('keydown', e => { if (e.key === 'Enter') startConnect() })
$('btn-respawn').addEventListener('click', () => {
  net.send({ t: 'respawn' })
  hud.hideDeath()
})
  $('click-to-play').addEventListener('click', () => {
    $('c').requestPointerLock()
  })

function status (text) {
  $('connect-status').textContent = text
}

async function startConnect () {
  sound.init()
  const host = $('in-host').value.trim()
  const port = parseInt($('in-port').value, 10) || 25565
  const username = $('in-username').value.trim()
  const auth = authSel.value
  const password = $('in-password').value

  localStorage.setItem('mcwc-last', JSON.stringify({ host, port, username }))
  $('btn-connect').disabled = true

  net = new Net()
  wireNet()

  try {
    await net.connect()
  } catch (e) {
    status('バックエンド接続失敗: ' + e.message)
    $('btn-connect').disabled = false
    return
  }
  net.send({ t: 'connect', host, port, username, auth, password })
}

function wireNet () {
  net.on('status', m => status(m.message))
  net.on('error', m => {
    status(m.message)
    $('btn-connect').disabled = false
  })
  net.on('geometry', g => { if (world) world.addGeometry(g) })
  net.on('hello', onHello)
  net.on('spawn', m => {
    if (!gameStarted) return
    player.setServerPos(m.entity)
    hud.hideDeath()
  })
  net.on('pos', m => {
    if (!player) return
    player.setServerPos(m)
    hud.updateHealth(m.health ?? 20, m.food ?? 20)
  })
  net.on('health', m => hud.updateHealth(m.health, m.food))
  net.on('chat', m => { if (m.position !== 'actionbar') chat.addLine(m.text) })
  net.on('hotbar', m => hud.updateHotbar(m))
  net.on('entities', m => entities.applySnapshot(m.list))
  net.on('rayResult', m => {
    currentHit = m.hit
    window.__currentHit = m.hit
    window.__lastRayResult = m
    hud.setHighlight(m.hit)
    // マウス長押し中は、照準が新しいブロックに移ったら自動で採掘を継続
    if (digButtonHeld) tryStartDig()
  })
  net.on('digProgress', m => {
    window.__digProgress = m
    window.__lastDigProgressAt = Date.now()
    hud.showDigProgress(m.progress)
  })
  net.on('digComplete', m => {
    window.__digComplete = m
    window.__digCompleteCount = (window.__digCompleteCount || 0) + 1
    // ブロックが壊れた（または失敗した）ので次の照準ブロックへ採掘を再開可能に
    digActive = false
    digTarget = null
    sound.play('break')
    if (digButtonHeld) tryStartDig()
  })
  net.on('inventory', m => {
    if (inventory) inventory.updateInventory(m)
    // pickup sound when an item count increased
    if (m.slots && prevInv) {
      let increased = false
      for (let i = 0; i < m.slots.length; i++) {
        const a = prevInv[i], b = m.slots[i]
        if ((b ? b.count : 0) > (a ? a.count : 0)) { increased = true; break }
      }
      if (increased) sound.play('pop')
    }
    prevInv = m.slots
  })
  net.on('recipes', m => { if (inventory) inventory.updateRecipes(m) })
  net.on('craftResult', m => { if (inventory) inventory.craftResult(m); if (m.ok) sound.play('craft') })
  net.on('windowOpen', m => {
    if (!container || !inventory) return
    const type = m.type || ''
    // reuse the inventory screen for crafting tables (expanded 3x3 craft area)
    if (type.includes('crafting')) {
      if (container.open) container.closePanel()
      if (inventory.open) inventory.closePanel()
      inventory.openCrafting(m.slots, type, m.title)
    } else {
      if (inventory.open) inventory.closePanel()
      container.openPanel(m.slots, type, m.title)
    }
    sound.play('chestOpen')
    if (document.pointerLockElement === $('c')) document.exitPointerLock()
    $('click-to-play').style.display = 'none'
  })
  net.on('windowUpdate', m => {
    if (inventory && inventory.windowMode) inventory.updateWindow(m.slots)
    else if (container && container.open) container.update(m.slots)
  })
  net.on('windowClose', () => {
    if (inventory && inventory.windowMode) { inventory.closePanel(); sound.play('chestClose') }
    else if (container) { container.closePanel(); sound.play('chestClose') }
  })
  net.on('death', () => { hud.showDeath(); player.clearControls() })
  net.on('kicked', m => {
    let reason = m.reason
    try {
      reason = JSON.parse(m.reason).text || JSON.parse(m.reason).translate || m.reason
    } catch (e) { /* keep raw */ }
    chat.addLine('[キック] ' + reason)
  })
}

async function onHello (m) {
  status(`ログイン成功! ${m.mcVersion} — ワールド受信中...`)
  await document.fonts?.ready?.catch?.(() => {})

  $('connect-screen').style.display = 'none'
  $('game').style.display = 'block'

  world = new WorldRenderer($('c'), '/assets/atlas.png')
  player = new Player($('c'), net)
  entities = new EntityManager(world.scene)
  chat = new ChatUI(net, () => { if (player) player.chatOpen = false })
  hud = new HUD(net)
  inventory = new InventoryUI(net)
  container = new ContainerUI(net)
  hud.attachScene(world.scene)
  hud.enabled = true
  hud.updateHealth(20, 20)

  player.attach(world.camera)
  // Camera must be part of the scene graph so its children (held item) are rendered
  if (world.camera.parent !== world.scene) world.scene.add(world.camera)
  // Held item in first-person (uses block atlas which now also contains item textures)
  try {
    heldItemRenderer = new HeldItemRenderer(world.scene, world.camera, () => {
      try {
        if (inventory && inventory.slots) {
          const idx = 27 + (hud ? hud.selected : 0)
          return inventory.slots[idx] || null
        }
      } catch {}
      return null
    }, () => (world && world.material ? world.material.map : null))
    window.__heldItemRenderer = heldItemRenderer
  } catch (e) { console.warn('heldItem init failed', e) }
  gameStarted = true
  window.__net = net
  window.__world = world
  window.__player = player
  window.__inventory = inventory
  window.__container = container
  window.__sound = sound

  // load mob textures and vanilla entity models asynchronously (non-blocking)
  loadMobAtlas().then(tex => { if (entities) entities.mobAtlasTex = tex })
  fetch('/assets/mobTextures.json').then(r => r.json()).then(j => {
    if (entities) entities.mobTextures = j.textures
    window.__mobTextures = j
  }).catch(() => {})
  fetch('/assets/entityModels.json').then(r => r.json()).then(j => {
    if (entities) entities.setModels(j)
    window.__entityModels = j
  }).catch(() => {})

  // ---- input events ----
  const handleDig = (e) => {
    if (e.button !== 0) return
    if (!currentHit) return
    if (currentHit.entity != null) startAttack()
    else { digButtonHeld = true; tryStartDig() }
  }

  // --- food / bow detection ---
  const FOOD_SET = new Set([
    'apple','baked_potato','beetroot','beetroot_soup','bread','cake','carrot','chorus_fruit','cooked_beef','cooked_chicken','cooked_cod','cooked_mutton','cooked_porkchop','cooked_rabbit','cooked_salmon','cookie','dried_kelp','enchanted_golden_apple','golden_apple','golden_carrot','honey_bottle','melon_slice','mushroom_stew','potato','pumpkin_pie','rabbit_stew','spider_eye','suspicious_stew','sweet_berries','glow_berries','tropical_fish','pufferfish','rotten_flesh','chicken','beef','porkchop','mutton','rabbit','cod','salmon','kelp','beetroot_soup','sweet_berries'
  ])
  const BOW_SET = new Set(['bow','crossbow'])
  let bowPulling = false
  function getHeldItem () {
    try {
      if (inventory && inventory.slots && typeof hud !== 'undefined' && hud) {
        const idx = 27 + (hud.selected || 0)
        const item = inventory.slots[idx]
        if (item) return item
      }
      // fallback: check HUD DOM
      if (typeof hud !== 'undefined' && hud && hud.hotbarEl) {
        const sel = hud.selected || 0
        const el = hud.hotbarEl.children[sel]
        if (el && el.title) return { name: el.title }
      }
    } catch {}
    return null
  }
  function isFood (name) {
    if (!name) return false
    const n = name.replace(/^minecraft:/, '')
    return FOOD_SET.has(n)
  }
  function isBow (name) {
    if (!name) return false
    const n = name.replace(/^minecraft:/, '')
    return BOW_SET.has(n)
  }

  const handlePlace = (e) => {
    if (e.button !== 2) return
    const held = getHeldItem()
    const holdingBow = held && isBow(held.name)
    const holdingFood = held && isFood(held.name)
    // Bow has priority over food (both are right-click hold items)
    if (holdingBow) {
      if (currentHit && currentHit.entity == null && isContainerBlock(currentHit.block)) {
        window.__openSent = (window.__openSent || 0) + 1
        net.send({ t: 'openBlock', x: currentHit.x, y: currentHit.y, z: currentHit.z })
        return
      }
      if (!bowPulling) {
        bowPulling = true
        window.__bowPullSent = (window.__bowPullSent || 0) + 1
        net.send({ t: 'bowPull' })
        sound.play('place')
      }
      return
    }
    // Prioritize eating if holding food – works even without a block hit (eating in air)
    if (holdingFood) {
      // If looking at a container, open it instead of eating (vanilla behavior)
      if (currentHit && currentHit.entity == null && isContainerBlock(currentHit.block)) {
        window.__openSent = (window.__openSent || 0) + 1
        net.send({ t: 'openBlock', x: currentHit.x, y: currentHit.y, z: currentHit.z })
        return
      }
      window.__consumeSent = (window.__consumeSent || 0) + 1
      net.send({ t: 'consume' })
      sound.play('place')
      return
    }
    if (!currentHit || currentHit.entity != null) {
      // No block hit – try bow/food as fallback even if held is unknown
      // (server will validate actual held item)
      const h = getHeldItem()
      if (h && isBow(h.name)) {
        if (!bowPulling) { bowPulling = true; net.send({ t: 'bowPull' }) }
        return
      }
      return
    }
    // Activatable blocks (doors, trapdoors, gates, buttons, levers) – use activateBlock
    // Do this before container check? Containers have priority, but activatables should
    // also be handled via activate. For doors/buttons etc., we want to toggle them.
    // Note: isActivatable includes doors/buttons/levers, but not containers.
    if (isActivatableBlock(currentHit.block)) {
      // In vanilla, sneaking + right-click on an activatable still activates it
      // (unlike containers where sneak+click places a block). So always activate.
      window.__activateSent = (window.__activateSent || 0) + 1
      net.send({ t: 'activateBlock', x: currentHit.x, y: currentHit.y, z: currentHit.z })
      sound.play('place')
      return
    }
    if (isContainerBlock(currentHit.block)) {
      // Sneaking + right-click on a container should place a block, not open
      const isSneaking = player && player.controls && player.controls.sneak
      if (isSneaking) {
        // fall through to place logic
      } else {
        window.__openSent = (window.__openSent || 0) + 1
        net.send({ t: 'openBlock', x: currentHit.x, y: currentHit.y, z: currentHit.z })
        return
      }
    }
    window.__placeSent = (window.__placeSent || 0) + 1
    sound.play('place')
    net.send({
      t: 'place',
      x: currentHit.x, y: currentHit.y, z: currentHit.z,
      dx: currentHit.nx, dy: currentHit.ny, dz: currentHit.nz
    })
  }

  const handlePointerDown = (e) => {
    if (container && container.open) return
    if (e.button === 0) handleDig(e)
    else if (e.button === 2) handlePlace(e)
  }

  const handlePointerUp = (e) => {
    if (e.button === 0) { stopDig(); stopAttack() }
    if (e.button === 2 && bowPulling) {
      bowPulling = false
      window.__bowReleaseSent = (window.__bowReleaseSent || 0) + 1
      net.send({ t: 'bowRelease' })
    }
  }

  // Use pointer events for better pointer lock compatibility
  $('c').addEventListener('pointerdown', handlePointerDown)
  $('c').addEventListener('pointerup', handlePointerUp)

  // Canvas click requests pointer lock and also triggers dig/place
  $('c').addEventListener('click', (e) => {
    if (container && container.open) return
    if (document.pointerLockElement !== $('c')) {
      $('c').focus()
      $('c').requestPointerLock()
      // If we have a current hit, also trigger dig/place on this click
      if (e.button === 0 && currentHit) {
        handleDig(new MouseEvent('pointerdown', { button: 0 }))
      } else if (e.button === 2 && currentHit) {
        handlePlace(new MouseEvent('pointerdown', { button: 2 }))
      }
    }
  })

  // Prevent context menu
  document.addEventListener('contextmenu', e => e.preventDefault())

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === $('c')
    player.enabled = locked
    hud.enabled = locked
    $('click-to-play').style.display = locked || chat.open || inventory?.open || container?.open ? 'none' : 'block'
    if (!locked) player.clearControls()
  })

  document.addEventListener('keydown', e => {
    if (!gameStarted) return
    // Fallback Enter handling for chat: if chat is open but the input
    // somehow lost focus (pointer-lock race or no-lock mode), still allow Enter to send.
    if (chat && chat.open && (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter')) {
      if (document.activeElement !== chat.input) {
        e.preventDefault()
        const text = chat.input.value.trim()
        if (text) try { net.send({ t: 'chat', text }) } catch {}
        chat.closeChat()
        player.chatOpen = false
        // Do not auto re-lock – user explicitly asked to be able to chat without pointer lock.
        // Just return focus to canvas (without locking) if no other UI is open.
        if (!inventory.open && !(container && container.open)) {
          $('c').focus()
        }
        return
      }
      // if input is focused, let chat.js handle it (avoid double-send)
      return
    }
    if (e.code === 'KeyE' && !chat.open) {
      e.preventDefault()
      if (inventory.open) {
        inventory.closePanel()
        $('click-to-play').style.display = 'none'
        $('c').requestPointerLock()
      } else if (document.pointerLockElement === $('c')) {
        player.clearControls()
        document.exitPointerLock()
        inventory.openPanel()
        $('click-to-play').style.display = 'none'
      }
      return
    }
    if (e.code === 'Escape' && inventory.open) {
      inventory.closePanel()
      $('click-to-play').style.display = 'none'
      $('c').requestPointerLock()
      return
    }
    if (e.code === 'Escape' && container && container.open) {
      container.requestClose()
      return
    }
    if (e.code === 'KeyT' && !chat.open) {
      e.preventDefault()
      chat.openChat()
      player.chatOpen = true
    } else if (e.code === 'Escape' && chat.open) {
      chat.closeChat()
      player.chatOpen = false
    } else if (e.code === 'F3' && !chat.open) {
      e.preventDefault()
      hud.toggleDebug()
    } else if (e.code === 'KeyN' && !e.repeat && !chat.open && !inventory.open) {
      e.preventDefault()
      digButtonHeld = true
      tryStartDig()
    }
  }, true)

  document.addEventListener('keyup', e => {
    if (e.code === 'KeyN') stopDig()
  }, true)

  // ---- main loops ----
  setInterval(() => {
    if (!player.pos) return
    const now = performance.now()
    if (now - lastRayAt < 120) return
    lastRayAt = now
    if (!gameStarted || inventory?.open || chat?.open) return
    const eye = player.eyePosition
    const dir = player.lookDirection()
    window.__rayCount = (window.__rayCount || 0) + 1
    net.send({ t: 'ray', ox: eye.x, oy: eye.y, oz: eye.z, dx: dir.x, dy: dir.y, dz: dir.z })
  }, 60)

  world.renderLoop(dt => {
    player.updateCamera(dt)
    entities.update(dt)
    try { heldItemRenderer && heldItemRenderer.update(dt) } catch {}
    const moving = player.controls && (player.controls.forward || player.controls.back || player.controls.left || player.controls.right)
    if (player.pos) sound.tickSteps(player.pos, moving)
    if (hud.debugVisible) {
      const p = player.serverPos
      const s = world.stats
      hud.setDebug(
        `mc-web-client | fps: ${s.fps}\n` +
        `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}\n` +
        `chunks recv: ${net.chunkCount} sections: ${s.sections} entities: ${entities.count}`
      )
    }
  })

  $('click-to-play').style.display = 'block'
}
