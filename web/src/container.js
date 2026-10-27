// Container / crafting window UI: renders an open chest/crafting-table/furnace,
// forwards slot clicks to the server.
import { setItemIcon } from './itemIcon.js'
export class ContainerUI {
  constructor (net) {
    this.net = net
    this.open = false
    this.type = null

    this.screen = document.createElement('div')
    this.screen.id = 'container-screen'
    this.screen.style.display = 'none'

    const panel = document.createElement('div')
    panel.className = 'panel'

    this.titleEl = document.createElement('div')
    this.titleEl.className = 'panel-title'
    this.titleEl.textContent = ''
    panel.appendChild(this.titleEl)

    // crafting area (3x3 grid + result), only shown for crafting tables
    this.craftWrap = document.createElement('div')
    this.craftWrap.className = 'craft-wrap'
    this.craftGrid = document.createElement('div')
    this.craftGrid.className = 'craft-grid'
    this.arrow = document.createElement('div')
    this.arrow.className = 'craft-arrow'
    this.arrow.textContent = '→'
    this.resultSlot = document.createElement('div')
    this.resultSlot.className = 'slot result'
    this.craftWrap.appendChild(this.craftGrid)
    this.craftWrap.appendChild(this.arrow)
    this.craftWrap.appendChild(this.resultSlot)
    panel.appendChild(this.craftWrap)

    // generic container grid (chests, furnaces, ...)
    this.containerEl = document.createElement('div')
    this.containerEl.className = 'cont-grid'
    panel.appendChild(this.containerEl)

    this.invLabel = document.createElement('div')
    this.invLabel.className = 'panel-sub'
    this.invLabel.textContent = 'インベントリ'
    panel.appendChild(this.invLabel)

    this.invEl = document.createElement('div')
    this.invEl.className = 'cont-grid inv'
    panel.appendChild(this.invEl)

    const closeBtn = document.createElement('button')
    closeBtn.className = 'small-btn'
    closeBtn.textContent = '閉じる (Esc)'
    closeBtn.addEventListener('click', () => this.requestClose())
    panel.appendChild(closeBtn)

    this.screen.appendChild(panel)
    document.body.appendChild(this.screen)

    this.slots = []
  }

  isCrafting () {
    return this.type && this.type.includes('crafting')
  }

  // split full window.slots into [containerSlots, inventorySlots]
  _split (slots) {
    const invCount = 36
    const cut = Math.max(0, slots.length - invCount)
    return { container: slots.slice(0, cut), inventory: slots.slice(cut) }
  }

  openPanel (slots, type, title) {
    this.open = true
    this.type = type || ''
    this.titleEl.textContent = title || (this.isCrafting() ? '作業台' : 'コンテナ')
    this.update(slots)
    this.screen.style.display = 'flex'
  }

  update (slots) {
    this.slots = slots || []
    if (this.isCrafting()) {
      // Crafting is now handled by the inventory screen (button recipe list).
      // If we ever receive a crafting window here, just show the player's
      // inventory and never the 3x3+result input grid.
      this.craftWrap.style.display = 'none'
      this.containerEl.style.display = 'grid'
      const { container, inventory } = this._split(this.slots)
      this._render(this.containerEl, [], 0)
      this._render(this.invEl, inventory, this.slots.length - inventory.length)
    } else {
      this.craftWrap.style.display = 'none'
      this.containerEl.style.display = 'grid'
      const { container, inventory } = this._split(this.slots)
      this._render(this.containerEl, container, 0)
      this._render(this.invEl, inventory, this.slots.length - inventory.length)
    }
  }

  _render (el, items, startIndex) {
      el.innerHTML = ''
      items.forEach((item, i) => {
        const slotIndex = startIndex + i
        const d = document.createElement('div')
        d.className = 'slot'
        d.dataset.slot = slotIndex
        if (item) {
          d.title = item.displayName || item.name
          const hasIcon = setItemIcon(d, item.name)
          if (!hasIcon) {
            const label = document.createElement('div')
            label.textContent = shortName(item.displayName || item.name)
            d.appendChild(label)
          }
          if (item.count > 1) {
            const c = document.createElement('span')
            c.className = 'count'
            c.textContent = item.count
            d.appendChild(c)
          }
        } else {
          d.style.backgroundImage = ''
          d.style.backgroundSize = ''
          d.style.backgroundPosition = ''
        }
        d.addEventListener('click', e => {
          e.preventDefault()
          this.net.send({ t: 'windowClick', slot: slotIndex, button: e.button === 2 ? 1 : 0, mode: 0 })
        })
        d.addEventListener('contextmenu', e => e.preventDefault())
        el.appendChild(d)
      })
    }

  closePanel () {
    this.open = false
    this.screen.style.display = 'none'
  }

  requestClose () {
    this.net.send({ t: 'closeWindow' })
    this.closePanel()
  }
}

function shortName (name) {
  return name.replace(/^minecraft:/, '').replace(/_/g, ' ').slice(0, 14)
}
