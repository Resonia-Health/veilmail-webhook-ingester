#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DatabaseType, IngesterConfig } from './types.js'
import { createAdapter } from './adapters/index.js'
import { createIngesterServer } from './server.js'

const BANNER = `
╔══════════════════════════════════════════╗
║       VeilMail Webhook Ingester          ║
║       Store webhook events locally       ║
╚══════════════════════════════════════════╝
`

function parseArgs(args: string[]): { configPath?: string } {
  const result: { configPath?: string } = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--config' || arg === '-c') {
      result.configPath = args[i + 1]
      i++
    }
  }
  return result
}

function loadConfigFromFile(filePath: string): Partial<IngesterConfig> {
  try {
    const absolute = resolve(process.cwd(), filePath)
    const content = readFileSync(absolute, 'utf8')
    return JSON.parse(content) as Partial<IngesterConfig>
  } catch (err) {
    console.error(`[webhook-ingester] Failed to load config file: ${filePath}`)
    throw err
  }
}

function loadConfigFromEnv(): IngesterConfig {
  const databaseUrl = process.env.DATABASE_URL
  const databaseType = (process.env.DATABASE_TYPE ?? 'postgres') as DatabaseType
  const webhookSecret = process.env.WEBHOOK_SECRET
  const port = parseInt(process.env.PORT ?? '4000', 10)
  const tableName = process.env.TABLE_NAME ?? 'veilmail_webhook_events'

  if (!databaseUrl) {
    console.error(
      '[webhook-ingester] ERROR: DATABASE_URL environment variable is required.',
    )
    process.exit(1)
  }

  if (!webhookSecret) {
    console.error(
      '[webhook-ingester] ERROR: WEBHOOK_SECRET environment variable is required.',
    )
    process.exit(1)
  }

  if (!['postgres', 'mysql', 'sqlite'].includes(databaseType)) {
    console.error(
      `[webhook-ingester] ERROR: DATABASE_TYPE must be one of: postgres, mysql, sqlite. Got: "${databaseType}"`,
    )
    process.exit(1)
  }

  return {
    port,
    secret: webhookSecret,
    database: {
      type: databaseType,
      url: databaseUrl,
    },
    tableName,
  }
}

function buildConfig(): IngesterConfig {
  const { configPath } = parseArgs(process.argv.slice(2))

  if (configPath) {
    const fileConfig = loadConfigFromFile(configPath)

    const config: IngesterConfig = {
      port: fileConfig.port ?? parseInt(process.env.PORT ?? '4000', 10),
      secret: fileConfig.secret ?? process.env.WEBHOOK_SECRET ?? '',
      database: fileConfig.database ?? {
        type: (process.env.DATABASE_TYPE ?? 'postgres') as DatabaseType,
        url: process.env.DATABASE_URL ?? '',
      },
      tableName: fileConfig.tableName ?? process.env.TABLE_NAME ?? 'veilmail_webhook_events',
    }

    if (!config.database.url) {
      console.error(
        '[webhook-ingester] ERROR: Database URL is required (set in config file or DATABASE_URL env var).',
      )
      process.exit(1)
    }

    if (!config.secret) {
      console.error(
        '[webhook-ingester] ERROR: Webhook secret is required (set in config file or WEBHOOK_SECRET env var).',
      )
      process.exit(1)
    }

    return config
  }

  return loadConfigFromEnv()
}

async function main(): Promise<void> {
  console.log(BANNER)

  const config = buildConfig()

  console.log(`[webhook-ingester] Database type:  ${config.database.type}`)
  console.log(`[webhook-ingester] Table name:     ${config.tableName}`)
  console.log(`[webhook-ingester] Port:           ${config.port}`)
  console.log('')

  // Create and connect the database adapter
  const adapter = await createAdapter(config.database, config.tableName)

  console.log('[webhook-ingester] Connecting to database...')
  await adapter.connect()
  console.log('[webhook-ingester] Connected successfully.')

  console.log('[webhook-ingester] Ensuring table exists...')
  await adapter.createTable()
  console.log('[webhook-ingester] Table ready.')
  console.log('')

  // Start the HTTP server
  const server = createIngesterServer(config, adapter)
  await server.start()

  console.log(`[webhook-ingester] Listening on http://localhost:${config.port}`)
  console.log(`[webhook-ingester] Webhook endpoint: POST http://localhost:${config.port}/webhook`)
  console.log(`[webhook-ingester] Events endpoint:  GET  http://localhost:${config.port}/events`)
  console.log(`[webhook-ingester] Health endpoint:  GET  http://localhost:${config.port}/health`)
  console.log('')
  console.log('[webhook-ingester] Ready to receive VeilMail webhook events.')
  console.log('[webhook-ingester] Press Ctrl+C to stop.')

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log('')
    console.log(`[webhook-ingester] Received ${signal}. Shutting down gracefully...`)
    try {
      await server.stop()
      console.log('[webhook-ingester] Server stopped. Goodbye!')
      process.exit(0)
    } catch (err) {
      console.error('[webhook-ingester] Error during shutdown:', err)
      process.exit(1)
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error('[webhook-ingester] Fatal error:', err)
  process.exit(1)
})
