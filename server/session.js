// Per-WebSocket session: owns a mineflayer bot connected to a real MC server
// and a MesherPool that turns incoming chunks into renderable geometry.
const mineflayer = require('mineflayer')
const zlib = require('zlib')
const { Vec3 } = require('vec3')
const { MesherPool } = require('./mesherPool')
const { pingServer, versionFromName } = require('./ping')
const { getVersion } = require('prismarine-viewer/viewer/lib/version')
const fs = require('fs')
const path = require('path')

let BLOCK_STATES = null
function loadBlockStates () {
  if (!BLOCK_STATES) {
    BLOCK_STATES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'blockStates.json')))
  }
  return BLOCK_STATES
}

const MAX_REACH = 4.8

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

// binary message ids (server -> client)
const MSG_CHUNK = 1
const MSG_GEOM = 2

function encodeChunk (x, z, jsonStr) {
  const data = zlib.deflateSync(Buffer.from(jsonStr))
  const head = Buffer.alloc(13)
  head.writeUInt8(MSG_CHUNK, 0)
  head.writeInt32BE(x, 1)
  head.writeInt32BE(z, 5)
  head.writeUInt32BE(data.length, 9)
  return Buffer.concat([head, data])
}

function encodeGeometry (msg) {
  const g = msg.geometry
  // The mesher builds vertices relative to section origin + 8 (for rotation
  // matrices); geometry.sx/sy/sz already contain that offset and MUST be used
  // as the mesh position, not the raw section key.
  const sx = g.sx
  const sy = g.sy
  const sz = g.sz
  const indices = Uint32Array.from(g.indices)
  const positions = Float32Array.from(g.positions)
  const normals = Float32Array.from(g.normals)
  const colors = Float32Array.from(g.colors)
  const uvs = Float32Array.from(g.uvs)

  // header: type(1) + pad(3) + sx/sy/sz(12) + idxCount(4) = 20, keeps u32 alignment;
  // then per-array: len(u32) + data
  const size = 20 + indices.byteLength +
    positions.byteLength + normals.byteLength + colors.byteLength + uvs.byteLength + 4 * 4
  const buf = Buffer.allocUnsafe(size)
  let o = 0
  buf.writeUInt8(MSG_GEOM, o); o += 4 // type + 3 pad bytes
  buf.writeInt32BE(sx, o); o += 4
  buf.writeInt32BE(sy, o); o += 4
  buf.writeInt32BE(sz, o); o += 4
  buf.writeUInt32BE(indices.length, o); o += 4
  // copy typed arrays into buffer
  Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength).copy(buf, o); o += indices.byteLength
  for (const arr of [positions, normals, colors, uvs]) {
    buf.writeUInt32BE(arr.length, o); o += 4
    Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).copy(buf, o); o += arr.byteLength
  }
  return buf
}

// Distance from eye to the closest point of a block's bounding box.
// Vanilla reach is measured to the hit point on the block face, so measuring
// to the box (not the center) is the correct equivalent.
function distEyeToBlock (eye, blockPos) {
  const cx = Math.max(blockPos.x, Math.min(eye.x, blockPos.x + 1))
  const cy = Math.max(blockPos.y, Math.min(eye.y, blockPos.y + 1))
  const cz = Math.max(blockPos.z, Math.min(eye.z, blockPos.z + 1))
  return eye.distanceTo(new Vec3(cx, cy, cz))
}

// slab-based ray vs AABB intersection; returns entry distance t or null
function rayAabb (origin, dir, min, max) {
  let tmin = -Infinity
  let tmax = Infinity
  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis]
    const d = dir[axis]
    const lo = min[axis]
    const hi = max[axis]
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null
    } else {
      let t1 = (lo - o) / d
      let t2 = (hi - o) / d
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
      tmin = Math.max(tmin, t1)
      tmax = Math.min(tmax, t2)
      if (tmin > tmax) return null
    }
  }
  if (tmax < 0) return null
  return tmin >= 0 ? tmin : 0
}

class Session {
  constructor (ws) {
    this.ws = ws
    this.bot = null
    this.pool = null
    this.closed = false
    this.lastInputAt = 0
    this.digging = null // { target, promise, startedAt, totalTime, timer }
    this.entityTimer = null
    this.posTimer = null
    this.invDirty = false
  }

  send (obj) {
    if (this.closed || this.ws.readyState !== 1) return
    try { this.ws.send(JSON.stringify(obj)) } catch (e) { /* ignore */ }
  }

  sendBinary (buf) {
    if (this.closed || this.ws.readyState !== 1) return
    try { this.ws.send(buf, { binary: true }) } catch (e) { /* ignore */ }
  }

  error (message) {
    this.send({ t: 'error', message })
  }

