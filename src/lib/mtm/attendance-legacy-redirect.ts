import { redirect } from "next/navigation"

export type AttendanceSearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * Former attendance pages are tabs now. Notifications and bookmarks still carry
 * the old address and its query (e.g. a focused case id), so keep every
 * parameter and only add the tab.
 */
export async function redirectToAttendanceTab(section: "timesheet" | "people" | "settings", tab: string, searchParams: AttendanceSearchParams): Promise<never> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (key === "tab") continue
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item)
  }
  query.set("tab", tab)
  redirect(`/mtm/attendance/${section}?${query}`)
}
