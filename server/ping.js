// Server status ping: version detection + Forge/modded detection.
const mc = require('minecraft-protocol')
const minecraftData = require('minecraft-data')

// protocol version number -> human readable version string
function protocolToVersion (protocolVersion) {
  const versions = minecraftData.versions.pc
  for (const v of versions) {
    if (v.version === protocolVersion && v.releaseType === 'release') {
      return v.minecraftVersion
    }
  }
  return null
}

// "Paper 1.21.4" / "1.21.4" etc -> "1.21.4"
function versionFromName (name) {
  if (!name) return null
  const m = /(\d+\.\d+(\.\d+)?)/.exec(String(name))
  return m ? m[1] : null
}

function pingServer (host, port = 25565, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('サーバーへの接続がタイムアウトしました'))
    }, timeoutMs)
    try {
      mc.ping({ host, port }, (err, results) => {
        clearTimeout(timeout)
        if (err) {
          const msg = err.code === 'ENOTFOUND'
            ? 'ホストが見つかりません'
            : err.code === 'ECONNREFUSED'
              ? '接続を拒否されました(ポート/アドレス確認)'
              : (err.message || 'pingに失敗しました')
          reject(new Error(msg))
          return
        }
        let versionName = null
        let protocol = null
        let modded = null
        if (results && results.version) {
          versionName = results.version.name
          protocol = results.version.protocol
          // Forge servers advertise modinfo/forgeData in the status response.
          // Only treat as modded when an actual mod list is advertised (empty
          // FML modinfo with no mods is a false positive on some hosts).
          const mi = results.modinfo
          const hasMods = mi && Array.isArray(mi.modList) && mi.modList.length > 0
          modded = hasMods || !!results.forgeData || (results.version && /forge/i.test(results.version.name || ''))
        }
        resolve({
          host,
          port,
          versionName,
          protocol,
          minecraftVersion: protocolToVersion(protocol),
          modded: !!modded,
          players: results && results.players ? results.players : null,
          description: results && results.description ? results.description : null,
          raw: results
        })
      })
    } catch (e) {
      clearTimeout(timeout)
      reject(e)
    }
  })
}

module.exports = { pingServer, protocolToVersion, versionFromName }