  async handleMessage (msg) {
    // console.log("[msg]", msg.t)
    switch (msg.t) {
      case 'connect':
        if (this.bot) { this.error('すでに接続中です'); return }
        this.startConnect(msg).catch(e => this.error(e.message))
        break
      case 'input':
        this.applyInput(msg)
        break
      case 'digStart':
        this.digStart(msg)
        break
      case 'digEnd':
        this.digEnd()
        break
      case 'attack':
        this.attack(msg)
        break
      case 'openBlock':
        this.openBlock(msg)
        break
      case 'activateBlock':
        this.activateBlock(msg)
        break
      case 'windowClick':
        this.windowClick(msg)
        break
      case 'closeWindow':
        this.closeActiveWindow()
        break
      case 'place':
        this.placeBlock(msg)
        break
      case 'consume':
        this.consumeFood()
        break
      case 'bowPull':
        this.bowPull()
        break
      case 'bowRelease':
        this.bowRelease()
        break
      case 'hotbar':
        if (this.bot && Number.isInteger(msg.slot)) {
          this.bot.setQuickBarSlot(Math.max(0, Math.min(8, msg.slot)))
          setTimeout(() => this.pushHotbar(), 100)
        }
        break
      case 'requestInventory':
        this.pushInventory()
        break
      case 'requestRecipes':
        this.pushRecipes(msg.table)
        break
      case 'swapSlots':
        this.swapSlots(msg)
        break
      case 'craft':
        this.craftItem(msg)
        break
      case 'creativeSet':
        this.creativeSet(msg)
        break
      case 'debugGive':
        if (this.bot && this.bot.game?.gameMode === 'creative') {
          const items = Array.isArray(msg.items) ? msg.items : []
          let slot = 36
          for (const it of items) {
            const reg = this.bot.registry.itemsByName[it.name]
            if (!reg || slot > 44) continue
            const Item = require('prismarine-item')(this.bot.version)
            this.bot.inventory.slots[slot++] = new Item(reg.id, it.count || 1)
          }
          setTimeout(() => this.pushInventory(), 100)
        }
        break
      case 'chat':
        if (this.bot && typeof msg.text === 'string' && msg.text.length > 0) {
          try { this.bot.chat(msg.text.slice(0, 256)) } catch (e) { /* ignore */ }
        }
        break
      case 'tabComplete':
        this.tabComplete(msg)
        break
      case 'ray':
        this.handleRay(msg)
        break
      case 'respawn':
        if (this.bot) { try { this.bot.respawn() } catch (e) { /* ignore */ } } break
      default:
        break
    }
  }

  // ---------- connection ----------

  async startConnect ({ host, port, username, auth, password }) {
    host = String(host || '').trim()
    port = parseInt(port, 10) || 25565
    username = String(username || '').trim()
    auth = auth === 'microsoft' ? 'microsoft' : 'offline'

    if (!host) throw new Error('サーバーアドレスを入力してください')
    if (!username) throw new Error('ユーザー名を入力してください')

    this.send({ t: 'status', message: `${host}:${port} を確認中...` })
    const status = await pingServer(host, port)
    if (this.closed) return

    if (status.modded) {
      throw new Error('このサーバーはForge等のMODサーバーのようです。本クライアントはMODサーバーに対応していません')
    }

    const mcVersion = status.minecraftVersion || versionFromName(status.versionName)
    if (!mcVersion) throw new Error('サーバーのバージョンを判定できませんでした')
    const atlasVersion = getVersion(mcVersion)
    if (!atlasVersion) {
      throw new Error(`サーバーバージョン ${mcVersion} は描画未対応です(対応: 1.8〜1.21系)`)
    }
    this.send({ t: 'status', message: `バージョン ${mcVersion} で接続中...` })

    const opts = {
      host,
      port,
      version: mcVersion,
      username,
      auth,
      hideErrors: false
    }
    if (auth === 'microsoft') {
      opts.username = username // email
      if (password) opts.password = password
    }

    const bot = mineflayer.createBot(opts)
    this.bot = bot
    this.atlasVersion = atlasVersion
    this.mcVersion = status.minecraftVersion
    this.activeWindow = null

    bot.on('windowOpen', window => this.onWindowOpen(window))
    bot.on('windowClose', window => this.onWindowClose(window))

    bot.once('error', err => {
      const m = /Invalid session|Failed to authenticate|invalid token/i.test(err.message)
        ? '認証に失敗しました(Microsoftアカウント情報を確認してください)'
        : (err.message || '接続エラー')
      if (!this.closed) this.error(m)
      this.cleanup()
    })
    bot.on('kicked', reason => {
      this.send({ t: 'kicked', reason: typeof reason === 'string' ? reason : JSON.stringify(reason) })
    })
    bot.on('end', () => {
      this.send({ t: 'end' })
      this.cleanup()
    })

    await new Promise((resolve, reject) => {
      const okTimer = setTimeout(() => reject(new Error('ログインがタイムアウトしました')), 45000)
      bot.once('login', () => { clearTimeout(okTimer); resolve() })
      bot.once('error', err => { clearTimeout(okTimer); reject(new Error(err.message)) })
      bot.once('kicked', reason => {
        clearTimeout(okTimer)
        const r = typeof reason === 'string' ? reason : JSON.stringify(reason)
        reject(new Error('キックされました: ' + r))
      })
    })

    this.attachBot()
  }

