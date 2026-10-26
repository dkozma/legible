import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "./styles/index.css"
import type { LegibleBridge } from "@legible/ipc"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import { createClient, type LegibleClient } from "./client"
import { Providers } from "./context"

export { createClient, type LegibleClient } from "./client"
export {
  buildRows,
  type Row,
  type RowModel,
  rangesForRows,
  rowAt,
} from "./diff/rows"

export interface MountOptions {
  /** Called with errors React caught while rendering, for error reports. */
  onError?: (error: unknown, componentStack: string | undefined) => void
}

export function mountApp(
  el: HTMLElement,
  bridge: LegibleBridge | LegibleClient,
  options: MountOptions = {},
) {
  const client = "call" in bridge ? bridge : createClient(bridge)
  const report = (error: unknown, info: { componentStack?: string }) => {
    console.error(error)
    options.onError?.(error, info.componentStack)
  }
  createRoot(el, { onUncaughtError: report, onCaughtError: report }).render(
    <Providers client={client}>
      <App />
    </Providers>,
  )
}
