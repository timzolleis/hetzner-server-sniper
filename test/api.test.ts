import { it } from "@effect/vitest"
import { assert } from "vitest"
import { Cause } from "effect"
import { causeToResult } from "../src/api"
import { ServerTypeNotFound } from "../src/errors"

it("encodes a tagged failure cause into the error envelope, fields and all", () => {
  const result = causeToResult(
    Cause.fail(new ServerTypeNotFound({ message: "unknown type", serverType: "nope" })),
  )
  assert.deepStrictEqual(result, {
    ok: false,
    error: { _tag: "ServerTypeNotFound", message: "unknown type", serverType: "nope" },
  })
})

it("flattens a defect (non-AppError) into an InternalError envelope", () => {
  const result = causeToResult(Cause.die(new Error("boom")))
  assert.strictEqual(result.ok, false)
  if (!result.ok) {
    assert.strictEqual(result.error._tag, "InternalError")
    assert.strictEqual(result.error.message, "boom")
  }
})
