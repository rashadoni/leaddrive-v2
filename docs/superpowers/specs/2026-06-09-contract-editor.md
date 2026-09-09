# Spec — Contract Editor (CLM body authoring) + per-client customization

> Status: **DRAFT for approval** (HARD GATE — no code until the user signs off on scope)
> Visual: `docs/mockups/contract-editor.html` → `docs/mockups/contract-editor-mockup.png`
> Date: 2026-06-09

## 1. Problem

Today a contract's `renderedBody` is a plain `String?` shown read-only inside a
`<pre>` in the "View document" dialog. There is **no real authoring surface** —
you cannot edit the body, insert clauses, see merge fields, redline a
negotiation, or export a properly typeset PDF. A lawyer would not accept it
(user's words: *"ты как юрист принял бы такую работу… нужен редактор нормальный"*).

We need a professional CLM editor, and — the user's explicit second ask —
each **client (Organization) must be able to customize the editor**, deeper than
the existing logo/colors branding.

## 2. The design (what the mockup shows)

A three-pane editor that opens on a contract (replaces / upgrades the current
read-only dialog):

| Pane | Contents |
|---|---|
| **Left — Outline / clause nav** | Numbered sections (Parties, Term, Fees, Confidentiality, Liability…), risk dots per section, "Insert clause" from the workspace clause library |
| **Center — Document canvas** | Paper-like A4 body, serif typeset, **merge variables** as orange pills (`{{counterparty_name}}`), **redline** (green insert / red strike), inline **comment pins**, selected-clause highlight |
| **Right — Assistant** | Tabbed: **AI review** (risk score ring + findings with "Apply suggested clause" — reuses the existing Contract Agent), **Variables** (fill merge fields), **Versions** (immutable ContractVersion history) |
| **Top toolbar** | Formatting (B/I/U, H1/H2, lists), **Insert Variable**, **Insert Clause**, **Track changes** toggle; right side = **1 primary CTA** ("Send for approval") + Export + **•••** (which opens the per-client **Workspace editor settings** drawer) |

The header deliberately follows the same "1 primary + ••• overflow" rule we
just shipped on the contract detail page — no competing CTAs.

## 3. Tech stack — and what ALREADY exists (verify-grepped 2026-06-09)

**Key finding:** the CLM *backend* is already rich. This editor is mostly a
**UI surface that unifies existing capabilities**, not a from-scratch build.

Already in the schema (reuse, do NOT recreate):
- `ContractTemplate` (8083) — org-scoped templates: `clauses` JSONB
  (`{id,title,body,conditional}`) + `variables` JSONB
  (`{name,type,required,default}`) + versioning. Rendered by
  `src/lib/contract-lifecycle/clause-substituter.ts` with `{{variable}}` markers.
  → **templates + merge-variables already implemented server-side.**
- `ContractClause` (13345) — org-scoped **clause library** (title, body,
  category, riskLevel std/fallback/high_risk, governance status, fallback chains).
- `ContractDeviationFlag` (13386) — matches template clauses against the library.
- `ContractRedline` (13570) — **redline already has a model.**
- `ContractVersion` (13299, immutable+SHA), `ContractRiskScore`,
  `ContractAiExtraction`, `ContractEmbedding`, `ContractApprovalStage/Rule` — all exist.

New work only:
- **Editor**: TipTap (ProseMirror) → new `Contract.bodyHtml` (rich HTML);
  `renderedBody` stays as the plain-text mirror for search + PDF fallback + SHA.
- **PDF export**: puppeteer-core (server already renders PDF) → HTML+theme → PDF;
  jsPDF+DejaVu remains the fallback.
- **.docx import**: mammoth → sanitized HTML → TipTap.
- **Sanitization**: allowlist sanitizer on all imported/AI HTML before persist.
- **Note (Slice 3)**: `ContractClause.body` / template `clauses[].body` are plain
  `String` with `{{var}}` markers — inserting a library clause into `bodyHtml`
  needs a deterministic **text→HTML wrap** step (paragraph-split → `<p>`, preserve
  `{{var}}` as variable nodes). Not HTML-in-HTML.

## 4. Per-client customization — mostly ALREADY per-org

The user's ask ("client must customize deeper than branding") is **largely
already satisfied** by existing per-`Organization` models — the editor just needs
to surface them:

| Capability | Status |
|---|---|
| Templates (per client) | ✅ `ContractTemplate` (org-scoped, versioned) |
| Clause library (per client) | ✅ `ContractClause` (org-scoped, governance) |
| Merge variables (per client) | ✅ template `variables` JSONB + clause-substituter |
| Approval & signature rules | ✅ `ContractApprovalRule` / stages / e-sign |
| Branding (logo/colors) | ✅ `Organization.branding` |
| **Visual document theme** | ❌ **NEW** — `OrgEditorTheme` |

So the ONLY genuinely-new customization model is **`OrgEditorTheme`**: fonts,
page size (A4/Letter), margins, line spacing, letterhead (logo placement,
header/footer), watermark, numbering. Read via `getOrgEditorTheme(orgId)` with a
LeadDrive default so new tenants work out-of-the-box.

## 5. Data-model changes (minimal — additive only)

- `Contract.bodyHtml String?` — **new** (rich HTML; `renderedBody` stays as mirror)
- `OrgEditorTheme` — **new** model (per-org visual theme)
- Everything else (`ContractTemplate`, `ContractClause`, `ContractRedline`,
  `ContractVersion`, AI + approval models) — **reuse as-is, no migration.**

### 5.1 `bodyHtml` → `renderedBody` derivation & SHA integrity (Slice-1 blocker — architect-flagged)

`bodyHtml` becomes the editable **source of truth**; `renderedBody` becomes a
**derived plain-text mirror**. The existing integrity chain
(`contentHash = sha256(renderedBody)`, computed at `amend/route.ts:182` and
`esign/.../send/route.ts:186`) **stays unchanged** — SHA remains over
`renderedBody`, so all existing sign/verify code keeps working. Rules:

1. **Single owner**: one pure function `serializeContractBody(bodyHtml: string): string`
   in `src/lib/clm/` (returns the derived `renderedBody` plain text; implemented
   2026-06-09 with jsdom + 23 golden tests, incl. `<ol>` numbering + a single-parse perf guard). NOT TipTap's runtime `getText()` — that varies by extension
   config). Canonical HTML→text ruleset (pin ALL of these or the SHA drifts across
   TipTap-typed vs mammoth-imported vs AI-authored input):
   1. block elements → single `\n`; `<br>` → `\n`;
   2. `<ul>` items → `- `; `<ol>` items → `1. `, `2. `, … (numbered per level,
      `start=` respected); both prefixed by depth (2 spaces per nesting level);
   3. **empty blocks** (`<p></p>`) → dropped, never emit a bare `\n`;
   4. **table** cells joined by a single space, rows by `\n`;
   5. **decode all HTML entities** to their character (`&amp;`/`&#38;` → `&`) —
      TipTap, mammoth and the AI emit different encodings of the same glyph;
   6. **Unicode-normalize output to NFC** — `.docx` import (mammoth) commonly emits
      NFD (`e`+combining accent); without NFC the same visible text hashes differently;
   7. collapse only **intra-line** space runs (never across `\n`); strip remaining
      tags; trim trailing whitespace per line.

   **Deterministic guarantee**: after rules 1–7, same *visible* document ⇒
   byte-identical `renderedBody` ⇒ identical SHA across renders/servers/import-paths.
