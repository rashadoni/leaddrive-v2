/**
 * Which program a task's file belongs to (src/lib/tasks/file-kind.ts). Zeytun,
 * 2026-11-23: an Excel sheet among eighteen visuals looked like all the others.
 * The extensions are the ones Zeytun's cards really hold.
 */
import { describe, expect, it } from "vitest"
import { fileKindOf } from "@/lib/tasks/file-kind"

describe("fileKindOf", () => {
  it.each([
    ["Ecodenta Black Friday.xlsx", "excel", "XLS"], ["hesabat.XLS", "excel", "XLS"], ["siyahı.csv", "excel", "CSV"],
    ["Brif.docx", "word", "DOC"], ["qeyd.rtf", "word", "RTF"], ["Təqdimat.pptx", "powerpoint", "PPT"], ["şərtlər.pdf", "pdf", "PDF"],
    ["banner.png", "image", "PNG"], ["Black friday purest-1.jpeg", "image", "JPG"], ["post.webp", "image", "WEBP"],
    ["reels.mp4", "video", "MP4"], ["çəkiliş.MOV", "video", "MOV"], ["səs.ogg", "audio", "OGG"],
    ["maket.cdr", "design", "CDR"], ["logo.ai", "design", "AI"], ["afişa.eps", "design", "EPS"], ["retuş.psd", "design", "PSD"],
    ["şəkillər.zip", "archive", "ZIP"], ["məktub.msg", "other", "MSG"], ["qeyd.txt", "other", "TXT"],
  ])("%s is %s", (name, kind, label) => {
    expect(fileKindOf(name)).toEqual({ kind, label })
  })

  it("reads the last extension: a dot inside a name is not one", () => {
    expect(fileKindOf("13.11.26 Buccotherm.v2.xlsx").kind).toBe("excel")
    expect(fileKindOf("10.04-10.05 Koteks").kind).toBe("other")
  })

  it("a name without a known extension goes by its MIME type", () => {
    expect(fileKindOf("hesabat", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toEqual({ kind: "excel", label: "XLS" })
    expect(fileKindOf("sənəd", "application/pdf")).toEqual({ kind: "pdf", label: "PDF" })
    expect(fileKindOf("şəkil", "image/png")).toEqual({ kind: "image", label: "IMG" })
  })

  it("the name wins over a generic MIME type, and an unknown file still has a mark that fits", () => {
    expect(fileKindOf("Koteks.xlsx", "application/octet-stream").kind).toBe("excel")
    expect(fileKindOf("noname")).toEqual({ kind: "other", label: "FILE" })
    expect(fileKindOf("data.parquet")).toEqual({ kind: "other", label: "FILE" })
  })
})
