import { readFileSync } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8")

describe("skill routing UX contract", () => {
  it("uses a queue-first master-detail model with truthful runtime coverage", () => {
    const page = source("src/app/(dashboard)/support/skill-routing/page.tsx")
    const queues = source("src/components/support/queue-manager.tsx")
    const agents = source("src/components/support/agent-skills-manager.tsx")
    expect(page).toContain("selectedQueueId")
    expect(page).toContain("routingCoverage(queues, agents)")
    expect(page).toContain('"x-skill-routing-view": "routing"')
    expect(page).toContain("lg:grid-cols-[22rem_minmax(0,1fr)]")
    expect(queues).toContain("eligibleAgentsForQueue")
    expect(agents).toContain("agentEligibleForQueue")
  })

  it("shows actionable coverage gaps without decorative KPI cards", () => {
    const page = source("src/app/(dashboard)/support/skill-routing/page.tsx")
    expect(page).toContain("uncoveredQueuesSummary")
    expect(page).toContain("agentsWithoutSkillsSummary")
    expect(page).toContain("divide-x")
    expect(page).not.toContain("<Card")
    expect(page).not.toContain("DidYouKnow")
  })

  it("supports search, filters, selection and audited safe bulk edits", () => {
    const agents = source("src/components/support/agent-skills-manager.tsx")
    const route = source("src/app/api/v1/skill-routing/agents/route.ts")
    expect(agents).toContain("searchAgents")
    expect(agents).toContain("agentFilterEligible")
    expect(agents).toContain("selectedIds")
    expect(agents).toContain("expandedAgentId")
    expect(agents).toContain('mode: "add" | "remove"')
    expect(agents).toContain("onAgentsChange(previous)")
    expect(route).toContain("routing_skills_updated")
    expect(route).toContain("prisma.$transaction")
  })

  it("uses focused queue and agent tabs rather than stacking managers on mobile", () => {
    const page = source("src/app/(dashboard)/support/skill-routing/page.tsx")
    const queues = source("src/components/support/queue-manager.tsx")
    expect(page).toContain('role="tablist"')
    expect(page).toContain('role="tab"')
    expect(page).toContain('mobileView === "queues" ? "block" : "hidden lg:block"')
    expect(page).toContain('setMobileView("agents")')
    expect(page).toContain("grid grid-cols-3 divide-x")
    expect(queues).toContain("grid-cols-[minmax(0,1fr)_8rem]")
  })

  it("uses semantic controls and accessible live success or rollback feedback", () => {
    const agents = source("src/components/support/agent-skills-manager.tsx")
    const queues = source("src/components/support/queue-manager.tsx")
    const picker = source("src/components/skill-picker.tsx")
    expect(queues).toContain("<Switch")
    expect(queues).toContain('aria-live="polite"')
    expect(agents).toContain('aria-live="polite"')
    expect(agents).toContain("skillsRolledBack")
    expect(queues).toContain("queueToggleRolledBack")
    expect(picker).toContain("aria-pressed={isSel}")
    expect(agents).toContain('className="peer absolute inset-0 h-11 w-11 cursor-pointer opacity-0"')
    expect(queues).toContain("routingSwitchClass")
    expect(queues).toContain("relative h-11 w-11")
    expect(queues).toContain("text-zinc-950")
    expect(agents).toContain("text-zinc-950")
  })

  it("distinguishes partial fetch failure from empty agents, queues and filters", () => {
    const page = source("src/app/(dashboard)/support/skill-routing/page.tsx")
    const agents = source("src/components/support/agent-skills-manager.tsx")
    const queues = source("src/components/support/queue-manager.tsx")
    expect(page).toContain("Promise.allSettled")
    expect(page).toContain("partialDataTitle")
    expect(page).toContain('response.status === 403 ? t("permissionDenied")')
    expect(page).toContain("queuesErrorRetryable")
    expect(page).toContain("agentsErrorRetryable")
    expect(agents).toContain("agents.length === 0")
    expect(agents).toContain("visibleAgents.length === 0")
    expect(queues).toContain("queues.length === 0")
    expect(queues).toContain("visibleQueues.length === 0")
  })

  it("is compact, touch-safe, responsive and free of synthetic palette tropes", () => {
    const files = [
      source("src/app/(dashboard)/support/skill-routing/page.tsx"),
      source("src/components/support/agent-skills-manager.tsx"),
      source("src/components/support/queue-manager.tsx"),
      source("src/components/skill-picker.tsx"),
    ].join("\n")
    expect(files).toContain("min-h-11")
    expect(files).toContain("motion-reduce:animate-none")
    expect(files).toContain("motion-reduce:transition-none")
    expect(files).not.toMatch(/text-(?:2xl|3xl|4xl)/)
    expect(files).not.toMatch(/(?:violet|purple|cyan|fuchsia|green|amber|orange|blue|red|slate)-/)
    expect(files).not.toContain("bg-gradient")
  })
})
