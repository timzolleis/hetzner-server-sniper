import { Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { AppConfig } from "./config"
import { CloudflareEnv } from "./env"
import { DurableStore } from "./durable-store"
import { EmailService } from "./email/resend"
import { ConfigError } from "./errors"
import { AvailabilityService } from "./hetzner/availability"
import { HetznerClient } from "./hetzner/client"
import { RateLimiter } from "./rate-limiter"
import { RequestStore } from "./requests/store"
import { SniperService } from "./sniper"

/**
 * Build the fully-closed layer that exposes {@link SniperService}, wiring the
 * runtime-provided bindings (Cloudflare env + Durable Object storage) through
 * the service graph. Composed bottom-up with `provideMerge` so each tier's
 * outputs satisfy the next. The only construction failure is {@link ConfigError}
 * (missing env), surfaced when the layer is first built.
 */
export const makeMainLayer = (
  storage: DurableObjectStorage,
  env: Env,
): Layer.Layer<SniperService, ConfigError> => {
  const leaves = Layer.mergeAll(
    CloudflareEnv.layer(env),
    DurableStore.layer(storage),
    FetchHttpClient.layer,
  )

  // AppConfig + the Durable-Object-backed services. RateLimiter must be built
  // before HetznerClient, which acquires tokens from it.
  const withConfig = AppConfig.layer.pipe(Layer.provideMerge(leaves))
  const foundations = Layer.mergeAll(
    RateLimiter.layer,
    RequestStore.layer,
    EmailService.layer,
  ).pipe(Layer.provideMerge(withConfig))

  const withClient = HetznerClient.layer.pipe(Layer.provideMerge(foundations))
  const withAvailability = AvailabilityService.layer.pipe(
    Layer.provideMerge(withClient),
  )

  return SniperService.layer.pipe(Layer.provide(withAvailability))
}
