"use client"

import Link from "next/link"
import { useId, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown, Route, UsersRound } from "lucide-react"
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { activeNavBase, type NavItem } from "@/lib/nav-items"
import { cn } from "@/lib/utils"

type Props = {
  /** Already filtered by the shared tenant, module, role and setting gates. */
  items: readonly NavItem[]
  pathname: string
  collapsed: boolean
  renderFieldItem: (item: NavItem) => ReactNode
}

/** Two readable submodules in the existing MTM sidebar, also on the icon rail. */
export function MtmSidebarSections({ items, pathname, collapsed, renderFieldItem }: Props) {
  const t = useTranslations("nav")
  const id = useId()
  const current = activeNavBase(items, pathname)
  const attendance = items.filter(item => item.attendanceSection)
  const field = items.filter(item => !item.attendanceSection)
  const inAttendance = attendance.some(item => item.href === current)
  const [fieldOpen, setFieldOpen] = useState(!inAttendance)
  const [attendanceOpen, setAttendanceOpen] = useState(inAttendance)

  function links(entries: readonly NavItem[], flyout = false) {
    return entries.map(item => {
      const active = item.href === current
      const Icon = item.icon
      const link = <Link
        href={item.href}
        prefetch={false}
        aria-current={active ? "page" : undefined}
        data-testid="sidebar-nav-item"
        data-nav-href={item.href}
        data-nav-active={active ? "true" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm leading-5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none",
          flyout ? "focus-visible:ring-ring" : "focus-visible:ring-white/60",
          active
            ? flyout ? "bg-primary/10 font-medium text-foreground" : "bg-white/10 font-medium text-white"
            : flyout ? "text-muted-foreground hover:bg-muted hover:text-foreground" : "text-white/65 hover:bg-white/[0.06] hover:text-white",
        )}
      >
        <Icon aria-hidden="true" className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "opacity-70")} />
        <span>{t(item.tKey)}</span>
      </Link>
      return flyout ? <PopoverClose key={item.href} asChild>{link}</PopoverClose> : <div key={item.href}>{link}</div>
    })
  }

  function attendanceLinks(flyout = false) {
    return (["work", "reports", "settings"] as const).map(section => {
      const entries = attendance.filter(item => item.attendanceSection === section)
      if (!entries.length) return null
      return <div key={section}>
        {section !== "work" && <p className={cn("px-3 pb-1 pt-4 text-xs font-medium", flyout ? "text-muted-foreground" : "text-white/40")}>{t(`mtmSections.${section}`)}</p>}
        {links(entries, flyout)}
      </div>
    })
  }

  if (!attendance.length) return <>{field.map(renderFieldItem)}</>

  if (collapsed) return <div className="space-y-1" data-testid="mtm-sidebar-sections">
    {(["field", "attendance"] as const).map(section => {
      const Icon = section === "attendance" ? UsersRound : Route
      const active = section === "attendance" ? inAttendance : field.some(item => item.href === current)
      return <Popover key={section}>
        <PopoverTrigger asChild>
          <button type="button" data-nav-active={active ? "true" : undefined} aria-label={t(`mtmSections.${section}`)} title={t(`mtmSections.${section}`)}
            className={cn("flex min-h-11 w-full items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-white/60", active ? "bg-white/10 text-primary" : "text-white/60 hover:bg-white/[0.06] hover:text-white")}
          ><Icon className="h-5 w-5" aria-hidden="true" /></button>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" sideOffset={8} aria-label={t(`mtmSections.${section}`)} className="max-h-[calc(100dvh-2rem)] w-72 max-w-[calc(100vw-5rem)] overflow-y-auto p-2">
          <p className="px-3 pb-3 pt-2 text-sm font-semibold">{t(`mtmSections.${section}`)}</p>
          {section === "attendance" ? attendanceLinks(true) : links(field, true)}
        </PopoverContent>
      </Popover>
    })}
  </div>

  return <div className="space-y-1" data-testid="mtm-sidebar-sections">
    <button type="button" aria-expanded={fieldOpen} aria-controls={`${id}-field`} onClick={() => setFieldOpen(value => !value)}
      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-white/70 outline-none hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-white/60">
      <Route className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="flex-1 text-left">{t("mtmSections.field")}</span><ChevronDown aria-hidden="true" className={cn("h-3.5 w-3.5 shrink-0", !fieldOpen && "-rotate-90")} />
    </button>
    <div id={`${id}-field`} hidden={!fieldOpen}>{field.map(renderFieldItem)}</div>
    <button type="button" aria-expanded={attendanceOpen} aria-controls={`${id}-attendance`} onClick={() => setAttendanceOpen(value => !value)}
      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-white outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/60">
      <UsersRound className={cn("h-4 w-4 shrink-0", inAttendance ? "text-primary" : "text-white/60")} aria-hidden="true" /><span className="flex-1 text-left">{t("mtmSections.attendance")}</span><ChevronDown aria-hidden="true" className={cn("h-3.5 w-3.5 shrink-0", !attendanceOpen && "-rotate-90")} />
    </button>
    <div id={`${id}-attendance`} hidden={!attendanceOpen}>{attendanceLinks()}</div>
  </div>
}
