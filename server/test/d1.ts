// Tiny D1 stand-in over node:sqlite, so the real SQL in src/ runs in tests (same SQLite dialect as D1).
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

class Stmt {
  params: unknown[] = [];
  constructor(
    readonly db: DatabaseSync,
    readonly sql: string,
  ) {}
  bind(...params: unknown[]): Stmt {
    const s = new Stmt(this.db, this.sql);
    s.params = params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p));
    return s;
  }
  exec() {
    const st = this.db.prepare(this.sql);
    if (/^\s*(SELECT|WITH)/i.test(this.sql)) {
      return { results: st.all(...this.params).map((r) => ({ ...r })), success: true, meta: {} };
    }
    const r = st.run(...this.params);
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  }
  async all() {
    return this.exec();
  }
  async run() {
    return this.exec();
  }
  async first() {
    return this.exec().results[0] ?? null;
  }
}

export function createTestDb(): { db: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  const db = {
    prepare: (sql: string) => new Stmt(raw, sql),
    async batch(stmts: Stmt[]) {
      raw.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.exec());
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { db: db as unknown as D1Database, raw };
}
