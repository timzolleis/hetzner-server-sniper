import { it } from "@effect/vitest"
import { assert } from "vitest"
import { Effect, Layer, Redacted } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppConfig } from "../src/config"
import { DurableStore } from "../src/durable-store"
import { HetznerApiError } from "../src/errors"
import { AvailabilityService } from "../src/hetzner/availability"
import { HetznerClient } from "../src/hetzner/client"
import { ListServerTypesResponse } from "../src/hetzner/schemas"
import { RateLimiter } from "../src/rate-limiter"

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

/** A fake HttpClient whose response is chosen per request URL. */
const httpLayer = (respond: (url: URL) => Response) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, respond(url))),
    ),
  )

const configStub = Layer.succeed(AppConfig, {
  hetznerToken: Redacted.make("token"),
  resendApiKey: Redacted.make("key"),
  notificationEmail: "ops@example.com",
  fromEmail: "sniper@example.com",
  pollIntervalMs: 30_000,
  serverTypeCacheTtlMs: 3_600_000,
  rateLimitPerHour: 3600,
  requestTtlMs: 30 * 86_400_000,
})

const rateLimiterStub = Layer.succeed(RateLimiter, { take: () => Effect.void })

const durableStoreStub = Layer.succeed(DurableStore, {
  sql: () => Effect.succeed([]),
  kvGet: () => Effect.succeed(undefined),
  kvPut: () => Effect.void,
})

it.effect("surfaces Hetzner's structured error body", () =>
  Effect.gen(function* () {
    const layer = HetznerClient.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          httpLayer(() =>
            jsonResponse(422, {
              error: { code: "resource_unavailable", message: "no capacity" },
            }),
          ),
          rateLimiterStub,
          configStub,
        ),
      ),
    )

    const error = yield* HetznerClient.pipe(
      Effect.flatMap((client) => client.getJson("/server_types", ListServerTypesResponse)),
      Effect.flip,
      Effect.provide(layer),
    )

    assert.instanceOf(error, HetznerApiError)
    assert.strictEqual(error.status, 422)
    assert.match(error.message, /resource_unavailable: no capacity/)
  }),
)

it.effect("pages through every server-type result", () =>
  Effect.gen(function* () {
    const pagedHttp = httpLayer((url) =>
      url.searchParams.get("page") === "2"
        ? jsonResponse(200, {
            server_types: [{ id: 11, name: "cax11" }],
            meta: { pagination: { next_page: null } },
          })
        : jsonResponse(200, {
            server_types: [{ id: 22, name: "cx22" }],
            meta: { pagination: { next_page: 2 } },
          }),
    )

    const layer = AvailabilityService.layer.pipe(
      Layer.provide(HetznerClient.layer),
      Layer.provide(
        Layer.mergeAll(pagedHttp, rateLimiterStub, configStub, durableStoreStub),
      ),
    )

    const index = yield* AvailabilityService.pipe(
      Effect.flatMap((service) => service.serverTypeIndex()),
      Effect.provide(layer),
    )

    assert.deepStrictEqual([...index.names], ["cax11", "cx22"])
    assert.strictEqual(index.byName.get("cx22"), 22)
    assert.strictEqual(index.byName.get("cax11"), 11)
  }),
)
