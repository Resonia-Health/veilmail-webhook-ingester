import type { DatabaseAdapter } from './base.js'
import type { QueryOptions, WebhookEvent } from '../types.js'
import { importModule } from '../utils.js'

/** Minimal interface for a mysql2 connection. */
interface MysqlConnection {
  release(): void
}

/** Minimal interface for the mysql2 Pool we use. */
interface MysqlPool {
  getConnection(): Promise<MysqlConnection>
  execute(sql: string, params?: unknown[]): Promise<[unknown[], unknown]>
  end(): Promise<void>
}

/** Minimal interface for the mysql2/promise module. */
interface MysqlModule {
  default?: { createPool: (opts: { uri: string }) => MysqlPool }
  createPool: (opts: { uri: string }) => MysqlPool
}

/**
 * MySQL adapter using the `mysql2` module.
 * The `mysql2` package is dynamically imported so it remains an optional peer dependency.
 */
export class MysqlAdapter implements DatabaseAdapter {
  private pool: MysqlPool | null = null
  private readonly connectionString: string
  private readonly tableName: string

  constructor(connectionString: string, tableName: string) {
    this.connectionString = connectionString
    this.tableName = tableName
  }

  async connect(): Promise<void> {
    let mysql: MysqlModule
    try {
      mysql = (await importModule('mysql2/promise')) as MysqlModule
    } catch {
      throw new Error(
        'The "mysql2" package is required for MySQL support. Install it with: npm install mysql2',
      )
    }

    const createPool = mysql.default?.createPool ?? mysql.createPool
    this.pool = createPool({ uri: this.connectionString })

    // Verify the connection works
    const connection = await this.pool.getConnection()
    connection.release()
  }

  async createTable(): Promise<void> {
    this.ensureConnected()

    await this.pool!.execute(`
      CREATE TABLE IF NOT EXISTS \`${this.tableName}\` (
        id VARCHAR(255) PRIMARY KEY,
        event_type VARCHAR(255) NOT NULL,
        event_id VARCHAR(255) NOT NULL,
        data JSON NOT NULL,
        created_at DATETIME(3) NOT NULL,
        received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY unique_event_id (event_id),
        INDEX idx_event_type (event_type),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
  }

  async insert(event: WebhookEvent): Promise<void> {
    this.ensureConnected()

    await this.pool!.execute(
      `INSERT IGNORE INTO \`${this.tableName}\` (id, event_type, event_id, data, created_at, received_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.event_type,
        event.event_id,
        JSON.stringify(event.data),
        event.created_at.toISOString().replace('T', ' ').replace('Z', ''),
        event.received_at.toISOString().replace('T', ' ').replace('Z', ''),
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
      conditions.push('event_type = ?')
      params.push(options.type)
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    params.push(limit)
    params.push(offset)

    const [rows] = await this.pool!.execute(
      `SELECT id, event_type, event_id, data, created_at, received_at
       FROM \`${this.tableName}\`
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      params,
    )

    return (rows as Record<string, unknown>[]).map(
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
      throw new Error('MySQL adapter is not connected. Call connect() first.')
    }
  }
}
