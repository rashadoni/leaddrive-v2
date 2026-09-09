// @vitest-environment jsdom

import { act, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({
    asChild,
    children,
    variant: _variant,
    size: _size,
    ...props
  }: {
    asChild?: boolean
    children?: ReactNode
    variant?: string
    size?: string
    [key: string]: unknown
  }) => {
    void _variant
    void _size
    if (asChild && isValidElement(children)) {
      return cloneElement(children as ReactElement<Record<string, unknown>>, props)
    }
    return createElement("button", props, children)
  },
}))

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DropdownMenuItem: ({
    asChild,
    children,
    onSelect,
  }: {
    asChild?: boolean
    children?: ReactNode
    onSelect?: () => void
  }) => {
    if (asChild && isValidElement(children)) return children
    return createElement("button", { type: "button", onClick: onSelect }, children)
  },
}))

import { toast } from "sonner"
import { OriginalSourceButton } from "@/components/social/original-source-button"

describe("OriginalSourceButton", () => {
  let container: HTMLDivElement
  let root: Root
  const writeText = vi.fn<(value: string) => Promise<void>>()
  const execCommand = vi.fn<(command: string) => boolean>()

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    writeText.mockReset().mockResolvedValue(undefined)
    execCommand.mockReset().mockReturnValue(true)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it("keeps the canonical link and exposes a mobile Facebook fallback", () => {
    const url = "https://www.facebook.com/example/posts/pfbid123?comment_id=456"

    act(() => {
      root.render(createElement(OriginalSourceButton, { url, label: "Open original" }))
    })

    const links = Array.from(container.querySelectorAll("a"))
    expect(links).toHaveLength(2)
    expect(links[0]?.getAttribute("href")).toBe(url)
    expect(links[0]?.getAttribute("target")).toBe("_blank")
    expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer")
    expect(links[1]?.getAttribute("href")).toBe(
      "https://m.facebook.com/example/posts/pfbid123?comment_id=456",
    )
    expect(container.querySelector('button[aria-label="originalLinkOptions"]')).not.toBeNull()
  })

  it("copies the exact original URL", async () => {
    const url = "https://www.facebook.com/example/posts/pfbid123"

    act(() => {
      root.render(createElement(OriginalSourceButton, { url, label: "Open original" }))
    })

    const copyButton = Array.from(container.querySelectorAll("button"))
      .find(button => button.textContent?.includes("copyOriginalLink"))
    expect(copyButton).toBeTruthy()

    await act(async () => {
      copyButton?.click()
    })

    expect(writeText).toHaveBeenCalledWith(url)
    expect(toast.success).toHaveBeenCalledWith("originalLinkCopied")
  })

  it("falls back to a temporary readonly field when Clipboard API rejects the write", async () => {
    const url = "https://www.instagram.com/p/example"
    writeText.mockRejectedValueOnce(new Error("denied"))

    act(() => {
      root.render(createElement(OriginalSourceButton, { url, label: "Open original" }))
    })

    const copyButton = Array.from(container.querySelectorAll("button"))
      .find(button => button.textContent?.includes("copyOriginalLink"))
    await act(async () => {
      copyButton?.click()
    })

    expect(execCommand).toHaveBeenCalledWith("copy")
    expect(document.querySelector('textarea[readonly]')).toBeNull()
    expect(toast.success).toHaveBeenCalledWith("originalLinkCopied")
  })

  it("reports a copy failure when neither copy path succeeds", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    })
    execCommand.mockReturnValue(false)

    act(() => {
      root.render(createElement(OriginalSourceButton, {
        url: "https://www.instagram.com/p/example",
        label: "Open original",
      }))
    })

    const copyButton = Array.from(container.querySelectorAll("button"))
      .find(button => button.textContent?.includes("copyOriginalLink"))
    await act(async () => {
      copyButton?.click()
    })

    expect(toast.error).toHaveBeenCalledWith("originalLinkCopyFailed")
  })

  it("does not invent a Facebook fallback for another platform", () => {
    act(() => {
      root.render(createElement(OriginalSourceButton, {
        url: "https://www.youtube.com/watch?v=video-1",
        label: "Open original",
      }))
    })

    expect(container.querySelectorAll("a")).toHaveLength(1)
    expect(container.textContent).not.toContain("openFacebookMobile")
  })
})
