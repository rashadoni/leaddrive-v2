"use client"

import { useSession } from "next-auth/react"
import { useEffect, useState } from "react"

export function useFieldPermissions(entityType: string) {
  const { data: session } = useSession()
  const [permissions, setPermissions] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!entityType) return
    setLoading(true)
    fetch(`/api/v1/settings/field-permissions?entityType=${entityType}`)
      .then(r => r.json())
      .then(data => {
        if (!data.success || !data.data) return
        const role = (session?.user as any)?.role ?? "viewer"
        const entityPerms = data.data[entityType] || {}
        const rolePerms: Record<string, string> = {}
        for (const [field, roles] of Object.entries(entityPerms)) {
          rolePerms[field] = (roles as any)[role] ?? "editable"
        }
        setPermissions(rolePerms)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [entityType, session])

  return {
    permissions,
    loading,
    isVisible: (field: string) => permissions[field] !== "hidden",
    isEditable: (field: string) => permissions[field] === "editable" || !permissions[field],
    isHidden: (field: string) => permissions[field] === "hidden",
  }
}
