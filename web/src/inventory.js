// Inventory screen: slot grid with click-to-swap, creative palette, 2x2 crafting,
// and (for a crafting table) a button-style recipe list reusing this same screen.
import { setItemIcon, onAtlasReady } from './itemIcon.js'
const PALETTE = [
  'stone', 'dirt', 'grass_block', 'sand', 'cobblestone',
  'oak_planks', 'oak_log', 'glass', 'sandstone', 'bricks',
  'white_wool', 'oak_leaves', 'water_bucket', 'lava_bucket', 'diamond'
]

export class InventoryUI {
  constructor (net) {
    this.net = net
    this.screen = document.getElementById('inventory-screen')
    this.invBody = document.getElementById('inv-body')
    this.mainEl = document.getElementById('inv-main')
    this.hotbarEl = document.getElementById('inv-hotbar')
    this.craftListEl = document.getElementById('craft-list')
    this.craftStatus = document.getElementById('craft-status')
    this.paletteSection = document.getElementById('creative-section')
    this.paletteEl = document.getElementById('creative-palette')
    this.craft2x2Header = document.getElementById('craft2x2-header')
    this.craft2x2Title = this.craft2x2Header ? this.craft2x2Header.querySelector('h3') : null
    this.open = false
    this.selected = null // mineflayer slot index currently picked
    this.slots = []
    this.gameMode = 'survival'
    // crafting-table window mode: reuses this very inventory screen, but as a
    // button-style recipe list (no 3x3 grid).
    this.windowMode = false

    document.getElementById('btn-refresh-recipes').addEventListener('click', () => {
      this.net.send({ t: 'requestRecipes', table: this.windowMode })
    })

    this.buildNormalSlots()

    onAtlasReady(() => {
      this.renderSlots()
      // re-apply icons to palette slots
      ;[...this.paletteEl.children].forEach(el => {
        if (el.title) setItemIcon(el, el.title)
      })
    })

    // creative palette
    for (const name of PALETTE) {
      const d = document.createElement('div')
      d.className = 'inv-slot pal'
      d.title = name
      const hasIcon = setItemIcon(d, name)
      if (!hasIcon) {
        const label = document.createElement('div')
        label.textContent = name.replace(/_/g, ' ').slice(0, 14)
        d.appendChild(label)
      }
      d.addEventListener('click', () => this.pickCreative(name))
      this.paletteEl.appendChild(d)
    }
  }

  pickCreative (name) {
    // put into the first empty hotbar slot, else the currently held slot
    let target = 0
    for (let i = 27; i < 36; i++) {
      if (!this.slots[i]) { target = i; break }
    }
    this.net.send({ t: 'creativeSet', slot: target - 27, name, count: 64 })
    this.craftStatus.textContent = `${name} をホットバーへ追加...`
    setTimeout(() => { this.craftStatus.textContent = '' }, 1500)
  }

  makeSlot (slotIndex) {
    const d = document.createElement('div')
    d.className = 'inv-slot'
    d.dataset.slot = slotIndex
    d.addEventListener('click', () => this.onSlotClick(slotIndex))
    return d
  }

  buildNormalSlots () {
    this.mainEl.innerHTML = ''
    for (let i = 9; i <= 35; i++) this.mainEl.appendChild(this.makeSlot(i))
    this.hotbarEl.innerHTML = ''
    for (let i = 36; i <= 44; i++) this.hotbarEl.appendChild(this.makeSlot(i))
  }

  onSlotClick (slotIndex) {
    if (this.selected == null) {
      this.selected = slotIndex
    } else if (this.selected === slotIndex) {
      this.selected = null
    } else {
      this.net.send({ t: 'swapSlots', a: this.selected, b: slotIndex })
      this.selected = null
    }
    this.renderSlots()
  }

  openPanel () {
    this.open = true
    this.windowMode = false
    this.invBody.classList.remove('crafting')
    const panel = this.screen.querySelector('.inv-panel')
    if (panel) panel.classList.remove('crafting-mode')
    if (this.craft2x2Title) this.craft2x2Title.textContent = 'クラフト (2×2)'
    this.buildNormalSlots()
    this.paletteSection.style.display = this.gameMode === 'creative' ? 'block' : 'none'
    this.screen.style.display = 'flex'
    this.net.send({ t: 'requestInventory' })
    this.net.send({ t: 'requestRecipes' })
  }

  closePanel () {
    if (!this.open) return
    this.open = false
    this.screen.style.display = 'none'
    if (this.windowMode) {
      this.net.send({ t: 'closeWindow' })
      this.windowMode = false
      this.invBody.classList.remove('crafting')
      const panel = this.screen.querySelector('.inv-panel')
      if (panel) panel.classList.remove('crafting-mode')
      if (this.craft2x2Title) this.craft2x2Title.textContent = 'クラフト (2×2)'
      this.buildNormalSlots()
      this.paletteSection.style.display = this.gameMode === 'creative' ? 'block' : 'none'
    }
  }

