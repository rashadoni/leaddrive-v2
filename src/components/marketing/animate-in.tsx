"use client"

import { useRef, useEffect, useState } from "react"
import { cn } from "@/lib/utils"

interface AnimateInProps {
  children: React.ReactNode
  className?: string
  delay?: number
  as?: "div" | "h2" | "p" | "ul" | "li" | "section"
}

export function AnimateIn({ children, className, delay = 0, as: Tag = "div" }: AnimateInProps) {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!ref.current) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect() } },
      { threshold: 0.05, rootMargin: "50px" }
    )
    obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])

  return (
    <Tag
      ref={ref as any}
      className={cn(
        "transition-all duration-700 ease-out",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
        className
      )}
      style={visible && delay > 0 ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  )
}
