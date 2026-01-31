import type { DatabaseConfig } from '../types.js'
import type { DatabaseAdapter } from './base.js'

/**
 * Factory function that creates the appropriate database adapter
 * based on the provided configuration.
 *
 * Database drivers are dynamically imported, so only the driver
 * for your chosen database needs to be installed.
 */
export async function createAdapter(
  config: DatabaseConfig,
  tableName: string = 'veilmail_webhook_events',
): Promise<DatabaseAdapter> {
  switch (config.type) {
    case 'postgres': {
      const { PostgresAdapter } = await import('./postgres.js')
      return new PostgresAdapter(config.url, tableName)
    }
    case 'mysql': {
      const { MysqlAdapter } = await import('./mysql.js')
      return new MysqlAdapter(config.url, tableName)
    }
    case 'sqlite': {
      const { SqliteAdapter } = await import('./sqlite.js')
      return new SqliteAdapter(config.url, tableName)
    }
    default:
      throw new Error(
        `Unsupported database type: "${config.type as string}". Supported types: postgres, mysql, sqlite`,
      )
  }
}

export type { DatabaseAdapter } from './base.js'
