# CLM Editor — Toolbar Expansion Plan (2026-06-10)

> User feedback on `/contracts/[id]/editor`: «редактор слабоватый, мало
> инструментов, неудобный». Verified market scan (Perplexity, 2026-06-10):
> TipTap v3 is the right engine class — what PandaDoc/Juro/Ironclad-style CLMs
> build on (ProseMirror-family); the gap is merely how few extensions we
> enable. Engine stays. This plan grows the toolbar in sanitizer-safe phases.

## Current state (audit)

- Extensions: `StarterKit.configure({ link: false })` + `TableKit({ table:
  { resizable: false } })` + `Placeholder` (editor/page.tsx:146-157).
- Toolbar: undo/redo, B/I/U/S, H1–H3, bullet/ordered list, quote, code block,
  HR, insert-table. Variables panel + live outline already exist.
- DOCX **import** already custom (`import-docx` route, mammoth) — Tiptap Pro
  not needed for it. Own `redline` route exists (diff-based).

## The law of this codebase (do not violate)

`sanitizeContractBody` (src/lib/sanitize.ts) is the **source of truth** for
what survives a save. Every editor capability ships as a **pair**:

> (extension + toolbar control) ⇄ (sanitizer allowlist delta + round-trip test)

Anything else re-creates the Slice-1 P0 class: the canvas shows markup the
server strips, and the next autosave silently mints a degraded version.
Equally: never widen the allowlist generically (`style`, `data-*`, external
`src`) — only narrow, value-validated hooks.

## The second pipeline — renderedBody / PDF / signer (architect catch)

`bodyHtml` is NOT the whole story. `PUT /body` also derives
`renderedBody = serializeContractBody(bodyHtml)` — **plaintext** — and that
plaintext is what gets content-hashed, rendered into the PDF
(`pdf/route.ts`) and shown to the EXTERNAL SIGNER (`sign/[token]`, rendered
as text). Consequences this plan commits to honestly:

- Everything in P1–P3 is **canvas/bodyHtml-visible only** until the rich
  bodyHtml→PDF work lands (that is the parallel CLM session's deferral,
  2026-08-15 — not duplicated here). Alignment, highlight, links and images
  will NOT alter the signed artifact: inline marks serialize to their text
  content (safe), block alignment has no plaintext equivalent (lost, by
  nature), `<img>` serializes to NOTHING today.
- Therefore the **pair test is TWO invariants**, not one:
  (a) sanitize round-trip — editor markup survives `sanitizeContractBody`
  unchanged; (b) **serialize stability** for plaintext-invariant markup
  (alignment classes, highlight, sub/sup, links) — `serializeContractBody`
  output with the new markup equals the output without it (no junk, no
  crashes, no hash churn on legacy bodies). P3 `<img>` is the deliberate
  exception: it CHANGES serializer output and gets its own explicit
  assertion (serializes to `[alt]`), not the equality invariant. Tests live
  in the existing suite: `src/__tests__/api-contract-body.test.ts`.
- Legacy stored bodies are untouched: every delta is additive; old documents
  render and hash identically.
- P3 images: serializer must gain an `IMG → alt ? "[alt]" : ""` branch so a
  signed PDF at least names the asset — recorded as part of P3 scope below.

## Phase 1 — typeset essentials (free/MIT, ~half a day, low risk)

| # | Feature | Package | Sanitizer delta | Toolbar |
|---|---------|---------|-----------------|---------|
| 1 | Text align (p + headings) | `@tiptap/extension-text-align` | **class-based, NOT style-based**: custom `renderHTML` emits `class="ta-center"` etc.; sanitizer adds `class` to `ALLOWED_ATTR` + `uponSanitizeAttribute` hook allowlisting exactly `ta-(left\|right\|center\|justify)` (drop all other classes); editor + renderedBody CSS maps the four classes. Rationale: DOMPurify `FORBID_ATTR:["style"]` takes precedence over hooks — "forbid style globally but allow via hook" does NOT work; classes keep the style ban intact | 4 toggles (or 1 cycling) |
| 2 | Sub/superscript | `@tiptap/extension-subscript`, `…-superscript` | add `sub`, `sup` tags | 2 toggles |
| 3 | Smart typography (—, «», …) | `@tiptap/extension-typography` | none (input transform only) | none |
| 4 | Word/char counter | `CharacterCount` from `@tiptap/extensions` (v3 home) | none | status-bar text |
| 5 | Table structure menu | TableKit commands (already installed) | none (no new attrs) | dropdown: add/delete row/col, toggle header row, delete table |
| 6 | Clear formatting | core `unsetAllMarks().clearNodes()` | none | 1 button |

