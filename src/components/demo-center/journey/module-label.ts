import type { NavItem } from "@/lib/nav-items"

/**
 * A module's name outside the sidebar — on the first screen's «where to
 * start» and on the last screen's «not seen yet».
 *
 * The menu's own label, except where it reads only under its group heading:
 * Route & Field's first entry is «Panel», which names nothing on a button of
 * its own, so the group's name stands for it there («Marşrut & Sahə»).
 */
export function demoModuleLabel(item: Pick<NavItem, "tKey" | "group">, t: (key: string) => string): string {
  return item.tKey === "mtmDashboard" ? t(`groups.${item.group}`) : t(item.tKey)
}
