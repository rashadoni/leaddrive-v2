import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const detailPath = "src/components/voip/call-journal-detail.tsx"
const detailSource = existsSync(detailPath) ? readFileSync(detailPath, "utf8") : ""
const pageSource = readFileSync("src/app/(dashboard)/support/voip/page.tsx", "utf8")

describe("call journal deep-link detail UI", () => {
  it("mounts a search-param detail inside Suspense without replacing the journal", () => {
    expect(pageSource).toContain("CallJournalDetail")
    expect(pageSource).toContain("<Suspense")
    expect(pageSource).toContain("<table")
    expect(detailSource).toContain("useSearchParams")
    expect(detailSource).toContain('searchParams.get("call")')
  })

  it("loads only the encoded exact call through the read-only calls endpoint", () => {
    expect(detailSource).toContain("encodeURIComponent(callId)")
    expect(detailSource).toMatch(/fetch\(`\/api\/v1\/calls\?id=\$\{encodeURIComponent\(callId\)\}&limit=1`/u)
    expect(detailSource).toContain('cache: "no-store"')
    expect(detailSource).toContain("if (!callId)")
    expect(detailSource).not.toMatch(/method:\s*["'](?:POST|PATCH|DELETE)["']/u)
    expect(detailSource).not.toContain("/transcribe")
    expect(detailSource).not.toContain("/analyze")
  })

  it("fails closed on a mismatched response and cancels stale requests", () => {
    expect(detailSource).toContain("AbortController")
    expect(detailSource).toContain("signal: controller.signal")
    expect(detailSource).toMatch(/candidate\?\.id\s*!==\s*callId/u)
    expect(detailSource).toContain("controller.abort()")
  })

  it("never renders cached state after the URL moves to another call", () => {
    expect(detailSource).toContain("const visibleCall = call?.id === callId ? call : null")
    expect(detailSource).toContain(") : !visibleCall ? (")
    expect(detailSource).toContain("{visibleCall.transcription}")
    expect(detailSource).toContain("visibleCall.recordingPlaybackUrl")
  })

  it("renders transcript as escaped React text and never as injected HTML", () => {
    expect(detailSource).toContain("{visibleCall.transcription}")
    expect(detailSource).toContain("<pre")
    expect(detailSource).toContain("whitespace-pre-wrap")
    expect(detailSource).toContain("break-words")
    expect(detailSource).toContain("overflow-auto")
    expect(detailSource).not.toContain("dangerouslySetInnerHTML")
    expect(detailSource).not.toContain("innerHTML")
  })

  it("offers only the protected recording path already returned by the API", () => {
    expect(detailSource).toContain("visibleCall.recordingPlaybackUrl")
    expect(detailSource).toContain('rel="noopener noreferrer"')
    expect(detailSource).not.toContain("recordingUrl")
  })

  it("has loading, retry, unavailable, no-transcript and no-recording states", () => {
    for (const key of [
      "loading",
      "loadError",
      "retry",
      "unavailable",
      "transcriptUnavailable",
      "recordingUnavailable",
    ]) {
      expect(detailSource).toContain(`t("journal.${key}")`)
    }
    expect(detailSource).toContain("min-h-11")
  })

  it("has complete Azerbaijani, Russian and English copy", () => {
    for (const locale of ["en", "ru", "az"] as const) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as {
        voip: { journal?: Record<string, string> }
      }
      for (const key of [
        "title",
        "close",
        "loading",
        "loadError",
        "retry",
        "unavailable",
        "transcript",
        "transcriptUnavailable",
        "recording",
        "openRecording",
        "recordingUnavailable",
      ]) {
        expect(messages.voip.journal?.[key]).toBeTruthy()
      }
    }
  })
})
