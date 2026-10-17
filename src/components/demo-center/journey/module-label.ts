import type { NavItem } from "@/lib/nav-items"

/**
 * A module's name outside the sidebar — on the first screen's «where to
 * start» and on the last screen's «not seen yet».
 *
 * The menu's own label, except where it reads only under its group heading:
 * Route & Field's first entry is «Panel» and Personnel's is «Bu gün», which
 * name nothing on a button of their own, so the group's name stands for them
 * there («Marşrut & Sahə», «Kadr uçotu»).
 */
const NAMED_BY_GROUP = new Set(["mtmDashboard", "personnelToday"])

export function demoModuleLabel(item: Pick<NavItem, "tKey" | "group">, t: (key: string) => string): string {
  return NAMED_BY_GROUP.has(item.tKey) ? t(`groups.${item.group}`) : t(item.tKey)
}
