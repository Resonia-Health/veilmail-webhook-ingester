import type { DatabaseAdapter } from './base.js'
import type { QueryOptions, WebhookEvent } from '../types.js'
import { importModule } from '../utils.js'

/** Minimal interface for a better-sqlite3 prepared statement. */
interface SqliteStatement {
  run(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

/** Minimal interface for a better-sqlite3 Database instance. */
interface SqliteDatabase {
  pragma(pragma: string): unknown
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

/**
 * SQLite adapter using the `better-sqlite3` module.
 * The `better-sqlite3` package is dynamically imported so it remains an optional peer dependency.
 */
export class SqliteAdapter implements DatabaseAdapter {
  private db: SqliteDatabase | null = null
  private readonly filePath: string
  private readonly tableName: string

  constructor(filePath: string, tableName: string) {
    this.filePath = filePath
    this.tableName = tableName
  }

  async connect(): Promise<void> {
    let BetterSqlite3: { default?: unknown; new?(path: string): SqliteDatabase }
    try {
      BetterSqlite3 = (await importModule('better-sqlite3')) as typeof BetterSqlite3
    } catch {
      throw new Error(
        'The "better-sqlite3" package is required for SQLite support. Install it with: npm install better-sqlite3',
      )
    }

    const Database = (BetterSqlite3.default ?? BetterSqlite3) as unknown as new (
      path: string,
    ) => SqliteDatabase
    this.db = new Database(this.filePath)

    // Enable WAL mode for better concurrent access
    this.db.pragma('journal_mode = WAL')
  }

  async createTable(): Promise<void> {
    this.ensureConnected()

    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        received_at TEXT NOT NULL
      )
    `)

    this.db!.exec(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_event_type"
        ON "${this.tableName}" (event_type)
    `)

    this.db!.exec(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_created_at"
        ON "${this.tableName}" (created_at DESC)
    `)
  }

  async insert(event: WebhookEvent): Promise<void> {
    this.ensureConnected()

    const stmt = this.db!.prepare(`
      INSERT OR IGNORE INTO "${this.tableName}" (id, event_type, event_id, data, created_at, received_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      event.id,
      event.event_type,
      event.event_id,
      JSON.stringify(event.data),
      event.created_at.toISOString(),
      event.received_at.toISOString(),
    )
  }

  async query(options?: QueryOptions): Promise<WebhookEvent[]> {
    this.ensureConnected()

    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0
    const conditions: string[] = []
    const params: unknown[] = []

    if (options?.type) {
      conditions.push('event_type = ?')
      params.push(options.type)
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    params.push(limit)
    params.push(offset)

    const stmt = this.db!.prepare(`
      SELECT id, event_type, event_id, data, created_at, received_at
      FROM "${this.tableName}"
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)

    const rows = stmt.all(...params) as Record<string, unknown>[]

    return rows.map(
      (row): WebhookEvent => ({
        id: row.id as string,
        event_type: row.event_type as string,
        event_id: row.event_id as string,
        data: JSON.parse(row.data as string) as Record<string, unknown>,
        created_at: new Date(row.created_at as string),
        received_at: new Date(row.received_at as string),
      }),
    )
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  private ensureConnected(): void {
    if (!this.db) {
      throw new Error('SQLite adapter is not connected. Call connect() first.')
    }
  }
}
