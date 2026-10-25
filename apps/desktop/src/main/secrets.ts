// Secrets (API keys, host tokens) encrypted with the OS keychain through
// Electron safeStorage. Only ciphertext touches disk, in its own file; never
// SQLite, never logs.

import { readFileSync } from 'node:fs';
import { chmod, rename, writeFile } from 'node:fs/promises';
import { safeStorage } from 'electron';

export class SecretStore {
  private cache: Record<string, string> | null = null;

  constructor(private readonly file: string) {}

  available(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  private load(): Record<string, string> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  get(name: string): string | null {
    const enc = this.load()[name];
    if (!enc) return null;
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return null;
    }
  }

  has(name: string): boolean {
    return Boolean(this.load()[name]);
  }

  names(): string[] {
    return Object.keys(this.load());
  }

  async set(name: string, value: string | null) {
    const all = { ...this.load() };
    if (value === null || value === '') delete all[name];
    else {
      if (!this.available()) throw new Error('The OS keychain is unavailable, so Legible can’t store secrets safely.');
      all[name] = safeStorage.encryptString(value).toString('base64');
    }
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(all), { mode: 0o600 });
    await rename(tmp, this.file);
    await chmod(this.file, 0o600).catch(() => undefined);
    this.cache = all;
  }
}
