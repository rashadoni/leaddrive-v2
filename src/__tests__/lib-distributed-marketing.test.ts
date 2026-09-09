/**
 * Tests for C7 Distributed Marketing slice 1 — 5 pure helpers.
 * No DB; all helpers are pure functions.
 */
import { describe, expect, it } from "vitest"

import {
  canTransitionPersonalizationStatus,
  canTransitionTemplateStatus,
  isPersonalizationStatus,
  isTemplateChannel,
  isTemplateStatus,
  validatePersonalization,
  validateTemplate,
} from "@/lib/distributed-marketing/template-variable-validator"
import {
  countPlaceholders,
  mergeVariables,
  renderTemplate,
} from "@/lib/distributed-marketing/personalization-renderer"
import {
  filterAccessibleTemplates,
  isDistributionType,
  resolveAccess,
} from "@/lib/distributed-marketing/distribution-resolver"
import {
  classifySendOutcome,
  isSendOutcome,
} from "@/lib/distributed-marketing/send-outcome-classifier"
import {
  CHANNELS_REQUIRING_SUBJECT,
  DISTRIBUTION_TYPES,
  PERSONALIZATION_STATUSES,
  PERSONALIZATION_STATUS_TRANSITIONS,
  SEND_OUTCOMES,
  TEMPLATE_CHANNELS,
  TEMPLATE_STATUSES,
  TEMPLATE_STATUS_TRANSITIONS,
  VARIABLE_SLOT_TYPES,
  type VariableSlot,
} from "@/lib/distributed-marketing/types"

/* ─── Exhaustiveness ───────────────────────────────────────────────────── */

describe("C7 — enum + transition map exhaustiveness", () => {
  it("TEMPLATE_STATUS_TRANSITIONS covers all statuses", () => {
    expect(Object.keys(TEMPLATE_STATUS_TRANSITIONS).sort()).toEqual(
      [...TEMPLATE_STATUSES].sort(),
    )
  })
  it("PERSONALIZATION_STATUS_TRANSITIONS covers all statuses", () => {
    expect(Object.keys(PERSONALIZATION_STATUS_TRANSITIONS).sort()).toEqual(
      [...PERSONALIZATION_STATUSES].sort(),
    )
  })
  it("every transition target known", () => {
    for (const t of Object.values(TEMPLATE_STATUS_TRANSITIONS).flat()) {
      expect(TEMPLATE_STATUSES).toContain(t)
    }
    for (const t of Object.values(PERSONALIZATION_STATUS_TRANSITIONS).flat()) {
      expect(PERSONALIZATION_STATUSES).toContain(t)
    }
  })
  it("CHANNELS_REQUIRING_SUBJECT is subset of TEMPLATE_CHANNELS", () => {
    for (const c of CHANNELS_REQUIRING_SUBJECT) {
      expect(TEMPLATE_CHANNELS).toContain(c)
    }
  })
  it("VARIABLE_SLOT_TYPES has 6 kinds", () => {
    expect(VARIABLE_SLOT_TYPES).toEqual([
      "string",
      "text",
      "url",
      "email",
      "number",
      "boolean",
    ])
  })
  it("DISTRIBUTION_TYPES has 4 kinds", () => {
    expect(DISTRIBUTION_TYPES).toEqual(["all", "user", "role", "team"])
  })
  it("SEND_OUTCOMES has 3 kinds", () => {
    expect(SEND_OUTCOMES).toEqual(["sent", "failed", "bounced"])
  })
})

/* ─── Type guards ──────────────────────────────────────────────────────── */

