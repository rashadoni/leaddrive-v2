import { describe, expect, it } from "vitest"
import {
  NEW_WHATSAPP_NUMBER_PURPOSE,
  isWhatsAppInboundPurpose,
  ticketWhatsAppChannelId,
  whatsappInboundPurpose,
  whatsappNumberFilesTickets,
} from "@/lib/channels/whatsapp-inbound-purpose"
import { channelSettingsForUpdate, serverOwnedSettingKeys } from "@/lib/channels/server-owned-settings"

/**
 * What a WhatsApp number is for (owner, 2026-11-21): «Переписка» — the inbox only — or «Поддержка»
 * — every message a Service Desk ticket. The rule that must never drift: a number with nothing
 * stored is a support number, because that is what every number did before the choice existed.
 */
describe("the purpose of a WhatsApp number", () => {
  it("reads a number from before the choice as «Поддержка»: nobody's working number changes on a deploy", () => {
    for (const settings of [undefined, null, {}, { replyMode: "agent" }, { inboundPurpose: "" }, { inboundPurpose: "something else" }, "conversations", ["conversations"]]) {
      expect(whatsappInboundPurpose(settings), JSON.stringify(settings)).toBe("support")
      expect(whatsappNumberFilesTickets(settings), JSON.stringify(settings)).toBe(true)
    }
  })

  it("files no tickets only for a number explicitly set to «Переписка»", () => {
    expect(whatsappInboundPurpose({ inboundPurpose: "conversations" })).toBe("conversations")
    expect(whatsappNumberFilesTickets({ inboundPurpose: "conversations" })).toBe(false)
    expect(whatsappNumberFilesTickets({ inboundPurpose: "support" })).toBe(true)
  })

  it("starts a newly connected number as «Переписка»", () => {
    expect(NEW_WHATSAPP_NUMBER_PURPOSE).toBe("conversations")
    expect(isWhatsAppInboundPurpose("conversations")).toBe(true)
    expect(isWhatsAppInboundPurpose("support")).toBe(true)
    expect(isWhatsAppInboundPurpose("tickets")).toBe(false)
    expect(isWhatsAppInboundPurpose(undefined)).toBe(false)
  })

  it("reads the number a ticket came in on, and nothing from a ticket that never recorded it", () => {
    expect(ticketWhatsAppChannelId({ phone: "994501112233", channelConfigId: "cfg-support" })).toBe("cfg-support")
    for (const meta of [null, undefined, {}, { phone: "994501112233" }, { channelConfigId: "" }, { channelConfigId: 7 }, "cfg-support"]) {
      expect(ticketWhatsAppChannelId(meta), JSON.stringify(meta)).toBeNull()
    }
  })
})

describe("the channel form's Save and the number's purpose", () => {
  it("cannot erase it: a number set to «Переписка» does not go back to opening tickets", () => {
    expect(serverOwnedSettingKeys("whatsapp")).toContain("inboundPurpose")
    // The form rebuilds `settings` from its own fields, so the key is simply absent from the request.
    const saved = channelSettingsForUpdate("whatsapp", { chatId: "x" }, { inboundPurpose: "conversations", replyMode: "agent" })
    expect(saved).toMatchObject({ inboundPurpose: "conversations", replyMode: "agent" })
  })

  it("cannot write it either: only the number's own endpoint does", () => {
    const legacy = channelSettingsForUpdate("whatsapp", { inboundPurpose: "conversations" }, { replyMode: "agent" })
    expect(legacy).not.toHaveProperty("inboundPurpose")
    const chosen = channelSettingsForUpdate("whatsapp", { inboundPurpose: "support" }, { inboundPurpose: "conversations" })
    expect(chosen).toMatchObject({ inboundPurpose: "conversations" })
  })
})
