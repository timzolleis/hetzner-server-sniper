import { Context, Effect, Layer, Option } from "effect"
import { HttpClient } from "effect/unstable/http"
import { AppConfig } from "../config"
import type { ServerRequest } from "../schema"
import { emailChannel, type NotificationChannel, webhookChannel } from "./channels"

/**
 * Delivers availability notifications across every configured channel. Delivery
 * is best-effort: a failing channel is logged and does not block the others or
 * roll back fulfilment, so `notify` never fails its caller.
 */
export class Notifier extends Context.Service<
  Notifier,
  {
    readonly notify: (req: ServerRequest, location: string) => Effect.Effect<void>
  }
>()("app/Notifier") {
  static readonly layer = Layer.effect(
    Notifier,
    Effect.gen(function* () {
      const config = yield* AppConfig
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

      const channels: Array<NotificationChannel> = []
      if (Option.isSome(config.email)) {
        channels.push(emailChannel(client, config.email.value))
      }
      if (Option.isSome(config.webhook)) {
        channels.push(webhookChannel(client, config.webhook.value))
      }

      return {
        notify: (req, location) =>
          Effect.forEach(channels, (channel) =>
            channel.send(req, location).pipe(
              Effect.catchCause((cause) =>
                Effect.logError(
                  `Notification via ${channel.name} failed for ${req.id}`,
                  cause,
                ),
              ),
            ),
          ).pipe(Effect.asVoid, Effect.withSpan("Notifier.notify")),
      }
    }),
  )
}
