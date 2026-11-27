import { describe, expect, it } from "vitest"
import { pastedImage } from "@/lib/inbox/pasted-image"

const png = (name = "image.png") => new File([new Uint8Array([1])], name, { type: "image/png" })
const clip = (text: string, items: { kind: string; type: string; file: File | null }[], files: File[] = []) => ({
  getData: (format: string) => (format === "text/plain" ? text : ""),
  items: items.map((i) => ({ kind: i.kind, type: i.type, getAsFile: () => i.file })) as unknown as DataTransferItemList,
  files: files as unknown as FileList,
})

describe("pastedImage", () => {
  it("takes the picture of a screenshot paste", () => {
    const file = png()
    expect(pastedImage(clip("", [{ kind: "file", type: "image/png", file }]))).toBe(file)
  })

  it("leaves a paste with text to the text, picture or not", () => {
    expect(pastedImage(clip("Salam", [{ kind: "file", type: "image/png", file: png() }]))).toBeNull()
  })

  it("ignores a plain text paste and a non-picture file", () => {
    expect(pastedImage(clip("", [{ kind: "string", type: "text/html", file: null }]))).toBeNull()
    const pdf = new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" })
    expect(pastedImage(clip("", [{ kind: "file", type: "application/pdf", file: pdf }], [pdf]))).toBeNull()
    expect(pastedImage(null)).toBeNull()
  })

  it("names a picture that came without a name", () => {
    const unnamed = new File([new Uint8Array([1])], "", { type: "image/jpeg" })
    const file = pastedImage(clip("", [{ kind: "file", type: "image/jpeg", file: unnamed }]))
    expect(file?.name).toBe("image.jpeg")
  })

  it("reads the files list when the items carry none", () => {
    const file = png("shot.png")
    expect(pastedImage(clip("", [], [file]))).toBe(file)
  })
})
