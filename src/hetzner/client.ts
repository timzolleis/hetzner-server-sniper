import { Cause, Context, Effect, Layer, Redacted } from "effect"
import {
  HttpClient,
  type HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"
import { Schema } from "effect"
import { AppConfig } from "../config"
import { HetznerApiError, RateLimitExceeded } from "../errors"
import { RateLimiter } from "../rate-limiter"
import { ErrorResponse } from "./schemas"

const BASE_URL = "https://api.hetzner.cloud/v1"

/**
 * Turn a transport/status failure into a {@link HetznerApiError}, parsing
 * Hetzner's `{ error: { code, message } }` body when a response is present so
 * the upstream status and reason are surfaced rather than a generic message.
 */
const failFromHttpError = (
  path: string,
  error: HttpClientError.HttpClientError,
): Effect.Effect<never, HetznerApiError> =>
  Effect.gen(function* () {
    const response = error.response
    if (response === undefined) {
      return yield* new HetznerApiError({
        message: `Hetzner GET ${path} failed: ${error.message}`,
      })
    }
    const body = yield* HttpClientResponse.schemaBodyJson(ErrorResponse)(response).pipe(
      Effect.catchCause(() => Effect.succeed(undefined)),
    )
    const detail =
      body !== undefined ? `${body.error.code}: ${body.error.message}` : error.message
    return yield* new HetznerApiError({
      status: response.status,
      message: `Hetzner GET ${path} failed (HTTP ${response.status}): ${detail}`,
    })
  })

/**
 * The authenticated, rate-limited HTTP client for the Hetzner Cloud API. Every
 * request first acquires a token from {@link RateLimiter}; transport/HTTP
 * failures surface as {@link HetznerApiError}.
 */
export class HetznerClient extends Context.Service<
  HetznerClient,
  {
    /** GET `path` and decode the JSON body with `schema`. */
    readonly getJson: <A, I, R>(
      path: string,
      schema: Schema.Codec<A, I, R>,
    ) => Effect.Effect<A, HetznerApiError | RateLimitExceeded, R>
  }
>()("app/HetznerClient") {
  static readonly layer = Layer.effect(
    HetznerClient,
    Effect.gen(function* () {
      const config = yield* AppConfig
      const limiter = yield* RateLimiter
      const token = Redacted.value(config.hetznerToken)

      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest((request) =>
          request.pipe(
            HttpClientRequest.prependUrl(BASE_URL),
            HttpClientRequest.acceptJson,
            HttpClientRequest.bearerToken(token),
          ),
        ),
        HttpClient.filterStatusOk,
        HttpClient.retryTransient({ times: 3 }),
      )

      return {
        getJson: (path, schema) =>
          Effect.gen(function* () {
            yield* limiter.take(1)
            const response = yield* client.get(path).pipe(
              Effect.catchTag("HttpClientError", (error) =>
                failFromHttpError(path, error),
              ),
            )
            return yield* HttpClientResponse.schemaBodyJson(schema)(response).pipe(
              Effect.catchCause((cause) =>
                Effect.fail(
                  new HetznerApiError({
                    message: `Failed to decode Hetzner GET ${path} response: ${String(Cause.squash(cause))}`,
                  }),
                ),
              ),
            )
          }),
      }
    }),
  )
}
