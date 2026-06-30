import { Clock, Context, Effect, Layer } from "effect"
import { AppConfig } from "./config"
import { DurableStore } from "./durable-store"
import { RateLimitExceeded } from "./errors"

const BUCKET_KEY = "ratelimit:hetzner"

interface Bucket {
  readonly tokens: number
  readonly updatedAt: number
}

/**
 * A token bucket persisted in Durable Object storage, enforcing a shared budget
 * across every Hetzner API call (3600/hour by default = 1 token/second, with a
 * full hour's worth of burst). Because the single Sniper DO serializes all
 * polling, this budget genuinely spans all server requests.
 */
export class RateLimiter extends Context.Service<
  RateLimiter,
  { readonly take: (cost: number) => Effect.Effect<void, RateLimitExceeded> }
>()("app/RateLimiter") {
  static readonly layer = Layer.effect(
    RateLimiter,
    Effect.gen(function* () {
      const store = yield* DurableStore
      const config = yield* AppConfig

      const capacity = config.rateLimitPerHour
      const tokensPerMs = config.rateLimitPerHour / 3_600_000

      return {
        take: (cost) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const stored = yield* store.kvGet<Bucket>(BUCKET_KEY)
            const previous = stored ?? { tokens: capacity, updatedAt: now }

            const refilled = Math.min(
              capacity,
              previous.tokens + (now - previous.updatedAt) * tokensPerMs,
            )

            if (refilled < cost) {
              const deficit = cost - refilled
              return yield* new RateLimitExceeded({
                message: `Hetzner rate-limit budget exhausted (need ${cost}, have ${refilled.toFixed(2)})`,
                retryAfterMs: Math.ceil(deficit / tokensPerMs),
              })
            }

            yield* store.kvPut(BUCKET_KEY, {
              tokens: refilled - cost,
              updatedAt: now,
            })
          }),
      }
    }),
  )
}
