import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * /mtm/visits for an office manager (prod audit 2026-09-14, owner: «решай»).
 *
 * The page gave every viewer the agent's execution workspace: a supervisor
 * opening Anar's finished visit to ADV-Store 22 saw forms to fill in, a
 * "complete visit" bar and a photo upload that would have filed the office's
 * photo as the agent's evidence — and none of the three photos, the signature
 * or the note that actually came from the field.
 */
const page = readFileSync("src/app/(dashboard)/mtm/visits/page.tsx", "utf8")
const panel = readFileSync("src/app/(dashboard)/mtm/visits/visit-review-panel.tsx", "utf8")
const workspace = readFileSync("src/app/(dashboard)/mtm/visits/visit-workspace.tsx", "utf8")
const photoGrid = readFileSync("src/components/mtm/visit-photo-grid.tsx", "utf8")

function between(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  expect(start, `${startMarker} not found`).toBeGreaterThan(-1)
  expect(end, `${endMarker} not found after ${startMarker}`).toBeGreaterThan(start)
  return source.slice(start, end)
}

const REVIEW_START = "{showReview && focusedVisitId ? ("
const OWN_START = "{ownActiveVisits.length > 0 && activeVisitId ? ("
const TEAM_START = "{teamActiveVisits.length > 0 ? ("
const HISTORY_START = 'aria-labelledby="visit-history-title"'

describe("office review never renders the agent's execution forms", () => {
  it("mounts the execution workspace only for the viewer's own open visits", () => {
    expect(page.match(/<VisitWorkspace\b/g)).toHaveLength(1)
    const ownBlock = between(page, OWN_START, TEAM_START)
    expect(ownBlock).toContain("<VisitWorkspace")
    expect(page).toContain('const ownActiveVisits = activeVisits.filter((visit) => isOwnVisitExecution(viewer, { agentId: visit.agentId, status: "CHECKED_IN" }))')
    // Other agents' open visits are a list of links into the review, not a workspace.
    const teamBlock = between(page, TEAM_START, HISTORY_START)
    expect(teamBlock).not.toContain("<VisitWorkspace")
    expect(teamBlock).toContain("visitHref(visit.id)")
  })

  it("shows the review for any focused visit that is not the viewer's own open one", () => {
    expect(page).toContain("const showReview = Boolean(focusedVisitId && !focusedOwnExecution && !focusedVisitUnavailable)")
    const reviewBlock = between(page, REVIEW_START, OWN_START)
    expect(reviewBlock).toContain("<VisitReviewPanel")
    expect(reviewBlock).not.toContain("<VisitWorkspace")
    expect(page).not.toMatch(/status\s*===\s*"CHECKED_IN"\s*&&\s*<VisitReviewPanel/)
  })

  it("keeps the review panel free of forms, uploads, writes and browser drafts", () => {
    for (const forbidden of [
      "localStorage",
      'method: "PUT"',
      'method: "POST"',
      'type="file"',
      "/actions",
      "/result",
      "<textarea",
      "<Input",
      "completeVisit",
      "uploadPhoto",
      "<VisitWorkspace",
      "visit-workspace",
    ]) {
      expect(panel, `review panel contains ${forbidden}`).not.toContain(forbidden)
    }
    expect(panel).toContain("/review`")
  })

  it("resets the workspace when the viewer switches between their open visits", () => {
    expect(page).toMatch(/<VisitWorkspace\s+key=\{activeVisitId\}/)
  })

  it("keeps the three-step execution guide away from office users", () => {
    expect(page).toContain('const showGuide = viewer?.role === "AGENT"')
    expect(page).toMatch(/\{showGuide \? \(\s*<MtmWorkflowGuide/)
  })
})

describe("what the review shows comes from the server", () => {
  it("renders the visit's photos as thumbnails that open the full image", () => {
    expect(panel).toMatch(/<VisitPhotoGrid\s+photos=\{visit\.photos\}/)
    expect(photoGrid).toContain('loading="lazy"')
    expect(photoGrid).toContain("aspect-square w-full object-cover")
    expect(photoGrid).toContain("<Dialog")
    expect(photoGrid).toContain("src={open.url}")
  })

  it("shows the signature, the agent's note and the saved result, never a draft", () => {
    expect(panel).toContain("<SignaturePreview evidence={signature.evidence}")
    expect(panel).toContain("visit.notes")
    expect(panel).toContain("tw(`outcomes.${visit.outcome}`)")
    expect(panel).toContain("reviewActionRows({")
    expect(panel).toContain("visitPlaceSummary(")
  })

  it("summarises open tasks read-only instead of offering complete/accept/tomorrow", () => {
    expect(panel).toContain('t("review.openTasks", { count: data.openTasks.count })')
    expect(panel).toContain('href="/mtm/tasks"')
    expect(panel).not.toContain("updateReminder")
    expect(panel).toContain("tw(`priorities.${task.priority}`)")
  })

  it("opens a history row as the review and refreshes while the tab is visible", () => {
    expect(page).toContain("onClick={() => openVisit(visit.id)}")
    expect(page).toContain("router.push(visitHref(visitId))")
    expect(page).toContain("const LIVE_REFRESH_MS = 30_000")
    expect(page).toContain('document.visibilityState !== "visible"')
    expect(page).toContain('document.addEventListener("visibilitychange", onVisibilityChange)')
    expect(page).toContain("window.clearInterval(interval)")
    expect(page).toContain("refreshToken={refreshTick}")
  })
})

describe("the agent's own execution view", () => {
  it("sends the task version so reminder buttons stop failing with 'expectedVersion is required'", () => {
    expect(workspace).toContain("expectedVersion: reminder.version")
    const api = readFileSync("src/app/api/v1/mtm/visits/[id]/workspace/route.ts", "utf8")
    expect(api).toMatch(/visitId: true, version: true/)
  })

  it("never shows the API's English error text in a toast", () => {
    expect(workspace).not.toContain("body?.error")
    expect(page).not.toContain(".error || t(")
    expect(workspace).toContain("visitApiErrorKey(status, body)")
  })

  it("labels a restored browser draft instead of presenting it as the saved result", () => {
    expect(workspace).toContain('t("localDraftNotice")')
    expect(workspace).toContain('t("resultNotSaved")')
    expect(workspace).toContain("savedResult(body.data.visit)")
  })

  it("localizes reminder priorities", () => {
    expect(workspace).toContain("t(`priorities.${reminder.priority}`)")
    expect(workspace).not.toContain("{reminder.priority}</span>")
  })
})
