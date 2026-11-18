// Minimal typings for the Node built-ins used by the tests (the project compiles against Workers types).
declare module 'node:sqlite' {
  export class StatementSync {
    all(...params: unknown[]): Record<string, unknown>[];
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
declare module 'node:fs' {
  export function readFileSync(path: URL | string, encoding: 'utf8'): string;
}
interface ImportMeta {
  readonly url: string;
}