describe("C7 — type guards", () => {
  it("isTemplateChannel", () => {
    expect(isTemplateChannel("email")).toBe(true)
    expect(isTemplateChannel("postal")).toBe(false) // not in template channels
    expect(isTemplateChannel(42)).toBe(false)
  })
  it("isTemplateStatus", () => {
    expect(isTemplateStatus("active")).toBe(true)
    expect(isTemplateStatus("xxx")).toBe(false)
  })
  it("isPersonalizationStatus", () => {
    expect(isPersonalizationStatus("draft")).toBe(true)
    expect(isPersonalizationStatus(null)).toBe(false)
  })
  it("isDistributionType", () => {
    expect(isDistributionType("all")).toBe(true)
    expect(isDistributionType("admin")).toBe(false)
  })
  it("isSendOutcome", () => {
    expect(isSendOutcome("sent")).toBe(true)
    expect(isSendOutcome("queued")).toBe(false)
  })
})

/* ─── Template state machine ───────────────────────────────────────────── */

describe("C7 — template state machine", () => {
  it("draft ↔ active permitted (pull-back to edit)", () => {
    expect(canTransitionTemplateStatus("draft", "active")).toBe(true)
    expect(canTransitionTemplateStatus("active", "draft")).toBe(true)
  })
  it("either → archived", () => {
    expect(canTransitionTemplateStatus("draft", "archived")).toBe(true)
    expect(canTransitionTemplateStatus("active", "archived")).toBe(true)
  })
  it("archived terminal", () => {
    expect(canTransitionTemplateStatus("archived", "active")).toBe(false)
    expect(canTransitionTemplateStatus("archived", "draft")).toBe(false)
  })
  it("same-status no-op", () => {
    expect(canTransitionTemplateStatus("active", "active")).toBe(true)
  })
})

describe("C7 — personalization state machine", () => {
  it("draft ↔ active", () => {
    expect(canTransitionPersonalizationStatus("draft", "active")).toBe(true)
    expect(canTransitionPersonalizationStatus("active", "draft")).toBe(true)
  })
  it("either → archived", () => {
    expect(canTransitionPersonalizationStatus("draft", "archived")).toBe(true)
    expect(canTransitionPersonalizationStatus("active", "archived")).toBe(true)
  })
  it("archived terminal", () => {
    expect(canTransitionPersonalizationStatus("archived", "draft")).toBe(false)
  })
})

/* ─── Template variable validator ──────────────────────────────────────── */

