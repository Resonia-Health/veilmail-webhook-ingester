import type { QueryOptions, WebhookEvent } from '../types.js'

/** Interface that all database adapters must implement. */
export interface DatabaseAdapter {
  /** Establish a connection to the database. */
  connect(): Promise<void>

  /** Create the webhook events table if it does not already exist. */
  createTable(): Promise<void>

  /** Insert a single webhook event into the database. */
  insert(event: WebhookEvent): Promise<void>

  /** Query stored webhook events with optional filtering. */
  query(options?: QueryOptions): Promise<WebhookEvent[]>

  /** Close the database connection and release resources. */
  close(): Promise<void>
}
