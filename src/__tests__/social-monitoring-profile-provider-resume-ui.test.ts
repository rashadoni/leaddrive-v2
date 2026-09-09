// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  MONITORING_PROFILE_RUN_RESUME_VERSION,
  type MonitoringProfileRunProgress,
} from "@/lib/social/monitoring-profile-runner"
import {
  MONITORING_PROFILE_WORKFLOW_STORAGE_KEY,
  serializeMonitoringProfileWorkflowState,
} from "@/lib/social/monitoring-profile-workflow-state"

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => {
    const translate = (key: string) => key
    translate.has = () => false
    return translate
  },
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { role: "admin" } },
  }),
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@/components/social/monitoring-profile-wizard", () => ({
  MonitoringProfileWizard: () => null,
}))

vi.mock("@/components/ui/button", async () => {
  const React = await import("react")
  return {
    Button: React.forwardRef<HTMLButtonElement, Record<string, unknown>>(
      function MockButton(props, ref) {
        const {
          children,
          variant: _variant,
          size: _size,
          asChild: _asChild,
          ...buttonProps
        } = props
        void _variant
        void _size
        void _asChild
        return React.createElement(
          "button",
          { ...buttonProps, ref },
          children as React.ReactNode,
        )
      },
    ),
  }
})

vi.mock("@/components/ui/badge", async () => {
  const React = await import("react")
  return {
    Badge: ({
      children,
      variant: _variant,
      ...props
    }: Record<string, unknown>) => {
      void _variant
      return React.createElement(
        "span",
        props,
        children as React.ReactNode,
      )
    },
  }
})

vi.mock("@/components/ui/input", async () => {
  const React = await import("react")
  return {
    Input: React.forwardRef<HTMLInputElement, Record<string, unknown>>(
      function MockInput(props, ref) {
        return React.createElement("input", { ...props, ref })
      },
    ),
  }
})

vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react")
  const PassThrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children)
  return {
    DropdownMenu: PassThrough,
    DropdownMenuTrigger: PassThrough,
    DropdownMenuContent: ({
      children,
      align: _align,
      ...props
    }: Record<string, unknown>) => {
      void _align
      return React.createElement(
        "div",
        props,
        children as React.ReactNode,
      )
    },
    DropdownMenuItem: ({
      children,
      ...props
    }: Record<string, unknown>) => React.createElement(
      "button",
      props,
      children as React.ReactNode,
    ),
  }
})

vi.mock("@/components/ui/popover", async () => {
  const React = await import("react")
  const PassThrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children)
  return {
    Popover: PassThrough,
    PopoverTrigger: PassThrough,
    PopoverContent: ({
      children,
      align: _align,
      sideOffset: _sideOffset,
      collisionPadding: _collisionPadding,
      ...props
    }: Record<string, unknown>) => {
      void _align
      void _sideOffset
      void _collisionPadding
      return React.createElement(
        "div",
        props,
        children as React.ReactNode,
      )
    },
  }
})

import { MonitoringProfileList } from "@/components/social/monitoring-profile-list"

