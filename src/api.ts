import { Cause } from "effect"

/**
 * The plain, structured-cloneable envelope returned by every Durable Object RPC
 * method. The Worker edge maps it directly onto an HTTP response, so all error
 * classification happens here (inside the DO) rather than relying on RPC error
 * serialization.
 */
export type ApiResult<A> =
  | { readonly ok: true; readonly data: A }
  | {
      readonly ok: false
      readonly status: number
      readonly tag: string
      readonly error: string
    }

const STATUS_BY_TAG: Record<string, number> = {
  InvalidRequest: 400,
  ServerTypeNotFound: 422,
  RequestNotFound: 404,
  RateLimitExceeded: 429,
  HetznerApiError: 502,
  EmailSendError: 502,
  ConfigError: 500,
}

export const formatError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

/** Map an Effect failure cause onto the error envelope, classifying by tag. */
export const causeToResult = <A>(cause: Cause.Cause<unknown>): ApiResult<A> => {
  const error = Cause.squash(cause) as { _tag?: string; message?: string }
  const tag = typeof error._tag === "string" ? error._tag : "Internal"
  return {
    ok: false,
    status: STATUS_BY_TAG[tag] ?? 500,
    tag,
    error: error.message ?? formatError(error),
  }
}
