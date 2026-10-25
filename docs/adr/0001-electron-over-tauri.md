# Electron (not Tauri) for the desktop shell

We build on Electron + React + TypeScript rather than Tauri. The Claude Agent SDK is a Node library that spawns the `claude` binary, so a Tauri app would have to ship a Node sidecar anyway — erasing most of Tauri's size advantage and adding a Rust↔Node IPC layer. The core of the product is a custom, virtualized diff renderer, and Electron's bundled Chromium gives identical rendering and performance on every OS, whereas Tauri's system webviews (WKWebView, WebView2, WebKitGTK) would mean three engines to tune. A single-language TypeScript codebase also lowers the bar for open-source contributors.

## Consequences

- We accept a ~120 MB download and higher idle memory.
- Tree-sitter runs as WASM (`web-tree-sitter`) in a utility process rather than as native Rust.
- The renderer must be sandboxed with context isolation; all privileged work (git, filesystem, agents, host APIs) lives in the main/utility processes behind a typed IPC surface.
