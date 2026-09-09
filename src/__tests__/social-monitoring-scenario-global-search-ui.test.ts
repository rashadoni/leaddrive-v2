import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const builder = readFileSync(
  join(process.cwd(), "src/components/social/monitoring-scenario-builder.tsx"),
  "utf8",
)
const profileWizard = readFileSync(
  join(process.cwd(), "src/components/social/monitoring-profile-wizard.tsx"),
  "utf8",
)
const profileList = readFileSync(
  join(process.cwd(), "src/components/social/monitoring-profile-list.tsx"),
  "utf8",
)
const sourceWatchlist = readFileSync(
  join(process.cwd(), "src/components/social/monitoring-source-watchlist.tsx"),
  "utf8",
)
const monitoringSettingsRoute = readFileSync(
  join(process.cwd(), "src/app/api/v1/social/monitoring-settings/route.ts"),
  "utf8",
)
const subjectManager = readFileSync(
  join(process.cwd(), "src/components/social/monitoring-subject-manager.tsx"),
  "utf8",
)
const monitoringPage = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/social-monitoring/page.tsx"),
  "utf8",
)

describe("monitoring scenario global-search UI", () => {
  it("does not load or render direct page/profile selection", () => {
    expect(builder).not.toContain("targetKind=direct")
    expect(builder).not.toContain('t("sourceScopeTitle")')
    expect(builder).not.toContain("toggleScenarioSource")
    expect(builder).not.toContain("MonitoringSourceOption")
  })

  it("keeps legacy aliases locally while sending one canonical brand query", () => {
    expect(builder).toContain("...scenario.search.topics.slice(1)")
    expect(builder).toContain("...scenario.search.keywords")
    expect(builder).toContain('keywords: localKeywordAliases.join("\\n")')
    expect(builder).toContain('hashtags: scenario.search.hashtags.join("\\n")')
    expect(builder).toContain("topics: splitList(form.topics).slice(0, 1)")
    expect(builder).toContain("keywords: splitList(form.keywords)")
    expect(builder).toContain("hashtags: splitList(form.hashtags)")
    expect(builder).toContain("useHashtagFallback: false")
    expect(builder).not.toContain("handles: splitList")
    expect(builder).not.toContain("urls: splitList")
  })

  it("turns a clean-slate resume rejection into actionable feedback", () => {
    expect(builder).toContain('data?.code === "social_monitoring_collection_blocked"')
    expect(builder).toContain('"collectionResetBlockedAskAdmin"')
    expect(builder).toContain("onOpenSources()")
    expect(builder).toContain("disabled={updatingScenarioId !== null}")
    expect(profileList).toContain('body?.code === "social_monitoring_collection_blocked"')
    expect(profileList).toContain("onCollectionBlocked?.()")
    expect(profileWizard).toContain('body?.code === "social_monitoring_collection_blocked"')
    expect(profileWizard).toContain("onCollectionBlocked?.()")
  })
})

describe("monitoring profile global-search UI", () => {
  it("has no alternate page/profile picker or direct-source requirement", () => {
    expect(profileWizard).not.toContain("targetKind=direct")
    expect(profileWizard).not.toContain("selectedSourceIds")
    expect(profileWizard).not.toContain("officialSourceIds")
    expect(profileWizard).not.toContain("missingExplicitSourcePlatforms")
    expect(profileWizard).not.toContain("/api/v1/social/monitoring-sources")
  })

  it("does not send source ids in the profile payload", () => {
    expect(profileWizard).toContain("includeExternalComments: includeComments")
    expect(profileWizard).not.toContain("sourceIds:")
    expect(profileWizard).toContain("social-profile-global-search-hint")
  })

  it("preserves comment collection after the server confirms a stale paid route", () => {
    expect(profileList).toContain(
      "paidConfirmed && clientFundedPaidSourceConfirmed && profile.commentsEnabled",
    )
    expect(profileList).toContain(
      "source.paid && !source.providerAccountFundedOnly",
    )
    expect(profileList).toContain("!providerAccountFundedOnly")
    expect(profileList).toContain("? { includeComments: true }")
    expect(profileList).toContain('"facebook",')
    expect(profileList).toContain('"instagram",')
    expect(profileList).toContain('"tiktok",')
    expect(profileList).toContain('"youtube",')
    expect(profileList).toContain('"web",')
    expect(profileList).not.toContain(
      "paidConfirmed && source.paid && profile.commentsEnabled",
    )
  })

  it("exposes a separate comments-only action that cannot rerun post discovery", () => {
    expect(profileList).toContain('data-testid={`social-profile-comments-only-${profile.id}`}')
    expect(profileList).toContain('onRun(profile, "all", "comments_only")')
    expect(profileList).toContain("commentsOnly: true")
    expect(profileList).toContain("source.commentsOnlyEligible")
    expect(profileList).toContain('t("run.commentsOnly")')
  })

  it("lets operators switch from TikTok comments to global discovery results", () => {
    expect(monitoringPage).toContain('{ value: "", label: t("tiktokEventFilters.all") }')
    expect(monitoringPage).toContain('onClick={() => applyTikTokEventFilter(item.value)}')
    expect(monitoringPage).toContain('if (value === "comment")')
    expect(monitoringPage).toContain('pickSurface("")')
    expect(monitoringPage).toContain('setSourceTypeFilter("")')
    expect(monitoringPage).toContain('setContentKindFilter("")')
  })
})

