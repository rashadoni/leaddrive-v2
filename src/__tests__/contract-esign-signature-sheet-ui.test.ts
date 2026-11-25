// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useLocale: () => "az",
  useTranslations: () => {
    const translate = (key: string, values?: Record<string, unknown>) => (values ? `${key}${JSON.stringify(values)}` : key)
    translate.has = () => true
    return translate
  },
}))
import { EsignSignatureSheet } from "@/components/contract-esign-signature-sheet"
import { readHint } from "./helpers/hint"

/**
 * «İmza vərəqi» in the contract card (owner's mock 2026-11-25, step 4): who
 * signed, how, when, from where, the fingerprint of the signed text, and a
 * button for the signed PDF. On real React in jsdom: what the person reads
 * and what the button opens. Keys stand in for the translated words.
 */
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const HASH = "3f2a9c1d" + "0".repeat(48) + "77e3a019"
const PDF_URL = "/api/v1/contracts/ctr-1/pdf?download=1&lang=az&signed=1&envelope=env-7&tz=Asia%2FBaku"

async function renderSheet() {
  await act(async () => {
    root.render(
      createElement(EsignSignatureSheet, {
        envelope: {
          signers: [
            { id: "s1", fullName: "Rəşad Rəhimov", email: "director@example.az", role: "signer", signedAt: "2026-11-25T06:42:00Z", signatureMethod: "typed", signedIpAddress: "5.191.10.4" },
            { id: "s2", fullName: "Fərid Qəhrəmanov", email: "farid@kaspi.az", role: "signer", signedAt: "2026-11-25T10:05:09Z", signatureMethod: "drawn", signedIpAddress: null },
            { id: "s3", fullName: "Mühasibat", email: "acc@example.az", role: "cc", signedAt: null },
          ],
        },
        signedVersion: { versionNo: 3, contentHash: HASH },
        pdfUrl: PDF_URL,
      }),
    )
  })
}

const sheet = () => container.querySelector<HTMLElement>('[data-testid="esign-signature-sheet"]')!

describe("the signature sheet in the contract card", () => {
  it("shows each signer with how they signed and from where, and leaves copy recipients out", async () => {
    await renderSheet()
    const text = sheet().textContent ?? ""
    expect(text).toContain("esignSheetTitle")
    expect(text).toContain("Rəşad Rəhimov")
    expect(text).toContain("Fərid Qəhrəmanov")
    expect(text).not.toContain("Mühasibat")
    expect(text).toContain("esignMethodTyped")
    expect(text).toContain("esignMethodDrawn")
    expect(text).toContain("5.191.10.4")
    // no address recorded → no empty «IP:» line
    expect(text.match(/esignSignedFromIp/g)).toHaveLength(1)
  })

  it("marks every signature as simple and explains on hover what that means", async () => {
    await renderSheet()
    const tags = [...sheet().querySelectorAll("span")].filter((el) => el.textContent === "esignSimpleSignature")
    expect(tags).toHaveLength(2)
    expect(await readHint(tags[0])).toBe("esignSimpleSignatureHint")
  })

  it("prints the fingerprint shortened, with its version, and the full meaning in a hint", async () => {
    await renderSheet()
    expect(sheet().textContent).toContain('esignFingerprint{"version":3}')
    const value = sheet().querySelector("[data-hint-value]")!
    expect(value.textContent).toBe("3f2a9c1d…77e3a019")
    expect(await readHint(value)).toBe("esignFingerprintHint")
  })

  it("opens the signed PDF from a button that says what it is", async () => {
    const open = vi.fn()
    vi.stubGlobal("open", open)
    await renderSheet()
    const button = [...sheet().querySelectorAll("button")].find((b) => b.textContent?.includes("esignSignedPdf"))!
    expect(await readHint(button)).toBe("esignSignedPdfHint")
    await act(async () => button.click())
    expect(open).toHaveBeenCalledWith(PDF_URL, "_blank")
  })
})
