"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function PortalHomePage() {
  const router = useRouter()
  useEffect(() => { router.replace("/portal/tickets") }, [])
  return null
}
