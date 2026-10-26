import { resolve } from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import type { Plugin } from "vite"

import { bundleFiles } from "../../packages/indexer/grammars/bundle.mjs"

/** Copies WASM grammars and their queries into out/main/grammars, for the indexer. */
function grammars(): Plugin {
  return {
    name: "legible-grammars",
    generateBundle() {
      for (const f of bundleFiles())
        this.emitFile({
          type: "asset",
          fileName: `grammars/${f.fileName}`,
          source: f.source,
        })
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), grammars()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          agentHost: resolve(__dirname, "src/main/agentHost.ts"),
          indexer: resolve(__dirname, "src/main/indexer.ts"),
        },
      },
    },
  },
  preload: {
    // A sandboxed preload can't require packages, so Sentry's bridge is bundled in.
    plugins: [externalizeDepsPlugin({ exclude: ["@sentry/electron"] })],
    build: {
      rollupOptions: {
        // Sandboxed preloads must be CommonJS.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") },
    },
  },
})
