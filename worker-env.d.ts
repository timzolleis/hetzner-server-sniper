// Ambient augmentation of the wrangler-generated global `Env` interface (see
// `worker-configuration.d.ts`) with the secret bindings that are intentionally
// NOT declared in `wrangler.jsonc`. Set them with `wrangler secret put <NAME>`
// in production and in `.dev.vars` for local `wrangler dev`.
//
// This file is a global script (no imports/exports) so the declarations merge
// into the global `interface Env`.
interface Env {
  /** Hetzner Cloud API token. A read-only token is sufficient. (required) */
  readonly HETZNER_API_TOKEN: string
  /** Shared bearer token required by every management API endpoint. (required) */
  readonly API_BEARER_TOKEN: string

  // ── Notification channels — configure at least one ──

  /** Resend API key (e-mail channel). */
  readonly RESEND_API_KEY?: string
  /** Default recipient for the e-mail channel. */
  readonly NOTIFICATION_EMAIL?: string
  /** Sender address for the e-mail channel; must be on a Resend-verified domain. */
  readonly RESEND_FROM_EMAIL?: string
  /** Destination URL for the generic webhook channel. */
  readonly WEBHOOK_URL?: string
  /** Optional shared secret; signs webhook bodies with X-Sniper-Signature. */
  readonly WEBHOOK_SECRET?: string
}