i18n: all new toolbar keys ×3 locales. Tests: BOTH pair invariants per
feature (sanitize round-trip + serialize stability — see "second pipeline"
section) in `src/__tests__/api-contract-body.test.ts`.

## Phase 2 — links + highlight (~1 day, security-review gated)

1. **Link** — re-enable in StarterKit (v3 bundles it; today `link: false`).
   Sanitizer: allow `a` + `href` via hook with protocol allowlist
   `http/https/mailto`, force `rel="noopener noreferrer"`, decide
   `target="_blank"` vs none. Editor: `linkOnPaste`, set/unset button + URL
   dialog. Verify the renderedBody→PDF path renders anchors sanely.
   **Proactive Codex review before merge** (security-sensitive surface).
2. **Highlight** — `@tiptap/extension-highlight` (multicolor OFF → plain
   `<mark>`); add `mark` tag to allowlist. Useful for negotiation review.
3. **Text color — recommended SKIP.** Contracts are uniform typeset; a
   color/hex style allowlist widens the surface for marginal value. Revisit
   only on explicit client ask (then the same style-hook pattern, hex-only).

## Phase 3 — images (1–2 days, BLOCKED on an open decision)

- **Gate:** the pending nginx `/uploads/` routing decision
  (memory: `project_nginx_uploads_routing` — prod alias currently bypasses
  the F-41 auth gate). Resolve that ticket first; image src auth semantics
  depend on it.
- Then: `@tiptap/extension-image`; upload via existing uploads infra into
  `/uploads/contracts/<orgId>/…`; sanitizer hook allows `img` with
  **same-origin relative src under that prefix only** (no external URLs —
  SSRF/exfil), `alt` attr; MIME/size caps server-side. Check PDF pipeline
  renders images before enabling.
- Serializer delta (required, see "second pipeline"): `serializeContractBody`
  gains `IMG → alt ? "[alt]" : ""` so the signed plaintext/PDF names the
  asset instead of silently dropping it.
- Value: логотипы/печати в шапке договора.

## Phase 4 — collaboration tier (decision gates, NOT build)

Per the parked-hardening rule (no architecture work without a concrete
driver), these are priced options awaiting a real client requirement:

- **Track changes / comments / version compare** — Tiptap **Pro (paid)**
  (`@tiptap-pro/extension-snapshot`, comments) vs CKEditor 5 commercial
  (turnkey legal redlining) vs extending our own `redline` route. Needs
  pricing + a paying driver before any pick.
- **Real-time co-editing** — free `@tiptap/extension-collaboration` + Yjs,
  but requires a websocket/Yjs server (infra + ops cost). Same driver rule.
- **Pagination/pages, DOCX export** — Tiptap Pro; our import is already
  custom, export today is PDF (rich bodyHtml PDF is the parallel CLM
  session's deferred item, 2026-08-15 — do not duplicate).

## Non-goals

- TaskList/TaskItem checkboxes (not contract material; would also need
  `data-*`/`input` in the sanitizer — no).
- FontFamily/FontSize (uniform typeset is a feature, not a gap).
- Generic `style`/`data-*` passthrough of any kind.

## Rollout

Each phase: worktree branch → BOTH pair invariants (sanitize round-trip +
serialize stability, in `api-contract-body.test.ts`) + tsc → push-to-main
(CI → LeadDrive) → prod editor smoke (type → format → reload → markup
intact — the round-trip is THE regression to watch) → architect gate.
Phase 1 can ship immediately; Phase 2 wants the Codex pass; Phase 3 waits
on nginx.
