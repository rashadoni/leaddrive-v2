import { beforeEach, describe, expect, it, vi } from "vitest"
const dispatch = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: dispatch }))
import { publishWhatsAppIntegrationEvent } from "@/lib/integrations/whatsapp-events"
import { requiredScopesForEvent } from "@/lib/zapier-auth"
import { ZAPIER_TRIGGER_CATALOG } from "@/lib/zapier-triggers"

beforeEach(() => vi.clearAllMocks())
describe("WhatsApp integration events", () => {
  it("publishes only allowed fields with a stable deduplication identity", async () => {
    const event = { id: "wamid1", channelConfigId: "channel1", direction: "inbound" as const, status: "received" as const, contactId: "contact1", phone: "PRIVATE", accessToken: "PRIVATE", body: "PRIVATE", metadata: { token: "PRIVATE" } }
    await publishWhatsAppIntegrationEvent("org1", event)
    const [org, name, payload] = dispatch.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(org).toBe("org1"); expect(name).toBe("whatsapp.message_received")
    expect(payload).toMatchObject({ id: "wamid1:received", messageId: "wamid1", contactId: "contact1" })
    expect(JSON.stringify(payload)).not.toContain("PRIVATE")
    await publishWhatsAppIntegrationEvent("org1", event)
    expect((dispatch.mock.calls[1] as unknown as [string, string, Record<string, unknown>])[2].id).toBe(payload.id)
  })
  it("separates delivery receipts from inbound events", async () => {
    await publishWhatsAppIntegrationEvent("org1", { id: "wamid1", channelConfigId: "channel1", direction: "outbound", status: "delivered" })
    expect(dispatch).toHaveBeenCalledWith("org1", "whatsapp.message_status", expect.objectContaining({ status: "delivered", id: "wamid1:delivered" }), { awaitDelivery: true })
  })
  it("does not fail ingest when the destination is unavailable", async () => {
    dispatch.mockRejectedValueOnce(new Error("destination offline"))
    await expect(publishWhatsAppIntegrationEvent("org1", { id: "wamid1", channelConfigId: "channel1", direction: "outbound", status: "failed" })).resolves.toBeUndefined()
  })
  it("requires inbox scopes for both Zapier triggers", () => {
    for (const key of ["whatsapp.message_received", "whatsapp.message_status"]) {
      expect(requiredScopesForEvent(key)).toEqual(["read:inbox", "write:inbox"])
      expect(ZAPIER_TRIGGER_CATALOG.find(entry => entry.key === key)?.required_scopes).toEqual(["read:inbox"])
    }
  })
})
