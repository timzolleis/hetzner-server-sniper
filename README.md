# hetzner-server-sniper

An [Effect](https://effect.website) v4 application on **Cloudflare Workers** that
watches **Hetzner Cloud** server-type availability and notifies you the moment a
server you want becomes orderable.

You register "server requests" — _"tell me when `cx22` is available (optionally in
`fsn1`)"_ — over a small bearer-authenticated HTTP API (with an auto-generated
OpenAPI spec and an interactive reference at `/docs`). A single Durable Object
polls Hetzner every 30 seconds; as soon as a requested server type appears in a
datacenter's availability set it marks the request fulfilled and notifies you by
**e-mail (Resend) or webhook**.

## Setup

### 1. Gather what you need

You'll need a **Cloudflare account** on the Workers Free plan or above (SQLite
Durable Objects are included on Free), plus:

- **A Hetzner Cloud API token** — Hetzner Cloud Console → your project →
  **Security → API Tokens → Generate**. A **read-only** token is enough.
- **A bearer token** — any long random string (e.g. `openssl rand -hex 32`).
  Callers send it as `Authorization: Bearer …` to use the API.
- **At least one notification channel:**
  - **E-mail (Resend)** — create a [Resend](https://resend.com) account,
    **verify a sending domain**, and create an API key.
  - **Webhook** — any URL that accepts a `POST` (no extra account needed).

### 2. Deploy

**One click** — clones the repo to your GitHub, provisions the Worker + Durable
Object, wires up CI (Workers Builds), and prompts you for the secrets:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/timzolleis/hetzner-server-sniper)

> Fill in `HETZNER_API_TOKEN`, `API_BEARER_TOKEN`, and **one** channel; leave the
> other channel's fields blank to disable it. The poll/TTL/rate-limit knobs ship
> with sane defaults.

**Or manually**, from a clone:

```bash
npm install
wrangler secret put HETZNER_API_TOKEN
wrangler secret put API_BEARER_TOKEN

# …then ONE channel — e-mail via Resend:
wrangler secret put RESEND_API_KEY
wrangler secret put NOTIFICATION_EMAIL
wrangler secret put RESEND_FROM_EMAIL
# …or a webhook:
wrangler secret put WEBHOOK_URL

npm run deploy
```

### 3. Verify

```bash
curl https://<your-worker>/health          # → {"status":"ok"}

curl -X POST https://<your-worker>/requests \
  -H "Authorization: Bearer $API_BEARER_TOKEN" \
  -H "content-type: application/json" \
  -d '{ "serverType": "cax11", "location": "fsn1" }'
```

Then open `https://<your-worker>/docs` for the interactive API reference.

## API

