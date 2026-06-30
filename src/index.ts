import { SniperDurableObject } from "./durable-object"
import { fetchHandler } from "./http/web"

export { SniperDurableObject }

export default {
  fetch: (request: Request, env: Env): Promise<Response> => fetchHandler(request, env),
} satisfies ExportedHandler<Env>
