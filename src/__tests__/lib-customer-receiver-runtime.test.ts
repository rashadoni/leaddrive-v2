import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { captureAllowed, deliveryAllowed, loadRuntimeBindings, runtimeBindingsFileSchema, runtimeSwitches, type RuntimeBinding } from "@/lib/integrations/customer-receiver/runtime/binding"
import type { ReceiverEffectMetadata } from "@/lib/integrations/customer-receiver/runtime/capture"
import { classifyMappedResponse } from "@/lib/integrations/customer-receiver/runtime/worker"
import { defaultBuilderProfile } from "@/lib/integrations/customer-receiver/constructor/profile"

const binding: RuntimeBinding = {
  integrationId: "aac-erp", organizationId: "org-1", environment: "TEST", enabled: true, contractApproved: true, durableIdempotencyConfirmed: false,
  profile: { draftId: "draft-1", revision: 1, sha256: "a".repeat(64) },
  target: { origin: "https://receiver.test.internal", privateIpv4: "10.0.0.10" },
  credentials: { accessTokenFile: "/run/secrets/token", certificateFile: "/run/secrets/cert", privateKeyFile: "/run/secrets/key", caFile: "/run/secrets/ca" },
  payloadTtlHours: 72, securityLogRetentionDays: 90, pauseAfterUncertain: 3,
}
const file = (bindings: unknown[]) => JSON.stringify({ schemaVersion: "1.0", bindings })

describe("operator runtime binding", () => {
  it("is disabled unless the file, both switches and the approvals are all present", () => {
    expect(loadRuntimeBindings({})).toEqual({ bindings: [], error: "not_configured" })
    expect(loadRuntimeBindings({ CUSTOMER_RECEIVER_RUNTIME_BINDINGS_FILE: "/x" }, () => { throw new Error("ENOENT") })).toEqual({ bindings: [], error: "unreadable" })
    expect(loadRuntimeBindings({ CUSTOMER_RECEIVER_RUNTIME_BINDINGS_FILE: "/x" }, () => "{")).toEqual({ bindings: [], error: "invalid" })
    expect(loadRuntimeBindings({ CUSTOMER_RECEIVER_RUNTIME_BINDINGS_FILE: "/x" }, () => file([binding])).bindings).toEqual([binding])
    expect(runtimeSwitches({})).toEqual({ capture: false, delivery: false })
    expect(runtimeSwitches({ CUSTOMER_RECEIVER_CAPTURE_ENABLED: "true", CUSTOMER_RECEIVER_DELIVERY_ENABLED: "1" })).toEqual({ capture: false, delivery: false })
    const on = runtimeSwitches({ CUSTOMER_RECEIVER_CAPTURE_ENABLED: "on", CUSTOMER_RECEIVER_DELIVERY_ENABLED: "on" })
    expect(captureAllowed(binding, on) && deliveryAllowed(binding, on)).toBe(true)
    expect(captureAllowed({ ...binding, contractApproved: false }, on)).toBe(false)
    expect(deliveryAllowed({ ...binding, target: null }, on)).toBe(false)
    expect(deliveryAllowed({ ...binding, credentials: null }, on)).toBe(false)
    expect(deliveryAllowed(binding, { capture: true, delivery: false })).toBe(false)
  })

  it("ships an operator template that parses and enables nothing", () => {
    const parsed = runtimeBindingsFileSchema.parse(JSON.parse(readFileSync("ops/customer-receiver/runtime-bindings.example.json", "utf8")))
    const on = { capture: true, delivery: true }
    expect(parsed.bindings.every((entry) => !captureAllowed(entry, on) && !deliveryAllowed(entry, on))).toBe(true)
  })

  it("rejects secrets inline, relative secret paths, unknown keys and duplicates", () => {
    const load = (bindings: unknown[]) => loadRuntimeBindings({ CUSTOMER_RECEIVER_RUNTIME_BINDINGS_FILE: "/x" }, () => file(bindings)).error
    expect(load([{ ...binding, credentials: { ...binding.credentials, accessToken: "inline-secret" } }])).toBe("invalid")
    expect(load([{ ...binding, credentials: { ...binding.credentials!, caFile: "../ca.pem" } }])).toBe("invalid")
    expect(load([{ ...binding, credentials: { ...binding.credentials!, caFile: "/run/../etc/ca.pem" } }])).toBe("invalid")
    expect(load([{ ...binding, integrationId: "aac:erp" }])).toBe("invalid")
    expect(load([{ ...binding, payloadTtlHours: 24 * 15 }])).toBe("invalid")
    expect(load([binding, binding])).toBe("invalid")
    expect(load([{ ...binding, receiverUrl: "https://x" }])).toBe("invalid")
  })
})

describe("mapped receipt classification", () => {
  const metadata = {
    eventId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", externalId: "cmp-1", entityVersion: 3, receipt: defaultBuilderProfile().receipt,
  } as ReceiverEffectMetadata
  const receipt = (changes: Record<string, unknown> = {}) => JSON.stringify({ status: "accepted", eventId: metadata.eventId, externalId: "cmp-1", acceptedVersion: 3, receiptId: "r-1", operationId: "op-1", acceptedAt: "2026-10-14T10:00:00Z", ...changes })

  it("accepts only a receipt for this exact event, record and version", () => {
    expect(classifyMappedResponse(metadata, { status: 201, body: receipt() })).toMatchObject({ outcome: "succeeded", receipt: { receiptId: "r-1", acceptedVersion: 3 } })
    for (const body of [receipt({ acceptedVersion: 2 }), receipt({ externalId: "cmp-2" }), receipt({ status: "queued" }), receipt({ error: "x" }), "not json", JSON.stringify({ status: "accepted" })]) {
      expect(classifyMappedResponse(metadata, { status: 200, body })).toMatchObject({ outcome: "reconciliation_required", reason: "invalid_receipt" })
    }
  })

  it("never treats a possibly-applied outcome as a definite failure", () => {
    expect(classifyMappedResponse(metadata, null)).toMatchObject({ outcome: "reconciliation_required", reason: "transport_error" })
    for (const status of [429, 500, 502, 503, 504, 302, 307, 100]) expect(classifyMappedResponse(metadata, { status, body: "" }).outcome).toBe("reconciliation_required")
    expect(classifyMappedResponse(metadata, { status: 422, body: "" })).toMatchObject({ outcome: "definitely_failed", reason: "invalid_data" })
    expect(classifyMappedResponse(metadata, { status: 403, body: "" })).toMatchObject({ outcome: "definitely_failed", reason: "access_denied" })
    expect(classifyMappedResponse(metadata, { status: 409, body: "" })).toMatchObject({ outcome: "definitely_failed", reason: "conflict" })
    expect(classifyMappedResponse(metadata, { status: 404, body: "" })).toMatchObject({ outcome: "definitely_failed", reason: "contract_mismatch" })
  })
})
