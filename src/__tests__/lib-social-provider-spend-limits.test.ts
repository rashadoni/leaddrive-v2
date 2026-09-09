import { describe, expect, it } from "vitest"

import {
  allocateClientFundedSourceCapsUsd,
  CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD,
} from "@/lib/social/provider-spend-limits"

const MICRO_USD_PER_USD = 1_000_000

function toMicroUsd(value: number): number {
  return Math.round(value * MICRO_USD_PER_USD)
}

describe("client-funded source cap allocation", () => {
  it("allocates the full micro-USD-rounded cap to discovery when comments are omitted", () => {
    const allocation = allocateClientFundedSourceCapsUsd({
      authorizedTotalUsd: 0.123456789,
      includeDependentComments: false,
    })

    expect(allocation).toEqual({
      discoveryUsd: 0.123456,
      commentsUsd: null,
    })
    expect(Object.isFrozen(allocation)).toBe(true)
  })

  it("splits the cap between discovery and dependent comments without exceeding it", () => {
    const authorizedTotalUsd = 0.020005
    const allocation = allocateClientFundedSourceCapsUsd({
      authorizedTotalUsd,
      includeDependentComments: true,
    })

    expect(allocation).toEqual({
      discoveryUsd: 0.010003,
      commentsUsd: 0.010002,
    })
    expect(Object.isFrozen(allocation)).toBe(true)
    expect(toMicroUsd(allocation!.discoveryUsd) + toMicroUsd(allocation!.commentsUsd!))
      .toBeLessThanOrEqual(Math.floor(authorizedTotalUsd * MICRO_USD_PER_USD))
  })

  it("accepts the exact two-cent minimum for discovery plus comments", () => {
    expect(allocateClientFundedSourceCapsUsd({
      authorizedTotalUsd: 0.02,
      includeDependentComments: true,
    })).toEqual({
      discoveryUsd: 0.01,
      commentsUsd: 0.01,
    })
  })

  it("fails closed when micro-USD rounding leaves either comments allocation below one cent", () => {
    expect(allocateClientFundedSourceCapsUsd({
      authorizedTotalUsd: 0.019999999,
      includeDependentComments: true,
    })).toBeNull()
  })

  it("rounds down before splitting so fractional micro-USD cannot overflow the authorization", () => {
    const authorizedTotalUsd = 0.020000999
    const allocation = allocateClientFundedSourceCapsUsd({
      authorizedTotalUsd,
      includeDependentComments: true,
    })

    expect(allocation).toEqual({
      discoveryUsd: 0.01,
      commentsUsd: 0.01,
    })
    expect(toMicroUsd(allocation!.discoveryUsd) + toMicroUsd(allocation!.commentsUsd!))
      .toBeLessThanOrEqual(Math.floor(authorizedTotalUsd * MICRO_USD_PER_USD))
  })

  it("accepts the exact client-funded provider fuse", () => {
    expect(allocateClientFundedSourceCapsUsd({
      authorizedTotalUsd: CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD,
      includeDependentComments: true,
    })).toEqual({
      discoveryUsd: 50,
      commentsUsd: 50,
    })
  })

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0,
    -0.01,
    CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD + 0.000001,
  ])("rejects invalid or unauthorized total %s instead of clamping it", (authorizedTotalUsd) => {
    expect(allocateClientFundedSourceCapsUsd({
      authorizedTotalUsd,
      includeDependentComments: false,
    })).toBeNull()
  })
})
