import { Effect, Layer, Redacted } from "effect"
import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi"
import { CloudflareEnv } from "../env"
import { Unauthorized } from "../errors"

/** Constant-time string comparison (still leaks length). */
const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Bearer-token gate applied to the `sniper` group. The decoded credential is
 * compared (constant-time) against `API_BEARER_TOKEN`; a mismatch fails the
 * request with {@link Unauthorized} (401). Reads the token from the per-request
 * {@link CloudflareEnv}, so the middleware is declared with `requires: CloudflareEnv`.
 */
export class BearerAuth extends HttpApiMiddleware.Service<
  BearerAuth,
  { requires: CloudflareEnv }
>()("app/BearerAuth", {
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized,
}) {
  static readonly layer = Layer.succeed(BearerAuth, {
    bearer: (httpEffect, { credential }) =>
      Effect.gen(function* () {
        const { env } = yield* CloudflareEnv
        const provided = Redacted.value(credential)
        const ok =
          env.API_BEARER_TOKEN.length > 0 && safeEqual(provided, env.API_BEARER_TOKEN)
        if (!ok) return yield* new Unauthorized({ message: "Unauthorized" })
        return yield* httpEffect
      }),
  })
}
