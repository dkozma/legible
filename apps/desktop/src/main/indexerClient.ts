// Main-process side of the indexer: spawns the utility process, restarts it
// if it dies, and turns its replies back into promises. Code indexes live in
// the process, so after a restart the next query rebuilds the one it needs.

import { randomUUID } from "node:crypto"

import {
  createIndexer,
  type FromIndexer,
  type Indexer,
  type IndexerConfig,
  type IndexerMethod,
  type ToIndexer,
} from "./indexerCore"

export interface IndexerTransport {
  post(m: ToIndexer): void
  onMessage(cb: (m: FromIndexer) => void): void
  onExit(cb: () => void): void
  kill(): void
}

export class IndexerClient implements Indexer {
  private transport: IndexerTransport | null = null
  private calls = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()

  constructor(
    private readonly spawn: () => IndexerTransport,
    private readonly config: IndexerConfig,
  ) {}

  private ensure(): IndexerTransport {
    if (this.transport) return this.transport
    const t = this.spawn()
    t.onMessage((m) => {
      const call = this.calls.get(m.id)
      if (!call) return
      this.calls.delete(m.id)
      if (m.ok) call.resolve(m.value)
      else call.reject(new Error(m.message))
    })
    t.onExit(() => {
      this.transport = null
      for (const [id, call] of this.calls) {
        call.reject(new Error("The indexer stopped unexpectedly. Try again."))
        this.calls.delete(id)
      }
    })
    t.post({ type: "configure", config: this.config })
    this.transport = t
    return t
  }

  private call<M extends IndexerMethod>(
    method: M,
    args: Parameters<Indexer[M]>,
  ): ReturnType<Indexer[M]> {
    const id = randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      this.calls.set(id, { resolve, reject })
      this.ensure().post({ type: "call", id, method, args })
    }) as ReturnType<Indexer[M]>
  }

  buildChangeSet(...a: Parameters<Indexer["buildChangeSet"]>) {
    return this.call("buildChangeSet", a)
  }
  status(...a: Parameters<Indexer["status"]>) {
    return this.call("status", a)
  }
  fileSymbols(...a: Parameters<Indexer["fileSymbols"]>) {
    return this.call("fileSymbols", a)
  }
  connections(...a: Parameters<Indexer["connections"]>) {
    return this.call("connections", a)
  }
  at(...a: Parameters<Indexer["at"]>) {
    return this.call("at", a)
  }
  source(...a: Parameters<Indexer["source"]>) {
    return this.call("source", a)
  }
  lookup(...a: Parameters<Indexer["lookup"]>) {
    return this.call("lookup", a)
  }

  dispose() {
    this.transport?.kill()
    this.transport = null
  }
}

/** The indexer in this process; for tests and LEGIBLE_IN_PROCESS_INDEXER=1. */
export function inProcessIndexer(config: IndexerConfig): Indexer {
  return createIndexer(config)
}
