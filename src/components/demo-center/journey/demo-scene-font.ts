import { Plus_Jakarta_Sans } from "next/font/google"

/**
 * The CRM's own font for the demo's scenes. Every scene is a CRM screen, and
 * the CRM draws its pages in Plus Jakarta Sans (`<main class="font-dashboard">`
 * in `src/app/(dashboard)/layout.tsx`); the demo's screens and the clips filmed
 * on them were in the body's Inter/Arial, so a prospect saw one product in the
 * demo and another after signing up.
 *
 * The same font with the same options under the same variable as the
 * dashboard layout (`demo-scene-font.test.ts` compares the two): the demo
 * routes' layouts put the variable on their page, and `#demo-scene` in the
 * player carries `font-dashboard`, so the chrome around the scene keeps its
 * own font.
 */
export const demoSceneFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-dashboard",
})
