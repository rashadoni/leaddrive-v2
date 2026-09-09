# LeadDrive CRM v2 — Design System Master

## Brand Identity
- **Product**: LeadDrive CRM — SaaS multi-tenant CRM for IT outsourcing companies
- **Tone**: Professional, modern, data-driven
- **Style**: Clean enterprise UI with subtle glassmorphism accents

## Color Palette

### Light Mode
| Token | HSL | Usage |
|-------|-----|-------|
| `--primary` | 207 53% 24.5% | Dark navy blue — buttons, headers, key actions |
| `--primary-foreground` | 0 0% 100% | White text on primary |
| `--accent` | 175 86% 33% | Teal — CTAs, links, focus rings |
| `--accent-foreground` | 0 0% 100% | White text on accent |
| `--background` | 210 20% 98% | Page background (near-white) |
| `--foreground` | 207 53% 15% | Body text |
| `--secondary` | 210 25% 94% | Secondary backgrounds |
| `--muted` | 210 25% 94% | Disabled/muted backgrounds |
| `--muted-foreground` | 215 16% 47% | Secondary text |
| `--destructive` | 0 84.2% 60.2% | Error/delete actions |
| `--border` | 214 25% 88% | Borders and dividers |
| `--ring` | 175 86% 33% | Focus ring (same as accent) |

### Dark Mode
| Token | HSL | Usage |
|-------|-----|-------|
| `--primary` | 175 70% 42% | Teal becomes primary in dark |
| `--background` | 210 40% 7% | Deep navy background |
| `--card` | 210 35% 10% | Card surfaces |
| `--accent` | 175 60% 30% | Muted teal accent |
| `--border` | 210 25% 18% | Subtle borders |

### Sidebar (Always Dark)
| Token | HSL | Usage |
|-------|-----|-------|
| `--sidebar-bg` | 207 53% 16% | Sidebar background |
| `--sidebar-text` | 210 20% 75% | Inactive menu items |
| `--sidebar-text-active` | 0 0% 100% | Active menu item |

## Typography

| Role | Font | Weight | Size |
|------|------|--------|------|
| Body | Inter | 400 | 14px (0.875rem) |
| Headings | Inter | 600-700 | 18-30px |
| Code/Mono | JetBrains Mono | 400 | 13px |
| Labels | Inter | 500 | 12-13px |

### Hierarchy
- Page title: `text-2xl font-bold` (30px)
- Section title: `text-lg font-semibold` (18px)
- Card title: `text-base font-medium` (16px)
- Body: `text-sm` (14px)
- Caption: `text-xs text-muted-foreground` (12px)

## Spacing & Layout

| Token | Value |
|-------|-------|
| `--radius` | 0.5rem (8px) |
| Card padding | 1.5rem (24px) |
| Section gap | 1.5rem (24px) |
| Grid gap | 1rem (16px) |
| Page padding | 2rem (32px) |

## Components (shadcn/ui — new-york style)
- Buttons: `rounded-md` with primary/secondary/destructive/outline variants
- Cards: `rounded-lg border bg-card shadow-sm`
- Inputs: `rounded-md border-input h-9`
- Dialogs: Centered modals with `rounded-lg`
- Tabs: Underline style for page-level, pill style for card-level

## Glassmorphism
- Used sparingly on sidebar and overlay elements
- `--glass-blur: 12px`
- Combine with `bg-opacity` and `backdrop-blur`

## Animation
- Page entrance: `fade-in-up` (0.3s ease-out)
- Stagger children: 60ms increment per child
- Transitions: `transition-colors duration-150` for hover states
- No heavy animations in data tables or forms

## Iconography
- Library: Lucide React
- Size: 16px (inline), 20px (buttons), 24px (page headers)
- Stroke width: 2

## Responsive Breakpoints
- Mobile: < 768px
- Tablet: 768px - 1024px
- Desktop: > 1024px
- Sidebar collapses to sheet on mobile

## Do's and Don'ts
- DO: Use the teal accent sparingly for key CTAs
- DO: Maintain consistent card spacing across pages
- DO: Use Inter everywhere, JetBrains Mono only for code
- DON'T: Mix border radius styles
- DON'T: Use more than 3 color variants per component
- DON'T: Add heavy shadows — prefer `shadow-sm` or `shadow-none`
