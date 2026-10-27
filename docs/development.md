# Development

## Testing constraints

- Use `127.0.0.1`, not `localhost` (IPv6 `::1` often refused)
- Stop background servers with `kill $SRV` (PID), never `pkill -9 -f` (hangs)
- Background server pattern (single command):
  ```bash
  node server/index.js > /tmp/server.log 2>&1 & SRV=$!
  sleep 2
  # ... tests ...
  kill $SRV; wait $SRV
  ```
- puppeteer-core: `--no-sandbox --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, executable `/usr/bin/google-chrome-stable`

## mineflayer notes

- `bot.inventory.count(id)` requires numeric id
- Recipe `count == -1` → clamp to 1; id `-1` = empty shaped slot → ignore
- `bot.recipesAll(null, ...)` returns 0 → iterate `Object.keys(bot.registry.recipes)` + `bot.recipesAll(typeKey, null, table)`
- `bot.recipesFor(itemType, metadata, minResultCount, craftingTable)` — 2nd=metadata, 4th=craftingTable
- `bot.craft(recipe, count, craftingTable)` closes `windowCraftingTable` after each craft
- Window type is `minecraft:crafting_table` (not `minecraft:crafting`); use `type.includes('crafting')`
- `inventory.js:456` expects `minecraft:crafting` → patched to `includes('crafting')`

## Live e2e

Blocked by harness `Failed to decode packet serverbound/minecraft:hello`. Use direct mineflayer probe with `version: '1.21.4'` for validation.

## Build

```bash
npm run build --prefix web   # outputs web/dist/
```

Server restart required after `server/session.js` changes.

## Lint/typecheck

No dedicated lint script. Verify with `node --check` on server files and `npm run build --prefix web`.
README.md