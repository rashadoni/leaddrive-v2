import { dashboardFont } from "@/lib/fonts/dashboard-font"

/**
 * The CRM's own font for the demo's scenes. Every scene is a CRM screen, and
 * the CRM draws its pages in Plus Jakarta Sans (`<main class="font-dashboard">`
 * in `src/app/(dashboard)/layout.tsx`); the demo's screens and the clips filmed
 * on them were in the body's Inter/Arial, so a prospect saw one product in the
 * demo and another after signing up.
 *
 * The very font object the dashboard layout uses (`@/lib/fonts/dashboard-font`,
 * one definition, so the two cannot drift apart): the demo
 * routes' layouts put the variable on their page, and `#demo-scene` in the
 * player carries `font-dashboard`, so the chrome around the scene keeps its
 * own font.
 */
export const demoSceneFont = dashboardFont
