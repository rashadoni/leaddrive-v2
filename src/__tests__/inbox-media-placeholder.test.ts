import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/transcription/transcribe", () => ({ resolveTranscriptionClient: vi.fn() }))

import {
  isMediaPlaceholder,
  parsePlaceholder,
  placeholderPreview,
  placeholderView,
  voiceTranscript,
} from "@/lib/inbox/media-placeholder"
import { describeMetaMessageShape } from "@/lib/social/meta-message-shape"
import { describeWaMessage } from "@/lib/whatsapp-message-text"
import { VOICE_MESSAGE_PREFIX, voiceMessageBody } from "@/lib/inbox/inbound-voice-transcript"

const en = JSON.parse(readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8")).inboxV2 as Record<string, string>

/** Every placeholder body found on production on 2026-11-15 (channel_messages and conversation previews). */
const SEEN_ON_PROD = [
  "[media]",
  "[attachment]",
  "[unsupported attachment]",
  "[Вложение]",
  "[Видео]",
  "[Изображение]",
  "[Аудио сообщение]",
  "[Стикер]",
  "[unsupported]",
  "[Форма: Lead Drive]",
  "[Форма: Rashad]",
  "[template:crm_notification_v1]",
  "[template:salon_visit_reminder]",
  "[template:hello_world]",
  "[Документ: leaddrive-mtm-v1.6.0.apk]",
  // 2026-11-16: the first live WhatsApp history import (a message Meta did not hand over).
  "[errors]",
]

describe("placeholder vocabulary", () => {
  it("knows every placeholder production holds", () => {
    for (const body of SEEN_ON_PROD) {
      expect(parsePlaceholder(body), body).not.toBeNull()
    }
  })

  it("knows every placeholder the WhatsApp reader writes", () => {
    const wordless = [
      { type: "image" }, { type: "video" }, { type: "audio" }, { type: "voice" },
      { type: "document", document: { filename: "price.pdf" } }, { type: "document" },
      { type: "sticker" }, { type: "location", location: { latitude: 40.4, longitude: 49.8 } },
      { type: "contacts" }, { type: "reaction", reaction: { emoji: "👍" } }, { type: "reaction" },
      { type: "button" }, { type: "interactive" },
      { type: "interactive", interactive: { nfm_reply: { response_json: JSON.stringify({ client: "Rəşad" }) } } },
      { type: "interactive", interactive: { nfm_reply: { response_json: "{}" } } },
      { type: "unsupported" }, { type: "unknown" }, { type: "errors" },
    ]
    for (const msg of wordless) {
      const { text } = describeWaMessage(msg)
      expect(parsePlaceholder(text), text).not.toBeNull()
    }
  })

  it("knows every placeholder the Telegram webhook writes", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/api/v1/webhooks/telegram/route.ts"), "utf8")
    const literals = [...source.matchAll(/mediaPlaceholder = (?:message\.sticker\.emoji \? `\[Стикер \$\{[^}]+\}\]` : )?["`](\[[^"`$]+\])["`]/g)].map((m) => m[1])
    expect(literals.length).toBeGreaterThanOrEqual(7)
    for (const body of literals) expect(parsePlaceholder(body), body).not.toBeNull()
    expect(parsePlaceholder("[Документ: report.pdf]")).toEqual({ kind: "document", detail: "report.pdf" })
    expect(parsePlaceholder("[Стикер 😀]")).toEqual({ kind: "sticker", detail: "😀" })
  })

  it("leaves a customer's own bracketed words alone", () => {
    for (const body of ["[Urgent]", "[media] salam", "Salam [media]", "[]", "", "media", null, undefined]) {
      expect(isMediaPlaceholder(body), String(body)).toBe(false)
    }
  })

  it("has a label in the catalogue for every kind it reads", () => {
    for (const body of SEEN_ON_PROD) {
      const label = placeholderPreview(body)
      expect(label, body).not.toBeNull()
      expect(en[label!.key], `${body} → ${label!.key}`).toBeTruthy()
    }
    for (const key of ["mediaWithheld", "mediaWithheldButtons", "mediaUnavailable", "placeholderNoFile", "placeholderVoice"]) {
      expect(en[key], key).toBeTruthy()
    }
  })
})

