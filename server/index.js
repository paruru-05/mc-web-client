// mc-web-client backend: serves the built web app and bridges browsers
// to real Minecraft servers via mineflayer.
const express = require('express')
const http = require('http')
const path = require('path')
const fs = require('fs')
const { WebSocketServer } = require('ws')
const { Session } = require('./session')

const PORT = process.env.PORT || 8091

// A single misbehaving packet handler must not kill every active session.
process.on('uncaughtException', err => console.error('[uncaught]', err))
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err))

const app = express()
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')))

const webDist = path.join(__dirname, '..', 'web', 'dist')
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/assets') || req.path.startsWith('/ws')) return next()
    res.sendFile(path.join(webDist, 'index.html'))
  })
}

app.get('/', (req, res) => {
  res.send('<h1>mc-web-client server</h1><p>Web UI is not built yet. Run <code>npm run build --prefix web</code> or <code>npm run dev</code>.</p>')
})

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', ws => {
  const session = new Session(ws)
  let alive = true
  ws.on('message', (data, isBinary) => {
    if (isBinary) return
    let msg
    try { msg = JSON.parse(data.toString()) } catch (e) { return }
    try { session.handleMessage(msg) } catch (e) {
      console.error('handleMessage failed:', e)
      session.error('内部エラー: ' + e.message)
    }
  })
  ws.on('close', () => {
    alive = false
    session.cleanup()
    console.log('[session] client disconnected')
  })
  ws.on('error', () => {})
  console.log('[session] client connected')
})

server.listen(PORT, () => {
  console.log(`mc-web-client server listening on http://localhost:${PORT}`)
})
