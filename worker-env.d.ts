// Ambient augmentation of the wrangler-generated global `Env` interface (see
// `worker-configuration.d.ts`) with the secret bindings that are intentionally
// NOT declared in `wrangler.jsonc`. Set them with `wrangler secret put <NAME>`
// in production and in `.dev.vars` for local `wrangler dev`.
//
// This file is a global script (no imports/exports) so the declarations merge
// into the global `interface Env`.
interface Env {
  /** Hetzner Cloud API token. A read-only token is sufficient. */
  readonly HETZNER_API_TOKEN: string
  /** Resend API key used to send availability notifications. */
  readonly RESEND_API_KEY: string
  /** Shared bearer token required by every management API endpoint. */
  readonly API_BEARER_TOKEN: string
  /** Default recipient for availability notifications. */
  readonly NOTIFICATION_EMAIL: string
  /** Sender address; must be on a Resend-verified domain. */
  readonly RESEND_FROM_EMAIL: string
}
