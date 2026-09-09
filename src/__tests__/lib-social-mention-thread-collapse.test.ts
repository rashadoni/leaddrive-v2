import { describe, expect, it } from "vitest"
import { collapseThreadMediaRepeats } from "@/lib/social/mention-thread-collapse"

const VIDEO = "https://www.tiktok.com/embed/v2/7668437904028355860"
const PARENT = "https://tiktok.com/@xeber.group1/video/7668437904028355860"

describe("collapseThreadMediaRepeats", () => {
  it("shows the thread video once and collapses the repeats", () => {
    const { threadLeadIds, repeatedMediaIds } = collapseThreadMediaRepeats([
      { id: "c1", parentUrl: PARENT, inlineMediaKey: VIDEO },
      { id: "c2", parentUrl: PARENT, inlineMediaKey: VIDEO },
      { id: "c3", parentUrl: PARENT, inlineMediaKey: VIDEO },
    ])

    expect([...threadLeadIds]).toEqual(["c1"])
    expect([...repeatedMediaIds]).toEqual(["c2", "c3"])
  })

  it("keeps a comment's own media even inside a collapsed thread", () => {
    const { repeatedMediaIds } = collapseThreadMediaRepeats([
      { id: "c1", parentUrl: PARENT, inlineMediaKey: VIDEO },
      { id: "c2", parentUrl: PARENT, inlineMediaKey: "https://cdn.test/own-photo.jpg" },
      { id: "c3", parentUrl: PARENT, inlineMediaKey: VIDEO },
    ])

    expect(repeatedMediaIds.has("c2")).toBe(false)
    expect(repeatedMediaIds.has("c3")).toBe(true)
  })

  it("collapses a thread whose findings are interleaved with other threads", () => {
    const other = "https://facebook.com/reel/1795148388507278"
    const { threadLeadIds, repeatedMediaIds } = collapseThreadMediaRepeats([
      { id: "a1", parentUrl: PARENT, inlineMediaKey: VIDEO },
      { id: "b1", parentUrl: other, inlineMediaKey: "https://cdn.test/reel.mp4" },
      { id: "a2", parentUrl: PARENT, inlineMediaKey: VIDEO },
      { id: "b2", parentUrl: other, inlineMediaKey: "https://cdn.test/reel.mp4" },
    ])

    expect([...threadLeadIds]).toEqual(["a1", "b1"])
    expect([...repeatedMediaIds]).toEqual(["a2", "b2"])
  })

  it("lets the first finding that actually has media show it", () => {
    const { threadLeadIds, repeatedMediaIds } = collapseThreadMediaRepeats([
      { id: "c1", parentUrl: PARENT, inlineMediaKey: null },
      { id: "c2", parentUrl: PARENT, inlineMediaKey: VIDEO },
      { id: "c3", parentUrl: PARENT, inlineMediaKey: VIDEO },
    ])

    // Ведущая карточка ветки — по-прежнему первая: размер ветки объявляется один раз.
    expect([...threadLeadIds]).toEqual(["c1"])
    expect([...repeatedMediaIds]).toEqual(["c3"])
  })

  it("treats findings without a parent post as their own leads", () => {
    const { threadLeadIds, repeatedMediaIds } = collapseThreadMediaRepeats([
      { id: "p1", parentUrl: null, inlineMediaKey: VIDEO },
      { id: "p2", parentUrl: null, inlineMediaKey: VIDEO },
    ])

    expect([...threadLeadIds]).toEqual(["p1", "p2"])
    expect(repeatedMediaIds.size).toBe(0)
  })
})
