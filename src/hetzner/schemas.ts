import { Schema } from "effect"

// Only the fields we actually consume are modeled; Effect Schema ignores
// unknown keys on decode, so the Hetzner responses decode resiliently.

/** `meta.pagination` — `next_page` is `null` on the last page. */
class Pagination extends Schema.Class<Pagination>("Pagination")({
  next_page: Schema.NullOr(Schema.Int),
}) {}

class Meta extends Schema.Class<Meta>("Meta")({
  pagination: Pagination,
}) {}

/** Shared interface of the paginated list responses. */
export interface PagedResponse {
  readonly meta: Meta
}

export const nextPage = (response: PagedResponse): number | null =>
  response.meta.pagination.next_page

/** The `{ error: { code, message } }` envelope Hetzner returns on failures. */
class HetznerError extends Schema.Class<HetznerError>("HetznerError")({
  code: Schema.String,
  message: Schema.String,
}) {}

export class ErrorResponse extends Schema.Class<ErrorResponse>("ErrorResponse")({
  error: HetznerError,
}) {}

export class ServerType extends Schema.Class<ServerType>("ServerType")({
  id: Schema.Int,
  name: Schema.String,
}) {}

export class ListServerTypesResponse extends Schema.Class<ListServerTypesResponse>(
  "ListServerTypesResponse",
)({
  server_types: Schema.Array(ServerType),
  meta: Meta,
}) {}

class DataCenterLocation extends Schema.Class<DataCenterLocation>("DataCenterLocation")({
  name: Schema.String,
}) {}

class ServerTypesAvailability extends Schema.Class<ServerTypesAvailability>(
  "ServerTypesAvailability",
)({
  /** Server type ids currently orderable in this datacenter. */
  available: Schema.Array(Schema.Int),
}) {}

export class DataCenter extends Schema.Class<DataCenter>("DataCenter")({
  name: Schema.String,
  location: DataCenterLocation,
  server_types: ServerTypesAvailability,
}) {}

export class ListDataCentersResponse extends Schema.Class<ListDataCentersResponse>(
  "ListDataCentersResponse",
)({
  datacenters: Schema.Array(DataCenter),
  meta: Meta,
}) {}
