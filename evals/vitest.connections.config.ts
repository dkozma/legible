import { defineConfig } from "vitest/config"

// `pnpm evals:connections`: Connections scored against SCIP on the corpus in
// evals/corpus/connections.json, or EVAL_REPO=<path> (local mode). Needs
// network access and installed dependencies; not part of `pnpm evals` or CI.
export default defineConfig({
  test: {
    include: ["evals/connections.eval.ts"],
    root: "..",
    testTimeout: 120 * 60_000,
  },
})
