# Enterprise Contract Lifecycle Management (CLM) — Design Spec (2026-06-07)

## Goal
Take Contracts + Contract Lifecycle from ~3.5/10 (shipped) to a **full enterprise 10/10 CLM**
(user decision: build everything — incl. AI layer, ASC-606 revenue recognition, semantic search,
and a dedicated "Contracts" nav group). End-state parity target: Ironclad / Icertis / DocuSign CLM
class, adapted to this multi-tenant B2B CRM.

## Decisions (locked 2026-06-07, after decision-stress-test + Codex peer review)
- **Scope:** FULL enterprise 10/10 (the user chose this over the lean-segment option).
- **Sequencing (Codex-corrected — build everything, but in dependency order):**
  document core + versioning FIRST → signature → approvals/intake → amendments/repository →
  obligations/analytics → **AI layer LAST** (needs document volume first) → integrations.
- **Versioning before/with e-sign** — you cannot sign what you cannot version. Every executed
  contract has ONE canonical signed version + immutable hash + full diff history.
- **Nav:** a dedicated **"Contracts" group** is the end-state, BUT sub-section nav items are added
  **only as each slice ships** (avoid dead nav / advertising roadmap holes — Codex). Until ≥3-4
  daily-use surfaces exist, keep them under a single Contracts area with tabs.
- **Counterparty experience is first-class** (external signer/reviewer portal, email, reminders).
- **Clause governance** (template ownership, approved fallback language, who-may-deviate) is core.
- Reuse what exists: status state-machine, sequential approvals, renewal alerts (90/60/30/14/7),
  quote→contract spawn, audit log, RBAC; and the UNWIRED foundations (ContractTemplate +
  clause-substitution, Esign envelope/signer/token/state-machine, ASC-606 PO/schedule/entry).

## Current state (audit 2026-06-07)
Shipped+usable: CRUD; status state-machine; sequential multi-stage approvals + bottleneck dashboard;
renewal alerts + cron; quote→contract spawn; audit log; RBAC + field perms; list UI + basic KPIs.
Built-but-unwired (schema+helpers): templates/clauses, e-sign, ASC-606 revenue recognition.
Missing: PDF export, versioning/redline/compare, parallel+conditional approvals, intake forms,
obligation UI, analytics, ALL AI, DocuSign/ERP/Slack integrations, counterparty portal.

## Slice plan (each slice = own architect + Codex review + deploy; nav item added when it ships)

### Slice 1 — Document core (authoring + versioning + PDF)
- **Schema:** `ContractVersion` (contractId, versionNo, renderedBody/snapshot, contentHash, source
  draft|amendment|signed, createdBy, createdAt, isCanonicalSigned) + a reusable `ContractClause`
  library model (org-scoped: title, body, category, riskLevel, governingLaw, fallbackOf, owner,
  status draft|approved, version) distinct from the template's embedded clauses. Migration.
- **API+UI:** Template CRUD (authoring editor + variables) + Clause-library CRUD (governance:
  approved/fallback, owner) — wire the existing substitution engine.
- **Generate:** contract-from-template (apply template → renderedBody + ContractVersion v1).
- **PDF export** (reuse jsPDF from CPQ) of renderedBody.
- **Version history UI** (list versions + diff/compare two versions).
- **Nav:** introduce the Contracts area + first tabs (Contracts | Lifecycle | Templates & Clauses).

### Slice 2 — Signature + counterparty experience
- Wire the e-sign foundation: public `/sign/[token]` portal (HMAC token verify), envelope API/UI,
  signer flow (drawn/typed/uploaded), signing order, email + reminders, decline.
- On completion → set `Contract.signedAt/signedBy`, mint the **canonical signed ContractVersion**
  (+ hash), append e-sign audit events. Status → active.
- Nav: + Signatures tab.

### Slice 3 — Approvals v2 + intake
- Parallel + conditional (by value/type/jurisdiction) + escalation + delegation (OOO); no-code-ish
  rule config. Intake/request forms by contract type → auto-routing to a queue.
- Nav: + Approvals tab.

### Slice 4 — Amendments + repository v2 + clause governance
- Amendment workflow (amend an active contract → new version, preserve lineage).
- Repository: richer metadata model + full-text/OCR search + saved views + tags/folders.
- Clause governance enforcement (deviation flags vs approved standard).
- Nav: promote to the full **Contracts GROUP** here (≥4 surfaces now live).

### Slice 5 — Obligations + analytics + revenue recognition
- Obligation/milestone tracking UI + owners + reminders (cron). Wire ASC-606 (PO/schedule/entry)
  UI + recognition cron.
- Contract analytics: cycle time, renewal rate, value/expiry cohorts, deviation, exec dashboards.
- Nav: + Obligations, + Renewals (split out), + Analytics tabs.

### Slice 6 — AI layer (the 10/10 differentiator; LAST — needs document volume)
- Reuse the `ai` / Da Vinci infra. AI: clause + obligation extraction (auto-fill metadata on
  upload), risk scoring + deviation-vs-playbook, AI redline/review with fallback suggestions,
  semantic/conversational search ("find all contracts where…"), drafting co-pilot, predictive
  renewal/exposure analytics.
- Nav: + AI Review / Playbooks tab.

### Slice 7 — Integrations
- DocuSign/Adobe Sign (alongside native e-sign), deep deal↔contract, ERP/invoicing, Slack/Teams
  alerts, BI export.

## Cross-cutting
- **Access:** all new surfaces gated by `contracts` module + RBAC (+ feature flags where relevant).
- **Multi-tenant:** every model org-scoped; PII in counterparty data follows the bound-AAD pattern.
- **Notifications:** reuse the Phase-1/2 notification framework (contract events already emit;
  add e-sign/obligation/amendment kinds as slices land).
- **Cadence per slice:** TDD on logic → architect review → Codex review → deploy (ask target) →
  live verify. Same discipline as the notifications feature.

## Out of scope (this program)
- Replacing the e-sign with a 3rd-party as the PRIMARY (native first; DocuSign as Slice-7 option).
- Non-contract document management (general DMS).
