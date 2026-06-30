import { Cause, Effect, Option, Redacted } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { EmailConfig, WebhookConfig } from "../config"
import { NotificationError } from "../errors"
import { encodeRequest, type ServerRequest } from "../schema"

/** A single delivery mechanism for availability notifications. */
export interface NotificationChannel {
  readonly name: string
  readonly send: (
    req: ServerRequest,
    location: string,
  ) => Effect.Effect<void, NotificationError>
}

const RESEND_ENDPOINT = "https://api.resend.com/emails"

const renderEmailBody = (
  from: string,
  to: string,
  req: ServerRequest,
  location: string,
): unknown => ({
  from,
  to: [to],
  subject: `Hetzner ${req.serverType} is now available in ${location}`,
  html:
    `<p>Good news — the Hetzner Cloud server type ` +
    `<strong>${req.serverType}</strong> you were waiting for is now available in ` +
    `<strong>${location}</strong>.</p>` +
    `<p>Request <code>${req.id}</code> created at ${new Date(req.createdAt).toISOString()}.</p>`,
})

/** Resend e-mail channel. Falls back to the configured default recipient. */
export const emailChannel = (
  client: HttpClient.HttpClient,
  config: EmailConfig,
): NotificationChannel => ({
  name: "email",
  send: (req, location) =>
    Effect.gen(function* () {
      const to = req.email ?? config.defaultTo
      const request = yield* HttpClientRequest.bodyJson(
        HttpClientRequest.post(RESEND_ENDPOINT).pipe(
          HttpClientRequest.bearerToken(Redacted.value(config.apiKey)),
          HttpClientRequest.acceptJson,
        ),
        renderEmailBody(config.from, to, req, location),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.fail(
            new NotificationError({
              channel: "email",
              message: `Failed to encode Resend request: ${String(Cause.squash(cause))}`,
            }),
          ),
        ),
      )
      yield* client.execute(request).pipe(
        Effect.catchCause((cause) =>
          Effect.fail(
            new NotificationError({
              channel: "email",
              message: `Resend request failed: ${String(Cause.squash(cause))}`,
            }),
          ),
        ),
      )
    }).pipe(Effect.withSpan("Notifier.email")),
})

const hexHmacSha256 = (secret: string, body: string): Effect.Effect<string> =>
  Effect.promise(async () => {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))
    return Array.from(new Uint8Array(signature))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  })

/**
 * Generic outbound webhook. POSTs a JSON payload to the configured URL and,
 * when a signing secret is set, includes an HMAC-SHA256 signature over the exact
 * request body in `X-Sniper-Signature: sha256=<hex>`.
 */
export const webhookChannel = (
  client: HttpClient.HttpClient,
  config: WebhookConfig,
): NotificationChannel => ({
  name: "webhook",
  send: (req, location) =>
    Effect.gen(function* () {
      const body = JSON.stringify({
        event: "server_available",
        serverType: req.serverType,
        location,
        request: encodeRequest(req),
      })

      let request = HttpClientRequest.post(Redacted.value(config.url)).pipe(
        HttpClientRequest.bodyText(body, "application/json"),
      )
      if (Option.isSome(config.signingSecret)) {
        const signature = yield* hexHmacSha256(
          Redacted.value(config.signingSecret.value),
          body,
        )
        request = request.pipe(
          HttpClientRequest.setHeader("X-Sniper-Signature", `sha256=${signature}`),
        )
      }

      yield* client.execute(request).pipe(
        Effect.catchCause((cause) =>
          Effect.fail(
            new NotificationError({
              channel: "webhook",
              message: `Webhook POST failed: ${String(Cause.squash(cause))}`,
            }),
          ),
        ),
      )
    }).pipe(Effect.withSpan("Notifier.webhook")),
})
