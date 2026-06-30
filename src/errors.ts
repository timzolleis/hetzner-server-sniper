import { Schema } from "effect"

/** Required environment configuration was missing or invalid. */
export class ConfigError extends Schema.TaggedErrorClass<ConfigError>()(
  "ConfigError",
  { message: Schema.String },
) {}

/** The incoming API payload could not be decoded. → HTTP 400 */
export class InvalidRequest extends Schema.TaggedErrorClass<InvalidRequest>()(
  "InvalidRequest",
  { message: Schema.String },
) {}

/** The requested server type is not a known Hetzner Cloud server type. → 422 */
export class ServerTypeNotFound extends Schema.TaggedErrorClass<ServerTypeNotFound>()(
  "ServerTypeNotFound",
  { message: Schema.String, serverType: Schema.String },
) {}

/** No server request exists with the given id. → 404 */
export class RequestNotFound extends Schema.TaggedErrorClass<RequestNotFound>()(
  "RequestNotFound",
  { message: Schema.String, id: Schema.String },
) {}

/** The local Hetzner rate-limit budget is exhausted. → 429 */
export class RateLimitExceeded extends Schema.TaggedErrorClass<RateLimitExceeded>()(
  "RateLimitExceeded",
  { message: Schema.String, retryAfterMs: Schema.Number },
) {}

/** A call to the Hetzner Cloud API failed or returned an unparseable body. → 502 */
export class HetznerApiError extends Schema.TaggedErrorClass<HetznerApiError>()(
  "HetznerApiError",
  { message: Schema.String, status: Schema.optional(Schema.Number) },
) {}

/** Sending a notification e-mail through Resend failed. → 502 */
export class EmailSendError extends Schema.TaggedErrorClass<EmailSendError>()(
  "EmailSendError",
  { message: Schema.String, status: Schema.optional(Schema.Number) },
) {}

/** Every modeled failure of the application's services. */
export type AppError =
  | ConfigError
  | InvalidRequest
  | ServerTypeNotFound
  | RequestNotFound
  | RateLimitExceeded
  | HetznerApiError
  | EmailSendError
