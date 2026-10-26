# oxlint and oxfmt for lint and format

M1 started on Biome, the engineering plan's default. It moved to the Oxc tools: oxlint for linting and oxfmt for formatting. The reason is type-aware linting. oxlint runs typescript-eslint's typed rules through `oxlint-tsgolint`, and Biome has no equivalent. Most of Legible's risky code is async: the Electron main process, the agent host, git and host clients. Rules like `no-floating-promises` and `no-misused-promises` catch the failures that tests miss there. oxlint also brings the ESLint plugin rule sets Biome only partly covers (react, react-hooks, jsx-a11y, import, promise, vitest).

oxfmt formats TS, TSX, CSS, JSON and YAML, so there's still one formatter. It uses Prettier's defaults (80 columns, double quotes, trailing commas) except that it leaves out semicolons, like `prettier --no-semi`. Two oxfmt defaults that differ from Prettier's are set back: the print width (oxfmt uses 100) and `package.json` key sorting (oxfmt sorts them). It doesn't sort imports or Tailwind classes, since Prettier doesn't.

## Consequences

- `pnpm lint` runs `oxlint && oxfmt --check`, and `pnpm format` writes. On code formatted at a wider width, oxfmt can need a second run to settle. The config is in `.oxlintrc.json` and `.oxfmtrc.json`. Markdown, `docs/design` and the lockfile aren't formatted.
- Correctness and suspicious rules are errors, and warnings fail the build.
- A few rules are off on purpose, each for one reason:
  - **Type assertions.** `no-unsafe-type-assertion` is off. With `noUncheckedIndexedAccess`, narrowing with `as` after a bounds check is the house style.
  - **Accessibility.** Biome turned the same rules off: keyboard handling is global and diff rows are virtualized.
  - **React Compiler rules.** Legible doesn't use the compiler, and the latest-ref pattern is deliberate.
  - **Effect dependencies.** `exhaustive-effect-dependencies` is off, because effects re-run on purpose when `tick` or `model` changes. `exhaustive-deps`, which catches missing dependencies, stays on.
  - **Unbound methods.** `unbound-method` is off in `packages/ui`, where props and store actions are declared as methods but are plain functions.
- The switch caught a bug: palette highlights were misaligned after an emoji, because match offsets were UTF-16 while rendering went by code points. It also caught an unhandled rejection at startup. A failed start now shows an error dialog instead of leaving no window.
