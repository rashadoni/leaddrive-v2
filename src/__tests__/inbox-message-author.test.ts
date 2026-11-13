import { describe, it, expect } from "vitest"
import { messageAuthor } from "@/lib/inbox/message-author"

/**
 * The badge under an outbound message must say who wrote it, or — when nobody can know — where.
 * The metadata below is exactly what each writer stores: send-conversation-reply (CRM),
 * the AI paths, meta-dm-app-echo / whatsapp-app-echo (the platform's app on a phone).
 */
describe("who wrote an outbound message", () => {
  it("a reply sent from the CRM names the person who was signed in", () => {
    const meta = { sentVia: "leaddrive_inbox", authorType: "operator", authorUserId: "u1", authorName: "Narmin Bağırlı" }
    expect(messageAuthor(meta, "instagram")).toEqual({ kind: "person", name: "Narmin Bağırlı" })
  })

  it("a reply typed in the Instagram app says so, instead of «author not recorded»", () => {
    const meta = { platform: "instagram", source: "business_app", sentFromBusinessApp: true, accountId: "1784", recipientId: "1318" }
    expect(messageAuthor(meta, "instagram")).toEqual({ kind: "app", app: "Instagram" })
  })

  it("a reply brought in from the account's history is the same: written in the app", () => {
    const meta = { source: "business_app", sentFromBusinessApp: true, importedFromHistory: true }
    expect(messageAuthor(meta, "instagram")).toEqual({ kind: "app", app: "Instagram" })
  })

  it("names the app the team actually opens on each platform", () => {
    expect(messageAuthor({ sentFromBusinessApp: true }, "facebook")).toEqual({ kind: "app", app: "Messenger" })
    expect(messageAuthor({ source: "business_app", sentFromBusinessApp: true }, "whatsapp")).toEqual({ kind: "app", app: "WhatsApp Business" })
  })

  it("the AI is the AI, whichever path sent it", () => {
    expect(messageAuthor({ aiAutoReply: true, authorType: "ai" }, "instagram")).toEqual({ kind: "ai" })
    expect(messageAuthor({ aiGenerated: true }, "web-chat")).toEqual({ kind: "ai" })
  })

  it("an operator row without a stored name, and a row with nothing, keep their old labels", () => {
    expect(messageAuthor({ authorType: "operator", authorName: "  " }, "telegram")).toEqual({ kind: "operator" })
    expect(messageAuthor({ sentVia: "leaddrive_inbox" }, "instagram")).toEqual({ kind: "unknown" })
    expect(messageAuthor(null, "email")).toEqual({ kind: "unknown" })
  })
})
