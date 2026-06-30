import { Schema } from "effect"

// ── Branded scalars at the domain seams ──────────────────────────────────────

export const RequestId = Schema.String.pipe(Schema.brand("RequestId"))
export type RequestId = typeof RequestId.Type

export const ServerTypeName = Schema.String.pipe(Schema.brand("ServerTypeName"))
export type ServerTypeName = typeof ServerTypeName.Type

export const LocationName = Schema.String.pipe(Schema.brand("LocationName"))
export type LocationName = typeof LocationName.Type

export const EmailAddress = Schema.String.pipe(Schema.brand("EmailAddress"))
export type EmailAddress = typeof EmailAddress.Type

export const RequestStatus = Schema.Literals(["pending", "fulfilled", "cancelled"])
export type RequestStatus = typeof RequestStatus.Type

// ── The server-request aggregate ─────────────────────────────────────────────

/**
 * A standing request to be notified when a Hetzner Cloud server type becomes
 * available (optionally constrained to a single location). Persisted in the
 * Durable Object's SQLite storage as its encoded (plain JSON) form.
 */
export class ServerRequest extends Schema.Class<ServerRequest>("ServerRequest")({
  id: RequestId,
  serverType: ServerTypeName,
  /** `null` means "any location". */
  location: Schema.NullOr(LocationName),
  email: EmailAddress,
  status: RequestStatus,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  fulfilledAt: Schema.NullOr(Schema.Number),
  lastCheckedAt: Schema.NullOr(Schema.Number),
  attempts: Schema.Number,
  /** The location at which availability was first observed, once fulfilled. */
  availableLocation: Schema.NullOr(LocationName),
}) {}

/** The encoded (wire + storage) representation of a {@link ServerRequest}. */
export type ServerRequestView = typeof ServerRequest.Encoded

// ── The create-request payload accepted by the API ───────────────────────────

export class CreateServerRequest extends Schema.Class<CreateServerRequest>(
  "CreateServerRequest",
)({
  serverType: Schema.NonEmptyString,
  location: Schema.optional(Schema.NonEmptyString),
  /** Defaults to NOTIFICATION_EMAIL when omitted. */
  email: Schema.optional(Schema.NonEmptyString),
}) {}

// ── Encode / decode helpers used at the storage and RPC boundaries ───────────

export const encodeRequest = Schema.encodeSync(ServerRequest)
export const decodeRequest = Schema.decodeUnknownSync(ServerRequest)

/** Returns a new request with the given encoded fields overridden. */
export const patchRequest = (
  req: ServerRequest,
  patch: Partial<ServerRequestView>,
): ServerRequest => decodeRequest({ ...encodeRequest(req), ...patch })
