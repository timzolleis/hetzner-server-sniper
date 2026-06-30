import { it } from "@effect/vitest"
import { assert } from "vitest"
import { Effect, Layer, Redacted } from "effect"
import { AppConfig } from "../src/config"
import { EmailService } from "../src/email/resend"
import { ServerTypeNotFound } from "../src/errors"
import { AvailabilityService } from "../src/hetzner/availability"
import { RequestStore } from "../src/requests/store"
import { SniperService } from "../src/sniper"

// cx22 is available in fsn1; cax11 exists in the catalogue but is out of stock.
const makeTestLayer = () => {
  const sentEmails: Array<{ to: string; serverType: string; location: string }> = []

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

  const email = Layer.succeed(EmailService, {
    sendAvailable: (req, location) =>
      Effect.sync(() => {
        sentEmails.push({ to: req.email, serverType: req.serverType, location })
      }),
  })

  const config = Layer.succeed(AppConfig, {
    hetznerToken: Redacted.make("token"),
    resendApiKey: Redacted.make("key"),
    notificationEmail: "ops@example.com",
    fromEmail: "sniper@example.com",
    pollIntervalMs: 30_000,
    serverTypeCacheTtlMs: 3_600_000,
    rateLimitPerHour: 3600,
  })

  const layer = SniperService.layer.pipe(
    Layer.provide(Layer.mergeAll(RequestStore.layerMemory, availability, email, config)),
  )

  return { layer, sentEmails }
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
    const { layer, sentEmails } = makeTestLayer()

    const program = Effect.gen(function* () {
      const sniper = yield* SniperService
      const created = yield* sniper.createRequest({ serverType: "cx22" })
      assert.strictEqual(created.status, "pending")
      assert.strictEqual(created.email, "ops@example.com")

      const tick = yield* sniper.tick()
      assert.strictEqual(tick.fulfilled, 1)
      assert.strictEqual(tick.hasPending, false)

      const after = yield* sniper.getRequest(created.id)
      return after
    }).pipe(Effect.provide(layer))

    const after = yield* program
    assert.strictEqual(after?.status, "fulfilled")
    assert.strictEqual(after?.availableLocation, "fsn1")
    assert.strictEqual(after?.attempts, 1)
    assert.deepStrictEqual(sentEmails, [
      { to: "ops@example.com", serverType: "cx22", location: "fsn1" },
    ])
  }),
)

it.effect("keeps polling a request whose location is not yet available", () =>
  Effect.gen(function* () {
    const { layer, sentEmails } = makeTestLayer()

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
    assert.strictEqual(sentEmails.length, 0)
  }),
)
