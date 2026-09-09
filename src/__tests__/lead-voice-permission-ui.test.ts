import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(
  "src/components/leads/lead-voice-permission.tsx",
  "utf8",
);
const route = readFileSync(
  "src/app/api/v1/leads/[id]/voice-permission/route.ts",
  "utf8",
);
const leadPage = readFileSync(
  "src/app/(dashboard)/leads/[id]/page.tsx",
  "utf8",
);
const idempotencyMigration = readFileSync(
  "prisma/migrations/20260810124500_voice_permission_idempotency_audit/migration.sql",
  "utf8",
);
const messages = Object.fromEntries(
  ["en", "ru", "az"].map((locale) => [
    locale,
    JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Record<
      string,
      unknown
    >,
  ]),
);

describe("lead voice permission UI contract", () => {
  it("places the permission control in the lead overview without changing the call action", () => {
    expect(leadPage).toContain("import { LeadVoicePermission }");
    expect(leadPage).toContain("<LeadVoicePermission");
    expect(leadPage.indexOf("<LeadVoicePermission")).toBeLessThan(
      leadPage.indexOf('t("salesCallTitle")'),
    );
    expect(leadPage).toContain("<LeadAiCallAction");
    expect(leadPage).toContain("key={`${lead.id}:${lead.updatedAt}`}");
  });

  it("keeps the browser contract lead-scoped and never sends a destination or actor", () => {
    expect(component).toContain("/voice-permission");
    expect(component).toContain("encodeURIComponent(leadId)");
    expect(component).toContain("crypto.randomUUID()");
    expect(component).toContain("leadVersion: permission.leadVersion");
    expect(component).not.toContain("toNumber");
    expect(component).not.toContain("phoneE164");
    expect(component).not.toContain("confirmedBy");
    expect(component).not.toContain("createdBy");
  });

  it("requires explicit confirmation before a manager can restore voice contact", () => {
    expect(component).toContain("action: pendingAction");
    expect(component).toContain(
      'pendingAction === "allow" ? { confirmation: true }',
    );
    expect(component).toContain('type="checkbox"');
    expect(component).toContain('pendingAction === "allow" && !allowConfirmed');
    expect(component).toContain('openConfirmation("block")');
    expect(component).toContain('openConfirmation("allow")');
    expect(component).toContain("!permission.globalBlockActive");
  });

  it("pins permission request replay keys with a tenant-scoped partial unique index", () => {
    expect(idempotencyMigration).toContain("CREATE UNIQUE INDEX");
    expect(idempotencyMigration).toContain(
      '"organizationId", "entityType", "entityId"',
    );
    expect(idempotencyMigration).toContain(
      "WHERE \"entityType\" = 'lead_voice_permission'",
    );
  });

  it("has clear allowed, blocked, unknown, loading, and retry copy in every locale", () => {
    for (const locale of ["en", "ru", "az"]) {
      const leads = messages[locale].leads as Record<string, unknown>;
      const permission = leads.voicePermission as Record<string, unknown>;
      const status = permission.status as Record<string, string>;
      expect(status.allowed).toBeTruthy();
      expect(status.blocked).toBeTruthy();
      expect(status.unknown).toBeTruthy();
      expect(permission.loading).toBeTruthy();
      expect(permission.retry).toBeTruthy();
      expect(permission.managerRestoreOnly).toBeTruthy();
      expect(permission.broaderRestrictionActive).toBeTruthy();
      expect(permission.staleError).toBeTruthy();
      expect(permission.broaderRestrictionError).toBeTruthy();
      expect(permission.historyTitle).toBeTruthy();
    }
  });

  it("states the phone-level sales scope, blocked-consent semantics, and dispatch caveat", () => {
    const en = (messages.en.leads as Record<string, unknown>).voicePermission;
    const ru = (messages.ru.leads as Record<string, unknown>).voicePermission;
    const az = (messages.az.leads as Record<string, unknown>).voicePermission;
    expect(JSON.stringify(en)).toContain("ordinary CRM");
    expect(JSON.stringify(en)).toContain("stored blocked consent");
    expect(JSON.stringify(en)).toContain("already dispatching");
    expect(JSON.stringify(en)).toContain("sharing this phone");
    expect(JSON.stringify(ru)).toContain("обычные звонки");
    expect(JSON.stringify(ru)).toContain("сохранённым отказом");
    expect(JSON.stringify(ru)).toContain("Уже отправляемый");
    expect(JSON.stringify(ru)).toContain("тем же номером");
    expect(JSON.stringify(az)).toContain("adi CRM");
    expect(JSON.stringify(az)).toContain("saxlanmış imtina");
    expect(JSON.stringify(az)).toContain("Artıq göndərilməkdə");
    expect(JSON.stringify(az)).toContain("eyni telefonu");
  });

  it("keeps mutations sales-only, guarded, revision-bound, and serialized with dispatch", () => {
    expect(route).toContain("guardInteractiveJsonMutation");
    expect(route).toContain("lockVoiceContactPermission");
    expect(route).toContain("TransactionIsolationLevel.ReadCommitted");
    expect(route).toContain('scope: "sales"');
    expect(route).toContain("leadVersion");
    expect(route).toContain("phoneFingerprint");
    expect(route).not.toContain(
      'scope: { in: ["sales", "all"] },\n              isActive: true',
    );
  });
});
