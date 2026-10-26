// Decides whether error reports leave the machine (ADR 0013). Reports wait in
// memory until the user's choice is known, then go out or are dropped.

/** The parts of a Sentry transport the gate needs. */
export interface GateTransport<E, R> {
  send(envelope: E): PromiseLike<R>
  flush(timeout?: number): PromiseLike<boolean>
}

export type GateState = "off" | "waiting" | "on"

export function createReportGate<E, R>(empty: R, maxWaiting = 30) {
  let state: GateState = "waiting"
  let inner: GateTransport<E, R> | null = null
  const waiting: { envelope: E; done: (r: R | PromiseLike<R>) => void }[] = []

  return {
    get state() {
      return state
    },
    /** Wraps a transport factory so every send passes through the gate. */
    wrap<O>(make: (options: O) => GateTransport<E, R>) {
      return (options: O): GateTransport<E, R> => {
        const t = make(options)
        inner = t
        return {
          send(envelope) {
            if (state === "on") return t.send(envelope)
            // A crash loop mustn't grow the queue without bound.
            if (state === "off" || waiting.length >= maxWaiting)
              return Promise.resolve(empty)
            return new Promise<R>((done) => waiting.push({ envelope, done }))
          },
          flush: (timeout) => t.flush(timeout),
        }
      }
    },
    /** Settles the choice: sends or drops what waited, and everything after. */
    set(enabled: boolean) {
      state = enabled ? "on" : "off"
      for (const { envelope, done } of waiting.splice(0)) {
        // Resolving with the send's promise adopts its result; a failed send settles as empty.
        if (enabled && inner)
          done(Promise.resolve(inner.send(envelope)).catch(() => empty))
        else done(empty)
      }
    },
  }
}
