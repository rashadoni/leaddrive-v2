"use client"

import { useCallback, useEffect, useState } from "react"
import {
  loadOrganizationFeatures,
  updateOrganizationFeature,
} from "@/lib/client/organization-features"

type OrganizationFeatureState = {
  enabled: boolean
  hasLoaded: boolean
  loading: boolean
  saving: boolean
  error: string | null
  setEnabled: (enabled: boolean) => Promise<boolean>
  reload: () => Promise<void>
}

/**
 * Client adapter for the existing Omnichannel feature-toggle API.
 * Reads and writes the organization flag without creating another endpoint or
 * storage path for each module.
 */
export function useOrganizationFeature(
  feature: string,
  organizationId?: string,
): OrganizationFeatureState {
  const [enabled, setEnabledState] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!organizationId) {
      setHasLoaded(false)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const features = await loadOrganizationFeatures(organizationId)
      setEnabledState(features.includes(feature))
      setHasLoaded(true)
    } catch (cause) {
      setEnabledState(false)
      setHasLoaded(false)
      setError(cause instanceof Error ? cause.message : "Failed to load feature")
    } finally {
      setLoading(false)
    }
  }, [feature, organizationId])

  useEffect(() => {
    void reload()
  }, [reload])

  const setEnabled = useCallback(async (nextEnabled: boolean) => {
    if (!organizationId || saving) return false
    const previous = enabled
    setEnabledState(nextEnabled)
    setSaving(true)
    setError(null)
    try {
      const features = await updateOrganizationFeature(feature, nextEnabled, organizationId)
      setEnabledState(features.includes(feature))
      return true
    } catch (cause) {
      setEnabledState(previous)
      setError(cause instanceof Error ? cause.message : "Failed to update feature")
      return false
    } finally {
      setSaving(false)
    }
  }, [enabled, feature, organizationId, saving])

  return { enabled, hasLoaded, loading, saving, error, setEnabled, reload }
}
