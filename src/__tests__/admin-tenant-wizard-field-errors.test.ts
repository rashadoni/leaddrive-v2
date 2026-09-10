import { describe, expect, it } from "vitest"

import { locateFieldError } from "@/app/admin/tenants/new/field-errors"

describe("new-tenant wizard field errors", () => {
  it("puts an API field path back on the step and input the admin filled in", () => {
    expect(locateFieldError("primaryBrand.website: Invalid URL")).toEqual({
      step: 2,
      field: "Official website",
      reason: "Invalid URL",
    })
  })

  it("ignores the array index, which points at no separate input", () => {
    expect(locateFieldError('channels.1: Invalid option: expected one of "email"|"webchat"')).toEqual({
      step: 3,
      field: "Channels",
      reason: 'Invalid option: expected one of "email"|"webchat"',
    })
    expect(locateFieldError("primaryBrand.languages.0: Too small")).toEqual({
      step: 2,
      field: "Languages",
      reason: "Too small",
    })
  })

  it("keeps a reason that itself contains a colon", () => {
    expect(locateFieldError("primaryBrand.name: Invalid input: expected string, received undefined")?.reason)
      .toBe("Invalid input: expected string, received undefined")
  })

  it("declines anything that is not a field rejection, so it is shown as it arrived", () => {
    expect(locateFieldError("Rate limit exceeded. Max 10 tenants per hour.")).toBeNull()
    expect(locateFieldError("Invalid input")).toBeNull()
    expect(locateFieldError('Slug "fanum" is reserved')).toBeNull()
    expect(locateFieldError("idempotencyKey: Too small")).toBeNull()
  })
})
