# hetzner-server-sniper

An [Effect](https://effect.website) v4 application on **Cloudflare Workers** that
watches for **Hetzner Cloud** server-type availability and notifies you (via
[Resend](https://resend.com)) the moment a server you want becomes orderable.

You register "server requests" — _"tell me when `cx22` is available (optionally in
`fsn1`)"_ — through a small bearer-authenticated HTTP API. A single Durable Object
polls Hetzner every 30 seconds, and as soon as a requested server type appears in
a datacenter's availability set it marks the request fulfilled and e-mails you.

## Deploy to your own Cloudflare account

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/timzolleis/hetzner-server-sniper)

One click clones this repo to your GitHub, provisions the Worker + the
SQLite-backed Durable Object, wires up CI (Workers Builds), and **prompts you for
the five values you must supply** — `HETZNER_API_TOKEN`, `RESEND_API_KEY`,
`API_BEARER_TOKEN`, `NOTIFICATION_EMAIL`, `RESEND_FROM_EMAIL` (stored as Worker
secrets). The polling/TTL/rate-limit knobs ship with sane defaults. Durable
Objects require the Workers Free plan or above (SQLite DOs are included on Free).

## How it works

```
client ──HTTP (Bearer)──▶  Worker (src/index.ts)  ──RPC──▶  SniperDurableObject
                            thin plain-TS edge                 │  (one global instance)
                                                               │
                                            ┌──────────────────┴───────────────────┐
                                            │ Effect runtime (ManagedRuntime)        │
                                            │  • RequestStore   → DO SQLite          │
                                            │  • RateLimiter    → DO KV (token bucket)│
                                            │  • AvailabilityService → Hetzner API   │
                                            │  • EmailService   → Resend API         │
                                            │  • alarm() every 30s drives SniperService.tick() │
                                            └────────────────────────────────────────┘
```

- **Why a Durable Object?** Cloudflare cron triggers have a 1-minute floor. The DO
  `alarm()` gives a precise 30-second loop, serializes all polling (so the Hetzner
  rate-limit budget is genuinely shared across every request), and holds all state
  in one place. The alarm only runs while pending requests exist, and pending
  requests older than `REQUEST_TTL_DAYS` (default 30) are auto-evicted to
  `expired` so a stale request can't keep the loop running forever. A request's
  `status` is `pending` → `fulfilled` | `cancelled` | `expired`.
- **Availability** is read from Hetzner's `GET /datacenters`: a server type is
  "available" when its id appears in some datacenter's `server_types.available`.
  The valid server-type **names** come from `GET /server_types` and are cached for
  an hour (used to validate new requests).
- **Rate limit:** one availability snapshot is fetched per tick (≈120 calls/hour),
  plus the hourly name refresh — far below the 3600/hour budget, which is still
  enforced by a persisted token bucket.

## API

All endpoints except `GET /health` require `Authorization: Bearer $API_BEARER_TOKEN`.

| Method & path          | Body                                   | Description                          |
| ---------------------- | -------------------------------------- | ------------------------------------ |
| `GET /health`          | —                                      | Liveness check (unauthenticated).    |
| `POST /requests`       | `{ serverType, location?, email? }`    | Create a request. `201` on success.  |
| `GET /requests`        | —                                      | List all requests.                   |
| `GET /requests/:id`    | —                                      | Fetch one request.                   |
| `DELETE /requests/:id` | —                                      | Cancel a request.                    |
| `GET /server-types`    | —                                      | List currently-known server-type names. |

`serverType` is a Hetzner Cloud server-type name (e.g. `cx22`, `cax11`). `location`
is optional (e.g. `fsn1`, `nbg1`, `hel1`); omit it to match any location. `email`
defaults to `NOTIFICATION_EMAIL`.

```bash
curl -X POST https://<your-worker>/requests \
  -H "Authorization: Bearer $API_BEARER_TOKEN" \
  -H "content-type: application/json" \
  -d '{ "serverType": "cax11", "location": "fsn1" }'
```

## Configuration

**Secrets** — prompted by the deploy button; otherwise set with
`wrangler secret put <NAME>` (or in `.dev.vars` for local dev):

| Secret               | Description                                            |
| -------------------- | ----------------------------------------------------- |
| `HETZNER_API_TOKEN`  | Hetzner Cloud API token (read-only is enough).        |
| `RESEND_API_KEY`     | Resend API key.                                        |
| `API_BEARER_TOKEN`   | Shared secret required by the management API.          |
| `NOTIFICATION_EMAIL` | Default recipient for notifications.                  |
| `RESEND_FROM_EMAIL`  | Sender; **must** be on a domain verified in Resend.   |

**Vars** (defaults in `wrangler.jsonc`, no action needed):

| Variable                        | Default | Description                                                   |
| ------------------------------- | ------- | ------------------------------------------------------------ |
| `POLL_INTERVAL_SECONDS`         | `30`    | Poll cadence.                                                |
| `REQUEST_TTL_DAYS`              | `30`    | Pending requests older than this are auto-evicted (`expired`).|
| `SERVER_TYPE_CACHE_TTL_SECONDS` | `3600`  | How long the server-type-name cache is reused.               |
| `HETZNER_RATE_LIMIT_PER_HOUR`   | `3600`  | Token-bucket capacity / refill (per hour) for Hetzner calls. |

## Development

```bash
npm install
cp .dev.vars.example .dev.vars   # then fill it in
npm run dev                      # wrangler dev (local DO + SQLite)
npm test                         # @effect/vitest unit tests
npm run typecheck                # tsc --noEmit
```

## Deploy

Easiest is the [Deploy to Cloudflare](#deploy-to-your-own-cloudflare-account)
button above. To deploy manually from a clone:

```bash
wrangler secret put HETZNER_API_TOKEN
wrangler secret put RESEND_API_KEY
wrangler secret put API_BEARER_TOKEN
wrangler secret put NOTIFICATION_EMAIL
wrangler secret put RESEND_FROM_EMAIL
npm run deploy
```

After changing `wrangler.jsonc`, regenerate types with `npm run cf-typegen`.
