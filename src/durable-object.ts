import { DurableObject } from "cloudflare:workers"
import { Effect, ManagedRuntime } from "effect"
import { causeToResult, internalError, type ApiResult } from "./api"
import { ConfigError, RequestNotFound } from "./errors"
import { makeMainLayer } from "./runtime"
import { SniperService } from "./sniper"
import type { ServerRequestView } from "./schema"

const intervalMs = (env: Env): number =>
  Math.max(1000, (Number(env.POLL_INTERVAL_SECONDS) || 30) * 1000)

/**
 * The single Durable Object that owns all sniper state and scheduling: the
 * SQLite-backed request store, the persisted rate-limit budget, the hourly
 * server-type-name cache, and the 30-second `alarm()` poll loop. The Worker
 * edge talks to it over RPC.
 */
export class SniperDurableObject extends DurableObject<Env> {
  readonly #runtime: ManagedRuntime.ManagedRuntime<SniperService, ConfigError>
  readonly #pollIntervalMs: number

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.#runtime = ManagedRuntime.make(makeMainLayer(ctx.storage, env))
    this.#pollIntervalMs = intervalMs(env)
    // Build the layer (and create the SQLite schema) before serving traffic.
    // A build failure (e.g. missing config) is surfaced per-request as a 500.
    ctx.blockConcurrencyWhile(async () => {
      try {
        await this.#runtime.runPromise(Effect.flatMap(SniperService, () => Effect.void))
      } catch {
        /* intentionally ignored */
      }
    })
  }

  // ── RPC surface (called from the Worker) ──────────────────────────────────

  async createRequest(input: unknown): Promise<ApiResult<ServerRequestView>> {
    const result = await this.#run(
      Effect.flatMap(SniperService, (sniper) => sniper.createRequest(input)),
    )
    if (result.ok) await this.#ensureAlarm()
    return result
  }

  async listRequests(): Promise<ApiResult<ReadonlyArray<ServerRequestView>>> {
    return this.#run(Effect.flatMap(SniperService, (sniper) => sniper.listRequests()))
  }

  async getRequest(id: string): Promise<ApiResult<ServerRequestView>> {
    return this.#run(
      Effect.flatMap(SniperService, (sniper) => sniper.getRequest(id)).pipe(
        Effect.flatMap((view) =>
          view === undefined
            ? Effect.fail(new RequestNotFound({ id, message: `No request '${id}'` }))
            : Effect.succeed(view),
        ),
      ),
    )
  }

  async cancelRequest(id: string): Promise<ApiResult<ServerRequestView>> {
    return this.#run(
      Effect.flatMap(SniperService, (sniper) => sniper.cancelRequest(id)).pipe(
        Effect.flatMap((view) =>
          view === undefined
            ? Effect.fail(new RequestNotFound({ id, message: `No request '${id}'` }))
            : Effect.succeed(view),
        ),
      ),
    )
  }

  async listServerTypes(): Promise<ApiResult<{ readonly names: ReadonlyArray<string> }>> {
    return this.#run(
      Effect.flatMap(SniperService, (sniper) => sniper.serverTypeNames()).pipe(
        Effect.map((names) => ({ names })),
      ),
    )
  }

  // ── Scheduling ────────────────────────────────────────────────────────────

  override async alarm(): Promise<void> {
    const result = await this.#runtime
      .runPromise(Effect.flatMap(SniperService, (sniper) => sniper.tick()))
      .catch(() => ({ hasPending: true, checked: 0, fulfilled: 0, expired: 0 }))
    // Keep polling while pending requests remain; otherwise let the loop idle
    // until the next createRequest re-arms it.
    if (result.hasPending) {
      await this.ctx.storage.setAlarm(Date.now() + this.#pollIntervalMs)
    }
  }

  async #ensureAlarm(): Promise<void> {
    const current = await this.ctx.storage.getAlarm()
    if (current === null) {
      await this.ctx.storage.setAlarm(Date.now() + this.#pollIntervalMs)
    }
  }

  #run<A>(effect: Effect.Effect<A, unknown, SniperService>): Promise<ApiResult<A>> {
    return this.#runtime
      .runPromise(
        effect.pipe(
          Effect.matchCauseEffect({
            onSuccess: (data) => Effect.succeed({ ok: true, data } as ApiResult<A>),
            onFailure: (cause) => Effect.succeed(causeToResult<A>(cause)),
          }),
        ),
      )
      // A layer-construction failure (e.g. ConfigError) rejects the promise
      // before the inner effect runs; map it to a clean error envelope.
      .catch(
        (error): ApiResult<A> =>
          internalError(error instanceof Error ? error.message : String(error)),
      )
  }
}
