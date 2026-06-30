import { Context, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
// Deep, named import so the tree-shaker drops `HttpApiScalar.layer` and the
// ~3.2 MB Scalar standalone bundle it inlines; layerCdn loads it from jsDelivr.
import { layerCdn as scalarDocs } from "effect/unstable/httpapi/HttpApiScalar"
import { CloudflareEnv } from "../env"
import { api } from "./api"
import { BearerAuth } from "./auth"
import { HealthHandlers, SniperHandlers } from "./handlers"

export const makeApiLive = (env: Env) => {
  const envLayer = CloudflareEnv.layer(env)
  const handlers = Layer.mergeAll(SniperHandlers, HealthHandlers).pipe(
    Layer.provide(envLayer),
  )
  return HttpApiBuilder.layer(api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(handlers),
    Layer.merge(scalarDocs(api)),
    Layer.provide(BearerAuth.layer),
    Layer.provide(envLayer),
    Layer.provide(HttpServer.layerServices),
  )
}

let cached:
  | {
      readonly handler: (
        request: Request,
        context: Context.Context<CloudflareEnv>,
      ) => Promise<Response>
      readonly context: Context.Context<CloudflareEnv>
    }
  | undefined

/**
 * Cloudflare bindings are stable for an isolate's lifetime, so the web handler
 * (and the whole API layer behind it) is built once on the first request and
 * reused — the same way the Durable Object builds its runtime once. `env` is
 * also threaded as the per-request context the middleware reads.
 */
export const fetchHandler = (request: Request, env: Env): Promise<Response> => {
  if (cached === undefined) {
    cached = {
      handler: HttpRouter.toWebHandler(makeApiLive(env)).handler,
      context: Context.make(CloudflareEnv, { env }),
    }
  }
  return cached.handler(request, cached.context)
}