describe("C7 — validateTemplate: channel-subject coherence", () => {
  it("email requires subject", () => {
    const result = validateTemplate({
      channel: "email",
      subjectTemplate: null,
      bodyTemplate: "Hello",
      lockedVariables: {},
      unlockedVariables: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("channel_subject_mismatch")
  })
  it("push requires subject", () => {
    const result = validateTemplate({
      channel: "push",
      subjectTemplate: "",
      bodyTemplate: "Hello",
      lockedVariables: {},
      unlockedVariables: [],
    })
    expect(result.ok).toBe(false)
  })
  it("sms must NOT have subject", () => {
    const result = validateTemplate({
      channel: "sms",
      subjectTemplate: "should-be-null",
      bodyTemplate: "Hello",
      lockedVariables: {},
      unlockedVariables: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("channel_subject_mismatch")
  })
  it("sms with null subject OK", () => {
    const result = validateTemplate({
      channel: "sms",
      subjectTemplate: null,
      bodyTemplate: "Hello",
      lockedVariables: {},
      unlockedVariables: [],
    })
    expect(result.ok).toBe(true)
  })
})

describe("C7 — validateTemplate: variable bucket overlap", () => {
  it("rejects key in both buckets", () => {
    const result = validateTemplate({
      channel: "email",
      subjectTemplate: "Subject",
      bodyTemplate: "Hello {{rep_name}}",
      lockedVariables: { rep_name: "Corporate" },
      unlockedVariables: [
        { name: "rep_name", label: "Your name", type: "string" },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("variable_in_both_buckets")
      expect(result.fields).toContain("rep_name")
    }
  })

  it("multiple overlaps all listed", () => {
    const result = validateTemplate({
      channel: "email",
      subjectTemplate: "Sub {{x}} {{y}}",
      bodyTemplate: "Hi",
      lockedVariables: { x: 1, y: 2 },
      unlockedVariables: [
        { name: "x", label: "X", type: "string" },
        { name: "y", label: "Y", type: "string" },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.fields).toEqual(["x", "y"])
  })
})

describe("C7 — validateTemplate: placeholders declared", () => {
  it("rejects undeclared placeholder in body", () => {
    const result = validateTemplate({
      channel: "sms",
      subjectTemplate: null,
      bodyTemplate: "Hello {{unknown}}",
      lockedVariables: {},
      unlockedVariables: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("placeholder_undeclared")
      expect(result.fields).toContain("unknown")
    }
  })

  it("rejects undeclared in subject (email)", () => {
    const result = validateTemplate({
      channel: "email",
      subjectTemplate: "Hi {{undeclared}}",
      bodyTemplate: "Body",
      lockedVariables: {},
      unlockedVariables: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("placeholder_undeclared")
  })

  it("accepts when all placeholders declared", () => {
    const result = validateTemplate({
      channel: "email",
      subjectTemplate: "Hi {{rep_name}}",
      bodyTemplate: "From {{company_name}}, {{rep_name}}",
      lockedVariables: { company_name: "LeadDrive" },
      unlockedVariables: [
        { name: "rep_name", label: "Your name", type: "string" },
      ],
    })
    expect(result.ok).toBe(true)
  })

  it("accepts no placeholders at all", () => {
    const result = validateTemplate({
      channel: "sms",
      subjectTemplate: null,
      bodyTemplate: "Plain text body",
      lockedVariables: {},
      unlockedVariables: [],
    })
    expect(result.ok).toBe(true)
  })

  it("reserved-prefix placeholders (contact_*) need no declaration", () => {
    const result = validateTemplate({
      channel: "sms",
      subjectTemplate: null,
      bodyTemplate: "Hello {{contact_first_name}}, today is {{today_iso}}",
      lockedVariables: {},
      unlockedVariables: [],
    })
    expect(result.ok).toBe(true)
  })

  it("reserved-prefix sender_* placeholder accepted", () => {
    const result = validateTemplate({
      channel: "sms",
      subjectTemplate: null,
      bodyTemplate: "From {{sender_name}}",
      lockedVariables: {},
      unlockedVariables: [],
    })
    expect(result.ok).toBe(true)
  })

  it("unknown prefix still rejected (e.g. contactX_ without underscore)", () => {
    const result = validateTemplate({
      channel: "sms",
      subjectTemplate: null,
      bodyTemplate: "Hi {{contactX_name}}", // no underscore after `contact`
      lockedVariables: {},
      unlockedVariables: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("placeholder_undeclared")
  })
})

describe("C7 — validateTemplate: slot shape", () => {
  it("rejects slot missing name", () => {
    const result = validateTemplate({
      channel: "sms",
      subjectTemplate: null,
      bodyTemplate: "Hi",
      lockedVariables: {},
      unlockedVariables: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { label: "Your name", type: "string" } as any,
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("slot_shape_invalid")
  })

  it("rejects slot with unknown type", () => {
    const result = validateTemplate({
      channel: "sms",
      subjectTemplate: null,
      bodyTemplate: "Hi {{x}}",
      lockedVariables: {},
      unlockedVariables: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { name: "x", label: "X", type: "bogus" as any },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("slot_type_unknown")
  })

  it("rejects duplicate slot names", () => {
    const result = validateTemplate({
      channel: "sms",
      subjectTemplate: null,
      bodyTemplate: "Hi {{x}}",
      lockedVariables: {},
      unlockedVariables: [
        { name: "x", label: "X1", type: "string" },
        { name: "x", label: "X2", type: "string" },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("duplicate_slot_name")
  })

  it("rejects non-array unlockedVariables (slice-2 DB JSONB defense)", () => {
    const result = validateTemplate({
      channel: "sms",
      subjectTemplate: null,
      bodyTemplate: "Hi",
      lockedVariables: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unlockedVariables: {} as any,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("slot_shape_invalid")
      expect(result.message).toContain("array")
    }
  })

  it("rejects null unlockedVariables (slice-2 defense)", () => {
    const result = validateTemplate({
      channel: "sms",
      subjectTemplate: null,
      bodyTemplate: "Hi",
      lockedVariables: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unlockedVariables: null as any,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("slot_shape_invalid")
  })
})

/* ─── Personalization validator ────────────────────────────────────────── */

const templateForPersonalization = {
  lockedVariables: { company_name: "LeadDrive" },
  unlockedVariables: [
    { name: "rep_name", label: "Your name", type: "string", required: true },
    { name: "signature", label: "Signature", type: "text" },
    { name: "local_cta_url", label: "Your CTA link", type: "url" },
  ] as VariableSlot[],
}

describe("C7 — validatePersonalization", () => {
  it("rejects attempt to override locked variable", () => {
    const result = validatePersonalization({
      template: templateForPersonalization,
      variableValues: { company_name: "Hacked Corp" },
      requireAllRequired: false,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("personalization_key_locked")
      expect(result.fields).toContain("company_name")
    }
  })

  it("rejects unknown key (not in slots)", () => {
    const result = validatePersonalization({
      template: templateForPersonalization,
      variableValues: { mystery_key: "x" },
      requireAllRequired: false,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("personalization_unknown_key")
  })

  it("draft save allows missing required when requireAllRequired=false", () => {
    const result = validatePersonalization({
      template: templateForPersonalization,
      variableValues: { signature: "—Rashad" },
      requireAllRequired: false,
    })
    expect(result.ok).toBe(true)
  })

  it("active transition rejects missing required", () => {
    const result = validatePersonalization({
      template: templateForPersonalization,
      variableValues: { signature: "—Rashad" },
      requireAllRequired: true,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("personalization_required_missing")
      expect(result.fields).toContain("rep_name")
    }
  })

  it("active transition accepts complete fills", () => {
    const result = validatePersonalization({
      template: templateForPersonalization,
      variableValues: {
        rep_name: "Rashad",
        signature: "—Rashad",
        local_cta_url: "https://example.com/cta",
      },
      requireAllRequired: true,
    })
    expect(result.ok).toBe(true)
  })

  it("required slot with defaultValue treated as filled", () => {
    const template = {
      lockedVariables: {},
      unlockedVariables: [
        {
          name: "subject_prefix",
          label: "Subject prefix",
          type: "string" as const,
          required: true,
          defaultValue: "[Demo]",
        },
      ] as VariableSlot[],
    }
    const result = validatePersonalization({
      template,
      variableValues: {},
      requireAllRequired: true,
    })
    expect(result.ok).toBe(true)
  })

  it("type-tag: rejects number for url slot", () => {
    const result = validatePersonalization({
      template: templateForPersonalization,
      variableValues: {
        local_cta_url: 42 as unknown as string,
      },
      requireAllRequired: false,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("personalization_value_type_mismatch")
  })

  it("type-tag: rejects invalid URL format", () => {
    const result = validatePersonalization({
      template: templateForPersonalization,
      variableValues: { local_cta_url: "not-a-url" },
      requireAllRequired: false,
    })
    expect(result.ok).toBe(false)
  })

  it("type-tag: accepts valid HTTPS URL", () => {
    const result = validatePersonalization({
      template: templateForPersonalization,
      variableValues: { local_cta_url: "https://leaddrivecrm.org/cta" },
      requireAllRequired: false,
    })
    expect(result.ok).toBe(true)
  })

  it("type-tag: rejects ftp URL (only http/https)", () => {
    const result = validatePersonalization({
      template: templateForPersonalization,
      variableValues: { local_cta_url: "ftp://files.example.com" },
      requireAllRequired: false,
    })
    expect(result.ok).toBe(false)
  })

  it("type-tag: number slot rejects string", () => {
    const template = {
      lockedVariables: {},
      unlockedVariables: [
        { name: "discount", label: "Discount %", type: "number" as const },
      ] as VariableSlot[],
    }
    const result = validatePersonalization({
      template,
      variableValues: { discount: "20" as unknown as number },
      requireAllRequired: false,
    })
    expect(result.ok).toBe(false)
  })

  it("type-tag: email slot accepts valid email", () => {
    const template = {
      lockedVariables: {},
      unlockedVariables: [
        { name: "reply_to", label: "Reply to", type: "email" as const },
      ] as VariableSlot[],
    }
    const result = validatePersonalization({
      template,
      variableValues: { reply_to: "rashad@leaddrivecrm.org" },
      requireAllRequired: false,
    })
    expect(result.ok).toBe(true)
  })

  it("type-tag: email slot rejects non-email string", () => {
    const template = {
      lockedVariables: {},
      unlockedVariables: [
        { name: "reply_to", label: "Reply to", type: "email" as const },
      ] as VariableSlot[],
    }
    const result = validatePersonalization({
      template,
      variableValues: { reply_to: "not an email" },
      requireAllRequired: false,
    })
    expect(result.ok).toBe(false)
  })
})

/* ─── Personalization renderer ─────────────────────────────────────────── */

describe("C7 — renderTemplate", () => {
  it("substitutes locked + personalization variables", () => {
    const result = renderTemplate({
      subjectTemplate: "From {{company_name}}",
      bodyTemplate: "Hi! Cheers, {{rep_name}} ({{company_name}})",
      lockedVariables: { company_name: "LeadDrive" },
      personalizationValues: { rep_name: "Rashad" },
    })
    expect(result.subject).toBe("From LeadDrive")
    expect(result.body).toBe("Hi! Cheers, Rashad (LeadDrive)")
    expect(result.unfilledPlaceholders).toEqual([])
  })

  it("locked variables WIN over personalization (defense-in-depth)", () => {
    const result = renderTemplate({
      subjectTemplate: null,
      bodyTemplate: "Brand: {{brand}}",
      lockedVariables: { brand: "CorporateValue" },
      // Rep tries to override (validator should have caught it; renderer
      // is defense-in-depth — locked value still wins).
      personalizationValues: { brand: "RepValue" },
    })
    expect(result.body).toBe("Brand: CorporateValue")
  })

  it("contact variables apply for per-send personalization", () => {
    const result = renderTemplate({
      subjectTemplate: null,
      bodyTemplate: "Hello {{contact_first_name}}, from {{rep_name}}",
      lockedVariables: {},
      personalizationValues: { rep_name: "Rashad" },
      contactVariables: { contact_first_name: "Alice" },
    })
    expect(result.body).toBe("Hello Alice, from Rashad")
  })

  it("locked > contact > personalization precedence", () => {
    const result = renderTemplate({
      subjectTemplate: null,
      bodyTemplate: "{{x}}",
      lockedVariables: { x: "LOCKED" },
      personalizationValues: { x: "PERSONALIZATION" },
      contactVariables: { x: "CONTACT" },
    })
    expect(result.body).toBe("LOCKED")
  })

  it("contact > personalization when no locked", () => {
    const result = renderTemplate({
      subjectTemplate: null,
      bodyTemplate: "{{x}}",
      lockedVariables: {},
      personalizationValues: { x: "PERSONALIZATION" },
      contactVariables: { x: "CONTACT" },
    })
    expect(result.body).toBe("CONTACT")
  })

  it("unfilled placeholders left as-is + recorded", () => {
    const result = renderTemplate({
      subjectTemplate: null,
      bodyTemplate: "Hi {{name}}, your code is {{code}}",
      lockedVariables: {},
      personalizationValues: { name: "Alice" },
    })
    expect(result.body).toBe("Hi Alice, your code is {{code}}")
    expect(result.unfilledPlaceholders).toEqual(["code"])
  })

  it("null subject → null in output", () => {
    const result = renderTemplate({
      subjectTemplate: null,
      bodyTemplate: "Body",
      lockedVariables: {},
      personalizationValues: {},
    })
    expect(result.subject).toBeNull()
  })

  it("empty subject string → null in output", () => {
    const result = renderTemplate({
      subjectTemplate: "",
      bodyTemplate: "Body",
      lockedVariables: {},
      personalizationValues: {},
    })
    expect(result.subject).toBeNull()
  })

  it("number/boolean variables stringified", () => {
    const result = renderTemplate({
      subjectTemplate: null,
      bodyTemplate: "Price: {{price}}, Active: {{active}}",
      lockedVariables: { price: 99.99, active: true },
      personalizationValues: {},
    })
    expect(result.body).toBe("Price: 99.99, Active: true")
  })

  it("multiple occurrences of same placeholder all replaced", () => {
    const result = renderTemplate({
      subjectTemplate: null,
      bodyTemplate: "{{x}} {{x}} {{x}}",
      lockedVariables: { x: "y" },
      personalizationValues: {},
    })
    expect(result.body).toBe("y y y")
  })

  it("placeholder whitespace tolerated: {{ name }}", () => {
    const result = renderTemplate({
      subjectTemplate: null,
      bodyTemplate: "Hi {{ name }}",
      lockedVariables: {},
      personalizationValues: { name: "Alice" },
    })
    expect(result.body).toBe("Hi Alice")
  })

  it("null variable value renders as empty string", () => {
    const result = renderTemplate({
      subjectTemplate: null,
      bodyTemplate: "Hi {{name}}!",
      lockedVariables: { name: null },
      personalizationValues: {},
    })
    expect(result.body).toBe("Hi !")
  })

  it("unfilledPlaceholders sorted + deduped", () => {
    const result = renderTemplate({
      subjectTemplate: null,
      bodyTemplate: "{{zebra}} {{alpha}} {{zebra}}",
      lockedVariables: {},
      personalizationValues: {},
    })
    expect(result.unfilledPlaceholders).toEqual(["alpha", "zebra"])
  })
})

describe("C7 — mergeVariables", () => {
  it("composes maps with correct precedence", () => {
    const merged = mergeVariables({
      lockedVariables: { x: "L", common: "L_C" },
      personalizationValues: { y: "P", common: "P_C" },
      contactVariables: { z: "Ct", common: "Ct_C" },
    })
    expect(merged.x).toBe("L")
    expect(merged.y).toBe("P")
    expect(merged.z).toBe("Ct")
    expect(merged.common).toBe("L_C")
  })
})

describe("C7 — countPlaceholders", () => {
  it("counts all occurrences (not dedup)", () => {
    expect(countPlaceholders("{{a}} {{b}} {{a}}")).toBe(3)
  })
  it("returns 0 for no placeholders", () => {
    expect(countPlaceholders("plain text")).toBe(0)
  })
})

/* ─── Distribution resolver ────────────────────────────────────────────── */

describe("C7 — resolveAccess", () => {
  const userAlice = {
    userId: "u_alice",
    role: "sales",
    teamRefs: ["team_us_west"],
  }

  it("empty rules → no access", () => {
    const result = resolveAccess({ user: userAlice, rules: [] })
    expect(result.hasAccess).toBe(false)
    expect(result.grantedBy).toBeNull()
  })

  it("'all' rule grants everyone", () => {
    const result = resolveAccess({
      user: userAlice,
      rules: [{ distributionType: "all" }],
    })
    expect(result.hasAccess).toBe(true)
    expect(result.grantedBy?.distributionType).toBe("all")
  })

  it("'user' rule grants matching user", () => {
    const result = resolveAccess({
      user: userAlice,
      rules: [{ distributionType: "user", targetUserId: "u_alice" }],
    })
    expect(result.hasAccess).toBe(true)
  })

  it("'user' rule rejects different user", () => {
    const result = resolveAccess({
      user: userAlice,
      rules: [{ distributionType: "user", targetUserId: "u_bob" }],
    })
    expect(result.hasAccess).toBe(false)
  })

  it("'role' rule grants matching role", () => {
    const result = resolveAccess({
      user: userAlice,
      rules: [{ distributionType: "role", targetRole: "sales" }],
    })
    expect(result.hasAccess).toBe(true)
  })

  it("'role' rule rejects different role", () => {
    const result = resolveAccess({
      user: userAlice,
      rules: [{ distributionType: "role", targetRole: "admin" }],
    })
    expect(result.hasAccess).toBe(false)
  })

  it("'team' rule grants when team in user.teamRefs", () => {
    const result = resolveAccess({
      user: userAlice,
      rules: [{ distributionType: "team", targetTeamRef: "team_us_west" }],
    })
    expect(result.hasAccess).toBe(true)
  })

  it("'team' rule rejects non-member team", () => {
    const result = resolveAccess({
      user: userAlice,
      rules: [{ distributionType: "team", targetTeamRef: "team_eu" }],
    })
    expect(result.hasAccess).toBe(false)
  })

  it("multiple rules OR-logic (any-match grants)", () => {
    const result = resolveAccess({
      user: userAlice,
      rules: [
        { distributionType: "user", targetUserId: "u_bob" }, // miss
        { distributionType: "role", targetRole: "admin" }, // miss
        { distributionType: "role", targetRole: "sales" }, // hit
      ],
    })
    expect(result.hasAccess).toBe(true)
    expect(result.grantedBy?.distributionType).toBe("role")
  })

  it("first-matching rule wins (grantedBy diagnostic)", () => {
    const result = resolveAccess({
      user: userAlice,
      rules: [
        { distributionType: "all" },
        { distributionType: "role", targetRole: "sales" },
      ],
    })
    expect(result.grantedBy?.distributionType).toBe("all")
  })

  it("'user' rule with null targetUserId never matches", () => {
    const result = resolveAccess({
      user: userAlice,
      rules: [{ distributionType: "user", targetUserId: null }],
    })
    expect(result.hasAccess).toBe(false)
  })
})

describe("C7 — filterAccessibleTemplates", () => {
  const userAlice = {
    userId: "u_alice",
    role: "sales",
    teamRefs: ["team_us_west"],
  }

  it("returns only templates the user has access to", () => {
    const visible = filterAccessibleTemplates(userAlice, [
      {
        id: "t1",
        rules: [{ distributionType: "all" as const }],
      },
      {
        id: "t2",
        rules: [{ distributionType: "user" as const, targetUserId: "u_bob" }],
      },
      {
        id: "t3",
        rules: [{ distributionType: "role" as const, targetRole: "sales" }],
      },
      { id: "t4", rules: [] },
    ])
    expect(visible.map((t) => t.id)).toEqual(["t1", "t3"])
  })
})

/* ─── Send outcome classifier ──────────────────────────────────────────── */

describe("C7 — classifySendOutcome", () => {
  it("success=true → sent (no error)", () => {
    const result = classifySendOutcome({ success: true })
    expect(result.outcome).toBe("sent")
    expect(result.errorMessage).toBeNull()
  })

  it("success=false + errorMessage → failed", () => {
    const result = classifySendOutcome({
      success: false,
      errorMessage: "SMTP timeout",
    })
    expect(result.outcome).toBe("failed")
    expect(result.errorMessage).toBe("SMTP timeout")
  })

  it("success=false + statusCode only → fallback message", () => {
    const result = classifySendOutcome({
      success: false,
      statusCode: 502,
    })
    expect(result.outcome).toBe("failed")
    expect(result.errorMessage).toContain("502")
  })

  it("success=false + nothing → generic message", () => {
    const result = classifySendOutcome({ success: false })
    expect(result.outcome).toBe("failed")
    expect(result.errorMessage).toBe("channel sender returned failure")
  })

  it("reportedBounce=true overrides success", () => {
    const result = classifySendOutcome({
      success: true,
      reportedBounce: true,
      errorMessage: "mailbox full",
    })
    expect(result.outcome).toBe("bounced")
    expect(result.errorMessage).toBe("bounced: mailbox full")
  })

  it("bounce without error message gets generic", () => {
    const result = classifySendOutcome({
      success: true,
      reportedBounce: true,
    })
    expect(result.outcome).toBe("bounced")
    expect(result.errorMessage).toBe("bounced")
  })

  it("whitespace-only error message treated as missing", () => {
    const result = classifySendOutcome({
      success: false,
      errorMessage: "   ",
      statusCode: 500,
    })
    expect(result.errorMessage).toContain("500")
  })
})

/* ─── End-to-end pipeline sanity ───────────────────────────────────────── */

describe("C7 — end-to-end pipeline", () => {
  it("validates template, validates personalization, renders, classifies", () => {
    // 1. Author template
    const templateInput = {
      channel: "email" as const,
      subjectTemplate: "Hi {{contact_first_name}} from {{company_name}}",
      bodyTemplate:
        "Dear {{contact_first_name}},\n\nWe at {{company_name}} would love to demo. {{cta_url}}.\n\nBest,\n{{rep_name}}",
      lockedVariables: {
        company_name: "LeadDrive",
      },
      unlockedVariables: [
        { name: "rep_name", label: "Your name", type: "string" as const, required: true },
        { name: "cta_url", label: "Demo link", type: "url" as const, required: true },
      ] as VariableSlot[],
    }
    expect(validateTemplate(templateInput).ok).toBe(true)

    // 2. Rep personalizes
    const personalization = {
      template: templateInput,
      variableValues: {
        rep_name: "Rashad",
        cta_url: "https://leaddrivecrm.org/demo?ref=rashad",
      },
      requireAllRequired: true,
    }
    expect(validatePersonalization(personalization).ok).toBe(true)

    // 3. Render to send to a specific contact
    const rendered = renderTemplate({
      subjectTemplate: templateInput.subjectTemplate,
      bodyTemplate: templateInput.bodyTemplate,
      lockedVariables: templateInput.lockedVariables,
      personalizationValues: personalization.variableValues,
      contactVariables: { contact_first_name: "Alice" },
    })
    expect(rendered.subject).toBe("Hi Alice from LeadDrive")
    expect(rendered.body).toContain("Dear Alice")
    expect(rendered.body).toContain("LeadDrive")
    expect(rendered.body).toContain("https://leaddrivecrm.org/demo?ref=rashad")
    expect(rendered.body).toContain("Rashad")
    expect(rendered.unfilledPlaceholders).toEqual([])

    // 4. Classify send result
    const outcome = classifySendOutcome({ success: true })
    expect(outcome.outcome).toBe("sent")
  })

  it("access resolution scenario: rep with team access", () => {
    const userBob = { userId: "u_bob", role: "sales", teamRefs: ["team_eu"] }
    const templates = [
      {
        id: "global_intro",
        rules: [{ distributionType: "all" as const }],
      },
      {
        id: "eu_promo",
        rules: [
          { distributionType: "team" as const, targetTeamRef: "team_eu" },
        ],
      },
      {
        id: "us_promo",
        rules: [
          { distributionType: "team" as const, targetTeamRef: "team_us_west" },
        ],
      },
    ]
    const visible = filterAccessibleTemplates(userBob, templates)
    expect(visible.map((t) => t.id)).toEqual(["global_intro", "eu_promo"])
  })
})
