// HUD: hotbar, health/food bars, dig progress, block highlight, debug overlay.
import * as THREE from 'three'
import { setItemIcon, onAtlasReady } from './itemIcon.js'

export class HUD {
  constructor (net) {
    this.net = net
    this.hotbarEl = document.getElementById('hotbar')
    this.healthEl = document.getElementById('health-bar')
    this.foodEl = document.getElementById('food-bar')
    this.digWrap = document.getElementById('dig-progress')
    this.digBar = document.getElementById('dig-progress-bar')
    this.debugEl = document.getElementById('debug')
    this.deathEl = document.getElementById('death-screen')

    this.selected = 0
    this.debugVisible = false
    this.highlight = null
    this._lastHotbar = null

    // build static DOM
    for (let i = 0; i < 10; i++) {
      this.healthEl.appendChild(document.createElement('span'))
      const s = document.createElement('span')
      this.foodEl.appendChild(s)
    }
    for (let i = 0; i < 9; i++) {
      const d = document.createElement('div')
      d.className = 'slot'
      d.dataset.slot = i
      d.addEventListener('click', () => this.selectSlot(i))
      this.hotbarEl.appendChild(d)
    }

    document.addEventListener('wheel', e => {
      if (!this.enabled) return
      e.preventDefault()
      const dir = e.deltaY > 0 ? 1 : -1
      this.selectSlot((this.selected + dir + 9) % 9)
    }, { passive: false })

    document.addEventListener('keydown', e => {
      if (!this._enabled) return
      const m = /^Digit([1-9])$/.exec(e.code)
      if (m) this.selectSlot(parseInt(m[1], 10) - 1)
    })

    // block highlight wireframe box
    this._wireAtlas()
    const geo = new THREE.BoxGeometry(1.002, 1.002, 1.002)
    const edges = new THREE.EdgesGeometry(geo)
    this.highlightBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }))
    this.highlightBox.visible = false
  }

  attachScene (scene) {
    scene.add(this.highlightBox)
    this.scene = scene
  }

  // re-render hotbar icons once the atlas is available
  _wireAtlas () {
    onAtlasReady(() => {
      // trigger a re-render using cached last hotbar if any
      if (this._lastHotbar) this.updateHotbar(this._lastHotbar)
    })
  }

  set enabled (v) { this._enabled = v }
  get enabled () { return !!this._enabled }

  selectSlot (i) {
    if (i === this.selected && this.hotbarEl.children[i]?.classList.contains('sel')) return
    this.selected = i
    ;[...this.hotbarEl.children].forEach((c, j) => c.classList.toggle('sel', j === i))
    this.net.send({ t: 'hotbar', slot: i })
  }

  updateHotbar (msg) {
    this._lastHotbar = msg
    for (let i = 0; i < 9; i++) {
      const el = this.hotbarEl.children[i]
      const item = msg.slots[i]
      el.innerHTML = ''
      el.classList.toggle('sel', i === msg.selected)
      if (item) {
        el.title = (item.displayName != null) ? String(item.displayName) : ''
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
    this.selected = msg.selected
  }

  updateHealth (health, food) {
    const hpOn = Math.ceil(health / 2)
    const foodOn = Math.ceil(food / 2)
    ;[...this.healthEl.children].forEach((s, i) => s.classList.toggle('on', i < hpOn))
    ;[...this.foodEl.children].forEach((s, i) => s.classList.toggle('on', i < foodOn))
  }

  showDigProgress (p) {
    if (p == null || p <= 0 || p >= 1) {
      this.digWrap.style.display = 'none'
      return
    }
    this.digWrap.style.display = 'block'
    this.digBar.style.width = `${Math.round(p * 100)}%`
  }

  setHighlight (hit) {
    if (!hit || hit.entity != null || hit.x == null) { this.highlightBox.visible = false; return }
    this.highlightBox.visible = true
    this.highlightBox.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5)
  }

  setDebug (text) {
    this.debugVisible = true
    this.debugEl.classList.remove('hidden')
    this.debugEl.textContent = text
  }

  toggleDebug () {
    this.debugVisible = !this.debugVisible
    this.debugEl.classList.toggle('hidden', !this.debugVisible)
  }

  showDeath () { this.deathEl.style.display = 'flex' }
  hideDeath () { this.deathEl.style.display = 'none' }
}

function shortName (name) {
  return name.replace(/^minecraft:/, '').replace(/_/g, ' ').slice(0, 14)
}
