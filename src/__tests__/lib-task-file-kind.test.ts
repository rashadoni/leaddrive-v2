/**
 * Which program a task's file belongs to (src/lib/tasks/file-kind.ts). Zeytun,
 * 2026-11-23: an Excel sheet among eighteen visuals looked like all the others.
 * The extensions are the ones Zeytun's cards really hold.
 */
import { describe, expect, it } from "vitest"
import { fileKindOf } from "@/lib/tasks/file-kind"

describe("fileKindOf", () => {
  it.each([
    ["Ecodenta Black Friday.xlsx", "excel", "xlsx"], ["hesabat.XLS", "excel", "xls"], ["siyahı.csv", "excel", "csv"],
    ["Brif.docx", "word", "docx"], ["qeyd.rtf", "word", "rtf"], ["Təqdimat.pptx", "powerpoint", "pptx"], ["şərtlər.pdf", "pdf", "pdf"],
    ["banner.png", "image", "png"], ["Black friday purest-1.jpeg", "image", "jpeg"], ["post.webp", "image", "webp"],
    ["reels.mp4", "video", "mp4"], ["çəkiliş.MOV", "video", "mov"], ["səs.ogg", "audio", "ogg"],
    ["maket.cdr", "design", "cdr"], ["logo.ai", "design", "ai"], ["afişa.eps", "design", "eps"], ["retuş.psd", "design", "psd"],
    ["şəkillər.zip", "archive", "zip"], ["məktub.msg", "other", "msg"], ["qeyd.txt", "other", "txt"],
  ])("%s is %s", (name, kind, label) => {
    expect(fileKindOf(name)).toEqual({ kind, label })
  })

  it("reads the last extension: a dot inside a name is not one", () => {
    expect(fileKindOf("13.11.26 Buccotherm.v2.xlsx").kind).toBe("excel")
    expect(fileKindOf("10.04-10.05 Koteks").kind).toBe("other")
  })

  it("a name without a known extension goes by its MIME type", () => {
    expect(fileKindOf("hesabat", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toEqual({ kind: "excel", label: "xlsx" })
    expect(fileKindOf("sənəd", "application/pdf")).toEqual({ kind: "pdf", label: "pdf" })
    expect(fileKindOf("şəkil", "image/png")).toEqual({ kind: "image", label: "img" })
  })

  it("the name wins over a generic MIME type, and an unknown file still has a mark that fits", () => {
    expect(fileKindOf("Koteks.xlsx", "application/octet-stream").kind).toBe("excel")
    expect(fileKindOf("noname")).toEqual({ kind: "other", label: "file" })
    expect(fileKindOf("data.parquet")).toEqual({ kind: "other", label: "file" })
  })
})
