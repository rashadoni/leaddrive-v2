/**
 * A list that came in as text becomes subtasks (Elvira, 2026-11-12: an order
 * of «45 ədəd vinil» arrives as one numbered list; the owner: «Да, делай»).
 */
import { describe, expect, it } from "vitest"
import { listLinesOf, newSubtaskTitles, pastedLines } from "@/lib/tasks/list-lines"

const ELVIRA = [
  "45 ədəd vinil, ölçülər:",
  "1. 167 (eni) x 88 (hündürlük) Ferveks + +",
  "2. 122 (eni) x 88 (hündürlük) Hedelix + +",
  "3. 168 (eni) x 88 (hündürlük) Upsarin upsa + +",
  "",
  "Son tarix: cümə",
].join("\n")

describe("listLinesOf — the list in a description", () => {
  it("takes the numbered lines, without their numbers, and leaves the rest of the text", () => {
    expect(listLinesOf(ELVIRA)).toEqual([
      "167 (eni) x 88 (hündürlük) Ferveks + +",
      "122 (eni) x 88 (hündürlük) Hedelix + +",
      "168 (eni) x 88 (hündürlük) Upsarin upsa + +",
    ])
  })

  it("reads bullets and «1)» as list lines too", () => {
    expect(listLinesOf("• Banner\n• Story\n- Post\n2) Reels")).toEqual(["Banner", "Story", "Post", "Reels"])
  })

  it("does not take a brief for a list: a date, a size or one item is not a list", () => {
    expect(listLinesOf("28.11.2026 Yuxu çatışmazlığı\nSlayd 1 — Cover\n167 (eni) x 88")).toEqual([])
    expect(listLinesOf("1. Tək sətir")).toEqual([])
    expect(listLinesOf(null)).toEqual([])
  })
})

describe("pastedLines — a list pasted into «add a subtask»", () => {
  it("makes every line a subtask, numbers and empty lines dropped; one line is an ordinary paste", () => {
    expect(pastedLines("167 x 88 Ferveks\r\n\r\n2. 122 x 88 Hedelix\n")).toEqual(["167 x 88 Ferveks", "122 x 88 Hedelix"])
    expect(pastedLines("ga4 quraşdırılması")).toBeNull()
  })

  it("keeps at most 200 lines", () => {
    expect(pastedLines(Array.from({ length: 250 }, (_, i) => `vinil ${i}`).join("\n"))).toHaveLength(200)
  })
})

describe("newSubtaskTitles — pressing the button again adds nothing", () => {
  it("skips lines already subtasks, keeps two equal lines of one list", () => {
    expect(newSubtaskTitles(["Ferveks", "Hedelix", "Hedelix"], [" ferveks "])).toEqual(["Hedelix", "Hedelix"])
    expect(newSubtaskTitles(["Ferveks"], ["Ferveks"])).toEqual([])
  })
})
