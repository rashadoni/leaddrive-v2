/** A picture in a task message asks for the 480 px thumbnail; a retry keeps it (owner, 2026-11-12). */
import { describe, expect, it } from "vitest"
import { messagePictureSrc } from "@/components/tasks/task-panel/task-panel-feed"

describe("messagePictureSrc", () => {
  it("shows a stored task file from its thumbnail, and a retry keeps the width", () => {
    expect(messagePictureSrc("/uploads/tasks/a1.jpg", 0)).toBe("/uploads/tasks/a1.jpg?w=480")
    expect(messagePictureSrc("/uploads/tasks/a1.jpg", 2)).toBe("/uploads/tasks/a1.jpg?w=480&try=2")
  })

  it("leaves any other address as it is", () => {
    expect(messagePictureSrc("https://cdn.example/x.png", 0)).toBe("https://cdn.example/x.png")
    expect(messagePictureSrc("https://cdn.example/x.png", 1)).toBe("https://cdn.example/x.png?try=1")
  })
})
