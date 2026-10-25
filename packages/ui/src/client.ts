// Typed wrapper over the bridge preload exposes. The UI depends on this, never
// on Electron.

import type { Channel, EventName, Events, LegibleBridge, Req, Responses } from '@legible/ipc';

export class ClientError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'ClientError';
  }
}

export interface LegibleClient {
  call<C extends Channel>(channel: C, req: Req<C>): Promise<Responses[C]>;
  on<E extends EventName>(event: E, listener: (payload: Events[E]) => void): () => void;
  platform: string;
}

export function createClient(bridge: LegibleBridge): LegibleClient {
  return {
    async call(channel, req) {
      const r = await bridge.invoke(channel, req);
      if (!r.ok) throw new ClientError(r.error.message, r.error.code);
      return r.value as never;
    },
    on(event, listener) {
      return bridge.on(event, listener as (p: unknown) => void);
    },
    platform: bridge.platform,
  };
}
