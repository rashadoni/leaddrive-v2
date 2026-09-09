import { describe, expect, it } from "vitest"
import {
  canAccessAllVoiceOverdueData,
  canAccessVoiceRecord,
  canAccessVoiceSection,
  canAccessVoiceWorkload,
  accessibleVoiceSectionKeys,
  type VoiceOrgModuleContext,
} from "@/lib/ai/voice/read-access"
import { VOICE_TOOL_MODULE } from "@/lib/ai/voice/read-tools"

const org = (modules: Record<string, boolean>): VoiceOrgModuleContext => ({
  plan: "enterprise",
  addons: [],
  modules,
})
describe("voice read access mapping", () => {
  it("binds record search to the selected entity, not the find_record shell", () => {
    const context = org({ crm: true, sales: true, finance: false })

    expect(canAccessVoiceRecord("manager", context, "deal")).toBe(true)
    expect(canAccessVoiceRecord("manager", context, "invoice")).toBe(false)
  })

  it("denies lower-scope roles and disabled record-specific features", () => {
    const all = org({
      crm: true,
      sales: true,
      marketing: true,
      support: true,
      complaints_register: true,
    })

    expect(canAccessVoiceRecord("support", all, "quote")).toBe(false)
    expect(canAccessVoiceRecord("support", all, "campaign")).toBe(false)
    expect(canAccessVoiceRecord("sales", all, "task")).toBe(true)
    expect(canAccessVoiceRecord("manager", all, "complaint")).toBe(true)
    expect(
      canAccessVoiceRecord(
        "manager",
        org({ ...all.modules, complaints_register: false }),
        "complaint",
      ),
    ).toBe(false)
  })

  it("requires every data family for composite overdue and all-workload reads", () => {
    const context = org({ crm: true, sales: true, finance: false, support: false })

    expect(canAccessAllVoiceOverdueData("manager", context)).toBe(false)
    expect(canAccessVoiceWorkload("manager", context, "all")).toBe(false)
    expect(canAccessVoiceWorkload("manager", context, "tasks")).toBe(true)
    expect(canAccessVoiceWorkload("manager", context, "tickets")).toBe(false)
  })

  it("uses the Sales group for lead descriptors and hides denied guide pages", () => {
    const crmOnly = org({ crm: true, sales: false, settings: true })

    expect(canAccessVoiceSection("manager", crmOnly, "leads")).toBe(false)
    expect(canAccessVoiceSection("manager", crmOnly, "settings_api-keys")).toBe(false)
  })

  it("uses the sidebar permission scope for browser-side voice destinations", () => {
    const social = org({ social: true })

    expect(accessibleVoiceSectionKeys("manager", social)).toContain("social_monitoring_mentions")
    expect(accessibleVoiceSectionKeys("manager", social)).not.toContain("social_monitoring_legal")
    expect(accessibleVoiceSectionKeys("admin", social)).toContain("social_monitoring_legal")
  })

  it("maps direct sales summaries and the advisor briefing to their real modules", () => {
    expect(VOICE_TOOL_MODULE.get_pipeline_by_stage).toBe("sales")
    expect(VOICE_TOOL_MODULE.get_sales_by_manager).toBe("sales")
    expect(VOICE_TOOL_MODULE.get_leads_summary).toBe("sales")
    expect(VOICE_TOOL_MODULE.get_forecast_summary).toBe("sales")
    expect(VOICE_TOOL_MODULE.get_sales_in_period).toBe("sales")
    expect(VOICE_TOOL_MODULE.get_daily_briefing).toBe("analytics")
  })

  it("gates target-scoped shells on AI before their selected data scope", () => {
    expect(VOICE_TOOL_MODULE.find_record).toBe("ai")
    expect(VOICE_TOOL_MODULE.describe_section).toBe("ai")
    expect(VOICE_TOOL_MODULE.explain_section).toBe("ai")
    expect(VOICE_TOOL_MODULE.get_workload_by_person).toBe("ai")
  })
})
