# Writing-plan — Contract Editor **Slice 1** (rich body + variables)

> Spec: `docs/superpowers/specs/2026-06-09-contract-editor.md` (gate-approved 2026-06-09)
> Scope (user-locked): rich editable body + merge-variables + PDF export + .docx import,
> on a **full-page route** `/contracts/[id]/editor`. SHA stays over `renderedBody`.
> Status: **plan for ack** — no code until the user oks the plan.

## Dependency reality (verified 2026-06-09)

- ✅ present: `isomorphic-dompurify` (sanitize), `puppeteer-core` + `jspdf` (PDF), typed `src/lib/contract-lifecycle/clause-substituter.ts` (variable engine).

**Directory convention (pin to avoid split-brain):** new body/serialize utils live in **`src/lib/clm/`** (alongside the existing `contract-pdf.ts` + `line-diff.ts`); lifecycle/template logic stays in **`src/lib/contract-lifecycle/`** (the substituter). Slice 1 reuses the latter, adds to the former.
- ❌ **must add**: `@tiptap/react @tiptap/pm @tiptap/starter-kit` (+ `@tiptap/extension-placeholder`), `mammoth` (.docx→HTML).

## Ordered steps (each ends green: `tsc` + unit tests)

### Step 0 — deps + schema (additive migration)
- `npm i @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/extension-placeholder mammoth`
- Prisma: `Contract.bodyHtml String?` + `ContractVersion.bodyHtml String?` (both nullable, additive — no backfill). `npx prisma migrate dev`.
- **Invariant**: `ContractVersion.renderedBody` stays the **canonical hashed field** (`contentHash = sha256(renderedBody)`). `bodyHtml` is a **non-hashed convenience snapshot** — NEVER part of `contentHash`, never hashed.
- **Accept**: migration applies clean; existing rows untouched; `tsc` green.

