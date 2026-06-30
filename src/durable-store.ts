import { Context, Effect, Layer } from "effect"

/** A column value as returned by Durable Object SQLite. */
export type SqlValue = ArrayBuffer | string | number | null

/**
 * Thin Effect wrapper over a single Durable Object's persistent storage: the
 * SQLite query interface plus the key/value API. Provided via `Layer.succeed`
 * when the DO runtime is built, because the underlying `DurableObjectStorage`
 * is only available inside the Durable Object instance.
 */
export class DurableStore extends Context.Service<
  DurableStore,
  {
    /** Run a SQL statement, returning all result rows as plain objects. */
    readonly sql: (
      query: string,
      ...bindings: ReadonlyArray<SqlValue>
    ) => Effect.Effect<ReadonlyArray<Record<string, SqlValue>>>
    /** Read a structured value from key/value storage (`undefined` if absent). */
    readonly kvGet: <A>(key: string) => Effect.Effect<A | undefined>
    /** Write a structured value to key/value storage. */
    readonly kvPut: (key: string, value: unknown) => Effect.Effect<void>
  }
>()("app/DurableStore") {
  static readonly layer = (
    storage: DurableObjectStorage,
  ): Layer.Layer<DurableStore> =>
    Layer.succeed(DurableStore, {
      sql: (query, ...bindings) =>
        Effect.sync(() =>
          storage.sql
            .exec(query, ...(bindings as Array<SqlValue>))
            .toArray() as ReadonlyArray<Record<string, SqlValue>>,
        ),
      kvGet: <A>(key: string) =>
        Effect.promise(() => storage.get<A>(key)).pipe(
          Effect.map((value) => value ?? undefined),
        ),
      kvPut: (key, value) =>
        Effect.promise(() => storage.put(key, value)).pipe(Effect.asVoid),
    })
}
