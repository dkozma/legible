// Layer hints from paths and frameworks (engineering plan §9.2). The planner
// sees them as hints; Layers order Steps when dependencies don't.

import type { Layer } from "@legible/domain"

export const LAYER_ORDER: Layer[] = [
  "data_model",
  "backend",
  "api",
  "client_data",
  "presentation",
  "chores",
]

export const layerRank = (l: Layer) => LAYER_ORDER.indexOf(l)

const RULES: [RegExp, Layer][] = [
  // Chores first: tooling and dependencies, wherever they live.
  [
    /(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|Cargo\.(toml|lock)|go\.(mod|sum)|Gemfile(\.lock)?|poetry\.lock|pyproject\.toml|requirements[^/]*\.txt|Dockerfile|Makefile|\.github\/|\.gitignore|\.npmrc|tsconfig[^/]*\.json|\.?eslint[^/]*|\.?prettier[^/]*|\.oxlint[^/]*|vite\.config|vitest\.config|jest\.config|webpack\.config|babel\.config|\.editorconfig)/i,
    "chores",
  ],
  [/\.(md|mdx|rst|txt|adoc)$|(^|\/)docs?\//i, "chores"],
  [/(^|\/)(config|configs|settings|scripts|tools|ci)\//i, "chores"],
  // Data model.
  [
    /(^|\/)(migrations?|migrate|schema|schemas|models?|entities|entity|db|database|prisma|repositories|repository)\/|\.(sql|prisma|proto|graphql|gql)$|(Repository|Model|Entity|Schema)\.\w+$/i,
    "data_model",
  ],
  // API surface.
  [
    /(^|\/)(api|apis|routes?|routers?|controllers?|handlers?|endpoints?|resolvers?|rpc|grpc)\/|(Controller|Handler|Router|Resolver)\.\w+$|openapi|swagger/i,
    "api",
  ],
  // Client data: state, queries and API clients on the client side.
  [
    /(^|\/)(client|clients|store|stores|state|hooks|queries|redux|slices|composables|services\/api)\/|(Store|Slice|Query|Hook)\.\w+$/i,
    "client_data",
  ],
  // Presentation.
  [
    /(^|\/)(components?|views?|pages?|screens?|ui|layouts?|templates?|styles?|widgets?)\/|\.(tsx|jsx|vue|svelte|astro|css|scss|sass|less|html|erb|hbs)$/i,
    "presentation",
  ],
]

/** The Layer a path most likely belongs to. Code nothing matches is backend logic. */
export function layerHint(path: string): Layer {
  for (const [re, layer] of RULES) if (re.test(path)) return layer
  return "backend"
}
