import { Cause, Schema } from "effect"
import { AppErrorUnion, type EncodedAppError } from "./errors"

/**
 * The plain, structured-cloneable envelope returned by every Durable Object RPC
 * method. The Worker edge maps it onto an HTTP response, so error classification
 * happens here (inside the DO) rather than relying on RPC error serialization.
 *
 * The failure arm carries the **fully encoded** tagged error (all fields), not a
 * squashed message: the edge reconstructs the matching error so HttpApi can
 * render a faithful body and the OpenAPI-declared status (via `httpApiStatus`).
 */
export type ApiResult<A> =
  | { readonly ok: true; readonly data: A }
  | { readonly ok: false; readonly error: EncodedAppError }

const encodeError = Schema.encodeUnknownSync(AppErrorUnion)

export const formatError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

/** A 500 envelope for an unexpected failure that isn't a modeled {@link AppError}. */
export const internalError = (message: string): ApiResult<never> => ({
  ok: false,
  error: { _tag: "InternalError", message },
})

/**
 * Map an Effect failure cause onto the error envelope. A modeled tagged error is
 * encoded as-is; anything else (a defect) becomes an `InternalError`.
 */
export const causeToResult = <A>(cause: Cause.Cause<unknown>): ApiResult<A> => {
  const squashed = Cause.squash(cause)
  try {
    return { ok: false, error: encodeError(squashed) }
  } catch {
    return internalError(formatError(squashed))
  }
}
