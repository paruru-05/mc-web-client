// Runs prismarine-viewer's mesher inside a Node worker_thread.
// The viewer's worker.js detects the node environment itself and wires
// parentPort into its global self/postMessage.
require('prismarine-viewer/viewer/lib/worker.js')
