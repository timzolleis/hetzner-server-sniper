import { Schema } from "effect"

// Only the fields we actually consume are modeled; Effect Schema ignores
// unknown keys on decode, so the Hetzner responses decode resiliently.

export class ServerType extends Schema.Class<ServerType>("ServerType")({
  id: Schema.Int,
  name: Schema.String,
}) {}

export class ListServerTypesResponse extends Schema.Class<ListServerTypesResponse>(
  "ListServerTypesResponse",
)({
  server_types: Schema.Array(ServerType),
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
}) {}