2. **Ordering**: every `bodyHtml` save regenerates `renderedBody` **first**, then
   (and only then) any `ContractVersion` mint / `contentHash` compute consumes the
   fresh `renderedBody`. No code path mints a version from a stale mirror.
3. **Immutability preserved**: a signed/canonical `ContractVersion` is frozen —
   editing `bodyHtml` afterward creates a **new** version (today's model is
   unchanged). `ContractVersion` gains an **additive** `bodyHtml String?` column so
   each version snapshots the rich source alongside its `renderedBody`+SHA; old
   rows (null `bodyHtml`) fall back to `renderedBody` for display.
4. **Migration story**: existing contracts have `renderedBody` only → on first
   open in the editor, `bodyHtml` is seeded by wrapping `renderedBody` paragraphs
   in `<p>` (lossless round-trip for plain text).

## 6. Phasing — re-framed as UI integration of existing backends

- **Slice 1 — Rich editable body**: TipTap on `bodyHtml`, formatting toolbar,
  save → new `ContractVersion`, puppeteer PDF export, .docx import. *(pure new UI + 1 column)*
- **Slice 2 — Variables + templates in-editor**: surface existing template
  `variables` as merge-field pills + fill panel; "generate from `ContractTemplate`"
  inside the canvas; block-send on unresolved tokens. *(wires existing substituter)*
