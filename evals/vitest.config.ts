import { defineConfig } from "vitest/config"

// `pnpm evals`: runs every labeled case through the real pipelines and writes
// a result file. EVAL_RUNTIME=fake (default) | claude | openai; see README.md.
export default defineConfig({
  test: {
    include: ["evals/run.eval.ts"],
    root: "..",
    testTimeout: 30 * 60_000,
  },
})
