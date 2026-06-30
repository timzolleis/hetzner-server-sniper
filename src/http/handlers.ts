import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import type { ApiResult } from "../api"
import { InternalError, InvalidRequest, RequestNotFound, ServerTypeNotFound } from "../errors"
import { CloudflareEnv } from "../env"
import { decodeRequest, type ServerRequestView } from "../schema"
import { api } from "./api"

/** The Durable Object RPC surface, as seen from the Worker stub. */
export interface SniperStub {
  createRequest(input: unknown): Promise<ApiResult<ServerRequestView>>
  listRequests(): Promise<ApiResult<ReadonlyArray<ServerRequestView>>>
  getRequest(id: string): Promise<ApiResult<ServerRequestView>>
  cancelRequest(id: string): Promise<ApiResult<ServerRequestView>>
  listServerTypes(): Promise<ApiResult<{ readonly names: ReadonlyArray<string> }>>
}

/** Address of the single, globally-shared Sniper Durable Object. */
const SNIPER_DO_NAME = "global"

const stub = (env: Env): SniperStub =>
  env.SNIPER.get(env.SNIPER.idFromName(SNIPER_DO_NAME)) as unknown as SniperStub

export const SniperHandlers = HttpApiBuilder.group(api, "sniper", (handlers) =>
  handlers
    .handle("createRequest", ({ payload }) =>
      Effect.gen(function* () {
        const { env } = yield* CloudflareEnv
        const result = yield* Effect.promise(() => stub(env).createRequest(payload))
        if (result.ok) return decodeRequest(result.data)
        switch (result.error._tag) {
          case "InvalidRequest":
            return yield* new InvalidRequest(result.error)
          case "ServerTypeNotFound":
            return yield* new ServerTypeNotFound(result.error)
          default:
            return yield* new InternalError({ message: result.error.message })
        }
      }),
    )
    .handle("listRequests", () =>
      Effect.gen(function* () {
        const { env } = yield* CloudflareEnv
        const result = yield* Effect.promise(() => stub(env).listRequests())
        if (result.ok) return result.data.map((view) => decodeRequest(view))
        return yield* new InternalError({ message: result.error.message })
      }),
    )
    .handle("getRequest", ({ params }) =>
      Effect.gen(function* () {
        const { env } = yield* CloudflareEnv
        const result = yield* Effect.promise(() => stub(env).getRequest(params.id))
        if (result.ok) return decodeRequest(result.data)
        switch (result.error._tag) {
          case "RequestNotFound":
            return yield* new RequestNotFound(result.error)
          default:
            return yield* new InternalError({ message: result.error.message })
        }
      }),
    )
    .handle("cancelRequest", ({ params }) =>
      Effect.gen(function* () {
        const { env } = yield* CloudflareEnv
        const result = yield* Effect.promise(() => stub(env).cancelRequest(params.id))
        if (result.ok) return decodeRequest(result.data)
        switch (result.error._tag) {
          case "RequestNotFound":
            return yield* new RequestNotFound(result.error)
          default:
            return yield* new InternalError({ message: result.error.message })
        }
      }),
    )
    .handle("listServerTypes", () =>
      Effect.gen(function* () {
        const { env } = yield* CloudflareEnv
        const result = yield* Effect.promise(() => stub(env).listServerTypes())
        if (result.ok) return result.data
        return yield* new InternalError({ message: result.error.message })
      }),
    ),
)

export const HealthHandlers = HttpApiBuilder.group(api, "health", (handlers) =>
  handlers.handle("health", () => Effect.succeed({ status: "ok" as const })),
)
