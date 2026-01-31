import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { DatabaseAdapter } from './adapters/base.js'
import type { IngesterConfig, WebhookEvent } from './types.js'
import { verifyWebhookSignature } from './webhook-verifier.js'

/** Read the full request body as a string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Send a JSON response. */
function sendJson(
  res: ServerResponse,
  statusCode: number,
  data: unknown,
): void {
  const body = JSON.stringify(data)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** Parse the URL path and query string. */
function parseUrl(url: string | undefined): { path: string; query: URLSearchParams } {
  const parsed = new URL(url ?? '/', 'http://localhost')
  return { path: parsed.pathname, query: parsed.searchParams }
}

export interface WebhookIngesterServer {
  /** Start listening on the configured port. */
  start(): Promise<void>
  /** Gracefully shut down the server and close the database connection. */
  stop(): Promise<void>
}

/**
 * Create a webhook ingester HTTP server.
 *
 * The server provides the following endpoints:
 * - `POST /webhook` - Receive and store webhook events
 * - `GET /health`   - Health check
 * - `GET /events`   - Query stored events (supports `type`, `limit`, `offset` params)
 */
export function createIngesterServer(
  config: IngesterConfig,
  adapter: DatabaseAdapter,
): WebhookIngesterServer {
  const server = createHttpServer(async (req, res) => {
    const method = req.method?.toUpperCase() ?? 'GET'
    const { path, query } = parseUrl(req.url)

    try {
      // --- Health check ---
      if (method === 'GET' && path === '/health') {
        sendJson(res, 200, {
          status: 'ok',
          timestamp: new Date().toISOString(),
          database: config.database.type,
        })
        return
      }

      // --- Query events ---
      if (method === 'GET' && path === '/events') {
        const type = query.get('type') ?? undefined
        const limit = query.has('limit')
          ? Math.min(Math.max(parseInt(query.get('limit')!, 10) || 50, 1), 1000)
          : 50
        const offset = query.has('offset')
          ? Math.max(parseInt(query.get('offset')!, 10) || 0, 0)
          : 0

        const events = await adapter.query({ type, limit, offset })
        sendJson(res, 200, { events, count: events.length })
        return
      }

      // --- Receive webhook ---
      if (method === 'POST' && path === '/webhook') {
        const body = await readBody(req)

        // Verify signature
        const signature = req.headers['x-veilmail-signature'] as string | undefined
        if (!signature) {
          sendJson(res, 401, { error: 'Missing x-veilmail-signature header' })
          return
        }

        if (!verifyWebhookSignature(body, signature, config.secret)) {
          sendJson(res, 401, { error: 'Invalid webhook signature' })
          return
        }

        // Parse the event payload
        let payload: Record<string, unknown>
        try {
          payload = JSON.parse(body) as Record<string, unknown>
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON payload' })
          return
        }

        const event: WebhookEvent = {
          id: randomUUID(),
          event_type: (payload.type as string) ?? 'unknown',
          event_id: (payload.id as string) ?? randomUUID(),
          data: payload,
          created_at: payload.created_at
            ? new Date(payload.created_at as string)
            : new Date(),
          received_at: new Date(),
        }

        await adapter.insert(event)

        sendJson(res, 200, { received: true, id: event.id })
        return
      }

      // --- 404 fallback ---
      sendJson(res, 404, { error: 'Not found' })
    } catch (err) {
      console.error('[webhook-ingester] Request error:', err)
      sendJson(res, 500, { error: 'Internal server error' })
    }
  })

  return {
    start() {
      return new Promise<void>((resolve) => {
        server.listen(config.port, () => {
          resolve()
        })
      })
    },

    stop() {
      return new Promise<void>((resolve, reject) => {
        server.close(async (err) => {
          if (err) {
            reject(err)
            return
          }
          try {
            await adapter.close()
            resolve()
          } catch (closeErr) {
            reject(closeErr)
          }
        })
      })
    },
  }
}
