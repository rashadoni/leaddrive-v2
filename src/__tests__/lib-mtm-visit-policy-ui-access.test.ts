import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  canCreateVisitPolicy,
  parseVisitPolicyUiAccess,
  visitPolicyDisabledNoticeKeys,
  visitPolicyFeatureDisabled,
  visitPolicyReadOnlyReason,
  visitPolicyTeamChoices,
} from "@/lib/mtm/visit-policy-ui-access"

const admin = parseVisitPolicyUiAccess({ kind: "admin", canWriteOrganizationWide: true, writableTeamIds: null })
const manager = parseVisitPolicyUiAccess({ kind: "manager", canWriteOrganizationWide: false, writableTeamIds: ["team-A"] })
const managerWithoutTeam = parseVisitPolicyUiAccess({ kind: "manager", canWriteOrganizationWide: false, writableTeamIds: [] })
const supervisor = parseVisitPolicyUiAccess({ kind: "supervisor", canWriteOrganizationWide: false, writableTeamIds: [] })

describe("visit policy settings: what may be edited (GET data.access contract)", () => {
  it("lets an administrator edit everything", () => {
    expect(visitPolicyReadOnlyReason(admin, { isNew: false, savedTeamId: null })).toBeNull()
    expect(visitPolicyReadOnlyReason(admin, { isNew: true, savedTeamId: null })).toBeNull()
    expect(visitPolicyTeamChoices(admin, [{ id: "team-A" }, { id: "team-B" }])).toEqual({ teams: [{ id: "team-A" }, { id: "team-B" }], allowAllTeams: true })
  })

  it("lets a manager edit only their teams' rules and says why otherwise", () => {
    expect(visitPolicyReadOnlyReason(manager, { isNew: false, savedTeamId: "team-A" })).toBeNull()
    expect(visitPolicyReadOnlyReason(manager, { isNew: false, savedTeamId: null })).toBe("adminOnly")
    expect(visitPolicyReadOnlyReason(manager, { isNew: false, savedTeamId: "team-B" })).toBe("otherTeam")
    expect(visitPolicyTeamChoices(manager, [{ id: "team-A" }, { id: "team-B" }])).toEqual({ teams: [{ id: "team-A" }], allowAllTeams: false })
  })

  it("tells a manager without a team how to get access instead of offering a doomed form", () => {
    expect(canCreateVisitPolicy(managerWithoutTeam)).toBe(false)
    expect(visitPolicyReadOnlyReason(managerWithoutTeam, { isNew: true, savedTeamId: null })).toBe("noTeam")
  })

  it("keeps a supervisor read-only", () => {
    expect(canCreateVisitPolicy(supervisor)).toBe(false)
    expect(visitPolicyReadOnlyReason(supervisor, { isNew: false, savedTeamId: "team-A" })).toBe("supervisor")
    expect(visitPolicyReadOnlyReason(supervisor, { isNew: true, savedTeamId: null })).toBe("supervisor")
  })

  it("falls back to the server when the access block is absent or malformed", () => {
    expect(parseVisitPolicyUiAccess(undefined)).toBeNull()
    expect(visitPolicyReadOnlyReason(null, { isNew: false, savedTeamId: null })).toBeNull()
    expect(parseVisitPolicyUiAccess({ writableTeamIds: "team-A" })).toEqual({ kind: undefined, canWriteOrganizationWide: false, writableTeamIds: [] })
  })

  it("is wired into the settings screen", () => {
    const source = readFileSync("src/app/(dashboard)/mtm/settings/visit-policy-settings.tsx", "utf8")
    expect(source).toContain("parseVisitPolicyUiAccess(policyBody.data?.access)")
    expect(source).toContain("<fieldset disabled={readOnly")
    expect(source).toContain("{readOnly ? null : (")
    expect(source).toContain('data-testid="visit-policy-read-only"')
    expect(source).toContain('data-testid="visit-policy-no-team-hint"')
    // 400/409 answers are explained too, never printed as the server's English.
    expect(source).not.toContain("body?.error")
    expect(source.match(/explainMtmApiErrorOr\(explainError, body, response\.status/g) ?? []).toHaveLength(3)
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmVisitPolicies
      for (const key of ["readOnlySupervisor", "readOnlyAdminOnly", "readOnlyOtherTeam", "managerNoTeamHint"]) {
        expect(typeof messages[key], `${locale}.${key}`).toBe("string")
      }
    }
  })
})

describe("visit policy settings: switch turned off (GET data.featureDisabled contract)", () => {
  it("reads the flag strictly from the GET payload", () => {
    expect(visitPolicyFeatureDisabled({ policies: [], featureDisabled: true })).toBe(true)
    expect(visitPolicyFeatureDisabled({ policies: [] })).toBe(false)
    expect(visitPolicyFeatureDisabled({ featureDisabled: "true" })).toBe(false)
    expect(visitPolicyFeatureDisabled(null)).toBe(false)
  })

  it("gives the enable hint to an administrator only", () => {
    expect(visitPolicyDisabledNoticeKeys(admin)).toEqual({ text: "featureDisabled", hint: "featureDisabledAdminHint" })
    expect(visitPolicyDisabledNoticeKeys(manager)).toEqual({ text: "featureDisabled", hint: null })
    expect(visitPolicyDisabledNoticeKeys(supervisor)).toEqual({ text: "featureDisabled", hint: null })
    expect(visitPolicyDisabledNoticeKeys(null)).toEqual({ text: "featureDisabled", hint: null })
  })

  it("replaces the editor with a notice on the settings screen", () => {
    const source = readFileSync("src/app/(dashboard)/mtm/settings/visit-policy-settings.tsx", "utf8")
    expect(source).toContain("setFeatureDisabled(visitPolicyFeatureDisabled(policyBody.data))")
    expect(source).toContain('data-testid="visit-policy-feature-disabled"')
    // No list, form, Save or preview while off; no "New policy" button either.
    expect(source).toContain("{featureDisabled && !loadError ? null : (")
    expect(source).toContain("{canCreate && !featureDisabled ? (")
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmVisitPolicies
      for (const key of ["featureDisabled", "featureDisabledAdminHint"]) {
        expect(typeof messages[key], `${locale}.${key}`).toBe("string")
      }
    }
  })
})
