import { it } from "@effect/vitest"
import { assert } from "vitest"
import { Context, Effect } from "effect"
import { HttpRouter } from "effect/unstable/http"
import type { ApiResult } from "../src/api"
import { CloudflareEnv } from "../src/env"
import type { SniperStub } from "../src/http/handlers"
import { makeApiLive } from "../src/http/web"
import type { ServerRequestView } from "../src/schema"

const TOKEN = "secret-token"

const view: ServerRequestView = {
  id: "req_1",
  serverType: "cx22",
  location: null,
  email: null,
  status: "pending",
  createdAt: 1,
  updatedAt: 1,
  fulfilledAt: null,
  lastCheckedAt: null,
  attempts: 0,
  availableLocation: null,
}

const fakeEnv = (stub: Partial<SniperStub>, token: string = TOKEN): Env => {
  const instance = stub as unknown as ReturnType<DurableObjectNamespace["get"]>
  const namespace = {
    idFromName: () => ({}) as DurableObjectId,
    get: () => instance,
  } as unknown as Env["SNIPER"]
  return { API_BEARER_TOKEN: token, SNIPER: namespace } as unknown as Env
}

/** Drive a single request through the real edge layer with a faked DO stub. */
const call = (env: Env, request: Request) =>
  Effect.promise(() => {
    const { handler } = HttpRouter.toWebHandler(makeApiLive(env), { disableLogger: true })
    return handler(request, Context.make(CloudflareEnv, { env }))
  })

const post = (body: unknown, token: string = TOKEN) =>
  new Request("http://sniper/requests", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  })

it.effect("creates a request and returns 201 with the encoded view", () =>
  Effect.gen(function* () {
    const env = fakeEnv({
      createRequest: () => Promise.resolve<ApiResult<ServerRequestView>>({ ok: true, data: view }),
    })
    const res = yield* call(env, post({ serverType: "cx22" }))
    assert.strictEqual(res.status, 201)
    assert.deepStrictEqual(yield* Effect.promise(() => res.json()), view)
  }),
)

it.effect("maps a ServerTypeNotFound envelope to 422 with the tagged body", () =>
  Effect.gen(function* () {
    const env = fakeEnv({
      createRequest: () =>
        Promise.resolve<ApiResult<ServerRequestView>>({
          ok: false,
          error: { _tag: "ServerTypeNotFound", message: "unknown type", serverType: "nope" },
        }),
    })
    const res = yield* call(env, post({ serverType: "nope" }))
    assert.strictEqual(res.status, 422)
    const body = (yield* Effect.promise(() => res.json())) as { _tag: string; serverType: string }
    assert.strictEqual(body._tag, "ServerTypeNotFound")
    assert.strictEqual(body.serverType, "nope")
  }),
)

it.effect("rejects a wrong bearer token with 401 and never calls the DO", () =>
  Effect.gen(function* () {
    let called = false
    const env = fakeEnv({
      createRequest: () => {
        called = true
        return Promise.resolve<ApiResult<ServerRequestView>>({ ok: true, data: view })
      },
    })
    const res = yield* call(env, post({ serverType: "cx22" }, "wrong"))
    assert.strictEqual(res.status, 401)
    assert.strictEqual(called, false)
  }),
)

it.effect("maps a RequestNotFound envelope to 404", () =>
  Effect.gen(function* () {
    const env = fakeEnv({
      getRequest: (id) =>
        Promise.resolve<ApiResult<ServerRequestView>>({
          ok: false,
          error: { _tag: "RequestNotFound", message: "missing", id },
        }),
    })
    const res = yield* call(
      env,
      new Request("http://sniper/requests/req_x", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    )
    assert.strictEqual(res.status, 404)
  }),
)

it.effect("serves /health unauthenticated", () =>
  Effect.gen(function* () {
    const res = yield* call(fakeEnv({}), new Request("http://sniper/health"))
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(yield* Effect.promise(() => res.json()), { status: "ok" })
  }),
)

it.effect("serves the generated OpenAPI document", () =>
  Effect.gen(function* () {
    const res = yield* call(fakeEnv({}), new Request("http://sniper/openapi.json"))
    assert.strictEqual(res.status, 200)
    const spec = (yield* Effect.promise(() => res.json())) as {
      paths: Record<string, unknown>
    }
    assert.ok("/requests" in spec.paths)
    assert.ok("/server-types" in spec.paths)
  }),
)
