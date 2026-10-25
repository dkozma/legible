// The only bridge between the sandboxed renderer and main: a whitelist of
// request channels and event names from the IPC contract.

import type { LegibleBridge } from "@legible/ipc"
import { CHANNELS, EVENTS } from "@legible/ipc/channels"
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron"

const channels = new Set<string>(CHANNELS)
const events = new Set<string>(EVENTS)

const bridge: LegibleBridge = {
  invoke(channel, payload) {
    if (!channels.has(channel))
      return Promise.resolve({
        ok: false,
        error: { message: `Unknown channel ${channel}`, code: "invalid" },
      })
    return ipcRenderer.invoke(channel, payload)
  },
  on(event, listener) {
    if (!events.has(event)) return () => undefined
    const wrapped = (_e: IpcRendererEvent, payload: unknown) =>
      listener(payload)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  },
  platform: process.platform,
}

contextBridge.exposeInMainWorld("legible", bridge)
