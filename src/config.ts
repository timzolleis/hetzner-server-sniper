import { Context, Effect, Layer, Redacted } from "effect"
import { CloudflareEnv } from "./env"
import { ConfigError } from "./errors"

const numberFrom = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Validated application configuration derived from the Cloudflare bindings.
 * Secrets are kept `Redacted` so they are never accidentally logged or traced.
 */
export class AppConfig extends Context.Service<
  AppConfig,
  {
    readonly hetznerToken: Redacted.Redacted<string>
    readonly resendApiKey: Redacted.Redacted<string>
    readonly notificationEmail: string
    readonly fromEmail: string
    readonly pollIntervalMs: number
    readonly serverTypeCacheTtlMs: number
    readonly rateLimitPerHour: number
  }
>()("app/AppConfig") {
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const { env } = yield* CloudflareEnv

      const missing: Array<string> = []
      const required = (value: string, name: string): string => {
        if (!value) missing.push(name)
        return value
      }

      const hetznerToken = required(env.HETZNER_API_TOKEN, "HETZNER_API_TOKEN")
      const resendApiKey = required(env.RESEND_API_KEY, "RESEND_API_KEY")
      const notificationEmail = required(env.NOTIFICATION_EMAIL, "NOTIFICATION_EMAIL")
      const fromEmail = required(env.RESEND_FROM_EMAIL, "RESEND_FROM_EMAIL")

      if (missing.length > 0) {
        return yield* new ConfigError({
          message: `Missing required configuration: ${missing.join(", ")}`,
        })
      }

      return {
        hetznerToken: Redacted.make(hetznerToken),
        resendApiKey: Redacted.make(resendApiKey),
        notificationEmail,
        fromEmail,
        pollIntervalMs: numberFrom(env.POLL_INTERVAL_SECONDS, 30) * 1000,
        serverTypeCacheTtlMs: numberFrom(env.SERVER_TYPE_CACHE_TTL_SECONDS, 3600) * 1000,
        rateLimitPerHour: numberFrom(env.HETZNER_RATE_LIMIT_PER_HOUR, 3600),
      }
    }),
  )
}
