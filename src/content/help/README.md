# In-app Help articles — authoring guide

These articles are the **source for video-tutorial scripts**. Write each one so a
producer can read it aloud while screen-recording. One page = one slug = one
article = one video.

## Golden rules
1. **Accuracy over polish.** Write from the REAL page: open the page component
   (`src/app/(dashboard)/.../page.tsx`) and its `messages/*.json` title/label
   keys. Describe the actual buttons, fields, columns, empty states. **Never
   invent UI.** A wrong "you'll see" is worse than none.
2. **Every action step gets an observation.** Each `HelpStep` that performs a UI
   action is immediately followed by a `HelpCallout kind="see"` describing what
   appears on screen. Pure-explanation goes in prose, not numbered steps.
3. **All 3 locales, always** (`az`, `en`, `ru`). Author `az` first (richest — it
   feeds the AZ video), then mirror to `en` and `ru`. Every slug must ship all
   three: the en-fallback in `resolveHelpArticle` is a **safety net for bugs, not
   a normal mode** — if a tenant ever sees the en-fallback banner, the parity
   test should have caught a missing locale. Never ship a slug with fewer than 3.
4. **`kind="see"` always passes a localized `label`**: az `"Ekranda görəcəksiniz"`,
   en `"What you'll see"`, ru `"Что вы увидите"`. The component default is English.

## Canonical structure
```tsx
"use client"
import {
  HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef,
} from "@/components/help/help-content"

export default function <Name>Help<Locale>() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="…who you are…" goal="…what you're trying to do…">
        …starting point / prerequisites / permissions…
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">  {/* orientation */}
        <p>…what's on the page…</p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Field">meaning</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: <task>">  {/* the script */}
        <HelpStep n={1}>
          <p>Concrete action with a real target (<HelpKey>Button label</HelpKey>).</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">…on-screen result…</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>…</HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">İpucu…</HelpCallout>
      <HelpCallout kind="warning">Tələ / diqqət…</HelpCallout>
      <HelpCallout kind="security">org-scope / permissions…</HelpCallout>
    </div>
  )
}
```

## Primitives (`src/components/help/help-content.tsx`)
- `HelpScenario{persona, goal, children?}` — top framing card.
- `HelpSection{title}` — a section.
- `HelpStep{n}` — numbered step.
- `HelpCallout{kind, label?}` — `kind`: `tip | warning | security | next | see`.
- `HelpKey` — inline UI/key pill.
- `HelpDef{term}` — definition row (wrap in `<dl>`).

## Wiring a new/split article
1. Add the slug to the `HelpSlug` union in `src/content/help/registry.ts`.
2. Add the `HELP_REGISTRY` entry (`title`/`subtitle` ×3 + `content.{en,ru,az}: lazy(() => import("./<slug>/<locale>"))`).
3. Create `src/content/help/<slug>/{en,ru,az}.tsx`.
4. In the page h1, render `<HelpButton slug="<slug>" variant="label" />` (inside
   `<h1 className="… flex items-center gap-2">`, after `{t("title")}` / any
   `<TourReplayButton/>`). For a split, repoint the page off the old shared slug
   in the same change; drop the shared slug from the union only once no page uses it.

## Definition of done (per article)
`npx tsc --noEmit` clean · `help-registry-parity.test.ts` green (3 locales present,
files exist, az resolves, renders non-empty).