describe("what the thread shows", () => {
  it("hides the placeholder under a file that is shown", () => {
    expect(placeholderView({ body: "[media]", mediaUrl: "/uploads/inbox/o/x.mp4", channelType: "instagram" }))
      .toEqual({ kind: "hide" })
    expect(placeholderView({ body: "[Изображение]", mediaUrl: "/uploads/inbox/o/x.jpg", channelType: "whatsapp" }))
      .toEqual({ kind: "hide" })
    expect(placeholderView({ body: "[attachment]", mediaUrl: "https://cdn/x.png", channelType: "tiktok" }))
      .toEqual({ kind: "hide" })
    // The reel shared from the app: Meta's page link, shown as «Instagram reel».
    expect(placeholderView({ body: "[media]", mediaUrl: "https://www.instagram.com/reel/DfuqOSORA6W/", channelType: "instagram" }))
      .toEqual({ kind: "hide" })
  })

  it("gives a document's name to its link", () => {
    expect(placeholderView({ body: "[Документ: price.pdf]", mediaUrl: "/uploads/inbox/o/p.pdf", channelType: "whatsapp" }))
      .toEqual({ kind: "hide", fileName: "price.pdf" })
  })

  it("says the content is only in the app when the platform did not hand it over", () => {
    // @avtorental, 2026-11-15: Graph returns this message with an empty body and no attachments.
    // The owner looked in the app: it was the «write on WhatsApp» button of their auto-reply.
    expect(placeholderView({ body: "[media]", mediaUrl: null, channelType: "instagram" }))
      .toEqual({ kind: "withheld", app: "Instagram", buttons: true })
    expect(placeholderView({ body: "[media]", mediaUrl: "", channelType: "facebook" }))
      .toEqual({ kind: "withheld", app: "Messenger", buttons: true })
    expect(placeholderView({ body: "[unsupported attachment]", channelType: "tiktok" }))
      .toEqual({ kind: "withheld", app: "TikTok" })
    expect(placeholderView({ body: "[unsupported]", channelType: "whatsapp" }))
      .toEqual({ kind: "withheld", app: "WhatsApp" })
    expect(placeholderView({ body: "[attachment]", channelType: "vkontakte" })).toEqual({ kind: "unavailable" })
  })

  it("names what a wordless message was, and says when its file did not arrive", () => {
    expect(placeholderView({ body: "[Видео]", mediaUrl: null, channelType: "whatsapp" }))
      .toEqual({ kind: "label", label: { key: "placeholderVideo" }, noFile: true })
    expect(placeholderView({ body: "[template:crm_notification_v1]", channelType: "whatsapp" }))
      .toEqual({ kind: "label", label: { key: "placeholderTemplateNamed", values: { name: "crm_notification_v1" } }, noFile: false })
    expect(placeholderView({ body: "[Форма: Lead Drive]", channelType: "whatsapp" }))
      .toEqual({ kind: "label", label: { key: "placeholderFormNamed", values: { name: "Lead Drive" } }, noFile: false })
  })

  it("shows words as words", () => {
    expect(placeholderView({ body: "Salam", mediaUrl: "/uploads/inbox/o/x.jpg", channelType: "instagram" }))
      .toEqual({ kind: "body" })
  })

  it("reads a voice transcript without its Azerbaijani prefix", () => {
    expect(VOICE_MESSAGE_PREFIX).toBe("[Səsli mesaj]")
    expect(voiceTranscript(voiceMessageBody("Salam, 10 qutu Mezim"))).toBe("Salam, 10 qutu Mezim")
    expect(voiceTranscript("[Səsli mesaj]")).toBeNull()
    expect(voiceTranscript("Salam")).toBeNull()
  })
})

describe("what the conversation list shows", () => {
  it("names the placeholder instead of printing it", () => {
    expect(placeholderPreview("[media]")).toEqual({ key: "mediaPreview" })
    expect(placeholderPreview("[unsupported attachment]")).toEqual({ key: "placeholderUnsupported" })
    expect(placeholderPreview("[Аудио сообщение]")).toEqual({ key: "placeholderAudio" })
    expect(placeholderPreview("Salam")).toBeNull()
  })
})

describe("shape of a Meta message without text or file", () => {
  it("names attachment types, payload keys and flags, never content", () => {
    const shape = describeMetaMessageShape({
      mid: "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQx",
      text: "",
      is_unsupported: true,
      attachments: [
        { type: "template", payload: { generic: { elements: [{ title: "Rent a car 50 AZN" }] } } },
        { type: "share", payload: { url: "https://lookaside.fbsbx.com/secret?asset_id=1" } },
      ],
    })
    expect(shape).toBe("keys=attachments,is_unsupported,mid,text attachments=template{generic};share{url} flags=is_unsupported")
    expect(shape).not.toMatch(/Rent a car|lookaside|aWdfZ/)
  })

  it("survives a message that is not an object", () => {
    expect(describeMetaMessageShape(undefined)).toBe("message=none")
    expect(describeMetaMessageShape({ mid: "x" })).toBe("keys=mid attachments=-")
  })

  it("cannot be steered into the log line by a hostile type name", () => {
    const shape = describeMetaMessageShape({ attachments: [{ type: "image\n[FAKE] ok=1 https://evil" }] })
    // One line, and nothing in it that reads as a link or a field of its own.
    expect(shape).toBe("keys=attachments attachments=imageFAKEok1httpsevil{}")
  })
})
