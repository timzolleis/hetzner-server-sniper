import { Context, Effect, Layer } from "effect"
import { DurableStore } from "../durable-store"
import { decodeRequest, encodeRequest, ServerRequest } from "../schema"

const CREATE_TABLE =
  "CREATE TABLE IF NOT EXISTS server_requests (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL)"

/**
 * Persists {@link ServerRequest} aggregates in the Durable Object's SQLite
 * storage. Each request is stored as its encoded JSON form, with the status
 * mirrored into an indexed column so pending requests can be queried cheaply.
 */
export class RequestStore extends Context.Service<
  RequestStore,
  {
    readonly create: (req: ServerRequest) => Effect.Effect<void>
    readonly update: (req: ServerRequest) => Effect.Effect<void>
    readonly list: () => Effect.Effect<ReadonlyArray<ServerRequest>>
    readonly get: (id: string) => Effect.Effect<ServerRequest | undefined>
    readonly pending: () => Effect.Effect<ReadonlyArray<ServerRequest>>
    readonly countPending: () => Effect.Effect<number>
  }
>()("app/RequestStore") {
  static readonly layer = Layer.effect(
    RequestStore,
    Effect.gen(function* () {
      const store = yield* DurableStore
      // Ensure the schema exists when the layer is built.
      yield* store.sql(CREATE_TABLE)

      const decodeRows = (
        rows: ReadonlyArray<Record<string, unknown>>,
      ): ReadonlyArray<ServerRequest> =>
        rows.map((row) => decodeRequest(JSON.parse(String(row.data))))

      const persist = (verb: "INSERT INTO" | "REPLACE INTO") =>
        (req: ServerRequest): Effect.Effect<void> =>
          store
            .sql(
              `${verb} server_requests (id, status, data) VALUES (?, ?, ?)`,
              req.id,
              req.status,
              JSON.stringify(encodeRequest(req)),
            )
            .pipe(Effect.asVoid)

      return {
        create: persist("INSERT INTO"),
        update: persist("REPLACE INTO"),
        list: () =>
          store
            .sql("SELECT data FROM server_requests ORDER BY rowid")
            .pipe(Effect.map(decodeRows)),
        get: (id) =>
          store
            .sql("SELECT data FROM server_requests WHERE id = ?", id)
            .pipe(Effect.map((rows) => decodeRows(rows)[0])),
        pending: () =>
          store
            .sql("SELECT data FROM server_requests WHERE status = 'pending' ORDER BY rowid")
            .pipe(Effect.map(decodeRows)),
        countPending: () =>
          store
            .sql("SELECT COUNT(*) AS n FROM server_requests WHERE status = 'pending'")
            .pipe(Effect.map((rows) => Number(rows[0]?.n ?? 0))),
      }
    }),
  )

  /** In-memory adapter for tests that exercise services depending on the store. */
  static readonly layerMemory = Layer.sync(RequestStore, () => {
    const records = new Map<string, ServerRequest>()
    const pendingValues = () =>
      [...records.values()].filter((req) => req.status === "pending")
    return {
      create: (req) => Effect.sync(() => void records.set(req.id, req)),
      update: (req) => Effect.sync(() => void records.set(req.id, req)),
      list: () => Effect.sync(() => [...records.values()]),
      get: (id) => Effect.sync(() => records.get(id)),
      pending: () => Effect.sync(pendingValues),
      countPending: () => Effect.sync(() => pendingValues().length),
    }
  })
}