  updateInventory (msg) {
    this.slots = msg.slots // index 0 => slot 9 ... 26 => 35, 27 => 36 ... 35 => 44
    if (msg.gameMode) {
      const wasCreative = this.gameMode === 'creative'
      this.gameMode = msg.gameMode
      const isCreative = this.gameMode === 'creative'
      if (!this.windowMode) {
        this.paletteSection.style.display = isCreative ? 'block' : 'none'
      }
      if (isCreative && !wasCreative) this.craftStatus.textContent = ''
    }
    this.renderSlots()
    // keep the recipe list in sync when in crafting-table mode
    if (this.windowMode) {
      // debounce to avoid spamming when many inventory packets arrive
      clearTimeout(this._recipeDebounce)
      this._recipeDebounce = setTimeout(() => this.net.send({ t: 'requestRecipes', table: true }), 180)
    }
  }

  // ---- crafting-table window (reuses this inventory screen) ----
  // Buttons only: the recipe list (3x3 recipes) goes in #craft-list, the player's
  // inventory stays visible on the other side. No input grid.
  openCrafting (slots, type, title) {
    this.open = true
    this.windowMode = true
    this.invBody.classList.add('crafting')
    const panel = this.screen.querySelector('.inv-panel')
    if (panel) panel.classList.add('crafting-mode')
    if (this.craft2x2Title) this.craft2x2Title.textContent = '作業台'
    this.paletteSection.style.display = 'none'
    this.buildNormalSlots()
    this.screen.style.display = 'flex'
    // refresh the player's belongings + the 3x3 recipe list
    this.net.send({ t: 'requestInventory' })
    this.net.send({ t: 'requestRecipes', table: true })
  }

  updateWindow (slots) {
    // window slots are not displayed (button-based crafting); server consumes
    // materials automatically when a recipe's クラフト button is pressed.
  }

  slotIndexToMf (gridIndex) {
    return gridIndex + 9
  }

  renderSlots () {
    const paint = (el, idx) => {
      const mfSlot = idx + 9
      const item = this.slots[idx]
      el.innerHTML = ''
      el.classList.toggle('selected', this.selected === mfSlot)
      if (item) {
        el.title = item.displayName || item.name
        const hasIcon = setItemIcon(el, item.name)
        if (!hasIcon) {
          const label = document.createElement('div')
          label.textContent = shortName(item.displayName || item.name)
          el.appendChild(label)
        }
        if (item.count > 1) {
          const c = document.createElement('span')
          c.className = 'count'
          c.textContent = item.count
          el.appendChild(c)
        }
      } else {
        el.style.backgroundImage = ''
        el.style.backgroundSize = ''
        el.style.backgroundPosition = ''
      }
    }
    ;[...this.mainEl.children].forEach((el, idx) => paint(el, idx))
    ;[...this.hotbarEl.children].forEach((el, idx) => paint(el, idx + 27))
  }

  updateRecipes (msg) {
    this.craftListEl.innerHTML = ''
    if (!msg.list || msg.list.length === 0) {
      const d = document.createElement('div')
      d.className = 'craft-empty'
      d.textContent = '現在の素材でクラフトできるものはありません'
      this.craftListEl.appendChild(d)
      return
    }
    // Show craftable first, then the rest disabled – never truncate the list
    for (const r of msg.list) {
      const canCraft = r.canCraft !== false
      const row = document.createElement('div')
      row.className = 'craft-item' + (canCraft ? '' : ' disabled')
      row.style.opacity = canCraft ? '' : '0.45'
      const left = document.createElement('div')
      left.textContent = `${r.result.displayName || r.result.name} ×${r.result.count}`
      if (!canCraft) left.style.color = '#8a939b'
      const right = document.createElement('div')
      right.style.display = 'flex'
      right.style.alignItems = 'center'
      right.style.gap = '8px'
      const ing = document.createElement('span')
      ing.className = 'ing'
      ing.textContent = r.ingredients.map(i => `${i.name}×${i.count}`).join(', ')
      const btn = document.createElement('button')
      btn.className = 'small-btn'
      btn.textContent = canCraft ? 'クラフト' : '材料不足'
      btn.disabled = !canCraft
      btn.style.opacity = canCraft ? '' : '0.5'
      btn.style.cursor = canCraft ? '' : 'not-allowed'
      if (canCraft) {
        btn.addEventListener('click', () => {
          this.net.send({ t: 'craft', result: r.result.name, count: 1 })
          this.craftStatus.textContent = 'クラフト中...'
        })
      }
      right.appendChild(ing)
      right.appendChild(btn)
      row.appendChild(left)
      row.appendChild(right)
      this.craftListEl.appendChild(row)
    }
  }

  craftResult (msg) {
    this.craftStatus.textContent = msg.ok ? '完了!' : `失敗: ${msg.message || ''}`
    if (msg.ok) {
      this.net.send({ t: 'requestInventory' })
      if (this.windowMode) this.net.send({ t: 'requestRecipes', table: true })
    }
    setTimeout(() => { this.craftStatus.textContent = '' }, 2500)
  }
}

function shortName (name) {
  return name.replace(/^minecraft:/, '').replace(/_/g, ' ').slice(0, 14)
}