- **Slice 3 — Clause library + AI apply**: insert from existing `ContractClause`;
  "Apply suggested clause" wired to existing Contract Agent / deviation findings. *(wires existing models)*
- **Slice 4 — Redline UI**: accept/reject on existing `ContractRedline`. *(UI on existing model)*
- **Slice 5 — `OrgEditorTheme`**: the one new model + the settings drawer. *(new)*

Only Slices 1 and 5 add schema; 2–4 are UI over existing backend.

## 7. Decisions I need from you (the gate)

1. **Slice 1 scope** — rich editable body + PDF + .docx first, or pull variables
   (Slice 2) into the first ship since the backend already exists?
2. **Customization** — confirm `OrgEditorTheme` is the only new piece you want now,
   and that surfacing existing templates/clauses (not rebuilding) is the goal.
3. **Redline priority** — Slice 4 timing OK, or earlier for negotiation-heavy clients?
4. **Build surface** — **recommend full-page route `/contracts/[id]/editor`**
   (TipTap + 3 panes won't fit the existing dialog; architect concurs). Confirm,
   or you prefer the full-screen-dialog variant.

No code until you pick. Recommended default: **Slice 1 as a full-page route**
(`/contracts/[id]/editor`), `OrgEditorTheme` deferred to Slice 5, everything else
wired from the backend that already exists.

### 7.1 DECISIONS LOCKED (user, 2026-06-09)

- **Slice 1 scope** = rich body **+ variables** (merge-field pills + generate-from-
  `ContractTemplate`) + PDF + .docx. *(variables pulled into first ship — backend exists)*
- **Build surface** = **full-page route** `/contracts/[id]/editor`.
- **Customization** = user wants it **deeper than the visual theme** → see §8 (open discussion).

## 8. Customization depth — layered menu (for discussion, user asked "глубже")

The user wants per-client customization **wider than `OrgEditorTheme`**. Layers
from shallow to deep — most of the backend already exists; the work is per-client
**management UI**:

| Layer | What the client configures | Backend status |
|---|---|---|
| **L0 Branding** | logo, colors, company name | ✅ `Organization.branding` |
| **L1 Templates** | their contract templates + default clauses/vars | ✅ `ContractTemplate` — needs a mgmt UI |
| **L2 Clause governance** | author/approve/retire clauses, fallback chains, risk levels | ✅ `ContractClause` (status/fallback/riskLevel) — needs a **governance workbench UI** |
| **L3 Merge-field dictionary** | custom variables beyond template vars (org field catalog) | ⚠️ org `CustomField` (schema 2567, `entityType/fieldName/fieldType/options`) EXISTS but is **not wired to contracts** — wire `CustomField` into the substituter; do NOT invent `MergeFieldDef` |
| **L4 AI playbook** | deviation rules + risk thresholds ("deviation from YOUR playbook") | ⚠️ categorical `ContractDeviationFlag` (13386) + numeric `ContractRiskScore` (13504) both exist, but **threshold/rule config is NOT yet a playbook** — needs a config model + UI |
| **L5 Conditional logic** | visual rule builder for `clauses[].conditional {var,equals}` | ✅ field exists — needs a builder UI |
| **L6 Visual theme** | fonts, margins, letterhead, watermark, numbering | ❌ **new** `OrgEditorTheme` |
| **L7 White-label output** | per-client PDF letterhead/footer/signature blocks | ❌ new (extends L6) |

**Open question for the user:** which layers are in scope, and in what order?
Recommendation: **L1 + L2 + L6** first (template mgmt + clause governance workbench +
visual theme) — the highest-value "a lawyer configures our paper" trio — then L4
(AI playbook) as a fast-follow (backend already flags + scores deviations; only the
threshold/rule config is new). A dedicated **`/settings/contract-editor`** workspace
hub would host all layers.

> **Track note:** §6 (Slice 1–5) is the **editor** track; §8 (L0–L7) is the
> **customization** track. They intersect at one item — L6 visual theme = §6 Slice 5
> (`OrgEditorTheme`), the same work referenced from both tracks. The two tracks ship
> in parallel; ordering within each is independent.
