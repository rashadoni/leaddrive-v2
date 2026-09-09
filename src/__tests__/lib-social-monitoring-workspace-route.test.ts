import { describe, expect, it } from "vitest"
import {
  applyMonitoringWorkspaceRoute,
  buildMonitoringWorkspaceSearch,
  parseMonitoringWorkspaceRoute,
} from "@/lib/social/monitoring-workspace-route"

function params(search = "") {
  return new URLSearchParams(search)
}

describe("parseMonitoringWorkspaceRoute", () => {
  it("uses the directory for an empty, monitor, or subject-only URL", () => {
    expect(parseMonitoringWorkspaceRoute(params())).toEqual({ kind: "directory" })
    expect(parseMonitoringWorkspaceRoute(params("view=monitors"))).toEqual({ kind: "directory" })
    expect(parseMonitoringWorkspaceRoute(params("subjectId=subject-1&subjectName=Araz"))).toEqual({
      kind: "directory",
    })
  })

  it("treats blank monitoring IDs as absent", () => {
    expect(parseMonitoringWorkspaceRoute(params("monitoringId=%20%20"))).toEqual({
      kind: "directory",
    })
    expect(parseMonitoringWorkspaceRoute(params("monitoringId=%20&scope=all"))).toEqual({
      kind: "all",
    })
    expect(parseMonitoringWorkspaceRoute(params("monitoringId=%20&view=mentions"))).toEqual({
      kind: "all",
    })
  })

  it("maps explicit all scope and legacy non-monitor views to all brands", () => {
    expect(parseMonitoringWorkspaceRoute(params("scope=all"))).toEqual({ kind: "all" })
    expect(parseMonitoringWorkspaceRoute(params("view=overview"))).toEqual({ kind: "all" })
    expect(parseMonitoringWorkspaceRoute(params("view=mentions"))).toEqual({ kind: "all" })
  })

  it("lets a monitoring ID win over both all-brand signals", () => {
    expect(parseMonitoringWorkspaceRoute(params(
      "monitoringId=profile-1&subjectId=subject-1&subjectName=Araz&scope=all&view=mentions",
    ))).toEqual({
      kind: "brand",
      monitoringId: "profile-1",
      subjectId: "subject-1",
      name: "Araz",
    })
  })

  it("supports legacy scenario profiles and missing subjects", () => {
    expect(parseMonitoringWorkspaceRoute(params(
      "monitoringId=scenario%3Alegacy-1&subjectName=Legacy%20Brand",
    ))).toEqual({
      kind: "brand",
      monitoringId: "scenario:legacy-1",
      name: "Legacy Brand",
    })
    expect(parseMonitoringWorkspaceRoute(params(
      "monitoringId=profile-2&subjectId=%20&subjectName=Bravo",
    ))).toEqual({
      kind: "brand",
      monitoringId: "profile-2",
      name: "Bravo",
    })
  })

  it("trims route identity values and has a stable name fallback", () => {
    expect(parseMonitoringWorkspaceRoute(params(
      "monitoringId=%20profile-3%20&subjectId=%20subject-3%20&subjectName=%20OBA%20",
    ))).toEqual({
      kind: "brand",
      monitoringId: "profile-3",
      subjectId: "subject-3",
      name: "OBA",
    })
    expect(parseMonitoringWorkspaceRoute(params("monitoringId=profile-4"))).toEqual({
      kind: "brand",
      monitoringId: "profile-4",
      name: "profile-4",
    })
  })
})

describe("applyMonitoringWorkspaceRoute", () => {
  it("builds the default brand summary while preserving unrelated filters", () => {
    const original = params(
      "platform=instagram&q=launch&monitoringId=old&scope=all&subjectId=old-subject"
      + "&subjectName=Old&view=mentions",
    )
    const result = applyMonitoringWorkspaceRoute(original, {
      kind: "brand",
      monitoringId: "profile-1",
      subjectId: "subject-1",
      name: "Araz Supermarket",
    })

    expect(Object.fromEntries(result)).toEqual({
      platform: "instagram",
      q: "launch",
      monitoringId: "profile-1",
      subjectId: "subject-1",
      subjectName: "Araz Supermarket",
    })
    expect(original.get("monitoringId")).toBe("old")
    expect(original.get("scope")).toBe("all")
  })

  it("supports a brand tool and removes a stale subject for subjectless profiles", () => {
    const result = applyMonitoringWorkspaceRoute(
      params("subjectId=old&subjectName=Old&view=overview&dateRange=7d"),
      {
        kind: "brand",
        monitoringId: " scenario:legacy-1 ",
        name: " Legacy Brand ",
      },
      { view: "mentions" },
    )

    expect(Object.fromEntries(result)).toEqual({
      dateRange: "7d",
      monitoringId: "scenario:legacy-1",
      subjectName: "Legacy Brand",
      view: "mentions",
    })
  })

  it("canonicalizes all brands to overview unless another tool is requested", () => {
    const defaultResult = applyMonitoringWorkspaceRoute(
      params("monitoringId=old&subjectId=old&subjectName=Old&stream=all"),
      { kind: "all" },
    )
    expect(Object.fromEntries(defaultResult)).toEqual({
      stream: "all",
      scope: "all",
      view: "overview",
    })

    const toolResult = applyMonitoringWorkspaceRoute(
      defaultResult,
      { kind: "all" },
      { view: "mentions" },
    )
    expect(Object.fromEntries(toolResult)).toEqual({
      stream: "all",
      scope: "all",
      view: "mentions",
    })
  })

  it("clears every workspace-owned key when returning to the directory", () => {
    const result = applyMonitoringWorkspaceRoute(
      params(
        "monitoringId=profile-1&scope=all&subjectId=subject-1&subjectName=Araz"
        + "&view=mentions&platform=facebook&sort=oldest",
      ),
      { kind: "directory" },
    )

    // view=monitors делает каталог адресуемым: голый URL зарезервирован под
    // первый визит, который редиректится на обзор всех брендов.
    expect(Object.fromEntries(result)).toEqual({
      platform: "facebook",
      sort: "oldest",
      view: "monitors",
    })
  })

  it("rejects blank required brand identity without dropping current params", () => {
    const original = params("monitoringId=current&q=keep")

    expect(() => applyMonitoringWorkspaceRoute(original, {
      kind: "brand",
      monitoringId: " ",
      name: "Araz",
    })).toThrow(/monitoringId/)
    expect(() => applyMonitoringWorkspaceRoute(original, {
      kind: "brand",
      monitoringId: "profile-1",
      name: " ",
    })).toThrow(/name/)
    expect(original.toString()).toBe("monitoringId=current&q=keep")
  })
})

describe("buildMonitoringWorkspaceSearch", () => {
  it("returns an encoded search string and an empty string for an empty directory", () => {
    expect(buildMonitoringWorkspaceSearch(
      params("platform=web"),
      {
        kind: "brand",
        monitoringId: "scenario:one",
        name: "Baku Electronics",
      },
    )).toBe(
      "?platform=web&monitoringId=scenario%3Aone&subjectName=Baku+Electronics",
    )
    expect(buildMonitoringWorkspaceSearch(params(), { kind: "directory" })).toBe("?view=monitors")
  })
})