  attachBot () {
    const bot = this.bot
    // Patch activateBlock to handle the case where a Window is passed as
    // craftingTable (our button-list UI keeps the table window open and
    // passes the Window to bot.craft). Mineflayer's craft expects a Block
    // when windowCraftingTable is not yet set and would otherwise try to
    // activate a Window as a Block.
    const _origActivate = bot.activateBlock.bind(bot)
    bot.activateBlock = async (target) => {
      if (target && target.type && target.slots && target.id !== undefined) {
        // target looks like a Window – treat as already open
        bot.currentWindow = target
        // craft's `once(bot, 'windowOpen')` will be waiting; emit it
        setImmediate(() => bot.emit('windowOpen', target))
        return
      }
      return _origActivate(target)
    }
    // Keep the crafting window open across consecutive button crafts.
    // Mineflayer's craft() closes windowCraftingTable after each craft,
    // which would make the next button click require a reopen (and cause
    // flicker/timeouts). While a craft is in progress we suppress the
    // close so the window stays usable.
    this._craftInProgress = false
    const _origClose = bot.closeWindow.bind(bot)
    bot.closeWindow = (win) => {
      if (this._craftInProgress && win && win.type && win.type.includes('crafting')) {
        // suppress close during craft – keep window for next craft
        return
      }
      return _origClose(win)
    }
    loadBlockStates()

    this.pool = new MesherPool(2)
    this.pool.setVersion(this.atlasVersion, BLOCK_STATES)
    let geomCount = 0
    let chunkCount = 0
    this.pool.on('geometry', msg => {
      geomCount++
      this.sendBinary(encodeGeometry(msg))
    })
    this.pool.on('workerError', e => console.error('mesher worker error:', e))
    this._dbgTimer = setInterval(() => {
      if (geomCount > 0 || chunkCount > 0) console.log(`[dbg] chunksIn=${chunkCount} geomOut=${geomCount}`)
    }, 60000)
    const origAdd = this.pool.addColumn.bind(this.pool)
    this.pool.addColumn = (x, z, json) => { chunkCount++; origAdd(x, z, json) }

    this.send({
      t: 'hello',
      mcVersion: this.mcVersion,
      atlasVersion: this.atlasVersion,
      entity: this.serializeSelf(),
      gameMode: bot.game && bot.game.gameMode,
      dimension: bot.game && bot.game.dimension
    })

    // ---- world streaming ----
    // NOTE: chunkColumnLoad emits the column corner in world block coords,
    // while bot.world.getColumn() takes CHUNK coordinates.
    bot.on('chunkColumnLoad', point => {
      const bx = Math.floor(point.x / 16) * 16
      const bz = Math.floor(point.z / 16) * 16
      const cx = bx >> 4
      const cz = bz >> 4
      let column
      try {
        column = bot.world.getColumn(cx, cz)
      } catch (e) { return }
      if (!column) return
       try {
         // skip completely empty columns (no sections with blocks) to save
         // serialization + transfer + meshing work
         const hasBlocks = Array.isArray(column.sections) && column.sections.some(s => s && typeof s.isEmpty === 'function' ? !s.isEmpty() : false)
         if (!hasBlocks) return
         const colJson = column.toJson()
         const json = JSON.stringify(colJson)
         this.sendBinary(encodeChunk(bx, bz, json))
         this.pool.addColumn(bx, bz, colJson)
         // mark all sections of the new column and neighbours dirty
         for (let y = 0; y < 256; y += 16) {
          this.pool.dirty(bx, y, bz)
          this.pool.dirty(bx - 16, y, bz)
          this.pool.dirty(bx + 16, y, bz)
          this.pool.dirty(bx, y, bz - 16)
          this.pool.dirty(bx, y, bz + 16)
        }
      } catch (e) {
        console.error('chunk stream failed', e.message)
      }
    })

    bot.on('chunkColumnUnload', point => {
      const bx = Math.floor(point.x / 16) * 16
      const bz = Math.floor(point.z / 16) * 16
      this.send({ t: 'unloadChunk', x: bx, z: bz })
      this.pool.unloadChunk(bx, bz)
    })

    bot.on('blockUpdate', (oldBlock, newBlock) => {
      if (!newBlock || !this.pool) return
      const p = newBlock.position
      this.pool.blockUpdate({ x: p.x, y: p.y, z: p.z }, newBlock.stateId)
      this.pool.dirty(Math.floor(p.x / 16) * 16, Math.floor(p.y / 16) * 16, Math.floor(p.z / 16) * 16)
      if ((p.x & 15) === 0) this.pool.dirty(Math.floor((p.x - 1) / 16) * 16, Math.floor(p.y / 16) * 16, Math.floor(p.z / 16) * 16)
      if ((p.x & 15) === 15) this.pool.dirty(Math.floor((p.x + 1) / 16) * 16, Math.floor(p.y / 16) * 16, Math.floor(p.z / 16) * 16)
      if ((p.y & 15) === 0) this.pool.dirty(Math.floor(p.x / 16) * 16, Math.floor((p.y - 1) / 16) * 16, Math.floor(p.z / 16) * 16)
      if ((p.y & 15) === 15) this.pool.dirty(Math.floor(p.x / 16) * 16, Math.floor((p.y + 1) / 16) * 16, Math.floor(p.z / 16) * 16)
      if ((p.z & 15) === 0) this.pool.dirty(Math.floor(p.x / 16) * 16, Math.floor(p.y / 16) * 16, Math.floor((p.z - 1) / 16) * 16)
      if ((p.z & 15) === 15) this.pool.dirty(Math.floor(p.x / 16) * 16, Math.floor(p.y / 16) * 16, Math.floor((p.z + 1) / 16) * 16)
    })

    // ---- player state ----
    bot.on('move', () => {
      this.pushPosition()
    })
    this.posTimer = setInterval(() => this.pushPosition(), 100)
    // pickups don't reliably emit setSlot on all servers; keep the client's
    // hotbar/inventory fresh with a periodic sync
    this.invSyncTimer = setInterval(() => this.pushInventory(), 2000)

    bot.on('health', () => {
      this.send({ t: 'health', health: bot.health, food: bot.food })
    })
    bot.on('death', () => this.send({ t: 'death' }))
    bot.on('spawn', () => {
      this.send({ t: 'spawn', entity: this.serializeSelf(), gameMode: bot.game && bot.game.gameMode })
      this.pushInventory()
    })
    bot.on('forcedMove', () => this.pushPosition())
    bot.on('game', () => this.pushInventory())

    // ---- inventory/hotbar ----
    bot.on('setSlot', () => {
      if (this.invDirty) return
      this.invDirty = true
      setTimeout(() => { this.invDirty = false; this.pushInventory() }, 150)
    })

    // ---- chat ----
    bot.on('message', (jsonMsg, position) => {
      let text
      try {
        if (typeof jsonMsg === 'string') {
          text = jsonMsg
        } else if (jsonMsg && typeof jsonMsg.toString === 'function' && 'json' in jsonMsg) {
          // mineflayer >= 4.x already hands us a ChatMessage instance
          text = String(jsonMsg)
        } else {
          const ChatMessage = require('prismarine-chat')(this.mcVersion || bot.version)
          text = new ChatMessage(jsonMsg).toString()
        }
      } catch (e) {
        text = typeof jsonMsg === 'string' ? jsonMsg : JSON.stringify(jsonMsg)
      }
      this.send({ t: 'chat', text, position: position || 'chat' })
    })

    // ---- entities: full snapshot at 8Hz ----
    this.entityTimer = setInterval(() => this.pushEntities(), 125)

    this.pushPosition()
    this.pushHealthSafe()

    // If the bot already finished spawning while listeners were being
    // attached (fast chunk loads), the 'spawn' event already fired — send
    // the spawn payload now so the client isn't stuck at (0,0,0).
    if (bot.entity && bot.entity.height &&
        (bot.entity.position.x !== 0 || bot.entity.position.y !== 0 || bot.entity.position.z !== 0)) {
      this.send({ t: 'spawn', entity: this.serializeSelf(), gameMode: bot.game && bot.game.gameMode })
      this.pushInventory()
    }
  }

