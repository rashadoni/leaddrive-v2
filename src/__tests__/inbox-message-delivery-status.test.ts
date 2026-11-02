// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"
import { MessageDeliveryStatus } from "@/components/inbox/message-delivery-status"

const labels = {
  unknown: "Delivery not confirmed",
  read: "Read",
  delivered: "Delivered",
  failed: "Not delivered",
  sent: "Sent",
  sending: "Sending",
}

describe("Inbox provider delivery receipts", () => {
  it("updates a sent message to read without falling back to sending", async () => {
    const container = document.createElement("div")
    const root = createRoot(container)
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    try {
      await act(async () => root.render(createElement(MessageDeliveryStatus, { status: "sent", deliveryUnknown: false, labels })))
      expect(container.querySelector('[aria-label="Sent"]')?.textContent).toBe("✓")
      await act(async () => root.render(createElement(MessageDeliveryStatus, { status: "read", deliveryUnknown: false, labels })))
      const receipt = container.querySelector('[aria-label="Read"]')!
      expect(receipt.textContent).toBe("✓✓")
      expect(receipt.getAttribute("title")).toBe("Read")
      expect(receipt.classList.contains("text-sky-500")).toBe(true)
      expect(container.textContent).not.toContain("⏳")
    } finally {
      await act(async () => root.unmount())
    }
  })

  it("keeps an explicit uncertain result visible instead of claiming delivery", async () => {
    const container = document.createElement("div")
    const root = createRoot(container)
    try {
      await act(async () => root.render(createElement(MessageDeliveryStatus, { status: "read", deliveryUnknown: true, labels })))
      expect(container.querySelector('[aria-label="Delivery not confirmed"]')?.textContent).toBe("⚠")
      expect(container.querySelector('[aria-label="Read"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
    }
  })
})
