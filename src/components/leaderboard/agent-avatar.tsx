"use client"

/**
 * Agent avatar with a graceful fallback: shows the image when a URL is present
 * AND loads; on a 404 / load error (or no URL) it falls back to coloured
 * initials — never a broken-image glyph.
 */
import { useState } from "react"

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
}

export function AgentAvatar({
  src,
  name,
  ring,
  fill,
  size = 28,
}: {
  src?: string | null
  name: string
  ring: string
  fill: string
  size?: number
}) {
  const [failed, setFailed] = useState(false)
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className="rounded-full object-cover"
        style={{ width: size, height: size, border: `1.5px solid ${ring}` }}
      />
    )
  }
  return (
    <span
      className="flex items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        backgroundColor: `${fill}33`,
        color: ring,
        border: `1.5px solid ${ring}`,
      }}
    >
      {initials(name)}
    </span>
  )
}
