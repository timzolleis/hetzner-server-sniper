import { it } from "@effect/vitest"
import { assert } from "vitest"
import { Effect, Option, Redacted } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { webhookChannel } from "../src/notify/channels"
import { decodeRequest } from "../src/schema"

const sampleRequest = decodeRequest({
  id: "req-1",
  serverType: "cx22",
  location: "fsn1",
  email: null,
  status: "fulfilled",
  createdAt: 0,
  updatedAt: 0,
  fulfilledAt: 0,
  lastCheckedAt: 0,
  attempts: 1,
  availableLocation: "fsn1",
})

const hmacHex = (secret: string, body: string) =>
  Effect.promise(async () => {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  })

it.effect("webhook channel POSTs a signed JSON payload", () =>
  Effect.gen(function* () {
    let captured: { url: string; body: string; signature: string | undefined } | undefined

    const client = HttpClient.make((request) => {
      const bytes = (request.body as { body?: Uint8Array }).body
      captured = {
        url: request.url,
        body: bytes ? new TextDecoder().decode(bytes) : "",
        signature: request.headers["x-sniper-signature"],
      }
      return Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response(null, { status: 200 })),
      )
    }).pipe(HttpClient.filterStatusOk)

    const channel = webhookChannel(client, {
      url: Redacted.make("https://example.com/hook"),
      signingSecret: Option.some(Redacted.make("s3cr3t")),
    })

    yield* channel.send(sampleRequest, "fsn1")

    assert.strictEqual(captured?.url, "https://example.com/hook")

    const payload = JSON.parse(captured!.body)
    assert.strictEqual(payload.event, "server_available")
    assert.strictEqual(payload.serverType, "cx22")
    assert.strictEqual(payload.location, "fsn1")
    assert.strictEqual(payload.request.id, "req-1")

    // Signature is a correct HMAC-SHA256 over the exact body that was sent.
    const expected = yield* hmacHex("s3cr3t", captured!.body)
    assert.strictEqual(captured!.signature, `sha256=${expected}`)
  }),
)

it.effect("webhook channel omits the signature when no secret is set", () =>
  Effect.gen(function* () {
    let signature: string | undefined = "unset"

    const client = HttpClient.make((request) => {
      signature = request.headers["x-sniper-signature"]
      return Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response(null, { status: 200 })),
      )
    }).pipe(HttpClient.filterStatusOk)

    const channel = webhookChannel(client, {
      url: Redacted.make("https://example.com/hook"),
      signingSecret: Option.none(),
    })

    yield* channel.send(sampleRequest, "fsn1")
    assert.strictEqual(signature, undefined)
  }),
)
