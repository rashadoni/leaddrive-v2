"use client"

interface LogoProps {
  collapsed?: boolean
  size?: "sm" | "md" | "lg"
  /** When true, uses dark: overrides for navy sidebar in dark mode */
  sidebar?: boolean
  className?: string
}

const sizes = {
  sm: { icon: 28, fontSize: 16, crmSize: 13, gap: 6 },
  md: { icon: 36, fontSize: 22, crmSize: 18, gap: 8 },
  lg: { icon: 48, fontSize: 30, crmSize: 26, gap: 10 },
}

export function Logo({ collapsed = false, size = "md", sidebar = false, className = "" }: LogoProps) {
  const s = sizes[size]

  // Sidebar logo: always white text (dark navy sidebar)
  // Normal logo: navy text in light, white in dark
  const textClass = sidebar
    ? "text-white"
    : "text-foreground dark:text-white"
  const crmClass = sidebar
    ? "text-white/50 border-white/20"
    : "text-muted-foreground border-zinc-200 dark:border-zinc-700"

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg
        // Collapsed rail (w-16 minus px-4) leaves 32px: the full mark with
        // bars is s.icon * 1.45 wide and would overflow, so the compact
        // colorway drops the bars and stays square.
        width={collapsed ? s.icon : Math.round(s.icon * 1.45)}
        height={s.icon}
        viewBox={collapsed ? "0 0 1024 1024" : "-460 0 1484 1024"}
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
      >
        {/* «Közərti» mark: amber speed bars + D with chamfered top-left.
            Bars stay amber in every colorway; fade is solid tints, not
            opacity — translucent amber muddies to brown on dark grounds. */}
        {!collapsed && (
          <>
            <polygon fill="#FF6D00" points="-206,418.5 160,418.5 241,337.5 -125,337.5" />
            <polygon fill="#FFA45C" points="-256,552.5 26,552.5 107,471.5 -175,471.5" />
            <polygon fill="#FFCFA8" points="-305,686.5 -108,686.5 -27,605.5 -224,605.5" />
          </>
        )}
        <path
          fillRule="evenodd"
          className={sidebar ? "fill-white" : "fill-foreground dark:fill-white"}
          d="M 370 160 L 420 160 A 352 352 0 0 1 420 864 L 220 864 L 220 440 Z M 420 292 A 220 220 0 0 1 420 732 L 420 732 Z"
        />
      </svg>

      {!collapsed && (
        <div className="flex items-baseline" style={{ gap: s.gap }}>
          <span
            className={`font-bold tracking-tight ${textClass}`}
            style={{ fontSize: s.fontSize, lineHeight: 1 }}
          >
            Lead
            <span className="font-extrabold">Drive</span>
          </span>
          <span
            className={`border-l pl-2 font-light tracking-widest ${crmClass}`}
            style={{ fontSize: s.crmSize, lineHeight: 1 }}
          >
            CRM
          </span>
        </div>
      )}
    </div>
  )
}
