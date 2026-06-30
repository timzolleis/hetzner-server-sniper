import { Schema } from "effect"

/** Required environment configuration was missing or invalid. */
export class ConfigError extends Schema.TaggedErrorClass<ConfigError>()(
  "ConfigError",
  { message: Schema.String },
  { httpApiStatus: 500 },
) {}

/** The incoming API payload could not be decoded. */
export class InvalidRequest extends Schema.TaggedErrorClass<InvalidRequest>()(
  "InvalidRequest",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

/** The requested server type is not a known Hetzner Cloud server type. */
export class ServerTypeNotFound extends Schema.TaggedErrorClass<ServerTypeNotFound>()(
  "ServerTypeNotFound",
  { message: Schema.String, serverType: Schema.String },
  { httpApiStatus: 422 },
) {}

/** No server request exists with the given id. */
export class RequestNotFound extends Schema.TaggedErrorClass<RequestNotFound>()(
  "RequestNotFound",
  { message: Schema.String, id: Schema.String },
  { httpApiStatus: 404 },
) {}

/** The local Hetzner rate-limit budget is exhausted. */
export class RateLimitExceeded extends Schema.TaggedErrorClass<RateLimitExceeded>()(
  "RateLimitExceeded",
  { message: Schema.String, retryAfterMs: Schema.Number },
  { httpApiStatus: 429 },
) {}

/** A call to the Hetzner Cloud API failed or returned an unparseable body. */
export class HetznerApiError extends Schema.TaggedErrorClass<HetznerApiError>()(
  "HetznerApiError",
  { message: Schema.String, status: Schema.optional(Schema.Number) },
  { httpApiStatus: 502 },
) {}

/** Delivering a notification through a channel (e.g. e-mail, webhook) failed. */
export class NotificationError extends Schema.TaggedErrorClass<NotificationError>()(
  "NotificationError",
  {
    message: Schema.String,
    channel: Schema.String,
    status: Schema.optional(Schema.Number),
  },
  { httpApiStatus: 502 },
) {}

/** The bearer credential was missing or did not match. Produced only at the edge. */
export class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

/** An unexpected failure: a defect, or a layer-construction error. */
export class InternalError extends Schema.TaggedErrorClass<InternalError>()(
  "InternalError",
  { message: Schema.String },
  { httpApiStatus: 500 },
) {}

/** Every modeled failure of the application's services. */
export type AppError =
  | ConfigError
  | InvalidRequest
  | ServerTypeNotFound
  | RequestNotFound
  | RateLimitExceeded
  | HetznerApiError
  | NotificationError

/**
 * The errors that can cross the Durable Object RPC boundary as an
 * {@link AppError}-shaped envelope. `Unauthorized` is excluded: it is produced
 * only at the Worker edge by the bearer middleware, before any RPC happens.
 */
export const AppErrorUnion = Schema.Union([
  ConfigError,
  InvalidRequest,
  ServerTypeNotFound,
  RequestNotFound,
  RateLimitExceeded,
  HetznerApiError,
  NotificationError,
  InternalError,
])

/** The encoded (structured-cloneable) form carried over RPC; discriminated by `_tag`. */
export type EncodedAppError = typeof AppErrorUnion.Encoded
