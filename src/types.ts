/** A VeilMail webhook event received from the API. */
export interface WebhookEvent {
  /** Unique identifier for this stored event record. */
  id: string
  /** The webhook event type (e.g. 'email.delivered', 'email.bounced'). */
  event_type: string
  /** The original event ID from VeilMail. */
  event_id: string
  /** The full event payload data. */
  data: Record<string, unknown>
  /** When the event originally occurred (from VeilMail). */
  created_at: Date
  /** When the event was received and stored by this ingester. */
  received_at: Date
}

/** Supported database types for the ingester. */
export type DatabaseType = 'postgres' | 'mysql' | 'sqlite'

/** Database connection configuration. */
export interface DatabaseConfig {
  /** The type of database to connect to. */
  type: DatabaseType
  /** Connection string (e.g. postgres://user:pass@host/db) or file path for SQLite. */
  url: string
}

/** Full configuration for the webhook ingester. */
export interface IngesterConfig {
  /** Port to listen on for incoming webhooks. Defaults to 4000. */
  port: number
  /** Shared secret for HMAC-SHA256 webhook signature verification. */
  secret: string
  /** Database connection configuration. */
  database: DatabaseConfig
  /** Name of the table to store events in. Defaults to 'veilmail_webhook_events'. */
  tableName: string
}

/** Options for querying stored webhook events. */
export interface QueryOptions {
  /** Filter by event type. */
  type?: string
  /** Maximum number of results to return. Defaults to 50. */
  limit?: number
  /** Number of results to skip. Defaults to 0. */
  offset?: number
}
