import { Clock, Context, Effect, Layer, Schema } from "effect"
import { AppConfig } from "./config"
import { InvalidRequest, ServerTypeNotFound } from "./errors"
import { AvailabilityService } from "./hetzner/availability"
import type { AvailabilitySnapshot, ServerTypeIndex } from "./hetzner/availability"
import { Notifier } from "./notify/notifier"
import { RequestStore } from "./requests/store"
import {
  CreateServerRequest,
  decodeRequest,
  encodeRequest,
  patchRequest,
  ServerRequest,
  type ServerRequestView,
} from "./schema"
import { formatError } from "./api"

/** Outcome of one poll cycle, used to decide whether to reschedule the alarm. */
export interface TickResult {
  readonly hasPending: boolean
  readonly checked: number
  readonly fulfilled: number
  readonly expired: number
}

/**
 * Resolve whether a request is now satisfiable. Returns the matched location
 * name, or `null` when not yet available.
 */
const matchLocation = (
  req: ServerRequest,
  index: ServerTypeIndex,
  snapshot: AvailabilitySnapshot,
): string | null => {
  const typeId = index.byName.get(req.serverType)
  if (typeId === undefined) return null
  const locations = snapshot.availableByTypeId.get(typeId)
  if (locations === undefined || locations.size === 0) return null
  if (req.location !== null) {
    return locations.has(req.location) ? req.location : null
  }
  for (const location of locations) return location
  return null
}

/**
 * The application's use cases: managing server requests and running the poll
 * cycle that fulfils them. This is the only service the Durable Object drives.
 */
export class SniperService extends Context.Service<
  SniperService,
  {
    readonly createRequest: (
      input: unknown,
    ) => Effect.Effect<ServerRequestView, InvalidRequest | ServerTypeNotFound>
    readonly listRequests: () => Effect.Effect<ReadonlyArray<ServerRequestView>>
    readonly getRequest: (id: string) => Effect.Effect<ServerRequestView | undefined>
    readonly cancelRequest: (id: string) => Effect.Effect<ServerRequestView | undefined>
    readonly serverTypeNames: () => Effect.Effect<ReadonlyArray<string>>
    readonly tick: () => Effect.Effect<TickResult>
  }
>()("app/SniperService") {
  static readonly layer = Layer.effect(
    SniperService,
    Effect.gen(function* () {
      const store = yield* RequestStore
      const availability = yield* AvailabilityService
      const notifier = yield* Notifier
      const config = yield* AppConfig

      return {
        createRequest: (input) =>
          Effect.gen(function* () {
            const payload = yield* Schema.decodeUnknownEffect(CreateServerRequest)(
              input,
            ).pipe(
              Effect.mapError(
                (error) =>
                  new InvalidRequest({
                    message: `Invalid request body: ${formatError(error)}`,
                  }),
              ),
            )

            const index = yield* availability.serverTypeIndex().pipe(
              Effect.mapError(
                (error) =>
                  new ServerTypeNotFound({
                    serverType: payload.serverType,
                    message: `Could not validate server type: ${error.message}`,
                  }),
              ),
            )
            if (!index.byName.has(payload.serverType)) {
              return yield* new ServerTypeNotFound({
                serverType: payload.serverType,
                message: `Unknown Hetzner server type '${payload.serverType}'. Known types: ${index.names.join(", ")}`,
              })
            }

            const now = yield* Clock.currentTimeMillis
            const id = yield* Effect.sync(() => crypto.randomUUID())
            const req = decodeRequest({
              id,
              serverType: payload.serverType,
              location: payload.location ?? null,
              // null = use each channel's default (e.g. NOTIFICATION_EMAIL).
              email: payload.email ?? null,
              status: "pending",
              createdAt: now,
              updatedAt: now,
              fulfilledAt: null,
              lastCheckedAt: null,
              attempts: 0,
              availableLocation: null,
            })
            yield* store.create(req)
            return encodeRequest(req)
          }).pipe(Effect.withSpan("SniperService.createRequest")),

        listRequests: () =>
          store.list().pipe(Effect.map((reqs) => reqs.map((req) => encodeRequest(req)))),

        getRequest: (id) =>
          store.get(id).pipe(Effect.map((req) => (req ? encodeRequest(req) : undefined))),

        cancelRequest: (id) =>
          Effect.gen(function* () {
            const existing = yield* store.get(id)
            if (existing === undefined) return undefined
            const now = yield* Clock.currentTimeMillis
            const cancelled = patchRequest(existing, { status: "cancelled", updatedAt: now })
            yield* store.update(cancelled)
            return encodeRequest(cancelled)
          }).pipe(Effect.withSpan("SniperService.cancelRequest")),

        serverTypeNames: () =>
          availability.serverTypeIndex().pipe(
            Effect.map((index) => index.names),
            // Surface a stale/empty list rather than failing the read endpoint.
            Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<string>)),
          ),

        tick: () =>
          Effect.gen(function* () {
            const pending = yield* store.pending()
            if (pending.length === 0) {
              return { hasPending: false, checked: 0, fulfilled: 0, expired: 0 }
            }

            const now = yield* Clock.currentTimeMillis

            // Auto-evict requests older than the TTL. This runs independently of
            // Hetzner, so stale requests are reclaimed even when the API is down.
            const active: Array<ServerRequest> = []
            let expired = 0
            for (const req of pending) {
              if (now - req.createdAt > config.requestTtlMs) {
                yield* store.update(
                  patchRequest(req, { status: "expired", updatedAt: now }),
                )
                expired++
              } else {
                active.push(req)
              }
            }

            // Match the survivors against current availability. Skips the
            // Hetzner call entirely when everything was just evicted.
            const matchActive = Effect.gen(function* () {
              const index = yield* availability.serverTypeIndex()
              const snapshot = yield* availability.snapshot()
              let count = 0
              for (const req of active) {
                const location = matchLocation(req, index, snapshot)
                if (location !== null) {
                  const updated = patchRequest(req, {
                    status: "fulfilled",
                    updatedAt: now,
                    fulfilledAt: now,
                    lastCheckedAt: now,
                    attempts: req.attempts + 1,
                    availableLocation: location,
                  })
                  yield* store.update(updated)
                  // Notification is best-effort and handled inside the Notifier
                  // (per-channel failures are logged); fulfilment stands either way.
                  yield* notifier.notify(updated, location)
                  count++
                } else {
                  yield* store.update(
                    patchRequest(req, { lastCheckedAt: now, attempts: req.attempts + 1 }),
                  )
                }
              }
              return count
            }).pipe(
              // Availability fetch failures keep the loop alive for the next tick.
              Effect.catchCause((cause) =>
                Effect.as(Effect.logWarning("Poll cycle skipped", cause), 0),
              ),
            )

            const fulfilled = active.length === 0 ? 0 : yield* matchActive

            const remaining = yield* store.countPending()
            return {
              hasPending: remaining > 0,
              checked: pending.length,
              fulfilled,
              expired,
            }
          }).pipe(Effect.withSpan("SniperService.tick")),
      }
    }),
  )
}
