# Architecture

## Overview

```
Browser (Three.js)  <--WebSocket-->  Node backend (Express + ws)
                                      |
                                      +-- mineflayer bot --> MC server
                                      +-- MesherPool (worker_threads) --> geometry
                                      +-- serves web/dist + assets/
```

## Components

### Frontend (`web/src/`)
- `main.js` — game init, input handling, HUD/inventory wiring
- `worldRenderer.js` — Three.js world rendering; merges section geometries into chunk meshes
- `entities.js` — entity rendering with vanilla Bedrock models (SkinnedMesh)
- `player.js` — first-person camera & movement
- `inventory.js` — inventory screen + crafting table recipe list
- `container.js` — container (chest/furnace) UI
- `hud.js` — hotbar & status bars
- `chat.js` — chat overlay
- `heldItem.js` — first-person held item rendering
- `sound.js` — SFX/BGM (synth + custom files)
- `itemIcon.js` — atlas sprite icons for slots
- `net.js` — WebSocket client

### Backend (`server/`)
- `index.js` — Express static + WebSocket server
- `session.js` — per-connection Session: mineflayer bot, input, digging, placing, containers, crafting, raycast
- `mesherPool.js` + `mesher-worker.cjs` — worker pool running prismarine-viewer mesher
- `atlas.js` — atlas generation
- `ping.js` — server status ping / version detection

### Assets (`assets/`)
- `atlas.png` + `atlas.json` — block/item texture atlas (16px tiles)
- `mobAtlas.png` + `mobTextures.json` — entity texture atlas (64px tiles)
- `entityModels.json` — 94 vanilla mob models (Bedrock format)
- `blockStates.json` — block model states for mesher
- `sounds/` — custom audio files

## Data flow

1. Browser connects via WebSocket `/ws`
2. `connect` message → Session pings server, detects version, creates mineflayer bot
3. `hello` → frontend initializes renderer
4. Chunk columns stream via `chunkColumnLoad` → mesher → binary `MSG_GEOM` → frontend merges into chunk meshes
5. Player input → `input` messages → bot control states
6. Raycast (60ms) → server `handleRay` → `rayResult` → highlight
7. Dig/place → server-side bot actions → block updates → mesh dirty/rebuild
8. Inventory/hotbar sync every 2s + on `setSlot`

## Key design decisions

- **Chunk-level mesh merging**: section geometries (16³) are merged per chunk to reduce draw calls
- **Shared atlas**: blocks, items, and chest textures in one atlas; mobs in a separate atlas
- **Button-style crafting**: crafting table reuses inventory screen with a recipe list (no 3×3 grid)
- **Camera in scene graph**: camera is added to scene so held-item child renders
README.md