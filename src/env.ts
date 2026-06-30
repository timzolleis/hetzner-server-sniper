import { Context, Layer } from "effect"

/**
 * The Cloudflare bindings (vars, secrets and the Durable Object namespace) for
 * a single Worker/DO instance. Provided once when the Durable Object's Effect
 * runtime is constructed.
 */
export class CloudflareEnv extends Context.Service<
  CloudflareEnv,
  { readonly env: Env }
>()("app/CloudflareEnv") {
  static readonly layer = (env: Env): Layer.Layer<CloudflareEnv> =>
    Layer.succeed(CloudflareEnv, { env })
}
