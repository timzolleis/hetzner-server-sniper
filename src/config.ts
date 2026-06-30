import { Context, Effect, Layer, Option, Redacted } from "effect"
import { CloudflareEnv } from "./env"
import { ConfigError } from "./errors"

const numberFrom = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const trimmed = (raw: string | undefined): string => (raw ?? "").trim()

/** Configuration for the e-mail (Resend) notification channel. */
export interface EmailConfig {
  readonly apiKey: Redacted.Redacted<string>
  readonly from: string
  /** Default recipient when a request does not specify its own. */
  readonly defaultTo: string
}

/** Configuration for the generic outbound-webhook notification channel. */
export interface WebhookConfig {
  readonly url: Redacted.Redacted<string>
  /** When present, requests are signed with `X-Sniper-Signature: sha256=…`. */
  readonly signingSecret: Option.Option<Redacted.Redacted<string>>
}

/**
 * Validated application configuration derived from the Cloudflare bindings.
 * Secrets are kept `Redacted` so they are never accidentally logged or traced.
 * At least one notification channel must be configured.
 */
export class AppConfig extends Context.Service<
  AppConfig,
  {
    readonly hetznerToken: Redacted.Redacted<string>
    readonly email: Option.Option<EmailConfig>
    readonly webhook: Option.Option<WebhookConfig>
    readonly pollIntervalMs: number
    readonly serverTypeCacheTtlMs: number
    readonly rateLimitPerHour: number
    readonly requestTtlMs: number
  }
>()("app/AppConfig") {
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const { env } = yield* CloudflareEnv

      const hetznerToken = trimmed(env.HETZNER_API_TOKEN)
      const resendApiKey = trimmed(env.RESEND_API_KEY)
      const notificationEmail = trimmed(env.NOTIFICATION_EMAIL)
      const fromEmail = trimmed(env.RESEND_FROM_EMAIL)
      const webhookUrl = trimmed(env.WEBHOOK_URL)
      const webhookSecret = trimmed(env.WEBHOOK_SECRET)

      const fail = (message: string) =>
        new ConfigError({ message: `Missing required configuration: ${message}` })

      if (hetznerToken === "") {
        return yield* fail("HETZNER_API_TOKEN")
      }

      // The e-mail channel needs all three fields; a partial set is rejected so
      // a typo doesn't silently disable notifications.
      const emailFields = [resendApiKey, notificationEmail, fromEmail]
      const emailProvided = emailFields.some((value) => value !== "")
      const emailComplete = emailFields.every((value) => value !== "")
      if (emailProvided && !emailComplete) {
        return yield* fail(
          "the e-mail channel needs RESEND_API_KEY, NOTIFICATION_EMAIL and RESEND_FROM_EMAIL together",
        )
      }

      const email: Option.Option<EmailConfig> = emailComplete
        ? Option.some({
            apiKey: Redacted.make(resendApiKey),
            from: fromEmail,
            defaultTo: notificationEmail,
          })
        : Option.none()

      const webhook: Option.Option<WebhookConfig> =
        webhookUrl !== ""
          ? Option.some({
              url: Redacted.make(webhookUrl),
              signingSecret:
                webhookSecret !== ""
                  ? Option.some(Redacted.make(webhookSecret))
                  : Option.none(),
            })
          : Option.none()

      if (Option.isNone(email) && Option.isNone(webhook)) {
        return yield* fail(
          "configure at least one notification channel — WEBHOOK_URL, or the e-mail trio (RESEND_API_KEY + NOTIFICATION_EMAIL + RESEND_FROM_EMAIL)",
        )
      }

      return {
        hetznerToken: Redacted.make(hetznerToken),
        email,
        webhook,
        pollIntervalMs: numberFrom(env.POLL_INTERVAL_SECONDS, 30) * 1000,
        serverTypeCacheTtlMs: numberFrom(env.SERVER_TYPE_CACHE_TTL_SECONDS, 3600) * 1000,
        rateLimitPerHour: numberFrom(env.HETZNER_RATE_LIMIT_PER_HOUR, 3600),
        requestTtlMs: numberFrom(env.REQUEST_TTL_DAYS, 30) * 86_400_000,
      }
    }),
  )
}