  serializeSelf () {
    const e = this.bot.entity
    return {
      id: e.id,
      x: e.position.x, y: e.position.y, z: e.position.z,
      yaw: e.yaw, pitch: e.pitch,
      height: e.height,
      username: this.bot.username
    }
  }

  pushPosition () {
    if (!this.bot) return
    const e = this.bot.entity
    this.send({
      t: 'pos',
      x: e.position.x, y: e.position.y, z: e.position.z,
      yaw: e.yaw, pitch: e.pitch, onGround: e.onGround,
      health: this.bot.health, food: this.bot.food
    })
  }

  pushHealthSafe () {
    if (!this.bot) return
    this.send({ t: 'health', health: this.bot.health, food: this.bot.food })
  }

  pushHotbar () {
    if (!this.bot || !this.bot.inventory) return
    const slots = []
    for (let i = 36; i <= 44; i++) {
      const it = this.bot.inventory.slots[i]
      slots.push(it ? { name: it.name, count: it.count, displayName: it.displayName || it.name } : null)
    }
    this.send({ t: 'hotbar', slots, selected: this.bot.quickBarSlot })
  }

  pushInventory () {
    if (!this.bot || !this.bot.inventory) return
    const slots = []
    // main inventory 9..35 + hotbar 36..44 (UI order: main grid then hotbar row)
    for (let i = 9; i <= 44; i++) {
      const it = this.bot.inventory.slots[i]
      slots.push(it ? { name: it.name, count: it.count, displayName: it.displayName || it.name } : null)
    }
    this.send({ t: 'inventory', slots, held: this.bot.quickBarSlot, gameMode: this.bot.game?.gameMode })
    this.pushHotbar()
  }

  // List of recipes for the given station. table=true => crafting-table (3x3)
  // recipes; table=false => 2x2 inventory recipes. The list is shown as a
  // button-style recipe list; the client sends a `craft` message per item.
  pushRecipes (table = false) {
    if (!this.bot) return
    try {
      const bot = this.bot
      const list = []
      const seen = new Set() // dedup exact ingredient sets, but keep all craftable variants
      const recipeMap = bot.registry.recipes || {}
      for (const typeKey of Object.keys(recipeMap)) {
        let recipes = []
        try { recipes = bot.recipesAll(typeKey, null, table) } catch (e) { continue }
        for (const r of recipes) {
          if (!r || !r.result) continue
          if (!r.inShape && !r.ingredients) continue // skip non-crafting (smelting, etc.)
          const resItem = bot.registry.itemsArray.find(it => it.id === r.result.id) ||
            bot.registry.itemsByName[r.result.name]
          const name = resItem ? resItem.name : r.result.name
          const count = r.result?.count ?? 1
          // resolve an ingredient to {id, count, name}; id is what inventory.count needs
          // -1 is used by prismarine-recipe to denote an empty slot in shaped recipes
          const resolve = (it) => {
            if (!it) return null
            let iid = it.id ?? it.type ?? it
            if (Array.isArray(iid)) iid = iid[0]
            if (iid == null || iid === -1) return null
            const iitem = bot.registry.itemsArray.find(x => x.id === iid) || bot.registry.itemsByName[iid]
            const cnt = (it.count && it.count > 0) ? it.count : 1
            return { id: iid, count: cnt, name: iitem ? iitem.name : String(iid) }
          }
          // each requirement is a list of alternatives (OR within a requirement)
          const reqs = []
          const display = new Map() // name -> total count (for the label)
          if (r.inShape) for (const row of r.inShape) for (const cell of row) {
            const r2 = resolve(cell); if (!r2) continue
            reqs.push([r2])
            display.set(r2.name, (display.get(r2.name) || 0) + r2.count)
          }
          if (r.ingredients) for (const c of r.ingredients) {
            if (Array.isArray(c)) {
              const alts = c.map(resolve).filter(Boolean)
              if (alts.length) { reqs.push(alts); for (const a of alts) display.set(a.name, (display.get(a.name) || 0) + a.count) }
            } else {
              const r2 = resolve(c); if (!r2) continue
              reqs.push([r2])
              display.set(r2.name, (display.get(r2.name) || 0) + r2.count)
            }
          }
          const canCraft = reqs.length > 0 &&
            reqs.every(alts => alts.some(a => (bot.inventory.count(a.id) || 0) >= a.count))
          // keep all variants but remember canCraft, so the client can show
          // craftable first and grey out the rest instead of hiding them
          const key = name + ':' + count + ':' + [...display.entries()].sort().map(([n,c])=>`${n}*${c}`).join(',')
          if (seen.has(key)) continue
          seen.add(key)
          list.push({
            result: { name, displayName: resItem ? resItem.displayName || name : name, count },
            ingredients: [...display.entries()].map(([n, c]) => ({ name: n, count: c })),
            canCraft
          })
        }
      }
      // craftable first, then alphabetical
      list.sort((a, b) => (b.canCraft - a.canCraft) || a.result.name.localeCompare(b.result.name) || a.ingredients.length - b.ingredients.length)
      this.send({ t: 'recipes', list })
    } catch (e) {
      console.error('pushRecipes failed:', e.message)
      this.send({ t: 'recipes', list: [] })
    }
  }

