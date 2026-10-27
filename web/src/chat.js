// Chat overlay without tab completion.
export class ChatUI {
  constructor (net, onClose = () => {}) {
    this.net = net
    this.onClose = onClose
    this.log = document.getElementById('chat-log')
    this.wrap = document.getElementById('chat-input-wrap')
    this.input = document.getElementById('chat-input')
    this.open = false

    this.input.addEventListener('keydown', e => this.onKey(e))
  }

  openChat () {
    this.open = true
    this.wrap.style.display = 'block'
    this.input.value = ''
    const canvas = document.getElementById('c')
    if (canvas) canvas.blur()
    const doFocus = () => {
      this.input.focus()
      try { this.input.setSelectionRange(this.input.value.length, this.input.value.length) } catch {}
    }
    if (document.pointerLockElement) {
      document.exitPointerLock()
      // exit is async – focus on next ticks and on pointerlockchange
      requestAnimationFrame(doFocus)
      setTimeout(doFocus, 30)
      setTimeout(doFocus, 150)
      if (this._plHandler) document.removeEventListener('pointerlockchange', this._plHandler)
      const onChange = () => {
        document.removeEventListener('pointerlockchange', onChange)
        this._plHandler = null
        doFocus()
        setTimeout(doFocus, 10)
      }
      this._plHandler = onChange
      document.addEventListener('pointerlockchange', onChange)
    } else {
      doFocus()
      requestAnimationFrame(doFocus)
    }
  }

  closeChat () {
    this.open = false
    this.wrap.style.display = 'none'
    this.input.blur()
    this.onClose()
  }

  addLine (text) {
    const div = document.createElement('div')
    div.className = 'chat-line'
    div.textContent = text
    div.style.opacity = '1'
    this.log.appendChild(div)
    while (this.log.childElementCount > 60) this.log.removeChild(this.log.firstChild)
    setTimeout(() => { div.style.opacity = '0' }, 8000)
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div) }, 9500)
  }

  onKey (e) {
    e.stopPropagation()
    const isEscape = e.key === 'Escape' || e.code === 'Escape'
    const isEnter = e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.keyCode === 13
    if (isEscape) {
      e.preventDefault()
      this.closeChat()
      return
    }
    if (isEnter) {
      e.preventDefault()
      const text = this.input.value.trim()
      if (text) {
        try { this.net.send({ t: 'chat', text }) } catch {}
      }
      this.closeChat()
    }
  }

  handleResult (msg) { /* tab completion disabled */ }
}
