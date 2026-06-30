import { Cause, Context, Effect, Layer, Redacted } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { AppConfig } from "../config"
import { EmailSendError } from "../errors"
import type { ServerRequest } from "../schema"

const RESEND_ENDPOINT = "https://api.resend.com/emails"

const renderBody = (
  from: string,
  req: ServerRequest,
  location: string,
): unknown => {
  const where = req.location === null ? `location ${location}` : location
  const subject = `Hetzner ${req.serverType} is now available in ${location}`
  return {
    from,
    to: [req.email],
    subject,
    html:
      `<p>Good news — the Hetzner Cloud server type ` +
      `<strong>${req.serverType}</strong> you were waiting for is now available in <strong>${where}</strong>.</p>` +
      `<p>Request <code>${req.id}</code> created at ${new Date(req.createdAt).toISOString()}.</p>`,
  }
}

/** Sends availability notifications through the Resend HTTP API. */
export class EmailService extends Context.Service<
  EmailService,
  {
    readonly sendAvailable: (
      req: ServerRequest,
      location: string,
    ) => Effect.Effect<void, EmailSendError>
  }
>()("app/EmailService") {
  static readonly layer = Layer.effect(
    EmailService,
    Effect.gen(function* () {
      const config = yield* AppConfig
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
      const apiKey = Redacted.value(config.resendApiKey)

      return {
        sendAvailable: (req, location) =>
          Effect.gen(function* () {
            const request = yield* HttpClientRequest.bodyJson(
              HttpClientRequest.post(RESEND_ENDPOINT).pipe(
                HttpClientRequest.bearerToken(apiKey),
                HttpClientRequest.acceptJson,
              ),
              renderBody(config.fromEmail, req, location),
            ).pipe(
              Effect.catchCause((cause) =>
                Effect.fail(
                  new EmailSendError({
                    message: `Failed to encode Resend request body: ${String(Cause.squash(cause))}`,
                  }),
                ),
              ),
            )

            yield* client.execute(request).pipe(
              Effect.catchCause((cause) =>
                Effect.fail(
                  new EmailSendError({
                    message: `Resend request failed: ${String(Cause.squash(cause))}`,
                  }),
                ),
              ),
            )
          }).pipe(Effect.withSpan("EmailService.sendAvailable")),
      }
    }),
  )
}
