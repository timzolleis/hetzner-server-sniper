import type { ApiResult } from "./api"
import { SNIPER_DO_NAME, SniperDurableObject } from "./durable-object"
import type { ServerRequestView } from "./schema"

export { SniperDurableObject }

/** The Durable Object RPC surface, as seen from the Worker stub. */
interface SniperStub {
  createRequest(input: unknown): Promise<ApiResult<ServerRequestView>>
  listRequests(): Promise<ApiResult<ReadonlyArray<ServerRequestView>>>
  getRequest(id: string): Promise<ApiResult<ServerRequestView>>
  cancelRequest(id: string): Promise<ApiResult<ServerRequestView>>
  listServerTypes(): Promise<ApiResult<{ readonly names: ReadonlyArray<string> }>>
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })

const respond = <A>(result: ApiResult<A>, okStatus = 200): Response =>
  result.ok
    ? json(okStatus, result.data)
    : json(result.status, { error: result.error, tag: result.tag })

/** Constant-time string comparison (still leaks length). */
const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const authorized = (request: Request, env: Env): boolean => {
  const provided = request.headers.get("authorization")
  return (
    env.API_BEARER_TOKEN.length > 0 &&
    provided !== null &&
    safeEqual(provided, `Bearer ${env.API_BEARER_TOKEN}`)
  )
}

const sniper = (env: Env): SniperStub =>
  env.SNIPER.get(env.SNIPER.idFromName(SNIPER_DO_NAME)) as unknown as SniperStub

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url
    const { method } = request

    if (method === "GET" && pathname === "/health") {
      return json(200, { status: "ok" })
    }

    if (!authorized(request, env)) {
      return json(401, { error: "Unauthorized" })
    }

    const stub = sniper(env)

    try {
      if (pathname === "/requests") {
        if (method === "POST") {
          let body: unknown
          try {
            body = await request.json()
          } catch {
            return json(400, { error: "Request body must be valid JSON" })
          }
          return respond(await stub.createRequest(body), 201)
        }
        if (method === "GET") {
          return respond(await stub.listRequests())
        }
      }

      const requestMatch = /^\/requests\/([^/]+)$/.exec(pathname)
      if (requestMatch) {
        const id = decodeURIComponent(requestMatch[1]!)
        if (method === "GET") return respond(await stub.getRequest(id))
        if (method === "DELETE") return respond(await stub.cancelRequest(id))
      }

      if (method === "GET" && pathname === "/server-types") {
        return respond(await stub.listServerTypes())
      }

      return json(404, { error: "Not found" })
    } catch (error) {
      return json(500, {
        error: error instanceof Error ? error.message : "Internal error",
      })
    }
  },
} satisfies ExportedHandler<Env>
