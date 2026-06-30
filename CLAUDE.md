# hetzner-server-sniper — repo conventions

Effect **v4** (beta) application on **Cloudflare Workers**. Read this together with
the global Effect conventions in `~/.claude/CLAUDE.md`. The notes below are the
deltas and decisions specific to this repo.

## Runtime & stack

- **Effect v4 beta** (`effect@4.x`, single package). HTTP/Schema/etc. live under
  `effect/unstable/*` — e.g. `import { HttpClient } from "effect/unstable/http"`.
  There is **no** `@effect/platform` here. APIs may shift between betas; write
  against the installed `.d.ts`, not memory.
- **Cloudflare Workers + Durable Objects.** Types come from the wrangler-generated
  `worker-configuration.d.ts` (run `npm run cf-typegen` after editing
  `wrangler.jsonc`). Secret bindings not in `wrangler.jsonc` are declared in
  `worker-env.d.ts` (a global `interface Env` augmentation).

## Architecture decisions (why it looks like this)

- **One Durable Object (`SniperDurableObject`) is the engine.** Chosen over a cron
  trigger because cron has a 1-minute floor and we need a 30s loop + a globally
  shared rate-limit budget + colocated state. The DO owns the SQLite request
  store, the persisted token bucket, the hourly name cache, and the `alarm()` loop.
  The alarm reschedules itself only while requests are pending; `createRequest`
  re-arms it.
- **The Worker edge (`src/index.ts`) is intentionally plain TypeScript** — bearer
  auth + JSON + route dispatch → DO RPC. All domain logic is Effect; only the
  platform handler boundary is not. DO RPC methods return a plain `ApiResult`
  envelope (`src/api.ts`) so error→HTTP-status mapping happens inside the DO and
  doesn't depend on RPC error serialization.
- **Availability source:** `GET /datacenters` → a server type is available when its
  id is in some datacenter's `server_types.available`. Valid names come from
  `GET /server_types`. If the Hetzner OpenAPI spec dictates a different field, the
  only place to change is `src/hetzner/` (`schemas.ts` + `availability.ts`) — the
  matching logic in `SniperService` consumes the `ServerTypeIndex` /
  `AvailabilitySnapshot` interfaces, not raw responses.

## Code conventions

- **Services are `Context.Service` classes** with layers as statics:
  `static layer = Layer.effect(this, …)`; runtime-valued layers are functions
  (`DurableStore.layer(storage)`, `CloudflareEnv.layer(env)`). No `Live` suffix.
  `layerMemory` only where a test needs it (currently `RequestStore.layerMemory`).
- **The service graph is wired in `src/runtime.ts`** (`makeMainLayer`), composed
  bottom-up with `Layer.provideMerge`. Ordering matters: `RateLimiter` is built
  before `HetznerClient` (which takes tokens from it). The layer's only
  construction error is `ConfigError`.
- **Errors** are `Schema.TaggedErrorClass` (see `src/errors.ts`); each carries a
  `message`. `src/api.ts` maps tags → HTTP status.
- **Domain types** are branded scalars + a `ServerRequest` `Schema.Class`
  (`src/schema.ts`). Requests are stored and returned in their **encoded** form;
  `patchRequest` does an encode→override→decode round-trip to keep brands valid.
- **Testing:** `@effect/vitest` `it.effect` + `assert`. Replace seams through real
  layers (`RequestStore.layerMemory`, `Layer.succeed(AvailabilityService, …)`),
  never module mocks. Assert observable outcomes through `SniperService`'s public
  methods.

## Checks

```
npm run typecheck   # tsc --noEmit (strict, exactOptionalPropertyTypes)
npm test            # vitest
npx wrangler deploy --dry-run --outdir=/tmp/x   # validates the workerd bundle
```