### Step 1 — `serializeContractBody()` + golden-master tests (the SHA-critical core)
- New `src/lib/clm/serialize-body.ts`: pure `serializeContractBody(bodyHtml: string): string` implementing spec §5.1.1 rules 1–7 (block→`\n`, `<br>`→`\n`, empty-block drop, table cells space/rows `\n`, **entity-decode**, **NFC normalize**, intra-line collapse + strip + trim).
- New `src/__tests__/lib-serialize-body.test.ts`: **golden-master** — same visible doc via 3 input shapes (TipTap-style, mammoth-style w/ NFD + entities, AI-style) ⇒ **byte-identical output ⇒ identical sha256**. Include `<blockquote>`/`<hr>` fixtures (architect's open edge → pin them: block-level ⇒ `\n`).
- **Accept**: 3-path golden test green; `sha256(serialize(a))===sha256(serialize(b))` for equivalent docs.

### Step 2 — read/seed: open existing contracts in the editor (NON-DESTRUCTIVE)
- `getOrSeedBodyHtml(contract)`: if `bodyHtml` null, seed by wrapping `renderedBody` paragraphs in `<p>` — **for editing/display only. Seeding MUST NOT write `renderedBody`, MUST NOT mint a ContractVersion, MUST NOT recompute `contentHash`.**
- **Why (architect-flagged landmine)**: the serializer normalizes (NFC + entity-decode + collapse); a legacy `renderedBody` was never normalized, so `serialize(seed(renderedBody))` can legitimately differ byte-for-byte. If seeding *wrote* that back, the next esign send (`send/route.ts:185` `findFirst where contentHash=sha256(renderedBody)`) would miss the existing signed version and **silently orphan** the envelope→version binding. Seeding stays read-only → the binding is untouched; `renderedBody` only ever changes on an explicit Step-3 save, which is already a new-version event.
- **Accept**: opening a **signed/legacy** contract in the editor leaves `renderedBody`, `contentHash`, and the ContractVersion chain **byte-identical** (asserted against a real legacy row); no new version row created on open; existing esign binding still resolves.

### Step 3 — save flow (integrity ordering)
- `PUT /api/v1/contracts/[id]/body`: **auth** `requireAuth(req,"contracts","write")` + module-gate + superadmin bypass (mirror `amend/route.ts:93-101`) + org-scope (`findFirst where organizationId`). Then: sanitize incoming HTML (dompurify allowlist, see below) → store `bodyHtml` → **derive `renderedBody` via serializer FIRST** → then mint `ContractVersion` (with `bodyHtml` snapshot + `renderedBody` + `contentHash=sha256(renderedBody)`). Reuse existing version-mint path; do **not** touch `amend`/`esign` hash code.
- **Dompurify allowlist (pin it)**: tags `p,h1,h2,h3,ul,ol,li,strong,em,u,br,blockquote,hr,table,thead,tbody,tr,td,th,span[data-var]`; strip `script,style,iframe,object`, all event-handler attrs, `img` with `data:`/remote URIs, and inline `style` (mammoth emits all of these on .docx import).
- Guard: a **signed/canonical** version is frozen → edit always mints a NEW version, never mutates a frozen one (existing immutability model).
- **Accept**: save creates a new `ContractVersion`; `contentHash === sha256(renderedBody)`; prior signed version's `renderedBody`+hash unchanged and still resolvable; route tests green (cross-tenant 404 + role-gate denial + status-guard).

### Step 4 — TipTap editor on the full-page route
- `src/app/(dashboard)/contracts/[id]/editor/page.tsx` — 3-pane shell from the mockup: left outline (from headings), center TipTap canvas, right tabs (Variables / Versions; AI tab reuses existing panel). Toolbar = formatting + Insert Variable + 1 primary CTA ("Send for approval") + ••• (same overflow rule as the detail header).
- Autosave (debounced) → Step 3 route; "Saved ✓" indicator.
- **UI checklist (per CLAUDE.md UI-protection)** — Step 7 architect verifies every pane from spec §2 / the mockup is present: (a) left outline from headings, (b) center TipTap canvas, (c) right tabs Variables/Versions (+ existing AI panel), (d) toolbar formatting + Insert Variable + 1 primary CTA + ••• overflow. None dropped.
- **Accept**: edit → save → reload shows persisted body; `tsc` green; all four §2 panes render.

### Step 5 — variables (two distinct paths — architect-flagged)
- **Generate path**: "Generate from `ContractTemplate`" → existing `substituteClauses(input: SubstituteInput)` (`src/lib/contract-lifecycle/clause-substituter.ts:141`, single object arg) emits the body. Reuse as-is, no duplication.
- **Edit path**: after free TipTap editing the body is HTML divorced from the template clause set — `substituteClauses` does NOT scan it. So **block "Send for approval"** via a **new lightweight residual scanner** `src/lib/clm/residual-vars.ts`: regex `{{\s*([\w]+)\s*}}` over the serialized text (Step 1 output), list any leftover tokens. Mirror the substituter's `FORBIDDEN_VAR_NAMES` guard (`__proto__`/`constructor`/`prototype`, `clause-substituter.ts:139`) so a stray `{{__proto__}}` is reported, not skipped. Small new util, NOT the substituter.
- Surface template `variables` as merge-field pills; right-panel "Variables" fill form.
- **Accept**: generate-from-template populates via substituter (no re-parse); freely-edited doc with a stray `{{foo}}` → send blocked w/ token list via the residual scanner; fully-resolved doc → send allowed.

### Step 6 — PDF export (puppeteer) + .docx import (mammoth)
- Both routes: **auth** `requireAuth(req,"contracts","write")` + org-scope (`findFirst where organizationId`) + status-guard — same contract as Step 3 (no anonymous/cross-tenant access to a contract body).
- `POST /api/v1/contracts/[id]/export-pdf`: `bodyHtml` + default theme (hardcoded LeadDrive theme; `OrgEditorTheme` is Slice 5) → puppeteer-core → PDF. jsPDF+DejaVu remains fallback.
- `POST /api/v1/contracts/[id]/import-docx`: mammoth → HTML → **dompurify sanitize (same allowlist as Step 3)** → set `bodyHtml` → Step 3 save path (derive+mint).
- **Accept**: PDF renders Azerbaijani/Cyrillic correctly (puppeteer = full Unicode); .docx import round-trips to editable body; both routes reject cross-tenant + unauthenticated; both tested.

### Step 7 — close-out
- Full `tsc` + `npm run test` (CLM suites) green; architect review; i18n keys for new UI (en/az/ru); manual smoke on prod-like.
- **Accept**: zero tails; architect GO; ready for deploy ack.

## Risks / guards
- **SHA drift** = the #1 risk → Step 1 golden tests are the gate; no version-mint ships until they pass.
- **puppeteer on server** needs chrome (already used for existing PDF) — verify before Step 6 deploy.
- **Sanitization**: every HTML entry point (editor save, .docx import, AI-authored) passes dompurify — no exceptions.
- Out of scope (declared): clause library insert (Slice 3), redline UI (Slice 4), `OrgEditorTheme` (Slice 5), customization layers L1–L7 (§8 — separate discussion).

## Open for user before code
- Ack this plan, OR adjust Step ordering.
- §8 customization layers still pending your pick (independent of Slice 1).