type TestProfile = {
  id: string
  subjectId: string
  scenarioId: string
  name: string
  status: "active" | "archived"
  platforms: string[]
  directions: string[]
  sources: Array<{
    id: string
    platform: string
    sourceType: string
    label: string
    status: string
    isActive: boolean
    paid: boolean
    providerAccountFundedOnly: boolean
    maxTotalChargeUsd: number | null
    sharedAcrossMonitorings: boolean
  }>
  coverage: []
  commentsEnabled: boolean
  archive: null
  findings: {
    total: number
    new: number
    last24Hours: number
    last7Days: number
    posts: number
    comments: number
    media: number
    negative: number
    needsReview: number
  }
  findingsByPlatform: Record<string, number>
  lastCollectedAt: null
  lastUpdatedAt: string
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

function profileRevision(profile: TestProfile): string {
  return JSON.stringify({
    scenarioId: profile.scenarioId,
    lastUpdatedAt: profile.lastUpdatedAt,
    platforms: [...profile.platforms].sort(),
    sources: profile.sources
      .map(source => ({
        id: source.id,
        platform: source.platform,
        isActive: source.isActive,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  })
}

async function flushMicrotasks(rounds = 12): Promise<void> {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) {
      await Promise.resolve()
    }
  })
}

describe("MonitoringProfileList provider-wait resume", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-28T15:00:00.000Z"))
    vi.spyOn(window, "confirm").mockReturnValue(true)
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    ;(globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean
    }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    window.localStorage.clear()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("opens an existing brand on findings and exposes direct scoped actions", async () => {
    const profile: TestProfile = {
      id: "profile-findings",
      subjectId: "subject-findings",
      scenarioId: "scenario-findings",
      name: "Araz Supermarket",
      status: "active",
      platforms: ["facebook"],
      directions: [],
      sources: [{
        id: "source-facebook",
        platform: "facebook",
        sourceType: "keyword",
        label: "Facebook",
        status: "active",
        isActive: true,
        paid: false,
        providerAccountFundedOnly: false,
        maxTotalChargeUsd: null,
        sharedAcrossMonitorings: false,
      }],
      coverage: [],
      commentsEnabled: false,
      archive: null,
      findings: {
        total: 9,
        new: 2,
        last24Hours: 2,
        last7Days: 6,
        posts: 7,
        comments: 2,
        media: 1,
        negative: 1,
        needsReview: 0,
      },
      findingsByPlatform: { facebook: 5 },
      lastCollectedAt: null,
      lastUpdatedAt: "2026-07-28T14:55:00.000Z",
    }
    const fetchMock = vi.fn(async () => (
      jsonResponse({ success: true, data: { profiles: [profile] } })
    ))
    vi.stubGlobal("fetch", fetchMock)
    const onOpenResults = vi.fn()

    await act(async () => {
      root.render(createElement(MonitoringProfileList, {
        workspaceMode: "brand",
        workspaceProfileId: profile.id,
        onOpenProfile: vi.fn(),
        onOpenAllBrands: vi.fn(),
        onOpenResults,
      }))
    })
    await flushMicrotasks()

    expect(
      container.querySelector<HTMLElement>('[data-testid="social-profile-stage-results"]')?.hidden,
    ).toBe(false)
    expect(
      container.querySelector<HTMLElement>('[data-testid="social-profile-stage-collection"]')?.hidden,
    ).toBe(true)

    const openFindings = container.querySelector<HTMLButtonElement>(
      '[data-testid="social-profile-open-findings"]',
    )
    expect(openFindings?.textContent).toContain("9")
    await act(async () => openFindings!.click())
    expect(onOpenResults).toHaveBeenLastCalledWith(expect.objectContaining({ id: profile.id }))

    const metricTargets = [
      ["all", undefined],
      ["posts", { surface: "posts" }],
      ["comments", { surface: "comments" }],
      ["media", { surface: "media" }],
      ["negative", { sentiment: "negative" }],
    ] as const
    for (const [metric, target] of metricTargets) {
      const button = container.querySelector<HTMLButtonElement>(
        `[data-testid="social-profile-open-metric-${metric}"]`,
      )
      expect(button?.disabled).toBe(false)
      await act(async () => button!.click())
      if (target) {
        expect(onOpenResults).toHaveBeenLastCalledWith(
          expect.objectContaining({ id: profile.id }),
          target,
        )
      } else {
        expect(onOpenResults).toHaveBeenLastCalledWith(
          expect.objectContaining({ id: profile.id }),
        )
      }
    }

    const openFacebook = container.querySelector<HTMLButtonElement>(
      '[data-testid="social-profile-open-platform-facebook"]',
    )
    expect(openFacebook?.textContent).toContain("5")
    await act(async () => openFacebook!.click())
    expect(onOpenResults).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: profile.id }),
      { platform: "facebook" },
    )
    expect(fetchMock.mock.calls.filter(([input]) => (
      input === "/api/v1/social/monitoring-profiles"
    ))).toHaveLength(1)
  })

  it("polls the saved provider run before dispatching only the remaining sources", async () => {
    const profile: TestProfile = {
      id: "profile-1",
      subjectId: "subject-1",
      scenarioId: "scenario-1",
      name: "Baku Electronics",
      status: "active",
      platforms: ["facebook", "web", "youtube"],
      directions: [],
      sources: [
        {
          id: "source-current",
          platform: "facebook",
          sourceType: "keyword",
          label: "Facebook current",
          status: "active",
          isActive: true,
          paid: true,
          providerAccountFundedOnly: true,
          maxTotalChargeUsd: null,
          sharedAcrossMonitorings: false,
        },
        {
          id: "source-next",
          platform: "facebook",
          sourceType: "keyword",
          label: "Facebook next",
          status: "active",
          isActive: true,
          paid: false,
          providerAccountFundedOnly: false,
          maxTotalChargeUsd: null,
          sharedAcrossMonitorings: false,
        },
        {
          id: "source-web",
          platform: "web",
          sourceType: "notification_inbox",
          label: "Google Alerts RSS",
          status: "active",
          isActive: true,
          paid: false,
          providerAccountFundedOnly: false,
          maxTotalChargeUsd: null,
          sharedAcrossMonitorings: false,
        },
        {
          id: "source-youtube",
          platform: "youtube",
          sourceType: "keyword",
          label: "YouTube",
          status: "active",
          isActive: true,
          paid: false,
          providerAccountFundedOnly: false,
          maxTotalChargeUsd: null,
          sharedAcrossMonitorings: false,
        },
      ],
      coverage: [],
      commentsEnabled: false,
      archive: null,
      findings: {
        total: 0,
        new: 0,
        last24Hours: 0,
        last7Days: 0,
        posts: 0,
        comments: 0,
        media: 0,
        negative: 0,
        needsReview: 0,
      },
      findingsByPlatform: {},
      lastCollectedAt: null,
      lastUpdatedAt: "2026-07-28T14:55:00.000Z",
    }
    const sourceIds = profile.sources.map(source => source.id).sort()
    const progress: MonitoringProfileRunProgress = {
      phase: "stopped",
      total: profile.sources.length,
      attempted: 0,
      succeeded: 0,
      partial: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      found: 0,
      accepted: 0,
      review: 0,
      rejected: 0,
      duplicates: 0,
      sourceResults: [],
      current: {
        id: "source-current",
        platform: "facebook",
        label: "Facebook current",
        index: 1,
        stage: "provider_wait",
        preview: {
          found: 0,
          accepted: 0,
          review: 0,
          rejected: 0,
          duplicates: 0,
        },
        providerWait: {
          providerRunIds: ["provider-run-existing"],
          collectorResult: {
            status: "pending",
            foundCount: 0,
            newCount: 0,
            duplicateCount: 0,
          },
        },
      },
      lastIssue: null,
      resumeContext: {
        version: MONITORING_PROFILE_RUN_RESUME_VERSION,
        scenarioId: profile.scenarioId,
        profileRevision: profileRevision(profile),
        sourceIds,
        startedAt: "2026-07-28T14:50:00.000Z",
        updatedAt: "2026-07-28T14:59:00.000Z",
      },
    }
    window.localStorage.setItem(
      MONITORING_PROFILE_WORKFLOW_STORAGE_KEY,
      serializeMonitoringProfileWorkflowState({
        selectedProfileId: profile.id,
        activeStage: "collection",
        runProgress: { [profile.id]: progress },
      }),
    )

    const providerEvents: string[] = []
    const dispatchedSourceIds: string[] = []
    const coverageRepairs: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
      const method = init?.method ?? "GET"

      if (url === "/api/v1/social/monitoring-profiles" && method === "GET") {
        return jsonResponse({ success: true, data: { profiles: [profile] } })
      }
      if (
        url === "/api/v1/social/monitoring-profiles/subject-1"
        && method === "PATCH"
      ) {
        coverageRepairs.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return jsonResponse({ success: true, data: profile })
      }
      if (url === "/api/v1/social/provider-runs" && method === "POST") {
        providerEvents.push("reconcile")
        expect(JSON.parse(String(init?.body))).toEqual({
          ids: ["provider-run-existing"],
        })
        return jsonResponse({ success: true })
      }
      if (url.startsWith("/api/v1/social/provider-runs?") && method === "GET") {
        providerEvents.push("poll-terminal")
        expect(url).toContain("provider-run-existing")
        return jsonResponse({
          success: true,
          data: [{
            id: "provider-run-existing",
            status: "IMPORTED",
            receivedCount: 2,
            acceptedCount: 2,
            reviewCount: 0,
            rejectedCount: 0,
            duplicateCount: 0,
          }],
        })
      }
      if (
        url === "/api/v1/social/monitoring-profiles/subject-1/run"
        && method === "POST"
      ) {
        const body = JSON.parse(String(init?.body)) as { sourceId: string }
        dispatchedSourceIds.push(body.sourceId)
        return jsonResponse({
          success: true,
          data: {
            status: "success",
            foundCount: 1,
            newCount: 1,
            duplicateCount: 0,
          },
        })
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    await act(async () => {
      root.render(createElement(MonitoringProfileList, {
        workspaceMode: "brand",
        workspaceProfileId: "profile-1",
        onOpenProfile: vi.fn(),
        onOpenAllBrands: vi.fn(),
        onOpenResults: vi.fn(),
      }))
    })
    await flushMicrotasks()

    const resumeButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '[data-testid="social-profile-run-profile-1"] button',
      ),
    ).find(button => button.textContent?.includes("run.resumeRemaining"))
    expect(resumeButton).toBeDefined()

    await act(async () => {
      resumeButton!.click()
    })
    await flushMicrotasks()

    expect(coverageRepairs).toEqual([expect.objectContaining({
      action: "resume",
      platforms: expect.arrayContaining([
        "facebook",
        "instagram",
        "tiktok",
        "youtube",
        "web",
      ]),
    })])
    expect(providerEvents).toEqual(["reconcile", "poll-terminal"])
    expect(dispatchedSourceIds).toEqual([])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    await flushMicrotasks()

    expect(providerEvents).toEqual([
      "reconcile",
      "poll-terminal",
      "reconcile",
      "poll-terminal",
    ])
    expect(dispatchedSourceIds).toEqual([
      "source-next",
      "source-web",
      "source-youtube",
    ])
    expect(dispatchedSourceIds).not.toContain("source-current")
    expect(container.querySelector(
      '[data-testid="social-profile-step-review"]',
    )).toBeNull()
    expect(
      container.querySelector<HTMLElement>(
        '[data-testid="social-profile-stage-results"]',
      )?.hidden,
    ).toBe(false)
  })

  it("repairs an RSS-only web route when every platform is otherwise configured", async () => {
    const profile: TestProfile = {
      id: "profile-rss-only",
      subjectId: "subject-rss-only",
      scenarioId: "scenario-rss-only",
      name: "Araz Supermarket",
      status: "active",
      platforms: ["facebook", "instagram", "tiktok", "youtube", "web"],
      directions: [],
      sources: [
        {
          id: "source-facebook",
          platform: "facebook",
          sourceType: "keyword",
          label: "Facebook",
          status: "active",
          isActive: true,
          paid: false,
          providerAccountFundedOnly: false,
          maxTotalChargeUsd: null,
          sharedAcrossMonitorings: false,
        },
        {
          id: "source-instagram",
          platform: "instagram",
          sourceType: "keyword",
          label: "Instagram",
          status: "active",
          isActive: true,
          paid: false,
          providerAccountFundedOnly: false,
          maxTotalChargeUsd: null,
          sharedAcrossMonitorings: false,
        },
        {
          id: "source-tiktok",
          platform: "tiktok",
          sourceType: "keyword",
          label: "TikTok",
          status: "active",
          isActive: true,
          paid: false,
          providerAccountFundedOnly: false,
          maxTotalChargeUsd: null,
          sharedAcrossMonitorings: false,
        },
        {
          id: "source-youtube",
          platform: "youtube",
          sourceType: "keyword",
          label: "YouTube",
          status: "active",
          isActive: true,
          paid: false,
          providerAccountFundedOnly: false,
          maxTotalChargeUsd: null,
          sharedAcrossMonitorings: false,
        },
        {
          id: "source-web-rss",
          platform: "web",
          sourceType: "notification_inbox",
          label: "Google Alerts RSS",
          status: "active",
          isActive: true,
          paid: false,
          providerAccountFundedOnly: false,
          maxTotalChargeUsd: null,
          sharedAcrossMonitorings: false,
        },
      ],
      coverage: [],
      commentsEnabled: false,
      archive: null,
      findings: {
        total: 0,
        new: 0,
        last24Hours: 0,
        last7Days: 0,
        posts: 0,
        comments: 0,
        media: 0,
        negative: 0,
        needsReview: 0,
      },
      findingsByPlatform: {},
      lastCollectedAt: null,
      lastUpdatedAt: "2026-07-28T14:55:00.000Z",
    }
    const repairedProfile: TestProfile = {
      ...profile,
      sources: [
        ...profile.sources,
        {
          id: "source-web-keyword",
          platform: "web",
          sourceType: "keyword",
          label: "Web search",
          status: "active",
          isActive: true,
          paid: false,
          providerAccountFundedOnly: false,
          maxTotalChargeUsd: null,
          sharedAcrossMonitorings: false,
        },
      ],
      lastUpdatedAt: "2026-07-28T15:00:00.000Z",
    }
    let loadedProfile = profile
    const coverageRepairs: Array<Record<string, unknown>> = []
    const dispatchedSourceIds: string[] = []
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
      const method = init?.method ?? "GET"

      if (url === "/api/v1/social/monitoring-profiles" && method === "GET") {
        return jsonResponse({ success: true, data: { profiles: [loadedProfile] } })
      }
      if (
        url === "/api/v1/social/monitoring-profiles/subject-rss-only"
        && method === "PATCH"
      ) {
        coverageRepairs.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        loadedProfile = repairedProfile
        return jsonResponse({ success: true, data: repairedProfile })
      }
      if (
        url === "/api/v1/social/monitoring-profiles/subject-rss-only/run"
        && method === "POST"
      ) {
        const body = JSON.parse(String(init?.body)) as { sourceId: string }
        dispatchedSourceIds.push(body.sourceId)
        return jsonResponse({
          success: true,
          data: {
            status: "success",
            foundCount: 0,
            newCount: 0,
            duplicateCount: 0,
          },
        })
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    await act(async () => {
      root.render(createElement(MonitoringProfileList, {
        workspaceMode: "brand",
        workspaceProfileId: profile.id,
        onOpenProfile: vi.fn(),
        onOpenAllBrands: vi.fn(),
        onOpenResults: vi.fn(),
      }))
    })
    await flushMicrotasks()

    const startButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '[data-testid="social-profile-run-profile-rss-only"] button',
      ),
    ).find(button => button.textContent?.includes("run.start"))
    expect(startButton).toBeDefined()

    await act(async () => {
      startButton!.click()
    })
    await flushMicrotasks(40)

    expect(coverageRepairs).toEqual([{
      action: "resume",
      platforms: ["facebook", "instagram", "tiktok", "youtube", "web"],
      directions: [],
    }])
    expect(dispatchedSourceIds).toContain("source-web-keyword")
  })

  it("deletes an archived monitoring directly from the selector", async () => {
    const profile: TestProfile = {
      id: "profile-archived",
      subjectId: "subject-archived",
      scenarioId: "scenario-archived",
      name: "PharmaStore",
      status: "archived",
      platforms: [],
      directions: [],
      sources: [],
      coverage: [],
      commentsEnabled: false,
      archive: null,
      findings: {
        total: 0,
        new: 0,
        last24Hours: 0,
        last7Days: 0,
        posts: 0,
        comments: 0,
        media: 0,
        negative: 0,
        needsReview: 0,
      },
      findingsByPlatform: {},
      lastCollectedAt: null,
      lastUpdatedAt: "2026-07-28T14:55:00.000Z",
    }
    let deleted = false
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
      const method = init?.method ?? "GET"

      if (url === "/api/v1/social/monitoring-profiles" && method === "GET") {
        return jsonResponse({
          success: true,
          data: { profiles: deleted ? [] : [profile] },
        })
      }
      if (
        url === "/api/v1/social/monitoring-profiles/subject-archived"
        && method === "DELETE"
      ) {
        deleted = true
        return jsonResponse({ success: true })
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    await act(async () => {
      root.render(createElement(MonitoringProfileList, {
        workspaceMode: "directory",
        workspaceProfileId: null,
        onOpenProfile: vi.fn(),
        onOpenAllBrands: vi.fn(),
        onOpenResults: vi.fn(),
      }))
    })
    await flushMicrotasks()

    const deleteButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="social-profile-selector-delete-profile-archived"]',
    )
    expect(deleteButton).not.toBeNull()

    await act(async () => {
      deleteButton!.click()
    })
    await flushMicrotasks()

    expect(window.confirm).toHaveBeenCalledWith("actions.deleteConfirm")
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/social/monitoring-profiles/subject-archived",
      { method: "DELETE" },
    )
    expect(container.querySelector(
      '[data-testid="social-profile-selector-delete-profile-archived"]',
    )).toBeNull()
  })
})
