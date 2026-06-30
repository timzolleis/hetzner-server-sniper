import { it } from "@effect/vitest"
import { assert } from "vitest"
import { Effect, Layer, Option, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { AppConfig } from "../src/config"
import { ServerTypeNotFound } from "../src/errors"
import { AvailabilityService } from "../src/hetzner/availability"
import { Notifier } from "../src/notify/notifier"
import { RequestStore } from "../src/requests/store"
import { SniperService } from "../src/sniper"

// cx22 is available in fsn1/nbg1; cax11 exists in the catalogue but is out of stock.
const makeTestLayer = () => {
  const sent: Array<{ serverType: string; location: string; email: string | null }> = []

  const availability = Layer.succeed(AvailabilityService, {
    serverTypeIndex: () =>
      Effect.succeed({
        byName: new Map([
          ["cx22", 22],
          ["cax11", 11],
        ]),
        names: ["cax11", "cx22"],
      }),
    snapshot: () =>
      Effect.succeed({
        availableByTypeId: new Map([[22, new Set(["fsn1", "nbg1"])]]),
      }),
  })

  const notifier = Layer.succeed(Notifier, {
    notify: (req, location) =>
      Effect.sync(() => {
        sent.push({ serverType: req.serverType, location, email: req.email })
      }),
  })

  const config = Layer.succeed(AppConfig, {
    hetznerToken: Redacted.make("token"),
    email: Option.some({
      apiKey: Redacted.make("key"),
      from: "sniper@example.com",
      defaultTo: "ops@example.com",
    }),
    webhook: Option.none(),
    pollIntervalMs: 30_000,
    serverTypeCacheTtlMs: 3_600_000,
    rateLimitPerHour: 3600,
    requestTtlMs: 30 * 86_400_000,
  })

  const layer = SniperService.layer.pipe(
    Layer.provide(Layer.mergeAll(RequestStore.layerMemory, availability, notifier, config)),
  )

  return { layer, sent }
}

it.effect("rejects an unknown server type", () =>
  Effect.gen(function* () {
    const { layer } = makeTestLayer()
    const result = yield* SniperService.pipe(
      Effect.flatMap((sniper) => sniper.createRequest({ serverType: "does-not-exist" })),
      Effect.flip,
      Effect.provide(layer),
    )
    assert.instanceOf(result, ServerTypeNotFound)
    assert.strictEqual(result.serverType, "does-not-exist")
  }),
)

it.effect("fulfils an available request and notifies", () =>
  Effect.gen(function* () {
    const { layer, sent } = makeTestLayer()

    const program = Effect.gen(function* () {
      const sniper = yield* SniperService
      const created = yield* sniper.createRequest({ serverType: "cx22" })
      assert.strictEqual(created.status, "pending")
      assert.strictEqual(created.email, null) // no per-request override

      const tick = yield* sniper.tick()
      assert.strictEqual(tick.fulfilled, 1)
      assert.strictEqual(tick.hasPending, false)

      return yield* sniper.getRequest(created.id)
    }).pipe(Effect.provide(layer))

    const after = yield* program
    assert.strictEqual(after?.status, "fulfilled")
    assert.strictEqual(after?.availableLocation, "fsn1")
    assert.strictEqual(after?.attempts, 1)
    assert.deepStrictEqual(sent, [{ serverType: "cx22", location: "fsn1", email: null }])
  }),
)

it.effect("passes a per-request e-mail override through to the notifier", () =>
  Effect.gen(function* () {
    const { layer, sent } = makeTestLayer()
    const program = Effect.gen(function* () {
      const sniper = yield* SniperService
      yield* sniper.createRequest({ serverType: "cx22", email: "me@example.com" })
      yield* sniper.tick()
    }).pipe(Effect.provide(layer))
    yield* program
    assert.strictEqual(sent[0]?.email, "me@example.com")
  }),
)

it.effect("auto-evicts a pending request once it passes the TTL", () =>
  Effect.gen(function* () {
    const { layer, sent } = makeTestLayer()

    const program = Effect.gen(function* () {
      const sniper = yield* SniperService
      const created = yield* sniper.createRequest({ serverType: "cax11" })
      yield* TestClock.adjust("31 days")
      const tick = yield* sniper.tick()
      assert.strictEqual(tick.expired, 1)
      assert.strictEqual(tick.fulfilled, 0)
      assert.strictEqual(tick.hasPending, false)
      return yield* sniper.getRequest(created.id)
    }).pipe(Effect.provide(layer))

    const after = yield* program
    assert.strictEqual(after?.status, "expired")
    assert.strictEqual(sent.length, 0)
  }),
)

it.effect("keeps polling a request whose location is not yet available", () =>
  Effect.gen(function* () {
    const { layer, sent } = makeTestLayer()

    const program = Effect.gen(function* () {
      const sniper = yield* SniperService
      // cx22 is available in fsn1/nbg1, but this request demands hel1.
      const created = yield* sniper.createRequest({ serverType: "cx22", location: "hel1" })
      const tick = yield* sniper.tick()
      assert.strictEqual(tick.fulfilled, 0)
      assert.strictEqual(tick.hasPending, true)
      return yield* sniper.getRequest(created.id)
    }).pipe(Effect.provide(layer))

    const after = yield* program
    assert.strictEqual(after?.status, "pending")
    assert.strictEqual(after?.attempts, 1)
    assert.strictEqual(sent.length, 0)
  }),
)