  craftItem ({ result, count = 1 }) {
    if (!this.bot) return
    try {
      const bot = this.bot
      const item = bot.registry.itemsArray.find(it => it.name === result)
      if (!item) return
      const isCraftingWindow = this.activeWindow && this.activeWindow.type && this.activeWindow.type.includes('crafting')
      const useTable = !!isCraftingWindow
      // For recipesFor the check is just truthy, but for the actual craft
      // mineflayer needs a Block when windowCraftingTable is not yet set.
      // Prefer the stored block position if we have it; otherwise fall back
      // to the window itself (patched activateBlock above will handle it).
      let tableForRecipes = null
      let tableForCraft = null
      if (useTable) {
        if (this.craftingBlockPos) {
          try {
            const p = this.craftingBlockPos
            const blk = bot.blockAt(new Vec3(p.x, p.y, p.z))
            if (blk && blk.name === 'crafting_table') {
              tableForRecipes = blk
              tableForCraft = blk
            } else {
              tableForRecipes = this.activeWindow
              tableForCraft = this.activeWindow
            }
          } catch {
            tableForRecipes = this.activeWindow
            tableForCraft = this.activeWindow
          }
        } else {
          tableForRecipes = this.activeWindow
          tableForCraft = this.activeWindow
        }
      }
      const rs = bot.recipesFor(item.id, null, count, tableForRecipes)
      if (!rs.length) { this.send({ t: 'craftResult', ok: false, message: '材料が足りません' }); return }
      this._craftInProgress = true
      bot.craft(rs[0], count, tableForCraft).then(async () => {
        this._craftInProgress = false
        this.send({ t: 'craftResult', ok: true })
        setTimeout(() => this.pushInventory(), 120)
        // window is kept open by the closeWindow patch above, so no need
        // to close/reopen – just ensure the client still sees it as open.
        // If for some reason the window was closed (e.g. player moved away),
        // try to reopen the table.
        if (useTable && this.craftingBlockPos && !this.activeWindow) {
          try {
            await new Promise(r => setTimeout(r, 200))
            if (!this.bot || this.closed || this.activeWindow) return
            const { x, y, z } = this.craftingBlockPos
            const blk = bot.blockAt(new Vec3(x, y, z))
            if (blk && blk.name === 'crafting_table') {
              await bot.activateBlock(blk)
            }
          } catch (e) { /* user can reopen manually */ }
        }
      }).catch(e => {
        this._craftInProgress = false
        console.error(`craft failed for ${result} (useTable=${useTable}):`, e.message)
        let msg = e.message
        if (msg && msg.includes('updateSlot')) {
          msg = 'クラフト応答がタイムアウトしました。作業台から離れすぎていないか、材料を確認して再試行してください。'
        }
        this.send({ t: 'craftResult', ok: false, message: msg })
        setTimeout(() => this.pushInventory(), 120)
        // if window was closed by the failed craft, try to reopen for next attempt
        if (useTable && this.craftingBlockPos && !this.activeWindow) {
          (async () => {
            try {
              await new Promise(r => setTimeout(r, 300))
              if (!this.bot || this.closed || this.activeWindow) return
              const { x, y, z } = this.craftingBlockPos
              const blk = bot.blockAt(new Vec3(x, y, z))
              if (blk && blk.name === 'crafting_table') await bot.activateBlock(blk)
            } catch {}
          })()
        }
      })
    } catch (e) {
      this.send({ t: 'craftResult', ok: false, message: e.message })
    }
  }

  swapSlots ({ a, b }) {
    if (!this.bot || !Number.isInteger(a) || !Number.isInteger(b)) return
    try {
      this.bot.moveSlotItem(a, b)
      setTimeout(() => this.pushInventory(), 150)
    } catch (e) { /* ignore */ }
  }

  // creative mode: put an arbitrary item into a hotbar slot
  creativeSet ({ slot = 0, name, count = 64 }) {
    console.log('[creative] request:', { slot, name }, 'gameMode:', this.bot?.game?.gameMode)
    if (!this.bot || this.bot.game?.gameMode !== 'creative') return
    if (!name || !this.bot._client) return
    try {
      const regItem = this.bot.registry.itemsByName[name]
      console.log('[creative] regItem:', regItem ? regItem.id : 'NULL')
      if (!regItem) return
      const Item = require('prismarine-item')(this.bot.version)
      const mfSlot = 36 + Math.max(0, Math.min(8, slot))
      // mineflayer's bot.creative is broken with current prismarine-registry
      // (registry.supportFeature missing), so write the vanilla packet directly
      this.bot._client.write('set_creative_slot', {
        slot: mfSlot,
        item: Item.toNotch(new Item(regItem.id, count || 1, 0))
      })
      setTimeout(() => this.pushInventory(), 300)
    } catch (e) { /* ignore */ }
  }

