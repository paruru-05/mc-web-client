# Texture Atlas

## Generation

```bash
npm run atlas   # runs server/atlas.js
```

Generates into `assets/`:
- `atlas.png` + `atlas.json` — block/item atlas (1024×1024, 16px tiles)
- `mobAtlas.png` + `mobTextures.json` — entity atlas (64px tiles, aspect-preserving)
- `entityModels.json` — 94 vanilla mob models (Bedrock format)
- `blockStates.json` — block model states for the mesher
- `meta.json` — version & timestamp

## Block/Item Atlas

Combines `minecraft-assets` block textures, item textures, and chest entity textures. Chest textures are prefixed `chest_` to avoid name collisions. Each tile is 16×16.

## Mob Atlas

Collects all PNGs under `entity/`. Each source image is fit (aspect-preserving) into a 64×64 tile. `su`/`sv` store the used sub-rect. UV remapping in `entities.js` maps model UVs (original texture space) into the atlas tile.

## Entity Models

Copied from `prismarine-viewer/viewer/lib/entity/entities.json`. Each entry has `geometry` (bones/cubes with origin/size/uv/rotation) and `textures`.

## Custom Sounds

Place files in `assets/sounds/` (and `web/public/sounds/` for dev):
- `bgm.mp3/.ogg` — background music loop
- `dig`, `break`, `place`, `hit`, `step`, `pop`, `chestOpen`, `chestClose`, `craft` — SFX

Supported formats: `.mp3`, `.ogg`, `.wav`. If absent, synthesized fallback is used.
README.md