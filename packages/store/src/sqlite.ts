// Adapts Node's built-in `node:sqlite` to Kysely's SQLite dialect, so the app
// needs no native module (no electron-rebuild, same binary in tests and Electron).

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { Kysely, type SqliteDatabase, SqliteDialect, type SqliteStatement } from 'kysely';

type Param = null | number | bigint | string | Uint8Array;

function toParams(parameters: ReadonlyArray<unknown>): Param[] {
  return parameters.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p as Param;
  });
}

class Statement implements SqliteStatement {
  readonly reader: boolean;
  constructor(private readonly stmt: StatementSync) {
    this.reader = stmt.columns().length > 0;
  }
  all(parameters: ReadonlyArray<unknown>): unknown[] {
    return this.stmt.all(...toParams(parameters));
  }
  run(parameters: ReadonlyArray<unknown>) {
    const r = this.stmt.run(...toParams(parameters));
    return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
  }
  iterate(parameters: ReadonlyArray<unknown>): IterableIterator<unknown> {
    return this.stmt.iterate(...toParams(parameters)) as IterableIterator<unknown>;
  }
}

export class NodeSqliteDatabase implements SqliteDatabase {
  readonly raw: DatabaseSync;
  constructor(path: string) {
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  }
  close(): void {
    this.raw.close();
  }
  prepare(sql: string): SqliteStatement {
    return new Statement(this.raw.prepare(sql));
  }
}

export function createKysely<DB>(db: NodeSqliteDatabase): Kysely<DB> {
  return new Kysely<DB>({ dialect: new SqliteDialect({ database: db }) });
}
