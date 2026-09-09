import { describe, expect, it } from "vitest"
import { normalizeLoginErrorCode } from "@/lib/login-error"

describe("normalizeLoginErrorCode", () => {
  it.each([null, undefined, "", " ", "undefined", "null"])(
    "treats %s as no error",
    (value) => {
      expect(normalizeLoginErrorCode(value)).toBeNull()
    },
  )

  it("preserves a real Auth.js error code", () => {
    expect(normalizeLoginErrorCode("CredentialsSignin")).toBe("CredentialsSignin")
  })
})
