# WebSocket Protocol

Binary frames: `MSG_CHUNK (1)` and `MSG_GEOM (2)`. JSON messages use `{ t: '<type>', ... }`.

## Client → Server

| type | fields | description |
|---|---|---|
| connect | host, port, username, auth, password | start connection |
| input | yaw, pitch, controls | player movement |
| digStart | x, y, z | begin digging |
| digEnd | — | cancel digging |
| attack | id | attack entity |
| openBlock | x, y, z | open container/crafting table |
| activateBlock | x, y, z | toggle door/button/lever |
| closeWindow | — | close active window |
| place | x, y, z, dx, dy, dz | place block |
| consume | — | eat held food |
| bowPull / bowRelease | — | bow mechanics |
| hotbar | slot | select hotbar slot |
| requestInventory | — | push inventory |
| requestRecipes | table | push recipe list |
| swapSlots | a, b | swap inventory slots |
| craft | result, count | craft item |
| creativeSet | slot, name, count | creative mode item |
| chat | text | send chat |
| tabComplete | id, text | tab completion |
| ray | ox, oy, oz, dx, dy, dz | raycast |
| respawn | — | respawn |

## Server → Client (JSON)

| type | fields | description |
|---|---|---|
| status | message | connection status |
| error | message | error |
| hello | mcVersion, atlasVersion, entity, gameMode, dimension | login success |
| spawn | entity, gameMode | spawn/teleport |
| pos | x, y, z, yaw, pitch, onGround, health, food | position update |
| health | health, food | health update |
| chat | text, position | chat message |
| hotbar | slots, selected | hotbar update |
| inventory | slots, held, gameMode | inventory update |
| recipes | list | recipe list (with canCraft) |
| craftResult | ok, message | craft result |
| windowOpen | type, title, slots | container opened |
| windowUpdate | slots | container slots changed |
| windowClose | — | container closed |
| entities | list | entity snapshot |
| rayResult | hit | raycast result |
| digProgress | x, y, z, progress | dig progress |
| digComplete | x, y, z, failed | dig finished |
| death | — | player died |
| kicked | reason | kicked from server |
| end | — | connection ended |
| unloadChunk | x, z | chunk unloaded |

## Server → Client (Binary)

- `MSG_CHUNK (1)`: deflated chunk column JSON
- `MSG_GEOM (2)`: section geometry (indices, positions, normals, colors, uvs)
README.md