describe("independent monitoring source registry", () => {
  it("locks direct page and profile creation in Brand Protection without hiding existing sources", () => {
    expect(sourceWatchlist).toMatch(
      /const openCreateDialog = \(\) => \{\s+if \(brandProtectionOnly\) return/,
    )
    expect(sourceWatchlist).toMatch(
      /const saveSource = async \(\) => \{\s+if \(\s+brandProtectionOnly\s+&& \(\s+!editingSource\s+\|\| editingSource\.platform !== "web"\s+\|\| form\.platform !== "web"/,
    )
    expect(sourceWatchlist).toMatch(
      /const bulkAddUrls = async \(\) => \{\s+if \(brandProtectionOnly\) return/,
    )
    expect(sourceWatchlist).toContain("legacyDirectSocialLocked")
    expect(sourceWatchlist).toContain(
      'brandProtectionOnly\n        && source.platform !== "web"\n        && monitoringSourcePresentationKind(source) === "direct"',
    )
    expect(sourceWatchlist).toMatch(
      /\{!brandProtectionOnly \? \(\s+<Button data-testid="social-watchlist-add"/,
    )
    expect(sourceWatchlist).toContain("!brandProtectionOnly || externalDirectSources.length > 0")
    expect(sourceWatchlist).toContain("externalDirectSources.map((source) => renderSourceCard(source))")
    expect(monitoringPage).toContain(
      "const brandProtectionSourceRegistryLocked = aiReplySettings === null || brandProtectionOnly",
    )
    expect(monitoringPage).toContain(
      "brandProtectionOnly={brandProtectionSourceRegistryLocked}",
    )
  })

  it("validates the result limit before saving provider settings", () => {
    expect(sourceWatchlist).toContain("parsedSearchIndexLimit >= 1")
    expect(sourceWatchlist).toContain("parsedSearchIndexLimit <= 100")
    expect(sourceWatchlist).toContain('toast.error(t("settingsLimitInvalid"))')
    expect(sourceWatchlist).toContain('t("settingsSave")')
  })

  it("accepts the configurable web-search actor in the API contract", () => {
    expect(monitoringSettingsRoute).toContain("webSearch: z.string()")
  })

  it("does not offer or submit a scenario assignment from the source watchlist", () => {
    expect(sourceWatchlist).not.toContain("social-watchlist-monitoring")
    expect(sourceWatchlist).not.toContain("bulkScenarioId")
    expect(sourceWatchlist).not.toContain("payload.scenarioId")
    expect(sourceWatchlist).not.toContain("payload.subjectId")
    expect(sourceWatchlist).not.toContain("/api/v1/social/monitoring-scenarios")
  })

  it("does not offer or submit source assignments from the subject manager", () => {
    expect(subjectManager).not.toContain("/api/v1/social/monitoring-sources")
    expect(subjectManager).not.toContain("form.sourceIds")
    expect(subjectManager).not.toContain("sourceIds: form.sourceIds")
  })
})
