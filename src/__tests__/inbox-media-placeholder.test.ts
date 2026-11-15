import { describe, expect, it } from "vitest"
import { isMediaPlaceholder, placeholderView } from "@/lib/inbox/media-placeholder"
import { describeMetaMessageShape } from "@/lib/social/meta-message-shape"

describe("media placeholder in the inbox", () => {
  it("recognises the stored placeholders and nothing else", () => {
    for (const body of ["[media]", " [MEDIA] ", "[attachment]", "[вложение]"]) {
      expect(isMediaPlaceholder(body)).toBe(true)
    }
    for (const body of ["", "media", "[media] salam", "Salam", null, undefined]) {
      expect(isMediaPlaceholder(body)).toBe(false)
    }
  })

  it("hides the placeholder under a file that is shown", () => {
    expect(placeholderView({ body: "[media]", mediaUrl: "/uploads/inbox/o/x.mp4", channelType: "instagram" }))
      .toEqual({ kind: "hide" })
    // The reel shared from the app: Meta's page link, shown as «Instagram reel».
    expect(placeholderView({ body: "[media]", mediaUrl: "https://www.instagram.com/reel/DfuqOSORA6W/", channelType: "instagram" }))
      .toEqual({ kind: "hide" })
  })

  it("says the content is only in the app when Meta handed over no file", () => {
    // @avtorental, 2026-11-15: Graph returns this message with an empty body and no attachments.
    expect(placeholderView({ body: "[media]", mediaUrl: null, channelType: "instagram" }))
      .toEqual({ kind: "withheld", app: "Instagram" })
    expect(placeholderView({ body: "[media]", mediaUrl: "", channelType: "facebook" }))
      .toEqual({ kind: "withheld", app: "Messenger" })
    expect(placeholderView({ body: "[media]", channelType: "telegram" })).toEqual({ kind: "unavailable" })
  })

  it("shows words as words", () => {
    expect(placeholderView({ body: "Salam", mediaUrl: "/uploads/inbox/o/x.jpg", channelType: "instagram" }))
      .toEqual({ kind: "body" })
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
