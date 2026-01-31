import type { DatabaseAdapter } from './base.js'
import type { QueryOptions, WebhookEvent } from '../types.js'
import { importModule } from '../utils.js'

/** Minimal interface for the pg Pool we use. */
interface PgPool {
  connect(): Promise<{ release(): void }>
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  end(): Promise<void>
}

/** Minimal interface for the pg module. */
interface PgModule {
  default?: { Pool: new (opts: { connectionString: string }) => PgPool }
  Pool: new (opts: { connectionString: string }) => PgPool
}

/**
 * PostgreSQL adapter using the `pg` module.
 * The `pg` package is dynamically imported so it remains an optional peer dependency.
 */
export class PostgresAdapter implements DatabaseAdapter {
  private pool: PgPool | null = null
  private readonly connectionString: string
  private readonly tableName: string

  constructor(connectionString: string, tableName: string) {
    this.connectionString = connectionString
    this.tableName = tableName
  }

  async connect(): Promise<void> {
    let pg: PgModule
    try {
      pg = (await importModule('pg')) as PgModule
    } catch {
      throw new Error(
        'The "pg" package is required for PostgreSQL support. Install it with: npm install pg',
      )
    }

    const Pool = pg.default?.Pool ?? pg.Pool
    this.pool = new Pool({ connectionString: this.connectionString })

    // Verify the connection works
    const client = await this.pool.connect()
    client.release()
  }

  async createTable(): Promise<void> {
    this.ensureConnected()

    await this.pool!.query(`
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        event_id TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (event_id)
      )
    `)

    await this.pool!.query(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_event_type"
        ON "${this.tableName}" (event_type)
    `)

    await this.pool!.query(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_created_at"
        ON "${this.tableName}" (created_at DESC)
    `)
  }

  async insert(event: WebhookEvent): Promise<void> {
    this.ensureConnected()

    await this.pool!.query(
      `INSERT INTO "${this.tableName}" (id, event_type, event_id, data, created_at, received_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        event.id,
        event.event_type,
        event.event_id,
        JSON.stringify(event.data),
        event.created_at.toISOString(),
        event.received_at.toISOString(),
      ],
    )
  }

  async query(options?: QueryOptions): Promise<WebhookEvent[]> {
    this.ensureConnected()

    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0
    const conditions: string[] = []
    const params: unknown[] = []

    if (options?.type) {
      params.push(options.type)
      conditions.push(`event_type = $${params.length}`)
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    params.push(limit)
    const limitParam = `$${params.length}`
    params.push(offset)
    const offsetParam = `$${params.length}`

    const result = await this.pool!.query(
      `SELECT id, event_type, event_id, data, created_at, received_at
       FROM "${this.tableName}"
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params,
    )

    return result.rows.map(
      (row): WebhookEvent => ({
        id: row.id as string,
        event_type: row.event_type as string,
        event_id: row.event_id as string,
        data: (typeof row.data === 'string'
          ? JSON.parse(row.data as string)
          : row.data) as Record<string, unknown>,
        created_at: new Date(row.created_at as string),
        received_at: new Date(row.received_at as string),
      }),
    )
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end()
      this.pool = null
    }
  }

  private ensureConnected(): void {
    if (!this.pool) {
      throw new Error(
        'PostgreSQL adapter is not connected. Call connect() first.',
      )
    }
  }
}