The API is defined with Effect's `HttpApi`, so the routes, request/response
schemas and bearer security below are generated, not hand-maintained: the OpenAPI
spec is served at `GET /openapi.json` and an interactive
[Scalar](https://scalar.com) reference at `GET /docs`.

Every endpoint requires `Authorization: Bearer $API_BEARER_TOKEN` except
`GET /health`, `GET /docs` and `GET /openapi.json`, which are public.

| Method & path          | Body                                | Description                              |
| ---------------------- | ----------------------------------- | ---------------------------------------- |
| `GET /health`          | —                                   | Liveness check.                          |
| `GET /docs`            | —                                   | Interactive Scalar API reference.        |
| `GET /openapi.json`    | —                                   | OpenAPI 3 spec.                          |
| `POST /requests`       | `{ serverType, location?, email? }` | Create a request. `201` on success.      |
| `GET /requests`        | —                                   | List all requests.                       |
| `GET /requests/:id`    | —                                   | Fetch one request.                       |
| `DELETE /requests/:id` | —                                   | Cancel a request.                        |
| `GET /server-types`    | —                                   | List currently-known server-type names.  |

`serverType` is a Hetzner Cloud server-type name (e.g. `cx22`, `cax11`).
`location` is optional (e.g. `fsn1`, `nbg1`, `hel1`); omit it to match any
location. `email` overrides `NOTIFICATION_EMAIL` for that one request.

Failures come back as a tagged JSON body with the matching status — e.g. an
unknown server type is `422 { "_tag": "ServerTypeNotFound", "serverType": "…",
"message": "…" }`; others include `404 RequestNotFound`, `401 Unauthorized`, and
`500 InternalError`.

## Configuration

**Secrets** — set with `wrangler secret put <NAME>` (or in `.dev.vars` for local
dev). Configure **at least one** notification channel.

| Secret               | Required  | Description                                            |
| -------------------- | --------- | ------------------------------------------------------ |
| `HETZNER_API_TOKEN`  | ✅ yes    | Hetzner Cloud API token (read-only is enough).         |
| `API_BEARER_TOKEN`   | ✅ yes    | Shared secret callers send as `Authorization: Bearer`. |
| `RESEND_API_KEY`     | e-mail    | Resend API key.                                        |
| `NOTIFICATION_EMAIL` | e-mail    | Default notification recipient.                        |
| `RESEND_FROM_EMAIL`  | e-mail    | Sender; **must** be on a Resend-verified domain.       |
| `WEBHOOK_URL`        | webhook   | Receives a JSON `POST` on each fulfilment.             |
| `WEBHOOK_SECRET`     | optional  | Signs webhook bodies with `X-Sniper-Signature: sha256=…`. |

The e-mail channel needs all three of its fields together; the webhook channel
needs only `WEBHOOK_URL`. Set either, or both.

**Vars** (defaults in `wrangler.jsonc`, no action needed):

| Variable                        | Default | Description                                                    |
| ------------------------------- | ------- | -------------------------------------------------------------- |
| `POLL_INTERVAL_SECONDS`         | `30`    | Poll cadence.                                                  |
| `REQUEST_TTL_DAYS`              | `30`    | Pending requests older than this are auto-evicted (`expired`). |
| `SERVER_TYPE_CACHE_TTL_SECONDS` | `3600`  | How long the server-type-name cache is reused.                 |
| `HETZNER_RATE_LIMIT_PER_HOUR`   | `3600`  | Token-bucket capacity / refill (per hour) for Hetzner calls.   |

## How it works

```
client ──HTTP (Bearer)──▶  Worker edge (src/http/)  ──RPC──▶  SniperDurableObject
                           Effect HttpApi + OpenAPI / Scalar       (one global instance)
```

The Worker edge is an Effect `HttpApi` that authenticates, validates, and RPCs
into one Durable Object. The DO holds all state and runs a single Effect runtime
(built once), driven by an `alarm()` loop:

- **RequestStore** → Durable Object SQLite
- **RateLimiter** → persisted token bucket (a Hetzner budget shared across all requests)
- **AvailabilityService** → Hetzner Cloud API
- **Notifier** → Resend e-mail / outbound webhook
- **`alarm()` every 30 s** → `SniperService.tick()`

- **Why a Durable Object?** Cloudflare cron triggers have a 1-minute floor. The DO
  `alarm()` gives a precise 30-second loop, serializes all polling (so the Hetzner
  rate-limit budget is genuinely shared), and holds all state in one place. The
  alarm only runs while pending requests exist, and pending requests older than
  `REQUEST_TTL_DAYS` are auto-evicted to `expired` so a stale request can't keep
  the loop running forever. A request's `status` is `pending` → `fulfilled` |
  `cancelled` | `expired`.
- **Availability** is read from Hetzner's `GET /datacenters`: a server type is
  "available" when its id appears in some datacenter's `server_types.available`.
  The valid server-type **names** come from `GET /server_types` and are cached for
  an hour (used to validate new requests).
- **Rate limit:** one availability snapshot is fetched per tick (≈120 calls/hour),
  plus the hourly name refresh — far below the 3600/hour budget, which is still
  enforced by the persisted token bucket.

## Development

```bash
npm install
cp .dev.vars.example .dev.vars   # then fill it in
npm run dev                      # wrangler dev (local DO + SQLite)
npm test                         # @effect/vitest unit tests
npm run typecheck                # tsc --noEmit
npm run cf-typegen               # regenerate types after editing wrangler.jsonc
```
