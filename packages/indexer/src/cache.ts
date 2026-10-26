// The parse cache: what a parse produced (tokens, Symbols, references,
// imports), keyed by blob OID + grammar version, so identical files across
// Base, Head and Iterations are parsed once. An in-memory LRU in front of an
// optional on-disk store with a size bound.

import { mkdirSync, readdirSync, statSync } from "node:fs"
import { readFile, rm, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { deserialize, serialize } from "node:v8"

export interface ParseCacheOptions {
  /** On-disk store; memory only when absent. */
  dir?: string
  /** Bound on the on-disk store. */
  maxDiskBytes?: number
  maxMemoryEntries?: number
}

export class ParseCache<T> {
  private memory = new Map<string, T>()
  private diskBytes: number | null = null
  private pruning: Promise<void> | null = null
  private readonly maxDisk: number
  private readonly maxMemory: number

  constructor(private readonly opts: ParseCacheOptions = {}) {
    this.maxDisk = opts.maxDiskBytes ?? 256 * 1024 * 1024
    this.maxMemory = opts.maxMemoryEntries ?? 4000
    if (opts.dir) mkdirSync(opts.dir, { recursive: true })
  }

  async get(key: string): Promise<T | undefined> {
    const hit = this.memory.get(key)
    if (hit !== undefined) {
      this.memory.delete(key)
      this.memory.set(key, hit)
      return hit
    }
    if (!this.opts.dir) return undefined
    const path = this.pathOf(key)
    try {
      const value = deserialize(await readFile(path)) as T
      this.remember(key, value)
      // Mark it recently used for pruning.
      const now = new Date()
      await utimes(path, now, now).catch(() => undefined)
      return value
    } catch {
      return undefined
    }
  }

  async set(key: string, value: T): Promise<void> {
    this.remember(key, value)
    if (!this.opts.dir) return
    const buf = serialize(value)
    try {
      await writeFile(this.pathOf(key), buf)
    } catch {
      return
    }
    this.diskBytes = (this.diskBytes ?? this.measure()) + buf.length
    if (this.diskBytes > this.maxDisk) {
      this.pruning ??= this.prune().finally(() => {
        this.pruning = null
      })
    }
  }

  private remember(key: string, value: T) {
    this.memory.set(key, value)
    while (this.memory.size > this.maxMemory)
      this.memory.delete(this.memory.keys().next().value as string)
  }

  private pathOf(key: string) {
    return join(this.opts.dir as string, `${key}.bin`)
  }

  private entries() {
    const dir = this.opts.dir as string
    return readdirSync(dir)
      .filter((f) => f.endsWith(".bin"))
      .map((f) => {
        try {
          const s = statSync(join(dir, f))
          return { path: join(dir, f), size: s.size, used: s.mtimeMs }
        } catch {
          return null
        }
      })
      .filter((e) => e !== null)
  }

  private measure(): number {
    return this.entries().reduce((n, e) => n + e.size, 0)
  }

  /** Removes least recently used entries down to 80% of the bound. */
  private async prune() {
    const entries = this.entries().toSorted((a, b) => a.used - b.used)
    let total = entries.reduce((n, e) => n + e.size, 0)
    for (const e of entries) {
      if (total <= this.maxDisk * 0.8) break
      await rm(e.path, { force: true })
      total -= e.size
    }
    this.diskBytes = total
  }
}
