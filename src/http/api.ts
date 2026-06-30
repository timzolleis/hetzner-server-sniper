import { Schema } from "effect"
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi"
import {
  InternalError,
  InvalidRequest,
  RequestNotFound,
  ServerTypeNotFound,
} from "../errors"
import { CreateServerRequest, RequestId, ServerRequest } from "../schema"
import { BearerAuth } from "./auth"

const RequestList = Schema.Array(ServerRequest)
const ServerTypes = Schema.Struct({ names: Schema.Array(Schema.String) })
const IdParam = { id: RequestId }

// Every endpoint carries InternalError: the edge flattens any non-domain RPC
// failure (defects, ConfigError from a failed layer build) to a 500 here.
const sniperGroup = HttpApiGroup.make("sniper")
  .add(
    HttpApiEndpoint.post("createRequest", "/requests", {
      payload: CreateServerRequest,
      success: ServerRequest.pipe(HttpApiSchema.status(201)),
      error: [InvalidRequest, ServerTypeNotFound, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.get("listRequests", "/requests", {
      success: RequestList,
      error: [InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.get("getRequest", "/requests/:id", {
      params: IdParam,
      success: ServerRequest,
      error: [RequestNotFound, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("cancelRequest", "/requests/:id", {
      params: IdParam,
      success: ServerRequest,
      error: [RequestNotFound, InternalError],
    }),
  )
  .add(
    HttpApiEndpoint.get("listServerTypes", "/server-types", {
      success: ServerTypes,
      error: [InternalError],
    }),
  )
  .middleware(BearerAuth)

/** Unauthenticated liveness probe; documented in the OpenAPI spec. */
const healthGroup = HttpApiGroup.make("health").add(
  HttpApiEndpoint.get("health", "/health", {
    success: Schema.Struct({ status: Schema.Literal("ok") }),
  }),
)

export const api = HttpApi.make("hetzner-sniper").add(sniperGroup, healthGroup)
