# mc-web-client

A browser-based Minecraft Java Edition client. Renders with Three.js and connects to real servers (Paper/Vanilla 1.8–1.21) through a Node.js backend powered by mineflayer.

## Features

- First-person 3D rendering of chunks, entities, and held items
- Real server connection (offline / Microsoft auth)
- Mining, placing, eating, bow, doors/buttons/levers
- Inventory and crafting table (button-style recipe list)
- Containers (chests, furnaces, etc.)
- Chat and tab completion
- Custom sound effects / BGM (drop files into `assets/sounds/`)

## Quick start

```bash
npm install
npm install --prefix web

# Generate texture atlas (first run / version change)
npm run atlas

# Build web frontend
npm run build --prefix web

# Start backend
npm run server          # http://localhost:8091
```

Open `http://localhost:8091`, enter server host/port/username, and connect.

For development with HMR: `npm run dev`.

## Documentation

- [docs/architecture.md](docs/architecture.md) — overall design
- [docs/protocol.md](docs/protocol.md) — WebSocket message protocol
- [docs/atlas.md](docs/atlas.md) — texture atlas generation
- [docs/development.md](docs/development.md) — dev notes, testing, constraints

## Requirements

- Node.js 18+
- Java Minecraft server (Paper/Vanilla) reachable from the backend

## License

MIT
README.md