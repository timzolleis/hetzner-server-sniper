import { Clock, Context, Effect, Layer } from "effect"
import { AppConfig } from "../config"
import { DurableStore } from "../durable-store"
import { HetznerApiError, RateLimitExceeded } from "../errors"
import { HetznerClient } from "./client"
import { ListDataCentersResponse, ListServerTypesResponse } from "./schemas"

const SERVER_TYPES_CACHE_KEY = "cache:server-types"

/** Maps server-type name → id, plus the sorted list of valid names. */
export interface ServerTypeIndex {
  readonly byName: ReadonlyMap<string, number>
  readonly names: ReadonlyArray<string>
}

/** A point-in-time view of which server-type ids are orderable, by location. */
export interface AvailabilitySnapshot {
  readonly availableByTypeId: ReadonlyMap<number, ReadonlySet<string>>
}

interface CachedServerTypes {
  readonly fetchedAt: number
  readonly entries: ReadonlyArray<readonly [string, number]>
}

const buildIndex = (
  entries: ReadonlyArray<readonly [string, number]>,
): ServerTypeIndex => ({
  byName: new Map(entries),
  names: entries.map(([name]) => name).sort(),
})

/**
 * Reads Hetzner availability. The server-type catalogue (name ↔ id) is cached
 * in Durable Object storage and refreshed at most once per
 * `SERVER_TYPE_CACHE_TTL_SECONDS`; the per-datacenter availability snapshot is
 * fetched fresh on every poll.
 */
export class AvailabilityService extends Context.Service<
  AvailabilityService,
  {
    readonly serverTypeIndex: () => Effect.Effect<
      ServerTypeIndex,
      HetznerApiError | RateLimitExceeded
    >
    readonly snapshot: () => Effect.Effect<
      AvailabilitySnapshot,
      HetznerApiError | RateLimitExceeded
    >
  }
>()("app/AvailabilityService") {
  static readonly layer = Layer.effect(
    AvailabilityService,
    Effect.gen(function* () {
      const client = yield* HetznerClient
      const store = yield* DurableStore
      const config = yield* AppConfig

      const fetchServerTypes = Effect.fn("AvailabilityService.fetchServerTypes")(
        function* () {
          const response = yield* client.getJson("/server_types", ListServerTypesResponse)
          return response.server_types.map(
            (type) => [type.name, type.id] as const,
          )
        },
      )

      return {
        serverTypeIndex: () =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const cached = yield* store.kvGet<CachedServerTypes>(SERVER_TYPES_CACHE_KEY)

            if (cached && now - cached.fetchedAt < config.serverTypeCacheTtlMs) {
              return buildIndex(cached.entries)
            }

            const entries = yield* fetchServerTypes()
            yield* store.kvPut(SERVER_TYPES_CACHE_KEY, { fetchedAt: now, entries })
            return buildIndex(entries)
          }).pipe(Effect.withSpan("AvailabilityService.serverTypeIndex")),

        snapshot: () =>
          Effect.gen(function* () {
            const response = yield* client.getJson("/datacenters", ListDataCentersResponse)
            const availableByTypeId = new Map<number, Set<string>>()
            for (const datacenter of response.datacenters) {
              for (const typeId of datacenter.server_types.available) {
                const locations = availableByTypeId.get(typeId) ?? new Set<string>()
                locations.add(datacenter.location.name)
                availableByTypeId.set(typeId, locations)
              }
            }
            return { availableByTypeId }
          }).pipe(Effect.withSpan("AvailabilityService.snapshot")),
      }
    }),
  )
}
