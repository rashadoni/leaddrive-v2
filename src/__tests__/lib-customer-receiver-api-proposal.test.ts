import { describe, expect, it } from "vitest"
import { buildReceivingApiProposal } from "../lib/integrations/customer-receiver/constructor/api-proposal"
import { defaultBuilderProfile } from "../lib/integrations/customer-receiver/constructor/profile"

describe("customer receiving API proposal", () => {
  it("has no operational server, credential or OAuth URL and requires both bearer and mTLS", () => {
    const proposal = buildReceivingApiProposal(defaultBuilderProfile())
    expect(proposal.openapi).toBe("3.1.0")
    expect(proposal).not.toHaveProperty("servers")
    expect(proposal["x-leaddrive-operational"]).toBe(false)
    expect(proposal.security).toEqual([{ bearerAuth: [], clientCertificate: [] }])
    expect(JSON.stringify(proposal)).not.toContain("tokenUrl")
    expect(proposal.info.description).toContain("receipt lookup")
  })
  it("preserves aliases, missing-field policy, request headers and output decimal precision", () => {
    const profile = defaultBuilderProfile()
    const deal = profile.resources.find((entry) => entry.resource === "deals")!
    const proposal = buildReceivingApiProposal(profile)
    const operation = proposal.paths[deal.path.replace("{resource}", "deals")].put!
    const body = operation.requestBody.content["application/json"].schema
    expect(body.required).toContain("eventId")
    expect(body.properties!.deal.properties!.amount.pattern).toBe("^-?(0|[1-9]\\d*)\\.\\d{2}$")
    expect(operation.parameters.map((entry) => entry.name)).toEqual(["externalId", "Idempotency-Key", "X-Correlation-ID"])
    expect(operation.responses["2XX"].description).toContain("HTTP success alone is insufficient")
    const customer = proposal.paths["/integration/v1/customers/{externalId}"].put!.requestBody.content["application/json"].schema
    expect(customer.properties!.customer.required).not.toContain("email")
    const email = profile.resources[0].mappings.find((entry) => entry.id === "email")!
    email.missing = "null"
    const next = buildReceivingApiProposal(profile).paths["/integration/v1/customers/{externalId}"].put!.requestBody.content["application/json"].schema
    expect(next.properties!.customer.required).toContain("email")
    expect(next.properties!.customer.properties!.email.anyOf).toContainEqual({ type: "null" })
  })
  it("exports only enabled resources and supports a shared POST receiving path", () => {
    const profile = defaultBuilderProfile()
    profile.resources.forEach((entry) => { entry.path = "/import"; entry.method = "POST" })
    profile.resources[1].enabled = false
    const proposal = buildReceivingApiProposal(profile)
    expect(Object.keys(proposal.paths)).toEqual(["/import"])
    const operation = proposal.paths["/import"].post!
    expect(operation["x-leaddrive-resources"]).toEqual(["customers", "deals"])
    expect(operation.requestBody.content["application/json"].schema.anyOf).toHaveLength(2)
    expect(operation.parameters.some((entry) => entry.in === "path")).toBe(false)
  })
  it("supports nested receipt aliases and rejects scalar/object collisions", () => {
    const profile = defaultBuilderProfile()
    for (const [key, value] of Object.entries(profile.receipt)) if (key.endsWith("Path")) (profile.receipt as Record<string, string>)[key] = `result.${value}`
    const receipt = buildReceivingApiProposal(profile).paths["/integration/v1/customers/{externalId}"].put!.responses["2XX"].content!["application/json"].schema
    expect(receipt.required).toEqual(["result"])
    expect(receipt.properties!.result.properties!.status.const).toBe(profile.receipt.acceptedValue)
    expect(receipt.additionalProperties).toBe(true)
    profile.receipt.statusPath = "result"
    expect(() => buildReceivingApiProposal(profile)).toThrow("overlapping_receipt_paths")
  })
  it("fails closed for custom fields without the authenticated tenant catalogue", () => {
    const profile = defaultBuilderProfile()
    profile.resources[0].mappings.push({ id: "custom", target: "customer.code", source: { type: "field", field: "custom.company.code" }, missing: "omit", transforms: [] })
    expect(() => buildReceivingApiProposal(profile)).toThrow("unregistered_source_field")
  })
  it("keeps an impossible lookup schema valid, retains lookup fallback, and does not mutate the profile", () => {
    const profile = defaultBuilderProfile()
    profile.resources[0].mappings.find((entry) => entry.id === "country")!.transforms = [{ type: "lookup", entries: [], fallback: "reject" }]
    const before = structuredClone(profile)
    const schema = buildReceivingApiProposal(profile).paths["/integration/v1/customers/{externalId}"].put!.requestBody.content["application/json"].schema
    expect(schema.properties!.customer.properties!.countryCode.not).toEqual({})
    expect(profile).toEqual(before)
    profile.resources[0].mappings.find((entry) => entry.id === "country")!.transforms = [{ type: "lookup", entries: [{ from: "AZ", to: 1 }], fallback: "keep" }]
    const next = buildReceivingApiProposal(profile).paths["/integration/v1/customers/{externalId}"].put!.requestBody.content["application/json"].schema
    expect(next.properties!.customer.properties!.countryCode.anyOf).toEqual([{ type: "number", const: 1 }, { type: "string" }])
  })
})
