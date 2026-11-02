import type { ReactNode } from "react"
import { demoSceneFont } from "@/components/demo-center/journey/demo-scene-font"

/** The demo's scenes are CRM screens: the CRM's font is defined here for the scene to use (`font-dashboard` on `#demo-scene`). */
export default function DemoAccessLayout({ children }: { children: ReactNode }) {
  return <div className={`contents ${demoSceneFont.variable}`}>{children}</div>
}