  pushEntities () {
    if (!this.bot) return
    const list = []
    for (const e of Object.values(this.bot.entities)) {
      if (e.id === this.bot.entity.id) continue
      const p = e.position
      list.push({
        id: e.id,
        type: e.name || e.type,
        kind: e.kind || 'other',
        name: e.username || (e.displayName || ''),
        x: p.x, y: p.y, z: p.z,
        yaw: e.yaw,
        height: e.height || 1.8,
        width: e.width || 0.6
      })
    }
    // skip sending when nothing changed to reduce traffic/CPU
    const sig = list.map(e => `${e.id}:${e.x.toFixed(2)},${e.y.toFixed(2)},${e.z.toFixed(2)},${e.yaw.toFixed(2)}`).join('|')
    if (sig === this._lastEntitySig) return
    this._lastEntitySig = sig
    this.send({ t: 'entities', list })
  }

  // ---------- input ----------

  applyInput (msg) {
    if (!this.bot || !this.bot.entity) return
    const e = this.bot.entity
    if (typeof msg.yaw === 'number') e.yaw = msg.yaw
    if (typeof msg.pitch === 'number') e.pitch = msg.pitch
    if (msg.controls) {
      for (const k of ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint']) {
        if (k in msg.controls) {
          try { this.bot.setControlState(k, !!msg.controls[k]) } catch (err) { /* ignore */ }
        }
      }
    }
    this.lastInputAt = Date.now()
  }

  // Eye height constant (vanilla player eye height)
  static EYE_HEIGHT = 1.62

  async faceIfNeeded (pos) {
    const e = this.bot.entity
    const eyeY = e.position.y + Session.EYE_HEIGHT
    const dx = pos.x + 0.5 - e.position.x
    const dy = pos.y + 0.5 - eyeY
    const dz = pos.z + 0.5 - e.position.z
    const yaw = Math.atan2(-dx, -dz)
    const groundDistance = Math.sqrt(dx * dx + dz * dz)
    const pitch = -Math.atan2(dy, groundDistance)
    try { await this.bot.look(yaw, pitch, true) } catch (err) { /* ignore */ }
  }

  // ---------- digging ----------

