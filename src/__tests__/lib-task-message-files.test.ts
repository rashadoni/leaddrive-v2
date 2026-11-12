import { describe, expect, it } from "vitest"
import { joinMessageFiles, matchMessageFiles, splitMessageFiles } from "@/lib/tasks/message-files"

describe("files named in a task message", () => {
  it("reads the file line the Bordio import wrote, and writes the same", () => {
    expect(splitMessageFiles("Baxın\n📎 a.jpg, b c.pdf")).toEqual({ body: "Baxın", names: ["a.jpg", "b c.pdf"] })
    expect(splitMessageFiles("📎 only.png")).toEqual({ body: "", names: ["only.png"] })
    expect(splitMessageFiles("no files 📎 here")).toEqual({ body: "no files 📎 here", names: [] })
    expect(joinMessageFiles(" Baxın ", ["a.jpg"])).toBe("Baxın\n📎 a.jpg")
    expect(joinMessageFiles("", ["a.jpg", "b.pdf"])).toBe("📎 a.jpg, b.pdf")
    expect(joinMessageFiles("text", [])).toBe("text")
  })

  it("matches names to the task's files whatever the case or Unicode form; two alike take two files", () => {
    const files = [
      { id: "1", fileName: "x.jpg", originalName: "Afişa.JPG" },
      { id: "2", fileName: "y.jpg", originalName: "afişa.jpg" },
    ]
    const nfd = "afişa.jpg".normalize("NFD")
    expect(matchMessageFiles([nfd, "AFİŞA.jpg".toLowerCase(), "none.png"], files).map((m) => m.file?.id ?? null)).toEqual(["1", "2", null])
  })
})

// Xayala, 2026-11-12: «2 fayl yüklədim, 3 fayl görünür».
describe("assignMessageFiles — each file in one message only", () => {
  const files = [
    { id: "new", fileName: "b.jpg", originalName: "11.11.26 ABB TamKart.jpg" },
    { id: "banner", fileName: "c.jpg", originalName: "Banner ABB.jpg" },
  ]
  it("the newest message takes the file; an older one naming a removed file shows just the name", async () => {
    const { assignMessageFiles } = await import("@/lib/tasks/message-files")
    const out = assignMessageFiles([
      { id: "m-14:36", text: "📎 11.11.26 ABB TamKart.jpg" },
      { id: "m-17:47", text: "Yeniləndi\n📎 11.11.26 ABB TamKart.jpg, Banner ABB.jpg" },
      { id: "plain", text: "Salam" },
    ], files)
    expect(out.get("m-17:47")?.map((m) => m.file?.id ?? null)).toEqual(["new", "banner"])
    expect(out.get("m-14:36")).toEqual([{ name: "11.11.26 ABB TamKart.jpg", file: null }])
    expect(out.has("plain")).toBe(false)
  })
})
