"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { useWallpaper } from "@/hooks/use-wallpaper"
import { VideoBackground } from "@/components/video-background"

/**
 * Renders the selected wallpaper only on the CRM dashboard route.
 * Settings and other modules keep their normal surfaces.
 */
export function DashboardWallpaper() {
  const { wallpaperDef, isWallpaperActive } = useWallpaper()
  const pathname = usePathname()
  const shouldRenderWallpaper = pathname === "/dashboard" && isWallpaperActive && !!wallpaperDef

  useEffect(() => {
    if (shouldRenderWallpaper && wallpaperDef) {
      document.documentElement.setAttribute("data-wallpaper", wallpaperDef.id)
      document.documentElement.setAttribute("data-wallpaper-scope", "dashboard")
    } else {
      document.documentElement.removeAttribute("data-wallpaper")
      document.documentElement.removeAttribute("data-wallpaper-scope")
    }
    return () => {
      document.documentElement.removeAttribute("data-wallpaper")
      document.documentElement.removeAttribute("data-wallpaper-scope")
    }
  }, [shouldRenderWallpaper, wallpaperDef])

  if (!shouldRenderWallpaper) return null

  return <VideoBackground />
}
