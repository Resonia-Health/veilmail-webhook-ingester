# @resonia/webhook-ingester

Store VeilMail webhook events in your database. A standalone, zero-dependency package that receives webhook events from VeilMail and persists them to PostgreSQL, MySQL, or SQLite.

## Features

- **Zero runtime dependencies** - uses only Node.js built-in modules
- **Multiple databases** - PostgreSQL, MySQL, and SQLite adapters
- **Webhook verification** - HMAC-SHA256 signature verification
- **CLI and library** - use as a standalone server or integrate programmatically
- **Idempotent** - duplicate events are safely ignored (upsert on event_id)
- **Query API** - built-in HTTP endpoint to query stored events

## Quick Start

### 1. Install

```bash
npm install @resonia/webhook-ingester

# Install the database driver you need (only one required):
npm install pg            # PostgreSQL
npm install mysql2        # MySQL
npm install better-sqlite3  # SQLite
```

### 2. Run the CLI

```bash
# Set environment variables
export DATABASE_URL="postgres://user:password@localhost:5432/veilmail_webhooks"
export DATABASE_TYPE="postgres"
export WEBHOOK_SECRET="whsec_your_secret_here"
export PORT=4000

# Start the ingester
npx veilmail-ingester
```

### 3. Configure VeilMail

In your VeilMail dashboard, set the webhook URL to:

```
http://your-server:4000/webhook
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | - | Database connection string or file path |
| `DATABASE_TYPE` | No | `postgres` | One of: `postgres`, `mysql`, `sqlite` |
| `WEBHOOK_SECRET` | Yes | - | Your VeilMail webhook signing secret |
| `PORT` | No | `4000` | HTTP server port |
| `TABLE_NAME` | No | `veilmail_webhook_events` | Database table name |

## Configuration File

You can also use a JSON config file instead of environment variables:

```bash
npx veilmail-ingester --config config.json
```

```json
{
  "port": 4000,
  "secret": "whsec_your_secret_here",
  "database": {
    "type": "postgres",
    "url": "postgres://user:password@localhost:5432/veilmail_webhooks"
  },
  "tableName": "veilmail_webhook_events"
}
```

## Database Setup

### PostgreSQL

```bash
export DATABASE_URL="postgres://user:password@localhost:5432/veilmail_webhooks"
export DATABASE_TYPE="postgres"
```

The table is created automatically with:
- `id` (TEXT, primary key)
- `event_type` (TEXT, indexed)
- `event_id` (TEXT, unique)
- `data` (JSONB)
- `created_at` (TIMESTAMPTZ, indexed)
- `received_at` (TIMESTAMPTZ)

### MySQL

```bash
export DATABASE_URL="mysql://user:password@localhost:3306/veilmail_webhooks"
export DATABASE_TYPE="mysql"
```

The table is created automatically with:
- `id` (VARCHAR(255), primary key)
- `event_type` (VARCHAR(255), indexed)
- `event_id` (VARCHAR(255), unique)
- `data` (JSON)
- `created_at` (DATETIME(3), indexed)
- `received_at` (DATETIME(3))

### SQLite

```bash
export DATABASE_URL="./webhooks.db"
export DATABASE_TYPE="sqlite"
```

The table is created automatically with:
- `id` (TEXT, primary key)
- `event_type` (TEXT, indexed)
- `event_id` (TEXT, unique)
- `data` (TEXT, stored as JSON string)
- `created_at` (TEXT, ISO 8601)
- `received_at` (TEXT, ISO 8601)

## Docker Compose Example

```yaml
version: "3.8"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: veilmail
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: veilmail_webhooks
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  ingester:
    image: node:20-alpine
    working_dir: /app
    command: npx @resonia/webhook-ingester
    environment:
      DATABASE_URL: postgres://veilmail:secret@postgres:5432/veilmail_webhooks
      DATABASE_TYPE: postgres
      WEBHOOK_SECRET: whsec_your_secret_here
      PORT: "4000"
    ports:
      - "4000:4000"
    depends_on:
      - postgres

volumes:
  pgdata:
```

## API Endpoints

### POST /webhook

Receive and store a webhook event from VeilMail.

**Headers:**
- `x-veilmail-signature` (required) - HMAC-SHA256 hex signature of the request body

**Body:** The raw JSON event payload from VeilMail.

**Response:**
```json
{ "received": true, "id": "550e8400-e29b-41d4-a716-446655440000" }
```

### GET /health

Health check endpoint.

**Response:**
```json
{ "status": "ok", "timestamp": "2025-01-01T00:00:00.000Z", "database": "postgres" }
```

### GET /events

Query stored webhook events.

**Query Parameters:**
| Param | Type | Default | Description |
|---|---|---|---|
| `type` | string | - | Filter by event type (e.g. `email.delivered`) |
| `limit` | number | `50` | Max results (1-1000) |
| `offset` | number | `0` | Skip N results |

**Response:**
```json
{
  "events": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "event_type": "email.delivered",
      "event_id": "evt_abc123",
      "data": { "type": "email.delivered", "email_id": "em_xyz" },
      "created_at": "2025-01-01T00:00:00.000Z",
      "received_at": "2025-01-01T00:00:01.000Z"
    }
  ],
  "count": 1
}
```

## Programmatic Usage

Use the package as a library in your own Node.js application:

```typescript
import {
  createAdapter,
  createIngesterServer,
  verifyWebhookSignature,
} from '@resonia/webhook-ingester'

// Create a database adapter
const adapter = await createAdapter({
  type: 'postgres',
  url: 'postgres://user:password@localhost:5432/veilmail_webhooks',
})

// Connect and set up the table
await adapter.connect()
await adapter.createTable()

// Option A: Start the built-in HTTP server
const server = createIngesterServer(
  {
    port: 4000,
    secret: 'whsec_your_secret',
    database: { type: 'postgres', url: '...' },
    tableName: 'veilmail_webhook_events',
  },
  adapter,
)
await server.start()

// Option B: Use the adapter directly in your own server
import { randomUUID } from 'node:crypto'

app.post('/webhook', async (req, res) => {
  const isValid = verifyWebhookSignature(
    req.rawBody,
    req.headers['x-veilmail-signature'],
    'whsec_your_secret',
  )

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  await adapter.insert({
    id: randomUUID(),
    event_type: req.body.type,
    event_id: req.body.id,
    data: req.body,
    created_at: new Date(req.body.created_at),
    received_at: new Date(),
  })

  res.json({ received: true })
})

// Query stored events
const events = await adapter.query({
  type: 'email.delivered',
  limit: 10,
  offset: 0,
})

// Clean up
await adapter.close()
```

## VeilMail Webhook Events

VeilMail sends the following webhook event types:

| Event Type | Description |
|---|---|
| `email.sent` | Email accepted for delivery |
| `email.delivered` | Email delivered to recipient |
| `email.bounced` | Email bounced |
| `email.complained` | Recipient marked as spam |
| `email.opened` | Email was opened |
| `email.clicked` | Link in email was clicked |
| `contact.created` | New contact added |
| `contact.updated` | Contact information updated |
| `contact.unsubscribed` | Contact unsubscribed |

## License

MIT
