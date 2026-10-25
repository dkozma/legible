# SQLite through Node's built-in `node:sqlite`, not better-sqlite3

The engineering plan named better-sqlite3 for the store. We use Node's built-in `node:sqlite` instead, behind the same Kysely query layer, through a small adapter (`packages/store/src/sqlite.ts`). better-sqlite3 is a native module: it has to be rebuilt for Electron's ABI, and once it is, the copy in `node_modules` no longer loads in plain Node, so unit tests and the app fight over one build. `node:sqlite` ships in both the Node that runs the tests and the Node inside Electron (Electron 44 bundles Node 24), so there's no rebuild step and the same code runs everywhere. Kysely was chosen over Drizzle (an open question in the plan) because its SQLite dialect takes any `prepare`/`all`/`run` object, which made the adapter about forty lines.

## Consequences

- No native modules in the app, so packaging needs no electron-rebuild.
- `node:sqlite` is still marked experimental in Node 22 and prints a warning in tests. If its API changes, only the adapter changes. better-sqlite3 remains the fallback, since Kysely supports it directly.