  async digStart ({ x, y, z }) {
    if (!this.bot || this.digging) return
    const target = this.bot.blockAt(new Vec3(x, y, z))
    if (!target || target.boundingBox === 'empty') return
    const eye = this.bot.entity.position.offset(0, Session.EYE_HEIGHT, 0)
    const d = distEyeToBlock(eye, target.position)
    if (d > MAX_REACH) return
    await this.faceIfNeeded(target.position)
    const totalTime = this.bot.digTime(target)
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const progress = Math.min(1, (Date.now() - startedAt) / (totalTime > 0 ? totalTime : 1))
      this.send({ t: 'digProgress', x, y, z, progress })
    }, 80)
    const promise = this.bot.dig(target)
    const finalize = (failed) => {
      clearInterval(timer)
      this.send({ t: 'digComplete', x, y, z, failed: !!failed })
      if (this.digging && this.digging.promise === promise) this.digging = null
    }
    promise.then(() => finalize(false)).catch(() => finalize(true))
    this.digging = { target, promise, startedAt, totalTime, timer, pos: { x, y, z } }
  }

  digEnd () {
    if (!this.digging || !this.bot) return
    const d = this.digging
    const elapsed = Date.now() - d.startedAt
    if (elapsed >= d.totalTime) {
      // The full dig time has elapsed; the completion handshake with the
      // server is in flight. Cancelling here would abort a finished dig.
      return
    }
    this.digging = null
    clearInterval(d.timer)
    try { this.bot.stopDigging() } catch (e) { /* ignore */ }
    this.send({ t: 'digProgress', ...d.pos, progress: 0 })
  }

  // ---------- placing & consuming ----------

  async consumeFood () {
    if (!this.bot) return
    if (this.bot.game && this.bot.game.gameMode === 'creative') return
    const held = this.bot.heldItem
    if (!held) return
    // check if held item is food (supports both foodsByName and foods)
    let isFood = false
    try {
      if (this.bot.registry.foodsByName && this.bot.registry.foodsByName[held.name]) isFood = true
      else if (this.bot.registry.foods && this.bot.registry.foods[held.type]) isFood = true
      else {
        // fallback: hard-coded list for 1.21.4
        const foodSet = new Set([
          'apple','baked_potato','beetroot','beetroot_soup','bread','cake','carrot','chorus_fruit','cooked_beef','cooked_chicken','cooked_cod','cooked_mutton','cooked_porkchop','cooked_rabbit','cooked_salmon','cookie','dried_kelp','enchanted_golden_apple','golden_apple','golden_carrot','honey_bottle','melon_slice','mushroom_stew','potato','pumpkin_pie','rabbit_stew','spider_eye','suspicious_stew','sweet_berries','glow_berries','tropical_fish','pufferfish','rotten_flesh','chicken','beef','porkchop','mutton','rabbit','cod','salmon','kelp'
        ])
        if (foodSet.has(held.name)) isFood = true
      }
    } catch {}
    if (!isFood) return
    try {
      await this.bot.consume()
      setTimeout(() => { this.pushInventory(); this.pushHealthSafe() }, 200)
    } catch (e) {
      // fallback: try activateItem (for some foods)
      try { await this.bot.activateItem() } catch {}
      setTimeout(() => { this.pushInventory(); this.pushHealthSafe() }, 200)
    }
  }

  async bowPull () {
    if (!this.bot) return
    const held = this.bot.heldItem
    if (!held) return
    const n = held.name.replace(/^minecraft:/, '')
    if (!['bow','crossbow'].includes(n)) return
    // crossbow needs special handling: first pull charges, second pull fires
    // For now treat both as bow - hold to charge
    try {
      await this.bot.activateItem(false)
      this._bowPullTime = Date.now()
    } catch {}
  }

  bowRelease () {
    if (!this.bot) return
    const held = this.bot.heldItem
    if (!held) return
    const n = held.name.replace(/^minecraft:/, '')
    if (!['bow','crossbow'].includes(n)) {
      try { this.bot.deactivateItem() } catch {}
      return
    }
    // Ensure at least a short charge time for the bow to actually shoot
    // If released too quickly, wait a bit before deactivate
    const heldTime = this._bowPullTime ? Date.now() - this._bowPullTime : 0
    const minCharge = n === 'crossbow' ? 1100 : 250 // ms
    const wait = Math.max(0, minCharge - heldTime)
    const doRelease = () => {
      try { this.bot.deactivateItem() } catch {}
      setTimeout(() => { this.pushInventory(); }, 300)
      // crossbow needs a second activate to fire after charging
      if (n === 'crossbow') {
        setTimeout(() => {
          try { this.bot.activateItem(false) } catch {}
          setTimeout(() => { try { this.bot.deactivateItem() } catch {} }, 80)
        }, 120)
      }
    }
    if (wait > 0) setTimeout(doRelease, wait)
    else doRelease()
    this._bowPullTime = null
  }

  placeBlock ({ x, y, z, dx, dy, dz }) {
    if (!this.bot) return
    const held = this.bot.heldItem
    if (held) {
      const n = held.name.replace(/^minecraft:/, '')
      if (['bow','crossbow'].includes(n)) {
        // Treat a place click with bow as a quick bow shot (pull+release)
        this.bowPull()
        setTimeout(() => this.bowRelease(), 380)
        return
      }
      let isFood = false
      try {
        if (this.bot.registry.foodsByName && this.bot.registry.foodsByName[held.name]) isFood = true
        else if (this.bot.registry.foods && this.bot.registry.foods[held.type]) isFood = true
      } catch {}
      if (isFood) {
        this.consumeFood()
        return
      }
    }
    const reference = this.bot.blockAt(new Vec3(x, y, z))
    if (!reference || !this.bot.heldItem) return
    const eye = this.bot.entity.position.offset(0, Session.EYE_HEIGHT, 0)
    if (distEyeToBlock(eye, reference.position) > MAX_REACH) return
    botPlace(this.bot, reference, new Vec3(dx | 0, dy | 0, dz | 0))
  }

  // ---------- containers / crafting windows ----------

   serializeSlots (slots) {
    if (!slots) return []
    return slots.map(it => it ? { name: it.name, count: it.count, displayName: it.displayName || it.name } : null)
  }

  async activateBlock ({ x, y, z }) {
    if (!this.bot) return
    const block = this.bot.blockAt(new Vec3(x, y, z))
    if (!block) return
    const eye = this.bot.entity.position.offset(0, Session.EYE_HEIGHT, 0)
    if (distEyeToBlock(eye, block.position) > MAX_REACH) return
    try {
      await this.bot.activateBlock(block)
    } catch (e) {
      // doors/buttons may need a second try with sneaking off, ignore
    }
  }

  async openBlock ({ x, y, z }) {
    if (!this.bot) return
    const block = this.bot.blockAt(new Vec3(x, y, z))
    if (!block) return
    // activatable blocks (doors, trapdoors, gates, buttons, levers) should be
    // toggled via activateBlock, not opened as a container
    const activatable = isActivatableBlock(block.name)
    if (activatable) {
      if (this.activeWindow) this.closeActiveWindow()
      try {
        await this.bot.activateBlock(block)
      } catch (e) {
        this.error('ブロックを操作できませんでした: ' + (e.message || e))
      }
      return
    }
    if (this.activeWindow) this.closeActiveWindow()
    try {
      if (block.name === 'crafting_table') {
        this.craftingBlockPos = { x: block.position.x, y: block.position.y, z: block.position.z }
        await this.bot.activateBlock(block)
      } else {
        this.craftingBlockPos = null
        await this.bot.openContainer(block)
      }
    } catch (e) {
      this.error('ブロックを開けませんでした: ' + (e.message || e))
    }
  }

  onWindowOpen (window) {
    if (!window || window.type === 'minecraft:inventory') return
    // Synthetic re-open during craft (patched activateBlock) should not
    // re-notify the client or reset activeWindow.
    if (this.activeWindow === window) return
    this.activeWindow = window
    let title = ''
    try {
      const wt = window.title
      if (wt) {
        if (typeof wt === 'string') title = wt
        else if (typeof wt.toString === 'function' && wt.toString() !== '[object Object]') title = wt.toString()
        else if (wt.text) title = wt.text
        else if (wt.translate) title = wt.translate
      }
    } catch (e) { title = '' }
    if (title === '[object Object]') title = ''
    const send = () => this.send({
      t: 'windowOpen',
      type: window.type,
      title,
      slots: this.serializeSlots(window.slots)
    })
    send()
    window.on('updateSlot', () => {
      this.send({ t: 'windowUpdate', slots: this.serializeSlots(this.activeWindow ? this.activeWindow.slots : window.slots) })
    })
  }

  onWindowClose (window) {
    if (this.activeWindow === window || (!this.activeWindow && window)) {
      this.activeWindow = null
      this.send({ t: 'windowClose' })
    }
  }

  async windowClick ({ slot, button = 0, mode = 0 }) {
    if (!this.bot || !this.activeWindow) return
    const w = this.activeWindow
    try { await this.bot.clickWindow(slot, button, mode) } catch (e) { /* ignore */ }
    // refresh immediately for snappy UI
    this.send({ t: 'windowUpdate', slots: this.serializeSlots(w.slots) })
  }

  closeActiveWindow () {
    if (!this.bot || !this.activeWindow) return
    try { this.bot.closeWindow(this.activeWindow) } catch (e) { /* ignore */ }
    this.activeWindow = null
    this.send({ t: 'windowClose' })
  }

  // ---------- tab completion ----------

  tabComplete ({ id, text }) {
    if (!this.bot) return
    Promise.race([
      this.bot.tabComplete(text, false, false),
      new Promise(resolve => setTimeout(() => resolve(null), 2000))
    ]).then(matches => {
      this.send({ t: 'tabResult', id, matches: matches || [] })
    }).catch(() => {
      this.send({ t: 'tabResult', id, matches: [] })
    })
  }

  // ---------- server-side raycast for block/entity highlight ----------

  // nearest entity intersected by the ray within `reach`, or null
  rayEntityHit (origin, dir, reach = 4.5) {
    if (!this.bot) return null
    let best = null
    let bestT = reach
    for (const e of Object.values(this.bot.entities)) {
      if (e.id === this.bot.entity.id) continue
      const p = e.position
      const w = (e.width || 0.6) / 2
      const h = e.height || 1.8
      const min = { x: p.x - w, y: p.y, z: p.z - w }
      const max = { x: p.x + w, y: p.y + h, z: p.z + w }
      const t = rayAabb(origin, dir, min, max)
      if (t != null && t < bestT) { bestT = t; best = e }
    }
    return best
  }

  handleRay ({ ox, oy, oz, dx, dy, dz, max = 5 }) {
    if (!this.bot) return
    const origin = new Vec3(ox, oy, oz)
    const dir = new Vec3(dx, dy, dz).normalize()

    const blockHit = raycastVoxel(this.bot, origin, dir, max)
    let blockT = Infinity
    if (blockHit) {
      const bp = blockHit.pos
      blockT = dir.x * (bp.x + 0.5 - ox) + dir.y * (bp.y + 0.5 - oy) + dir.z * (bp.z + 0.5 - oz)
    }

    const ent = this.rayEntityHit(origin, dir, max)
    let entT = Infinity
    if (ent) {
      const p = ent.position
      const h = (ent.height || 1.8) / 2
      entT = dir.x * (p.x - ox) + dir.y * (p.y + h - oy) + dir.z * (p.z - oz)
    }

    // prefer whichever is closer: block or entity
    if (ent && entT <= blockT) {
      this.send({ t: 'rayResult', hit: { entity: ent.id, block: null } })
      return
    }
    if (blockHit) {
      this.send({
        t: 'rayResult',
        hit: {
          x: blockHit.pos.x, y: blockHit.pos.y, z: blockHit.pos.z,
          nx: blockHit.normal.x, ny: blockHit.normal.y, nz: blockHit.normal.z,
          block: blockHit.block.name,
          entity: null
        }
      })
      return
    }
    this.send({ t: 'rayResult', hit: null })
  }

  attack ({ id }) {
    if (!this.bot) return
    const target = this.bot.entities[id]
    if (!target) return
    try { this.bot.attack(target) } catch (e) { /* ignore */ }
    try { this.bot.swingArm() } catch (e) { /* ignore */ }
  }

  cleanup () {
    this.closed = true
    if (this.posTimer) clearInterval(this.posTimer)
    if (this.invSyncTimer) clearInterval(this.invSyncTimer)
    if (this._dbgTimer) clearInterval(this._dbgTimer)
    if (this.entityTimer) clearInterval(this.entityTimer)
    if (this.digging) { clearInterval(this.digging.timer); this.digging = null }
    if (this.bot) {
      const b = this.bot
      this.bot = null
      try { b.quit() } catch (e) { /* ignore */ }
    }
    if (this.pool) {
      this.pool.dispose()
      this.pool = null
    }
  }
}

async function botPlace (bot, reference, faceVec) {
  try {
    await bot.placeBlock(reference, faceVec)
  } catch (e) { /* server rejected; ignore */ }
}

// Amanatides & Woo voxel traversal against bot.world
function raycastVoxel (bot, origin, dir, maxDist) {
  let px = Math.floor(origin.x)
  let py = Math.floor(origin.y)
  let pz = Math.floor(origin.z)
  const stepX = dir.x > 0 ? 1 : -1
  const stepY = dir.y > 0 ? 1 : -1
  const stepZ = dir.z > 0 ? 1 : -1
  const tDeltaX = Math.abs(dir.x) < 1e-9 ? Infinity : Math.abs(1 / dir.x)
  const tDeltaY = Math.abs(dir.y) < 1e-9 ? Infinity : Math.abs(1 / dir.y)
  const tDeltaZ = Math.abs(dir.z) < 1e-9 ? Infinity : Math.abs(1 / dir.z)
  const nextX = dir.x > 0 ? (px + 1 - origin.x) : (origin.x - px)
  const nextY = dir.y > 0 ? (py + 1 - origin.y) : (origin.y - py)
  const nextZ = dir.z > 0 ? (pz + 1 - origin.z) : (origin.z - pz)
  let tMaxX = tDeltaX * nextX
  let tMaxY = tDeltaY * nextY
  let tMaxZ = tDeltaZ * nextZ
  let normal = { x: 0, y: 0, z: 0 }
  let dist = 0

  while (dist <= maxDist) {
    const block = bot.blockAt(new Vec3(px, py, pz))
    if (block && block.boundingBox !== 'empty' && block.name !== 'water' && block.name !== 'lava') {
      return { pos: block.position, normal, block }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      px += stepX; dist = tMaxX; tMaxX += tDeltaX
      normal = { x: -stepX, y: 0, z: 0 }
    } else if (tMaxY < tMaxZ) {
      py += stepY; dist = tMaxY; tMaxY += tDeltaY
      normal = { x: 0, y: -stepY, z: 0 }
    } else {
      pz += stepZ; dist = tMaxZ; tMaxZ += tDeltaZ
      normal = { x: 0, y: 0, z: -stepZ }
    }
  }
  return null
}

module.exports = { Session }
